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
  // 새 포지션은 한 가격에 몰지 않고 퍼뜨립니다: 진입가는 그 봉 저가~고가 사이 다섯 곳, 배수는 고른 배수 근처 세 개 (예: 10배 → 8·10·12.5배)
  const ENTRY = [0.1, 0.3, 0.5, 0.7, 0.9], LSPREAD = [0.8, 1, 1.25];
  function addPos(A, B, binOf, levs, wsum, dq, share, h, l) {
    const n = ENTRY.length * LSPREAD.length;
    levs.forEach(([lev, w]) => {
      const q = dq * w / wsum / n, qa = q * share, qb = q * (1 - share);
      ENTRY.forEach(f => { const px = l + (h - l) * f; LSPREAD.forEach(s => { const L = lev * s; A[binOf(px * (1 - 1 / L + MMR))] += qa; B[binOf(px * (1 + 1 / L - MMR))] += qb; }); });
    });
  }
  const TF = { '15m': 1, '1h': 4, '4h': 16 }, RANGE = [3, 7, 14, 30, 60];
  const S = {
    coin: store.get('lmCoin', 'BTC'), view: store.get('lmView', 'map'), tf: store.get('lmTf', '1h'), days: +store.get('lmDays', 14), split: store.get('lmSplit', 'taker'),
    ex: new Set(JSON.parse(store.get('lmEx', '["binance","bybit","okx","bitget","hl"]'))), lev: new Set(JSON.parse(store.get('lmLev', '[10,25,50,100]'))),
    data: {}, seen: {}, model: null, at: null, playing: null, started: false
  };
  const save = () => { store.set('lmCoin', S.coin); store.set('lmView', S.view); store.set('lmTf', S.tf); store.set('lmDays', S.days); store.set('lmSplit', S.split); store.set('lmEx', JSON.stringify([...S.ex])); store.set('lmLev', JSON.stringify([...S.lev])); };

  // ---------- 자료 ----------
  // 수집기는 코인 파일을 다 쓴 뒤 index.json의 updated를 바꿉니다. 받아 둔 자료가 그보다 옛것이면 다시 받습니다.
  async function indexTime() {
    try { const r = await fetch('liqmap/index.json?v=' + Date.now(), { cache: 'no-store' }); return (await r.json()).updated || 0; } catch (e) { return 0; }
  }
  async function loadData(coin, force) {
    const idx = await indexTime();
    if (S.data[coin] && !force && !(idx > (S.seen[coin] || 0))) return S.data[coin];
    const r = await fetch(`liqmap/${coin}.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('청산맵 자료가 아직 없습니다 (scripts/liqmap-collect.mjs가 모읍니다)');
    S.data[coin] = await r.json(); S.seen[coin] = idx;
    return S.data[coin];
  }

  // ---------- 추정 모델 ----------
  // 전체 60일을 15분 단위로 한 번 계산하고, 화면 봉(15분·1시간·4시간)이 끝날 때마다 가격별 남은 물량을 저장합니다.
  function niceStep(v) { const p = 10 ** Math.floor(Math.log10(v)), m = v / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; }
  function build(d, opt = S) { // opt: { ex, lev, days, tf, split } — 청산 라인 탭도 같은 계산을 씁니다
    const bars = d.bars, N = bars.length; if (N < 10) throw new Error('봉 자료가 부족합니다');
    let lo = Infinity, hi = -Infinity; bars.forEach(b => { if (b[3] < lo) lo = b[3]; if (b[2] > hi) hi = b[2]; });
    const pmin = lo * 0.86, pmax = hi * 1.14, step = niceStep((pmax - pmin) / 700), b0 = Math.floor(pmin / step), nb = Math.ceil(pmax / step) - b0 + 1;
    const priceOf = i => (b0 + i) * step, binOf = p => Math.max(0, Math.min(nb - 1, Math.round(p / step) - b0));
    const levs = LEV.filter(([L]) => opt.lev.has(L)), wsum = levs.reduce((t, [, w]) => t + w, 0) || 1;
    const exs = EX.map(e => e[0]).filter(e => opt.ex.has(e));
    const L = {}, Sh = {}, last = {};
    exs.forEach(e => { L[e] = new Float64Array(nb); Sh[e] = new Float64Array(nb); last[e] = null; });
    const per = TF[opt.tf], from = Math.max(0, N - Math.round(opt.days * 96)), snaps = [], cols = [];
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
        if (!(end > 0)) return; // 0·빈 값은 잘못 들어온 자료로 보고 건너뜀 (OKX가 가끔 0을 줌 → 전부 지웠다 다시 쌓아 지도가 끊겨 보였음)
        const prev = last[e]; last[e] = end;
        if (prev == null) return; // 첫 값은 기준점
        const dq = end - prev, A = L[e], B = Sh[e];
        if (dq > 0) {
          const own = d.buy[e] && d.buy[e][t];
          const share = opt.split === 'taker' ? (own != null ? own : bnBuy) : Math.max(0.15, Math.min(0.85, 0.5 + 0.5 * (h > l ? (c - o) / (h - l) : 0)));
          addPos(A, B, binOf, levs, wsum, dq, share, h, l);
          curStat.add += dq * (h + l + c) / 3;
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
    return { nb, step, b0, priceOf, binOf, snaps, cols, exs, price: bars[N - 1][4], last: bars[N - 1][0], updated: d.updated, first: d.first };
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
        const end = d.oi[e] && d.oi[e][t + M15]; if (!(end > 0)) return;
        const prev = last[e]; last[e] = end; if (prev == null) return;
        const dq = end - prev;
        if (dq > 0) {
          const own = d.buy[e] && d.buy[e][t];
          const share = S.split === 'taker' ? (own != null ? own : bnBuy) : Math.max(0.15, Math.min(0.85, 0.5 + 0.5 * (h > l ? (c - o) / (h - l) : 0)));
          addPos(A, B, binOf, levs, wsum, dq, share, h, l);
        } else if (dq < 0 && prev > 0) { const f = end / prev; for (let k = 0; k < nb; k++) { A[k] *= f; B[k] *= f; } }
      });
    }
    return { L, S: Sh, price: d.bars[upto][4], t: d.bars[upto][0] };
  }

  // ---------- 실시간 (바이낸스 선물): 15분봉 가격과 강제청산 ----------
  // 청산 물량 지도는 15분 수집 자료 그대로 두고, 캔들·현재가·강제청산 점만 실시간으로 움직입니다.
  const LIVE = { coin: null, bars: new Map(), ws: null, liq: [], liqWs: null, since: null, timer: null };
  const LIQ_COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'HYPE'];
  async function liveStart(coin) {
    if (LIVE.coin === coin && LIVE.ws) return;
    if (LIVE.ws) { LIVE.ws.onclose = null; LIVE.ws.close(); LIVE.ws = null; }
    LIVE.coin = coin; LIVE.bars = new Map();
    const put = k => LIVE.bars.set(+k[0], [+k[0], +k[1], +k[2], +k[3], +k[4]]);
    try { (await (await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${coin}USDT&interval=15m&limit=8`)).json()).forEach(put); } catch (e) {}
    if (LIVE.coin !== coin) return;
    try {
      const ws = new WebSocket(`wss://fstream.binance.com/market/ws/${coin.toLowerCase()}usdt@kline_15m`); LIVE.ws = ws;
      ws.onmessage = e => { try { const k = JSON.parse(e.data).k; put([k.t, k.o, k.h, k.l, k.c]); liveDraw(); } catch (err) {} };
      ws.onclose = () => { if (LIVE.ws !== ws) return; LIVE.ws = null; setTimeout(() => { if (LIVE.coin === coin && !LIVE.ws) liveStart(coin); }, 10e3); };
    } catch (e) {}
    liveDraw();
  }
  function liqStart() {
    if (LIVE.liqWs) return;
    try {
      const ws = new WebSocket('wss://fstream.binance.com/market/ws/!forceOrder@arr'); LIVE.liqWs = ws;
      ws.onopen = () => { if (LIVE.since == null) LIVE.since = Date.now(); };
      ws.onmessage = e => {
        try {
          const o = JSON.parse(e.data).o, c = o.s.replace(/USDT$/, ''); if (!LIQ_COINS.includes(c)) return;
          LIVE.liq.push({ t: o.T, c, long: o.S === 'SELL', p: +o.ap, usd: +o.z * +o.ap }); // SELL = 롱 포지션이 강제로 팔림
          const cut = Date.now() - 864e5; while (LIVE.liq.length && LIVE.liq[0].t < cut) LIVE.liq.shift();
          if (c === S.coin) liveDraw();
        } catch (err) {}
      };
      ws.onclose = () => { LIVE.liqWs = null; setTimeout(liqStart, 30e3); };
    } catch (e) {}
  }
  // 화면이 너무 자주 다시 그려지지 않게 2초에 한 번만
  function liveDraw() {
    if (LIVE.timer || U.activeTab() !== 'liq' || document.hidden || !S.model || S.playing) return;
    LIVE.timer = setTimeout(() => { LIVE.timer = null; if (U.activeTab() === 'liq' && S.model && !S.playing) (S.view === 'map' ? drawMap : drawPrice)(); }, 2000);
  }
  // 수집 자료 뒤에 나온 바이낸스 15분봉을 화면 봉에 이어 붙입니다. lo~hi는 그 사이 가격이 지나간 범위 (그 안의 청산가는 이미 청산된 것으로 봄)
  function liveView(m) {
    const out = { cols: m.cols, price: m.price, lo: Infinity, hi: -Infinity, on: false };
    if (LIVE.coin !== S.coin || !m.cols.length) return out;
    const per = TF[S.tf] * M15, bars = [...LIVE.bars.values()].filter(b => b[0] >= m.last).sort((a, b) => a[0] - b[0]);
    if (!bars.length) return out;
    const cols = m.cols.slice(); let cur = { ...cols[cols.length - 1] }; cols[cols.length - 1] = cur;
    bars.forEach(([t, o, h, l, c]) => {
      if (t > m.last && t - cur.t >= per) { cur = { t: cur.t + Math.floor((t - cur.t) / per) * per, o, h, l, c, i: cur.i, stat: { add: 0, close: 0, liq: 0 }, live: true }; cols.push(cur); }
      else { cur.h = Math.max(cur.h, h); cur.l = Math.min(cur.l, l); cur.c = c; }
      out.lo = Math.min(out.lo, l); out.hi = Math.max(out.hi, h);
    });
    return Object.assign(out, { cols, price: bars[bars.length - 1][4], on: true });
  }
  const liqOf = (coin, from) => LIVE.liq.filter(x => x.c === coin && x.t >= from);
  function liqNote(coin) {
    if (LIVE.since == null) return '실시간 강제청산: 바이낸스 연결 중…';
    const g = liqOf(coin, LIVE.since), L = g.filter(x => x.long).reduce((t, x) => t + x.usd, 0), Sh = g.filter(x => !x.long).reduce((t, x) => t + x.usd, 0);
    return `실시간 강제청산 (바이낸스, ${fdt(LIVE.since / 1000).slice(-5)}부터 ${g.length}건): 롱 ${fusd(L)} · 숏 ${fusd(Sh)}`;
  }

  // ---------- 색 ----------
  const STOPS = [[0, [10, 14, 60]], [0.18, [20, 40, 140]], [0.38, [20, 140, 170]], [0.55, [60, 190, 120]], [0.72, [230, 220, 60]], [0.86, [245, 140, 30]], [1, [235, 40, 30]]];
  const colorAt = v => { v = Math.max(0, Math.min(1, v)); let k = 1; while (k < STOPS.length - 1 && STOPS[k][0] < v) k++; const [a, ca] = STOPS[k - 1], [b, cb] = STOPS[k], f = (v - a) / (b - a || 1); return ca.map((x, i) => Math.round(x + (cb[i] - x) * f)); };
  // 색 기준: 보이는 칸 중 상위 0.5% 물량을 빨강 끝으로, 지수 0.8 (작을수록 중간 물량이 밝아짐). 큰 덩어리만 빨갛게 튀도록 맞춤
  const COLOR_PCT = 0.995, COLOR_GAMMA = 0.8;
  const LUT = Array.from({ length: 256 }, (_, k) => colorAt(k / 255)); // 색칠을 빠르게 하려고 미리 계산

  // ---------- 화면: 지도 ----------
  function drawMap() {
    const box = $('#lmCanvasBox'), m = S.model; box.textContent = '';
    const W = Math.max(320, box.clientWidth), H = Math.min(620, Math.max(380, Math.round(W * 0.5)));
    const cnv = el('canvas', { width: W * devicePixelRatio, height: H * devicePixelRatio, style: `width:${W}px;height:${H}px;display:block` });
    box.append(cnv);
    const g = cnv.getContext('2d'); g.scale(devicePixelRatio, devicePixelRatio);
    const histW = Math.min(150, Math.round(W * 0.14)), axisW = 64, padB = 22, mapW = W - histW - axisW, mapH = H - padB;
    const lv = liveView(m), cols = lv.cols, price = lv.price, n = cols.length; if (!n) return;
    const snapAt = ci => m.snaps[Math.min(ci, m.snaps.length - 1)]; // 실시간으로 붙인 봉은 마지막 수집 시점의 지도
    // 보이는 범위: 봉 a~b (확대·이동 안 했으면 전체), 가격 lo~hi (안 정했으면 보이는 봉에 맞춤)
    const z = S.zoom;
    if (z && z.n !== n) { if (z.b >= z.n - 0.5) { z.a += n - z.n; z.b += n - z.n; } z.n = n; } // 오른쪽 끝을 보고 있었으면 새 봉을 따라감
    const a = z ? z.a : 0, b = z ? z.b : n;
    let lo = Infinity, hi = -Infinity;
    for (let i = Math.max(0, Math.floor(a)); i < Math.min(n, Math.ceil(b)); i++) { if (cols[i].l < lo) lo = cols[i].l; if (cols[i].h > hi) hi = cols[i].h; }
    if (!isFinite(lo)) { lo = price * 0.95; hi = price * 1.05; }
    const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
    if (z && z.lo != null) { lo = z.lo; hi = z.hi; }
    S.geo = { kind: 'map', mapW, mapH, histW, a, b, lo, hi, n };
    const yOf = p => (hi - p) / (hi - lo) * mapH, pOf = y => hi - y / mapH * (hi - lo);
    const cw = mapW / (b - a), xOf = i => (i - a) * cw; // i = 봉 번호 (소수 가능)
    const kLo = m.binOf(lo), kHi = m.binOf(hi);
    // 지도 색칠은 무거워서, 보이는 범위·크기가 같으면 전에 칠한 그림을 다시 씁니다
    const key = [W, H, devicePixelRatio, n, a, b, lo, hi].join('|');
    if (!S.img || S.img.model !== m || S.img.key !== key) {
      // 색 기준: 보이는 칸들의 98% 값
      const vals = [], i0 = Math.max(0, Math.floor(a)), i1 = Math.min(n, Math.ceil(b));
      for (let x = i0; x < i1; x += Math.max(1, Math.floor((i1 - i0) / 200))) { const s = snapAt(x); for (let k = kLo; k <= kHi; k += 2) { const v = (s[k] * 3 + ((s[k - 1] || 0) + (s[k + 1] || 0)) * 2 + (s[k - 2] || 0) + (s[k + 2] || 0)) / 9; if (v > 0) vals.push(v); } }
      vals.sort((p, q) => p - q); const vmax = vals.length ? vals[Math.floor(vals.length * COLOR_PCT)] : 1;
      const img = g.createImageData(Math.max(1, Math.floor(mapW * devicePixelRatio)), Math.max(1, Math.floor(mapH * devicePixelRatio)));
      const iw = img.width, ih = img.height, D = img.data, bin = new Int32Array(ih), c0 = LUT[0];
      for (let py = 0; py < ih; py++) bin[py] = m.binOf(pOf((py + 0.5) / devicePixelRatio));
      for (let px = 0; px < iw; px++) {
        const ci = Math.floor(a + (px + 0.5) / iw * (b - a)), snap = ci >= 0 && ci < n ? snapAt(ci) : null;
        for (let py = 0, o = px * 4; py < ih; py++, o += iw * 4) {
          // 색만 이웃 두 칸까지 부드럽게 섞음 (숫자·물량 계산은 그대로)
          const k = bin[py], v = snap ? (snap[k] * 3 + ((snap[k - 1] || 0) + (snap[k + 1] || 0)) * 2 + (snap[k - 2] || 0) + (snap[k + 2] || 0)) / 9 : 0;
          const c = v > 0 ? LUT[Math.min(255, Math.pow(v / vmax, COLOR_GAMMA) * 255 | 0)] : c0;
          D[o] = c[0]; D[o + 1] = c[1]; D[o + 2] = c[2]; D[o + 3] = 255;
        }
      }
      S.img = { model: m, key, img };
    }
    g.putImageData(S.img.img, 0, 0); // putImageData는 scale을 무시하므로 장치 픽셀 기준으로 그렸습니다
    g.save(); g.beginPath(); g.rect(0, 0, mapW, mapH); g.clip();
    // 봉
    const up = '#3ddc97', dn = '#ff5a6a';
    for (let x = Math.max(0, Math.floor(a)); x < Math.min(n, Math.ceil(b)); x++) {
      const c = cols[x], cx = xOf(x + 0.5); g.strokeStyle = c.c >= c.o ? up : dn; g.lineWidth = 1;
      g.beginPath(); g.moveTo(cx, yOf(c.h)); g.lineTo(cx, yOf(c.l)); g.stroke();
      if (cw >= 3) { g.fillStyle = g.strokeStyle; const y1 = yOf(Math.max(c.o, c.c)), y2 = yOf(Math.min(c.o, c.c)); g.fillRect(cx - cw * 0.35, y1, cw * 0.7, Math.max(1, y2 - y1)); }
    }
    // 실시간 강제청산: 점 크기 = 금액, 초록 = 롱이 청산됨, 빨강 = 숏이 청산됨
    const per = TF[S.tf] * M15;
    liqOf(S.coin, cols[0].t).forEach(x => {
      let ci = n - 1; while (ci > 0 && cols[ci].t > x.t) ci--;
      const cx = xOf(ci + Math.min(1, (x.t - cols[ci].t) / per)), cy = yOf(x.p);
      g.beginPath(); g.arc(cx, cy, Math.min(11, 2.5 + Math.sqrt(x.usd / 2e4)), 0, 7);
      g.fillStyle = x.long ? 'rgba(43,195,165,.85)' : 'rgba(241,95,105,.85)'; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke();
    });
    g.restore();
    // 현재가 (보이는 가격 범위 안에 있을 때만)
    const yp = yOf(price), pin = yp >= 0 && yp <= mapH;
    // 오른쪽: 지금 남은 물량 (위 = 숏 청산, 아래 = 롱 청산). 수집 뒤 가격이 지나간 자리는 뺍니다
    const last = m.snaps[m.snaps.length - 1], now = k => { const p = m.priceOf(k); return p >= lv.lo && p <= lv.hi ? 0 : last[k]; };
    let hm = 0; for (let k = kLo; k <= kHi; k++) hm = Math.max(hm, now(k));
    g.fillStyle = cv('--panel'); g.fillRect(mapW, 0, histW + axisW, H);
    for (let k = kLo; k <= kHi; k++) {
      const p = m.priceOf(k), v = now(k); if (!v) continue;
      const y = yOf(p + m.step / 2), hgt = Math.max(1, yOf(p - m.step / 2) - y);
      g.fillStyle = p > price ? '#f15f69' : '#2bc3a5'; g.fillRect(mapW + 4, y, (histW - 8) * v / hm, hgt);
    }
    if (pin) { g.setLineDash([4, 3]); g.strokeStyle = '#ffffff'; g.beginPath(); g.moveTo(0, yp); g.lineTo(mapW + histW, yp); g.stroke(); g.setLineDash([]); }
    // 가격 축
    g.fillStyle = cv('--muted'); g.font = '11px JetBrains Mono, Consolas, monospace'; g.textAlign = 'left';
    const ps = niceStep((hi - lo) / 8); for (let p = Math.ceil(lo / ps) * ps; p < hi; p += ps) g.fillText(fp(p), mapW + histW + 6, yOf(p) + 4);
    if (pin) { g.fillStyle = '#ffffff'; g.fillRect(mapW + histW + 2, yp - 8, axisW - 4, 16); g.fillStyle = '#000'; g.fillText(fp(price), mapW + histW + 6, yp + 4); }
    g.fillStyle = cv('--muted'); g.font = '11px JetBrains Mono, Consolas, monospace'; g.textAlign = 'center'; g.fillText(`${fdt(m.updated / 1000)} 남은 물량`, mapW + (histW + axisW) / 2, H - 6);
    // 날짜 축
    g.fillStyle = cv('--muted'); g.textAlign = 'center';
    const every = Math.max(1, Math.round((b - a) / 7));
    for (let x = Math.max(0, Math.ceil(a / every) * every); x < Math.min(n, b); x += every) g.fillText(fdt(cols[x].t / 1000).slice(0, 5), Math.max(16, Math.min(mapW - 16, xOf(x))), H - 6);
    // 마우스: 시각·가격·남은 물량
    const tip = $('#lmTip');
    cnv.onmousemove = e => {
      const r = cnv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, ci = Math.floor(a + x / cw);
      if (S.drag || x > mapW || y > mapH || ci < 0 || ci >= n) { tip.hidden = true; return; }
      // 그 시점에 남은 청산가는 봉 아래 = 롱, 위 = 숏으로 정확히 나뉨 (봉이 지나간 자리는 이미 지워짐)
      const p = pOf(y), k = m.binOf(p), v = snapAt(ci)[k] || 0, c = cols[ci], isShort = m.priceOf(k) > c.c;
      const amt = v ? `${(v / m.priceOf(k)).toFixed(v / m.priceOf(k) < 100 ? 1 : 0)} ${S.coin} (${fusd(v)})` : `0 ${S.coin} ($0)`;
      tip.hidden = false; tip.style.left = Math.min(x + 14, W - 300) + 'px'; tip.style.top = (y + 14) + 'px';
      tip.textContent = '';
      tip.append(el('b', { text: `${fdt(c.t / 1000)} · ${fp(p)}` }), el('br'), `시 ${fp(c.o)} 고 ${fp(c.h)} 저 ${fp(c.l)} 종 ${fp(c.c)}`, el('br'),
        el('span', { class: 'up', text: `롱 청산 ${isShort ? `0 ${S.coin} ($0)` : amt}` }), ' · ', el('span', { class: 'down', text: `숏 청산 ${isShort ? amt : `0 ${S.coin} ($0)`}` }),
        c.live ? el('div', { class: 'muted', text: '지도는 마지막 수집 시점' }) : '');
    };
    cnv.onmouseleave = () => { tip.hidden = true; };
    // 위 요약
    let sumL = 0, sumS = 0, allL = 0, allS = 0;
    for (let k = 0; k < m.nb; k++) { const v = now(k), up = m.priceOf(k) > price; if (up) allS += v; else allL += v; if (k >= kLo && k <= kHi) { if (up) sumS += v; else sumL += v; } }
    $('#lmSum').innerHTML = '';
    $('#lmSum').append(`${fdt(m.updated / 1000)} 남은 `, el('b', { class: 'up', text: `롱 청산 ${fusd(allL)}` }), ' · ', el('b', { class: 'down', text: `숏 청산 ${fusd(allS)}` }), ` (화면 안: 롱 ${fusd(sumL)} · 숏 ${fusd(sumS)})${lv.on ? ' · 가격 실시간' : ''} · ` + liqNote(S.coin));
  }

  // ---------- 화면: 가격대별 ----------
  function drawPrice() {
    const box = $('#lmCanvasBox'), m = S.model, d = S.data[S.coin]; box.textContent = '';
    const cols = m.cols; if (S.at == null || S.at >= cols.length) S.at = cols.length - 1;
    const col = cols[S.at];
    // 거래소별 계산은 무거워서 같은 시점이면 전에 계산한 것을 씁니다
    if (!S.st || S.st.model !== m || S.st.at !== S.at) S.st = { model: m, at: S.at, st: exState(d, col.i) };
    let st = S.st.st;
    // 마지막 봉을 볼 때는 바이낸스 실시간 가격을 쓰고, 수집 뒤 가격이 지나간 청산가는 뺍니다
    const lv = S.at === cols.length - 1 ? liveView(m) : null;
    if (lv && lv.on) {
      const cut = a => a.map((v, k) => { const p = m.priceOf(k); return p >= lv.lo && p <= lv.hi ? 0 : v; });
      const L = {}, Sh = {}; m.exs.forEach(e => { L[e] = cut(st.L[e]); Sh[e] = cut(st.S[e]); });
      st = { L, S: Sh, price: lv.price, t: st.t };
    }
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
    // 가격 칸 묶기: 보이는 가격 범위(기본 현재가 ±20%, 휠·끌기로 바꿈)를 약 260칸으로
    const p0 = S.pz ? S.pz.p0 : st.price * 0.8, p1 = S.pz ? S.pz.p1 : st.price * 1.2;
    S.geo = { kind: 'price', padL, plotW, plotT, p0, p1 };
    const groupN = Math.max(1, Math.round((p1 - p0) / m.step / 260)), gs = m.step * groupN;
    const nG = Math.ceil((p1 - p0) / gs), byEx = m.exs.map(() => new Float64Array(nG)), side = new Int8Array(nG);
    for (let k = m.binOf(p0); k <= m.binOf(p1); k++) {
      const p = m.priceOf(k), gi = Math.floor((p - p0) / gs); if (gi < 0 || gi >= nG) continue;
      m.exs.forEach((e, ei) => { byEx[ei][gi] += (st.L[e][k] + st.S[e][k]) * p; });
      side[gi] = p > st.price ? -1 : 1;
    }
    const tot = Array.from({ length: nG }, (_, i) => byEx.reduce((t, a) => t + a[i], 0)), vmax = Math.max(...tot, 1);
    // 누적선: 현재가에서 바깥으로
    const cumL = new Float64Array(nG), cumS = new Float64Array(nG);
    const pi = Math.max(-1, Math.min(nG - 1, Math.floor((st.price - p0) / gs))); // 현재가가 화면 밖이면 가장자리로
    for (let i = pi, s = 0; i >= 0; i--) { s += side[i] > 0 ? tot[i] : 0; cumL[i] = s; }
    for (let i = pi + 1, s = 0; i < nG; i++) { s += side[i] < 0 ? tot[i] : 0; cumS[i] = s; }
    const cmax = Math.max(cumL[0] || 0, cumS[nG - 1] || 0, 1);
    const xOf = i => padL + i / nG * plotW, yV = v => plotT + plotH - v / vmax * plotH, yC = v => plotT + plotH - v / cmax * plotH;
    const bw = plotW / nG;
    for (let i = 0; i < nG; i++) { let y = plotT + plotH; m.exs.forEach((e, ei) => { const v = byEx[ei][i]; if (!v) return; const hgt = v / vmax * plotH; g.fillStyle = EX.find(x => x[0] === e)[2]; g.fillRect(xOf(i), y - hgt, Math.max(1, bw - 0.5), hgt); y -= hgt; }); }
    g.lineWidth = 2; g.strokeStyle = '#3ddc97'; g.beginPath(); for (let i = 0; i <= pi; i++) { const X = xOf(i) + bw / 2, Y = yC(cumL[i]); i ? g.lineTo(X, Y) : g.moveTo(X, Y); } g.stroke();
    g.strokeStyle = '#f15f69'; g.beginPath(); for (let i = pi + 1; i < nG; i++) { const X = xOf(i) + bw / 2, Y = yC(cumS[i]); i > pi + 1 ? g.lineTo(X, Y) : g.moveTo(X, Y); } g.stroke();
    const xp = padL + (st.price - p0) / (p1 - p0) * plotW;
    if (xp >= padL && xp <= padL + plotW) {
      g.setLineDash([4, 3]); g.strokeStyle = '#3ddc97'; g.lineWidth = 1; g.beginPath(); g.moveTo(xp, plotT); g.lineTo(xp, plotT + plotH); g.stroke(); g.setLineDash([]);
      g.fillStyle = cv('--fg'); g.font = 'bold 12px JetBrains Mono, Consolas, monospace'; g.textAlign = 'center'; g.fillText(`가격 ${fp(st.price)}${lv && lv.on ? ' (실시간)' : ''}`, Math.max(padL + 60, Math.min(padL + plotW - 60, xp)), plotT - 4);
    }
    // 마지막 봉: 최근 1시간 실시간 강제청산을 위에서 내려오는 막대로 (초록 = 롱이 청산됨, 빨강 = 숏이 청산됨)
    if (lv) {
      const rec = liqOf(S.coin, Date.now() - 36e5).filter(x => x.p >= p0 && x.p < p1), qmax = Math.max(1, ...rec.map(x => x.usd));
      rec.forEach(x => { const X = padL + (x.p - p0) / (p1 - p0) * plotW; g.fillStyle = x.long ? 'rgba(43,195,165,.9)' : 'rgba(241,95,105,.9)'; g.fillRect(X - 1, plotT, 2.5, Math.max(4, plotH * 0.25 * Math.sqrt(x.usd / qmax))); });
    }
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
      if (S.drag || y < plotT || i < 0 || i >= nG) { tip.hidden = true; return; }
      const a = p0 + i * gs, dp = ((a + gs / 2) / st.price - 1) * 100;
      tip.hidden = false; tip.style.left = Math.min(x + 14, W - 240) + 'px'; tip.style.top = (y + 10) + 'px';
      tip.textContent = `${fp(a)} ~ ${fp(a + gs)} · 현재가 ${dp > 0 ? '위' : '아래'} ${dp.toFixed(1)}% · ${side[i] < 0 ? '숏' : '롱'} 청산 자리 · ` + (tot[i] ? m.exs.map((e, ei) => byEx[ei][i] ? `${EX.find(x => x[0] === e)[1]} ${fusd(byEx[ei][i])}` : '').filter(Boolean).join(' · ') : '물량 없음');
    };
    cnv.onmouseleave = () => { tip.hidden = true; };
    // 위 요약 + 시점 표시
    $('#lmSum').innerHTML = '';
    $('#lmSum').append(`${fdt(col.t / 1000)} 시점 · 아래 롱 누적 `, el('b', { class: 'up', text: fusd(cumL[0] || 0) }), ' · 위 숏 누적 ', el('b', { class: 'down', text: fusd(cumS[nG - 1] || 0) }),
      ` · 이번 봉: 새로 생김 ${fusd(col.stat.add)} · 스스로 사라짐 ${fusd(col.stat.close)} · 청산으로 사라짐 ${fusd(col.stat.liq)}` + (S.at === cols.length - 1 ? " · " + liqNote(S.coin) : ""));
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
      const atEnd = S.at == null || !S.model || S.at >= S.model.cols.length - 1; // 마지막 봉을 보고 있었으면 새 자료에서도 마지막 봉
      S.model = build(d);
      if (atEnd) S.at = null;
      liveStart(S.coin);
      const fst = EX.filter(([e]) => S.ex.has(e)).map(([e, nm]) => `${nm} ${d.first && d.first[e] ? fdt(d.first[e] / 1000).slice(0, 5) : '-'}부터`).join(' · ');
      const head = $('#lmHead'); head.textContent = '';
      head.append(el('b', { text: S.coin }), ` · ${EX.filter(([e]) => S.ex.has(e)).map(x => x[1]).join(' + ')} · ${[...S.lev].sort((a, b) => a - b).map(x => x + 'x').join(' ')} · 이 기기 시각 · 휠 = 확대/축소 · 끌기 = 이동 · 가격 칸·날짜 칸 끌기 = 늘이기 · 더블클릭 = 처음대로 · `, el('span', { class: 'warn', text: `OI 자료 ${fst} (그 전 포지션은 빠짐)` }));
      note.textContent = `롱/숏 나누기: ${S.split === 'taker' ? '시장가 매수 비율' : '봉 방향(킹피셔식)'} · 실제 포지션이 아닌 추정 · 캔들·현재가·강제청산 점은 바이낸스 선물 실시간 (강제청산은 바이낸스가 코인마다 1초에 1건만 보내 주므로 실제보다 적게 보이고, 이 화면을 연 뒤의 것만 보입니다)`;
      if (S.view === 'map') drawMap(); else drawPrice();
    } catch (e) { note.textContent = e.message; }
  }
  function bind() {
    const seg = (id, f) => $('#' + id).addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; f(b.dataset.v); save(); syncButtons(); refresh(); });
    seg('lmCoinSeg', v => { S.coin = v; S.at = null; S.zoom = null; S.pz = null; });
    seg('lmViewSeg', v => { S.view = v; });
    seg('lmTfSeg', v => { S.tf = v; S.at = null; S.zoom = null; });
    seg('lmDaysSeg', v => { S.days = +v; S.at = null; S.zoom = null; });
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
    // 확대·이동: 휠 = 확대·축소 (지도는 시간, 오른쪽 가격 칸에서는 가격), 끌기 = 이동, 가격 칸 위아래 끌기 = 가격 폭, 더블클릭 = 처음대로
    // 그림(canvas)은 그릴 때마다 새로 만들어지므로 손잡이는 바깥 상자에 답니다. S.geo = 마지막으로 그린 화면의 범위
    const box = $('#lmCanvasBox');
    let raf = 0;
    const redraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (S.model) (S.view === 'map' ? drawMap : drawPrice)(); }); };
    const at = e => { const r = box.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const zoomOf = G => S.zoom || (S.zoom = { a: G.a, b: G.b, lo: null, hi: null, n: G.n });
    const clampCols = (z, G) => { // 최소 5봉, 최대 전체의 1.5배, 양 끝에 빈 공간은 화면 폭의 절반까지
      let w = Math.max(5, Math.min(G.n * 1.5, z.b - z.a)); const c = (z.a + z.b) / 2; z.a = c - w / 2; z.b = c + w / 2;
      if (z.b > G.n + w / 2) { z.b = G.n + w / 2; z.a = z.b - w; } if (z.a < -w / 2) { z.a = -w / 2; z.b = z.a + w; }
    };
    box.addEventListener('wheel', e => {
      const G = S.geo; if (!G || !S.model) return;
      const [x, y] = at(e), f = Math.exp(Math.max(-3, Math.min(3, e.deltaY / 100)) * 0.15); // 1보다 크면 축소
      if (G.kind === 'map') {
        if (y > G.mapH && x > G.mapW) return;
        const z = zoomOf(G);
        if (x > G.mapW + G.histW || e.shiftKey) {
          const p = G.hi - y / G.mapH * (G.hi - G.lo); z.lo = p - (p - G.lo) * f; z.hi = p + (G.hi - p) * f;
        } else if (x <= G.mapW) {
          const c = G.a + x / G.mapW * (G.b - G.a); z.a = c - (c - G.a) * f; z.b = c + (G.b - c) * f; clampCols(z, G);
        } else return;
      } else {
        if (y < G.plotT) return;
        const p = G.p0 + (x - G.padL) / G.plotW * (G.p1 - G.p0), w = (G.p1 - G.p0) * f;
        if (w < S.model.step * 20) return;
        S.pz = { p0: p - (p - G.p0) * f, p1: p + (G.p1 - p) * f };
      }
      e.preventDefault(); redraw();
    }, { passive: false });
    box.addEventListener('mousedown', e => {
      const G = S.geo; if (!G || e.button !== 0) return;
      const [x, y] = at(e);
      if (G.kind === 'price' && y < G.plotT) return;
      // 오른쪽 가격 칸 = 가격 폭, 아래 날짜 칸 = 시간 폭 (오른쪽 끝 고정), 나머지 = 이동
      const scale = G.kind === 'map' && x > G.mapW + G.histW, tscale = G.kind === 'map' && !scale && y > G.mapH && x <= G.mapW;
      S.drag = { x, y, G: { ...G }, scale, tscale };
      box.style.cursor = scale ? 'ns-resize' : tscale ? 'ew-resize' : 'grabbing'; e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      const d = S.drag; if (!d) return;
      const [x, y] = at(e), dx = x - d.x, dy = y - d.y, G = d.G;
      if (G.kind === 'map') {
        const z = zoomOf(G);
        if (d.scale) { const f = Math.exp(dy * 0.006), mid = (G.lo + G.hi) / 2; z.lo = mid - (mid - G.lo) * f; z.hi = mid + (G.hi - mid) * f; }
        else if (d.tscale) { z.b = G.b; z.a = G.b - (G.b - G.a) * Math.exp(-dx * 0.006); clampCols(z, G); if (z.lo == null) { z.lo = G.lo; z.hi = G.hi; } }
        else { const dc = -dx / G.mapW * (G.b - G.a), dp = dy / G.mapH * (G.hi - G.lo); z.a = G.a + dc; z.b = G.b + dc; clampCols(z, G); z.lo = G.lo + dp; z.hi = G.hi + dp; }
      } else { const dp = -dx / G.plotW * (G.p1 - G.p0); S.pz = { p0: G.p0 + dp, p1: G.p1 + dp }; }
      redraw();
    });
    window.addEventListener('mouseup', () => { if (S.drag) { S.drag = null; box.style.cursor = ''; } });
    box.addEventListener('dblclick', () => { if (S.view === 'map') S.zoom = null; else S.pz = null; redraw(); });
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (U.activeTab() === 'liq' && S.model) (S.view === 'map' ? drawMap : drawPrice)(); }, 200); });
  }
  function start() {
    if (S.started) { refresh(); return; }
    S.started = true; bind(); syncButtons(); refresh(); liqStart();
    // 새 자료 확인 (수집은 15분마다): 2분마다, 그리고 숨겨 둔 화면을 다시 볼 때 바로
    const checkNew = async () => {
      if (U.activeTab() !== 'liq' || document.hidden || S.playing || !S.model) return;
      if (await indexTime() > (S.seen[S.coin] || 0)) refresh(true);
    };
    setInterval(checkNew, 120e3);
    document.addEventListener('visibilitychange', () => { checkNew(); liveDraw(); });
  }
  // 청산 라인 탭(liqlines.js)용
  U.liqModel = { EX, loadData, build };
  window.addEventListener('tabchange', e => { if (e.detail === 'liq') start(); });
  if (U.activeTab() === 'liq') start();
})();
