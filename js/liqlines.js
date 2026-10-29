// 청산 라인 탭: 추정 청산맵(liqmap.js와 같은 계산)에서 물량이 몰린 가격을 골라 차트에 가로선으로 그립니다.
// 송백 영상의 선 종류를 흉내 낸 자동 선입니다 (영상의 선 긋는 방법은 공개되지 않았으므로 똑같지 않습니다).
//  - L1·L2 (단타): 50·100배 물량만 본 맵에서 현재가 0.2~3% 안의 가장 큰 덩어리 2개 (가까운 쪽이 L1)
//  - S1·S2 (스윙): 전체 배수 맵에서 3~10% 안의 가장 큰 덩어리 2개
//  - RIP (레버리지 청소): 현재가에서 15% 안 물량의 80%가 청산되는 가격
(() => {
  const TA = window.TA, U = TA && TA.ui, LW = window.LightweightCharts;
  if (!U || !LW) return;
  const { el, fp, fusd, fpct, fdt, store } = U;
  const $ = s => document.querySelector(s);
  const cv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const S = { coin: store.get('llCoin', 'BTC'), tf: store.get('llTf', '1h'), chart: null, candle: null, ema: [], lines: [], started: false, updated: 0 };

  // ---------- 선 고르기 ----------
  function peaks(snap, m, price, side, dLo, dHi, n) {
    // 가격 0.2% 폭으로 묶어서 이웃보다 큰 덩어리 중 큰 순서로 n개 (서로 0.4% 이상 떨어진 것만)
    const g = price * 0.002, groups = new Map();
    for (let k = 0; k < m.nb; k++) {
      const p = m.priceOf(k), d = side * (p / price - 1); if (d < dLo || d > dHi || !snap[k]) continue;
      const gi = Math.round(p / g); const x = groups.get(gi) || { v: 0, pv: 0 }; x.v += snap[k]; x.pv += snap[k] * p; groups.set(gi, x);
    }
    const arr = [...groups.entries()].map(([gi, x]) => ({ gi, v: x.v, p: x.pv / x.v })).sort((a, b) => a.gi - b.gi);
    const loc = arr.filter((x, i) => (!arr[i - 1] || arr[i - 1].v <= x.v) && (!arr[i + 1] || arr[i + 1].v <= x.v)).sort((a, b) => b.v - a.v);
    const out = [];
    // 가장 큰 덩어리의 1/4보다 작으면 선으로 안 씀
    for (const x of loc) { if (out.length >= n || x.v < loc[0].v * 0.25) break; if (out.every(y => Math.abs(y.p / x.p - 1) >= 0.004)) out.push(x); }
    return out.sort((a, b) => side * (a.p - b.p));
  }
  function rip(snap, m, price, side) {
    let tot = 0; const list = [];
    for (let k = 0; k < m.nb; k++) { const p = m.priceOf(k), d = side * (p / price - 1); if (d > 0 && d <= 0.15 && snap[k]) { list.push([d, p, snap[k]]); tot += snap[k]; } }
    list.sort((a, b) => a[0] - b[0]);
    let c = 0; for (const [, p, v] of list) { c += v; if (c >= tot * 0.8) return { p, v: tot * 0.8 }; }
    return null;
  }
  const cache = {};
  async function computeLines(coin) {
    // 청산맵 자료가 새로 나왔을 때만 다시 계산 (자료 파일이 커서)
    let upd = 0; try { upd = (await (await fetch('liqmap/index.json?v=' + Date.now(), { cache: 'no-store' })).json()).updated; } catch (e) {}
    if (cache[coin] && cache[coin].updated >= upd) return cache[coin];
    const LM = U.liqModel, d = await LM.loadData(coin, true);
    S.updated = d.updated;
    const all = new Set(LM.EX.map(e => e[0])), base = { ex: all, days: 0.25, tf: '15m', split: 'taker' };
    const hiM = LM.build(d, { ...base, lev: new Set([50, 100]) }), allM = LM.build(d, { ...base, lev: new Set([10, 25, 50, 100]) });
    const price = allM.price, hs = hiM.snaps[hiM.snaps.length - 1], as = allM.snaps[allM.snaps.length - 1], lines = [];
    [[-1, '롱'], [1, '숏']].forEach(([side, nm]) => {
      peaks(hs, hiM, price, side, 0.002, 0.03, 2).forEach((x, i) => lines.push({ kind: 'L', name: `L${i + 1}`, side, sideName: nm, p: x.p, v: x.v }));
      peaks(as, allM, price, side, 0.03, 0.10, 2).forEach((x, i) => lines.push({ kind: 'S', name: `S${i + 1}`, side, sideName: nm, p: x.p, v: x.v }));
      const r = rip(as, allM, price, side); if (r) lines.push({ kind: 'RIP', name: 'RIP', side, sideName: nm, p: r.p, v: r.v });
    });
    return (cache[coin] = { price, lines, updated: d.updated });
  }
  U.liqLines = computeLines; // 리포트 지시문도 같은 선을 씁니다

  // ---------- 차트 ----------
  function makeChart() {
    const box = $('#llChart'); box.textContent = '';
    S.chart = LW.createChart(box, {
      autoSize: true, layout: { background: { type: 'solid', color: cv('--panel') }, textColor: cv('--muted'), fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 11 },
      grid: { vertLines: { color: cv('--grid') }, horzLines: { color: cv('--grid') } }, rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false, timeVisible: S.tf !== '1d' },
      localization: { locale: 'ko-KR' }
    });
    S.resetPan = U.freePan(S.chart, box); // 차트를 눌러 위아래로 끌기, 더블클릭 = 자동 맞춤
    const up = cv('--up'), dn = cv('--down');
    S.candle = S.chart.addCandlestickSeries({ upColor: up, downColor: dn, wickUpColor: up, wickDownColor: dn, borderVisible: false });
    S.ema = [[50, '#e0a106'], [200, '#5b8def']].map(([n, c]) => ({ n, s: S.chart.addLineSeries({ color: c, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }) }));
  }
  async function draw() {
    const note = $('#llNote');
    try {
      note.textContent = '차트와 청산 라인을 불러오는 중…';
      const [s, L] = await Promise.all([TA.load(S.coin, S.tf, 'hl'), computeLines(S.coin)]);
      if (!S.chart) makeChart();
      S.chart.applyOptions({ timeScale: { timeVisible: S.tf !== '1d' } });
      const off = t => -new Date(t * 1000).getTimezoneOffset() * 60, n = s.t.length;
      S.candle.setData(s.t.map((t, i) => ({ time: t + off(t), open: s.o[i], high: s.h[i], low: s.l[i], close: s.c[i] })));
      S.ema.forEach(({ n: k, s: ser }) => { const e = TA.ema(s.c, k); ser.setData(s.t.map((t, i) => e[i] == null ? null : { time: t + off(t), value: e[i] }).filter(Boolean)); });
      S.lines.forEach(x => S.candle.removePriceLine(x)); S.lines = [];
      const COL = { 1: '#f15f69', '-1': '#2bc3a5' };
      L.lines.forEach(x => S.lines.push(S.candle.createPriceLine({
        price: x.p, color: COL[x.side], lineWidth: x.kind === 'RIP' ? 3 : x.kind === 'S' ? 2 : 1,
        lineStyle: x.kind === 'L' ? LW.LineStyle.Dashed : LW.LineStyle.Solid, axisLabelVisible: true, title: `${x.name} ${x.sideName} ${fusd(x.v)}`
      })));
      if (!S.fitted) { S.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 160), to: n + 5 }); S.resetPan(); S.fitted = true; }
      // 선 목록
      const MEAN = { L: '단타 라인: 고배율(50·100배) 물량. 반응은 잘 나오지만 실패도 잦음 → 0.5~1%에서 반익절', S: '스윙 라인: 큰 물량 덩어리. 닿으면 큰 저항·급락·횡보가 나오기 쉬움', RIP: '레버리지 청소: 이 가격까지 가면 그쪽 물량(현재가 15% 안)의 80%가 청산됨' };
      const tb = $('#llTable'); tb.textContent = '';
      const rows = L.lines.slice().sort((a, b) => b.p - a.p);
      tb.append(el('div', { class: 'tblwrap' }, el('table', null,
        el('thead', null, el('tr', null, ['선', '가격', '현재가 대비', '청산될 물량', '뜻'].map((h, i) => el('th', { class: i && i < 4 ? 'r' : '', text: h })))),
        el('tbody', null, rows.map(x => el('tr', null, el('td', { class: x.side > 0 ? 'down' : 'up', text: `${x.name} ${x.sideName} 청산` }), el('td', { class: 'r m', text: fp(x.p) }),
          el('td', { class: 'r m', text: fpct((x.p / s.c[n - 1] - 1) * 100, 2) }), el('td', { class: 'r m', text: fusd(x.v) }), el('td', { text: MEAN[x.kind] })))))));
      note.textContent = `${S.coin} · 청산맵 ${fdt(L.updated / 1000)} 기준 (현재가 ${fp(L.price)}) · 5개 거래소 합산 추정 · 빨강 = 위쪽 숏 청산, 초록 = 아래쪽 롱 청산 · 점선 L = 단타, 실선 S = 스윙, 굵은 선 RIP = 레버리지 청소 · 송백의 선을 흉내 낸 자동 선이며 실제 포지션이 아닌 추정입니다`;
    } catch (e) { note.textContent = '그리지 못했습니다: ' + e.message; }
  }
  function sync() {
    document.querySelectorAll('#llCoinSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === S.coin)));
    document.querySelectorAll('#llTfSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === S.tf)));
  }
  function start() {
    if (S.started) { draw(); return; }
    S.started = true; sync();
    $('#llCoinSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.coin = b.dataset.v; store.set('llCoin', S.coin); S.fitted = false; sync(); draw(); });
    $('#llTfSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.tf = b.dataset.v; store.set('llTf', S.tf); S.fitted = false; sync(); draw(); });
    draw();
    // 1분마다 봉, 새 청산맵 자료가 있으면 선도 다시
    setInterval(() => { if (U.activeTab() === 'lines' && !document.hidden) draw(); }, 60e3);
  }
  window.addEventListener('themechange', () => { if (S.started) { S.chart && S.chart.remove(); S.chart = null; S.lines = []; S.fitted = false; draw(); } });
  window.addEventListener('tabchange', e => { if (e.detail === 'lines') start(); });
  if (U.activeTab() === 'lines') start();
})();
