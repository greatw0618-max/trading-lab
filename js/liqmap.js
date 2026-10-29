// 청산맵 탭: 바이낸스·바이빗·OKX·비트겟·하이퍼리퀴드의 15분 OI 변화로 "어느 가격에 청산될 물량이 남아 있나"를 추정합니다.
// 자료는 scripts/liqmap-collect.mjs가 15분마다 liqmap/<코인>.json에 모읍니다. 실제 포지션이 아니라 추정입니다.
// 추정 방식: OI가 늘어난 봉 = 그 봉 평균 가격에 새 포지션 → 롱/숏 비율로 나누고 레버리지별 청산가에 쌓음.
//          OI가 줄면 그 거래소 물량을 같은 비율로 줄임(스스로 정리), 가격이 청산가를 지나가면 지움(청산).
(() => {
  const TA = window.TA, U = TA && TA.ui;
  if (!U) return;
  const { el, fp, fusd, fdt, store } = U;
  const $ = s => document.querySelector(s);
  const cv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const M15 = 900e3, MMR = 0.004; // 유지 증거금 0.4% (청산가가 진입가 쪽으로 조금 당겨짐)
  const EX = [['binance', '바이낸스', '#5b6cff'], ['bybit', '바이빗', '#3fae6a'], ['okx', 'OKX', '#e39be6'], ['bitget', '비트겟', '#9aa3ad'], ['hl', '하이퍼리퀴드', '#a46bff']];
  const LEV = [[10, 0.35], [25, 0.3], [50, 0.2], [100, 0.15]]; // 레버리지별 비중 (고른 것끼리 다시 나눔)
  const TF = { '15m': 1, '1h': 4, '4h': 16 }, RANGE = [3, 7, 14, 30, 60];
  const S = {
    coin: store.get('lmCoin', 'BTC'), view: store.get('lmView', 'map'), tf: store.get('lmTf', '1h'), days: +store.get('lmDays', 14), split: store.get('lmSplit', 'taker'),
    ex: new Set(JSON.parse(store.get('lmEx', '["binance","bybit","okx","bitget","hl"]'))), lev: new Set(JSON.parse(store.get('lmLev', '[10,25,50,100]'))),
    data: {}, model: null, at: null, playing: null, started: false
  };
  const save = () => { store.set('lmCoin', S.coin); store.set('lmView', S.view); store.set('lmTf', S.tf); store.set('lmDays', S.days); store.set('lmSplit', S.split); store.set('lmEx', JSON.stringify([...S.ex])); store.set('lmLev', JSON.stringify([...S.lev])); };

  // ---------- 자료 ----------
  async function loadData(coin, force) {
    if (S.data[coin] && !force) return S.data[coin];
    const r = await fetch(`liqmap/${coin}.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('청산맵 자료가 아직 없습니다 (scripts/liqmap-collect.mjs가 모읍니다)');
    return (S.data[coin] = await r.json());
  }

  // ---------- 추정 모델 ----------
  // 전체 60일을 15분 단위로 한 번 계산하고, 화면 봉(15분·1시간·4시간)이 끝날 때마다 가격별 남은 물량을 저장합니다.
  function niceStep(v) { const p = 10 ** Math.floor(Math.log10(v)), m = v / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; }
  function build(d) {
    const bars = d.bars, N = bars.length; if (N < 10) throw new Error('봉 자료가 부족합니다');
    let lo = Infinity, hi = -Infinity; bars.forEach(b => { if (b[3] < lo) lo = b[3]; if (b[2] > hi) hi = b[2]; });
    const pmin = lo * 0.86, pmax = hi * 1.14, step = niceStep((pmax - pmin) / 700), b0 = Math.floor(pmin / step), nb = Math.ceil(pmax / step) - b0 + 1;
    const priceOf = i => (b0 + i) * step, binOf = p => Math.max(0, Math.min(nb - 1, Math.round(p / step) - b0));
    const levs = LEV.filter(([L]) => S.lev.has(L)), wsum = levs.reduce((t, [, w]) => t + w, 0) || 1;
    const exs = EX.map(e => e[0]).filter(e => S.ex.has(e));
    const L = {}, Sh = {}, last = {};
    exs.forEach(e => { L[e] = new Float64Array(nb); Sh[e] = new Float64Array(nb); last[e] = null; });
    const per = TF[S.tf], from = Math.max(0, N - Math.round(S.days * 96)), snaps = [], cols = [];
    const stats = []; // 봉마다 새로 생김·스스로 사라짐·청산으로 사라짐 (달러, 고른 거래소 합)
    let curStat = { add: 0, close: 0, liq: 0 };
    for (let i = 0; i < N; i++) {
      const [t, o, h, l, c, bnBuy] = bars[i];
      if (i === from) curStat = { add: 0, close: 0, liq: 0 }; // 화면 앞의 봉 기록은 버림
      // 1) 이 봉에서 가격이 지나간 청산가 → 청산
      const lb = binOf(l), hb = binOf(h);
      exs.forEach(e => {
        const A = L[e], B = Sh[e];
        for (let k = lb; k < nb; k++) if (A[k]) { curStat.liq += A[k] * priceOf(k); A[k] = 0; }
        for (let k = 0; k <= hb; k++) if (B[k]) { curStat.liq += B[k] * priceOf(k); B[k] = 0; }
      });
      // 2) 이 봉 동안의 OI 변화 (값이 없는 칸은 직전 값을 이어 씀)
      exs.forEach(e => {
        const end = d.oi[e] && d.oi[e][t + M15];
        if (end == null) return;
        const prev = last[e]; last[e] = end;
        if (prev == null) return; // 첫 값은 기준점
        const dq = end - prev, A = L[e], B = Sh[e];
        if (dq > 0) {
          const own = d.buy[e] && d.buy[e][t];
          const share = S.split === 'taker' ? (own != null ? own : bnBuy) : Math.max(0.15, Math.min(0.85, 0.5 + 0.5 * (h > l ? (c - o) / (h - l) : 0)));
          const px = (h + l + c) / 3;
          levs.forEach(([lev, w]) => {
            const q = dq * w / wsum;
            A[binOf(px * (1 - 1 / lev + MMR))] += q * share; B[binOf(px * (1 + 1 / lev - MMR))] += q * (1 - share);
          });
          curStat.add += dq * px;
        } else if (dq < 0 && prev > 0) {
          const f = end / prev;
          let tot = 0; for (let k = 0; k < nb; k++) { tot += (A[k] + B[k]) * priceOf(k) * (1 - f); A[k] *= f; B[k] *= f; }
          curStat.close += tot;
        }
      });
      // 3) 화면 봉이 끝나는 곳에서 저장
      if (i >= from && ((i - from + 1) % per === 0 || i === N - 1)) {
        const tot = new Float32Array(nb); exs.forEach(e => { const A = L[e], B = Sh[e]; for (let k = 0; k < nb; k++) tot[k] += (A[k] + B[k]) * priceOf(k); });
        const j0 = Math.max(from, i - per + 1);
        let O = bars[j0][1], Hh = -Infinity, Ll = Infinity; for (let j = j0; j <= i; j++) { if (bars[j][2] > Hh) Hh = bars[j][2]; if (bars[j][3] < Ll) Ll = bars[j][3]; }
        snaps.push(tot); cols.push({ t: bars[j0][0], o: O, h: Hh, l: Ll, c: c, i, stat: curStat });
        curStat = { add: 0, close: 0, liq: 0 };
      }
    }
    return { nb, step, b0, priceOf, binOf, snaps, cols, exs, price: bars[N - 1][4], updated: d.updated, first: d.first };
  }
  // 가격대별: 거래소별 롱/숏 배열이 필요해서 따로 계산 (같은 규칙)
  function exState(d, upto) {
    const m = S.model, { nb, priceOf, binOf } = m;
    const levs = LEV.filter(([L]) => S.lev.has(L)), wsum = levs.reduce((t, [, w]) => t + w, 0) || 1;
    const L = {}, Sh = {}, last = {}; m.exs.forEach(e => { L[e] = new Float64Array(nb); Sh[e] = new Float64Array(nb); last[e] = null; });
    for (let i = 0; i <= upto; i++) {
      const [t, o, h, l, c, bnBuy] = d.bars[i], lb = binOf(l), hb = binOf(h);
      m.exs.forEach(e => {
        const A = L[e], B = Sh[e];
        for (let k = lb; k < nb; k++) A[k] = 0;
        for (let k = 0; k <= hb; k++) B[k] = 0;
        const end = d.oi[e] && d.oi[e][t + M15]; if (end == null) return;
        const prev = last[e]; last[e] = end; if (prev == null) return;
        const dq = end - prev;
        if (dq > 0) {
          const own = d.buy[e] && d.buy[e][t];
          const share = S.split === 'taker' ? (own != null ? own : bnBuy) : Math.max(0.15, Math.min(0.85, 0.5 + 0.5 * (h > l ? (c - o) / (h - l) : 0)));
          const px = (h + l + c) / 3;
          levs.forEach(([lev, w]) => { const q = dq * w / wsum; A[binOf(px * (1 - 1 / lev + MMR))] += q * share; B[binOf(px * (1 + 1 / lev - MMR))] += q * (1 - share); });
        } else if (dq < 0 && prev > 0) { const f = end / prev; for (let k = 0; k < nb; k++) { A[k] *= f; B[k] *= f; } }
      });
    }
    return { L, S: Sh, price: d.bars[upto][4], t: d.bars[upto][0] };
  }

  // ---------- 색 ----------
  const STOPS = [[0, [10, 14, 60]], [0.18, [20, 40, 140]], [0.38, [20, 140, 170]], [0.55, [60, 190, 120]], [0.72, [230, 220, 60]], [0.86, [245, 140, 30]], [1, [235, 40, 30]]];
  const colorAt = v => { v = Math.max(0, Math.min(1, v)); let k = 1; while (k < STOPS.length - 1 && STOPS[k][0] < v) k++; const [a, ca] = STOPS[k - 1], [b, cb] = STOPS[k], f = (v - a) / (b - a || 1); return ca.map((x, i) => Math.round(x + (cb[i] - x) * f)); };

  // ---------- 화면: 지도 ----------
  function drawMap() {
    const box = $('#lmCanvasBox'), m = S.model; box.textContent = '';
    const W = Math.max(320, box.clientWidth), H = Math.min(620, Math.max(380, Math.round(W * 0.5)));
    const cnv = el('canvas', { width: W * devicePixelRatio, height: H * devicePixelRatio, style: `width:${W}px;height:${H}px;display:block` });
    box.append(cnv);
    const g = cnv.getContext('2d'); g.scale(devicePixelRatio, devicePixelRatio);
    const histW = Math.min(150, Math.round(W * 0.14)), axisW = 64, padB = 22, mapW = W - histW - axisW, mapH = H - padB;
    const cols = m.cols; if (!cols.length) return;
    let lo = Infinity, hi = -Infinity; cols.forEach(c => { if (c.l < lo) lo = c.l; if (c.h > hi) hi = c.h; });
    const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
    const yOf = p => (hi - p) / (hi - lo) * mapH, pOf = y => hi - y / mapH * (hi - lo);
    // 색 기준: 보이는 칸들의 98% 값
    const kLo = m.binOf(lo), kHi = m.binOf(hi), vals = [];
    for (let x = 0; x < cols.length; x += Math.max(1, Math.floor(cols.length / 200))) for (let k = kLo; k <= kHi; k += 2) { const v = m.snaps[x][k]; if (v > 0) vals.push(v); }
    vals.sort((a, b) => a - b); const vmax = vals.length ? vals[Math.floor(vals.length * 0.98)] : 1;
    const img = g.createImageData(Math.max(1, Math.floor(mapW * devicePixelRatio)), Math.max(1, Math.floor(mapH * devicePixelRatio)));
    const iw = img.width, ih = img.height;
    for (let px = 0; px < iw; px++) {
      const ci = Math.min(cols.length - 1, Math.floor(px / iw * cols.length)), snap = m.snaps[ci];
      for (let py = 0; py < ih; py++) {
        const p = pOf(py / devicePixelRatio), v = snap[m.binOf(p)], [r, gg, b] = colorAt(Math.sqrt(v / vmax));
        const o = (py * iw + px) * 4; img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0); // putImageData는 scale을 무시하므로 장치 픽셀 기준으로 그렸습니다
    // 봉
    const cw = mapW / cols.length, up = '#3ddc97', dn = '#ff5a6a';
    cols.forEach((c, x) => {
      const cx = x * cw + cw / 2; g.strokeStyle = c.c >= c.o ? up : dn; g.lineWidth = 1;
      g.beginPath(); g.moveTo(cx, yOf(c.h)); g.lineTo(cx, yOf(c.l)); g.stroke();
      if (cw >= 3) { g.fillStyle = g.strokeStyle; const y1 = yOf(Math.max(c.o, c.c)), y2 = yOf(Math.min(c.o, c.c)); g.fillRect(cx - cw * 0.35, y1, cw * 0.7, Math.max(1, y2 - y1)); }
    });
    // 현재가
    const yp = yOf(m.price); g.setLineDash([4, 3]); g.strokeStyle = '#ffffff'; g.beginPath(); g.moveTo(0, yp); g.lineTo(mapW + histW, yp); g.stroke(); g.setLineDash([]);
    // 오른쪽: 지금 남은 물량 (위 = 숏 청산, 아래 = 롱 청산)
    const now = m.snaps[m.snaps.length - 1]; let hm = 0; for (let k = kLo; k <= kHi; k++) hm = Math.max(hm, now[k]);
    g.fillStyle = cv('--panel'); g.fillRect(mapW, 0, histW + axisW, H);
    for (let k = kLo; k <= kHi; k++) {
      const p = m.priceOf(k), v = now[k]; if (!v) continue;
      const y = yOf(p + m.step / 2), hgt = Math.max(1, yOf(p - m.step / 2) - y);
      g.fillStyle = p > m.price ? '#f15f69' : '#2bc3a5'; g.fillRect(mapW + 4, y, (histW - 8) * v / hm, hgt);
    }
    // 가격 축
    g.fillStyle = cv('--muted'); g.font = '11px JetBrains Mono, Consolas, monospace'; g.textAlign = 'left';
    const ps = niceStep((hi - lo) / 8); for (let p = Math.ceil(lo / ps) * ps; p < hi; p += ps) g.fillText(fp(p), mapW + histW + 6, yOf(p) + 4);
    g.fillStyle = '#ffffff'; g.fillRect(mapW + histW + 2, yp - 8, axisW - 4, 16); g.fillStyle = '#000'; g.fillText(fp(m.price), mapW + histW + 6, yp + 4);
    // 날짜 축
    g.fillStyle = cv('--muted'); g.textAlign = 'center';
    const every = Math.max(1, Math.round(cols.length / 7)); for (let x = 0; x < cols.length; x += every) g.fillText(fdt(cols[x].t / 1000).slice(0, 5), x * cw, H - 6);
    // 마우스: 시각·가격·남은 물량
    const tip = $('#lmTip');
    cnv.onmousemove = e => {
      const r = cnv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (x > mapW || y > mapH) { tip.hidden = true; return; }
      const ci = Math.min(cols.length - 1, Math.floor(x / cw)), p = pOf(y), v = m.snaps[ci][m.binOf(p)];
      tip.hidden = false; tip.style.left = Math.min(x + 14, W - 200) + 'px'; tip.style.top = (y + 14) + 'px';
      tip.textContent = `${fdt(cols[ci].t / 1000)} · ${fp(p)} · ${p > cols[ci].c ? '숏' : '롱'} 청산 대기 ${fusd(v)}`;
    };
    cnv.onmouseleave = () => { tip.hidden = true; };
    // 위 요약
    let sumL = 0, sumS = 0; for (let k = kLo; k <= kHi; k++) { if (m.priceOf(k) > m.price) sumS += now[k]; else sumL += now[k]; }
    $('#lmSum').innerHTML = '';
    $('#lmSum').append(`${fdt(m.updated / 1000)} 기준 · 화면 안 남은 `, el('b', { class: 'up', text: `롱 청산 ${fusd(sumL)}` }), ' · ', el('b', { class: 'down', text: `숏 청산 ${fusd(sumS)}` }));
  }

  // ---------- 화면: 가격대별 ----------
  function drawPrice() {
    const box = $('#lmCanvasBox'), m = S.model, d = S.data[S.coin]; box.textContent = '';
    const cols = m.cols; if (S.at == null || S.at >= cols.length) S.at = cols.length - 1;
    const col = cols[S.at], st = exState(d, col.i);
    const W = Math.max(320, box.clientWidth), H = Math.min(560, Math.max(380, Math.round(W * 0.46)));
    const cnv = el('canvas', { width: W * devicePixelRatio, height: H * devicePixelRatio, style: `width:${W}px;height:${H}px;display:block` });
    box.append(cnv);
    const g = cnv.getContext('2d'); g.scale(devicePixelRatio, devicePixelRatio);
    const topH = 70, padL = 64, padR = 64, padB = 24, plotT = topH + 16, plotH = H - plotT - padB, plotW = W - padL - padR;
    // 위: 가격 흐름과 고른 시점
    let lo = Infinity, hi = -Infinity; cols.forEach(c => { if (c.l < lo) lo = c.l; if (c.h > hi) hi = c.h; });
    g.strokeStyle = cv('--muted'); g.lineWidth = 1; g.beginPath();
    cols.forEach((c, x) => { const X = padL + x / (cols.length - 1 || 1) * plotW, Y = 6 + (hi - c.c) / (hi - lo || 1) * (topH - 12); x ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.stroke();
    const mx = padL + S.at / (cols.length - 1 || 1) * plotW; g.strokeStyle = '#e0b84a'; g.lineWidth = 2; g.beginPath(); g.moveTo(mx, 0); g.lineTo(mx, topH); g.stroke();
    // 가격 칸 묶기: 현재가 ±20%를 약 260칸으로
    const p0 = st.price * 0.8, p1 = st.price * 1.2, groupN = Math.max(1, Math.round((p1 - p0) / m.step / 260)), gs = m.step * groupN;
    const nG = Math.ceil((p1 - p0) / gs), byEx = m.exs.map(() => new Float64Array(nG)), side = new Int8Array(nG);
    for (let k = m.binOf(p0); k <= m.binOf(p1); k++) {
      const p = m.priceOf(k), gi = Math.floor((p - p0) / gs); if (gi < 0 || gi >= nG) continue;
      m.exs.forEach((e, ei) => { byEx[ei][gi] += (st.L[e][k] + st.S[e][k]) * p; });
      side[gi] = p > st.price ? -1 : 1;
    }
    const tot = Array.from({ length: nG }, (_, i) => byEx.reduce((t, a) => t + a[i], 0)), vmax = Math.max(...tot, 1);
    // 누적선: 현재가에서 바깥으로
    const cumL = new Float64Array(nG), cumS = new Float64Array(nG);
    const pi = Math.floor((st.price - p0) / gs);
    for (let i = pi, s = 0; i >= 0; i--) { s += side[i] > 0 ? tot[i] : 0; cumL[i] = s; }
    for (let i = pi + 1, s = 0; i < nG; i++) { s += side[i] < 0 ? tot[i] : 0; cumS[i] = s; }
    const cmax = Math.max(cumL[0] || 0, cumS[nG - 1] || 0, 1);
    const xOf = i => padL + i / nG * plotW, yV = v => plotT + plotH - v / vmax * plotH, yC = v => plotT + plotH - v / cmax * plotH;
    const bw = plotW / nG;
    for (let i = 0; i < nG; i++) { let y = plotT + plotH; m.exs.forEach((e, ei) => { const v = byEx[ei][i]; if (!v) return; const hgt = v / vmax * plotH; g.fillStyle = EX.find(x => x[0] === e)[2]; g.fillRect(xOf(i), y - hgt, Math.max(1, bw - 0.5), hgt); y -= hgt; }); }
    g.lineWidth = 2; g.strokeStyle = '#3ddc97'; g.beginPath(); for (let i = 0; i <= pi; i++) { const X = xOf(i) + bw / 2, Y = yC(cumL[i]); i ? g.lineTo(X, Y) : g.moveTo(X, Y); } g.stroke();
    g.strokeStyle = '#f15f69'; g.beginPath(); for (let i = pi + 1; i < nG; i++) { const X = xOf(i) + bw / 2, Y = yC(cumS[i]); i > pi + 1 ? g.lineTo(X, Y) : g.moveTo(X, Y); } g.stroke();
    const xp = padL + (st.price - p0) / (p1 - p0) * plotW; g.setLineDash([4, 3]); g.strokeStyle = '#3ddc97'; g.lineWidth = 1; g.beginPath(); g.moveTo(xp, plotT); g.lineTo(xp, plotT + plotH); g.stroke(); g.setLineDash([]);
    g.fillStyle = cv('--fg'); g.font = 'bold 12px JetBrains Mono, Consolas, monospace'; g.textAlign = 'center'; g.fillText(`가격 ${fp(st.price)}`, xp, plotT - 4);
    // 축
    g.font = '11px JetBrains Mono, Consolas, monospace'; g.fillStyle = cv('--muted');
    g.textAlign = 'right'; for (let f = 0; f <= 1; f += 0.25) g.fillText(fusd(vmax * f), padL - 6, yV(vmax * f) + 4);
    g.textAlign = 'left'; for (let f = 0; f <= 1; f += 0.25) g.fillText(fusd(cmax * f), padL + plotW + 6, yC(cmax * f) + 4);
    g.textAlign = 'center'; const ps = niceStep((p1 - p0) / 8); for (let p = Math.ceil(p0 / ps) * ps; p < p1; p += ps) g.fillText(fp(p), padL + (p - p0) / (p1 - p0) * plotW, H - 6);
    // 범례
    g.textAlign = 'left'; m.exs.forEach((e, ei) => { const [, nm, c] = EX.find(x => x[0] === e); g.fillStyle = c; g.fillRect(W - padR - 110, plotT + 6 + ei * 16, 10, 10); g.fillStyle = cv('--fg'); g.fillText(nm, W - padR - 95, plotT + 15 + ei * 16); });
    // 마우스
    const tip = $('#lmTip');
    cnv.onmousemove = e => {
      const r = cnv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, i = Math.floor((x - padL) / bw);
      if (y < plotT || i < 0 || i >= nG) { tip.hidden = true; return; }
      const a = p0 + i * gs, dp = ((a + gs / 2) / st.price - 1) * 100;
      tip.hidden = false; tip.style.left = Math.min(x + 14, W - 240) + 'px'; tip.style.top = (y + 10) + 'px';
      tip.textContent = `${fp(a)} ~ ${fp(a + gs)} · 현재가 ${dp > 0 ? '위' : '아래'} ${dp.toFixed(1)}% · ${side[i] < 0 ? '숏' : '롱'} 청산 자리 · ` + (tot[i] ? m.exs.map((e, ei) => byEx[ei][i] ? `${EX.find(x => x[0] === e)[1]} ${fusd(byEx[ei][i])}` : '').filter(Boolean).join(' · ') : '물량 없음');
    };
    cnv.onmouseleave = () => { tip.hidden = true; };
    // 위 요약 + 시점 표시
    $('#lmSum').innerHTML = '';
    $('#lmSum').append(`${fdt(col.t / 1000)} 시점 · 아래 롱 누적 `, el('b', { class: 'up', text: fusd(cumL[0] || 0) }), ' · 위 숏 누적 ', el('b', { class: 'down', text: fusd(cumS[nG - 1] || 0) }),
      ` · 이번 봉: 새로 생김 ${fusd(col.stat.add)} · 스스로 사라짐 ${fusd(col.stat.close)} · 청산으로 사라짐 ${fusd(col.stat.liq)}`);
    $('#lmSlider').max = cols.length - 1; $('#lmSlider').value = S.at; $('#lmAt').textContent = fdt(col.t / 1000);
  }

  // ---------- 조작 ----------
  function syncButtons() {
    const set = (id, cur) => document.querySelectorAll(`#${id} button`).forEach(b => b.setAttribute('aria-pressed', String(cur(b.dataset.v))));
    set('lmCoinSeg', v => v === S.coin); set('lmViewSeg', v => v === S.view); set('lmTfSeg', v => v === S.tf); set('lmDaysSeg', v => +v === S.days); set('lmSplitSeg', v => v === S.split);
    set('lmExSeg', v => v === 'all' ? S.ex.size === EX.length : S.ex.has(v)); set('lmLevSeg', v => S.lev.has(+v));
    $('#lmTime').hidden = S.view !== 'price';
  }
  async function refresh(force) {
    const note = $('#lmNote');
    try {
      note.textContent = '청산맵을 계산하는 중…';
      const d = await loadData(S.coin, force);
      if (!S.ex.size || !S.lev.size) { note.textContent = '거래소와 배수를 하나 이상 고르세요.'; return; }
      S.model = build(d);
      const fst = EX.filter(([e]) => S.ex.has(e)).map(([e, nm]) => `${nm} ${d.first && d.first[e] ? fdt(d.first[e] / 1000).slice(0, 5) : '-'}부터`).join(' · ');
      note.textContent = `${S.coin} · ${EX.filter(([e]) => S.ex.has(e)).map(x => x[1]).join(' + ')} · ${[...S.lev].sort((a, b) => a - b).map(x => x + 'x').join(' ')} · OI 자료: ${fst} (자료가 시작된 뒤에 생긴 물량만 보입니다) · 롱/숏 나누기: ${S.split === 'taker' ? '시장가 매수 비율' : '봉 방향(킹피셔식)'} · 실제 포지션이 아닌 추정`;
      if (S.view === 'map') drawMap(); else drawPrice();
    } catch (e) { note.textContent = e.message; }
  }
  function bind() {
    const seg = (id, f) => $('#' + id).addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; f(b.dataset.v); save(); syncButtons(); refresh(); });
    seg('lmCoinSeg', v => { S.coin = v; S.at = null; });
    seg('lmViewSeg', v => { S.view = v; });
    seg('lmTfSeg', v => { S.tf = v; S.at = null; });
    seg('lmDaysSeg', v => { S.days = +v; S.at = null; });
    seg('lmSplitSeg', v => { S.split = v; });
    seg('lmExSeg', v => { if (v === 'all') { S.ex = new Set(EX.map(x => x[0])); } else if (S.ex.has(v)) S.ex.delete(v); else S.ex.add(v); });
    seg('lmLevSeg', v => { v = +v; if (S.lev.has(v)) S.lev.delete(v); else S.lev.add(v); });
    $('#lmSlider').addEventListener('input', e => { S.at = +e.target.value; drawPrice(); });
    $('#lmPrev').addEventListener('click', () => { S.at = Math.max(0, (S.at ?? 0) - 1); drawPrice(); });
    $('#lmNext').addEventListener('click', () => { S.at = Math.min(S.model.cols.length - 1, (S.at ?? 0) + 1); drawPrice(); });
    $('#lmEnd').addEventListener('click', () => { S.at = S.model.cols.length - 1; drawPrice(); });
    $('#lmPlay').addEventListener('click', e => {
      if (S.playing) { clearInterval(S.playing); S.playing = null; e.target.textContent = '재생'; return; }
      if (S.at >= S.model.cols.length - 1) S.at = 0;
      e.target.textContent = '멈춤';
      S.playing = setInterval(() => { if (S.at >= S.model.cols.length - 1 || U.activeTab() !== 'liq') { clearInterval(S.playing); S.playing = null; e.target.textContent = '재생'; return; } S.at++; drawPrice(); }, 120);
    });
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (U.activeTab() === 'liq' && S.model) (S.view === 'map' ? drawMap : drawPrice)(); }, 200); });
  }
  function start() {
    if (S.started) { refresh(); return; }
    S.started = true; bind(); syncButtons(); refresh();
    // 새 자료 확인 (수집은 15분마다)
    setInterval(async () => {
      if (U.activeTab() !== 'liq' || document.hidden || S.playing) return;
      try { const r = await fetch('liqmap/index.json?v=' + Date.now(), { cache: 'no-store' }); const x = await r.json(); if (S.model && x.updated > S.model.updated) { delete S.data[S.coin]; refresh(true); } } catch (e) {}
    }, 120e3);
  }
  window.addEventListener('tabchange', e => { if (e.detail === 'liq') start(); });
  if (U.activeTab() === 'liq') start();
})();
