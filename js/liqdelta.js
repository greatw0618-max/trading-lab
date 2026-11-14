// 시장 수급 탭 · 청산 델타: 현재가 위 N% 안에 남은 숏 청산 물량 − 아래 N% 안의 롱 청산 물량 (코인 수량)을 시간 흐름으로 그립니다.
// 청산맵(liqmap.js)과 같은 추정 계산을 15분 단위로 씁니다. 초록 = 숏이 더 많음(위쪽이 먹잇감), 빨강 = 롱이 더 많음(아래쪽이 먹잇감).
//  - 평소 대비 ±5%: ±5% 값에서 직전 3일 평균을 뺀 값 (평소보다 어느 쪽이 쌓였나)
//  - ±5%: ±5% 값 그대로 · 전체 ±15%: 범위를 ±15%로 넓힌 값
// 그 시점에 남은 청산가는 봉 아래 = 롱, 위 = 숏으로 나뉩니다 (봉이 지나간 자리는 이미 청산된 것으로 지워짐).
(() => {
  const TA = window.TA, U = TA && TA.ui, LW = window.LightweightCharts;
  if (!U || !LW) return;
  const { el, store, toneOf, fdt } = U;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const cv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const off = t => -new Date(t * 1000).getTimezoneOffset() * 60;
  const COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'HYPE']; // 청산맵 자료가 있는 코인
  const MODES = { rel: '평소 대비 ±5%', p5: '±5%', p15: '전체 ±15%' };
  const SHOW_DAYS = 7, BASE = 288; // 화면 7일, 평소 = 직전 3일(15분봉 288개)
  const D = { coin: null, mode: store.get('ldMode', 'rel'), chart: null, ser: null, cache: {}, started: false, busy: false, fit: null };
  if (!MODES[D.mode]) D.mode = 'rel';
  const compact = v => { const a = Math.abs(v), s = v < 0 ? '-' : v > 0 ? '+' : ''; return a >= 1e6 ? s + (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? s + (a / 1e3).toFixed(1) + 'K' : s + a.toFixed(a < 10 ? 2 : a < 100 ? 1 : 0); };

  // ---------- 계산 ----------
  async function series(coin) {
    const LM = U.liqModel; if (!LM) throw new Error('청산맵 계산을 불러오지 못했습니다');
    const d = await LM.loadData(coin); // 새 자료가 나왔을 때만 다시 받음
    if (D.cache[coin] && D.cache[coin].updated === d.updated) return D.cache[coin];
    const m = LM.build(d, { ex: new Set(LM.EX.map(e => e[0])), lev: new Set([10, 25, 50, 100]), days: SHOW_DAYS + 3, tf: '15m', split: 'taker' });
    const p5 = [], p15 = [];
    m.cols.forEach((c, i) => {
      const s = m.snaps[i], price = c.c;
      for (const [out, pct] of [[p5, 0.05], [p15, 0.15]]) {
        let up = 0, dn = 0;
        for (let k = m.binOf(price * (1 - pct)); k <= m.binOf(price * (1 + pct)); k++) { const v = s[k]; if (!v) continue; const p = m.priceOf(k); if (p > price) up += v / p; else dn += v / p; }
        out.push({ t: c.t, v: up - dn });
      }
    });
    const rel = []; let run = 0;
    p5.forEach((x, i) => { run += x.v; if (i >= BASE) { run -= p5[i - BASE].v; rel.push({ t: x.t, v: x.v - (run - x.v + p5[i - BASE].v) / BASE }); } });
    const cut = Date.now() - SHOW_DAYS * 864e5, keep = a => a.filter(x => x.t >= cut);
    return (D.cache[coin] = { updated: d.updated, pts: { rel: keep(rel), p5: keep(p5), p15: keep(p15) } });
  }

  // ---------- 화면 ----------
  function makeChart() {
    D.chart = LW.createChart($('#ldChart'), {
      autoSize: true, layout: { background: { type: 'solid', color: cv('--panel') }, textColor: cv('--muted'), fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 11 },
      grid: { vertLines: { color: cv('--grid') }, horzLines: { color: cv('--grid') } }, rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false }, localization: { locale: 'ko-KR' }
    });
    D.ser = D.chart.addBaselineSeries({
      baseValue: { type: 'price', price: 0 }, lineWidth: 1.5, priceLineVisible: false,
      topLineColor: '#2bc3a5', topFillColor1: 'rgba(43,195,165,.45)', topFillColor2: 'rgba(43,195,165,.08)',
      bottomLineColor: '#f15f69', bottomFillColor1: 'rgba(241,95,105,.08)', bottomFillColor2: 'rgba(241,95,105,.45)',
      priceFormat: { type: 'custom', minMove: 0.01, formatter: v => compact(v) }
    });
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => D.chart.timeScale().fitContent(), 200); }); // 창 크기가 바뀌면 다시 전체에 맞춤
    window.addEventListener('themechange', () => D.chart.applyOptions({ layout: { background: { type: 'solid', color: cv('--panel') }, textColor: cv('--muted') }, grid: { vertLines: { color: cv('--grid') }, horzLines: { color: cv('--grid') } } }));
  }
  async function render() {
    if (D.busy) return; D.busy = true;
    const coin = store.get('flowCoin', 'BTC'), now = $('#ldNow'), note = $('#ldNote');
    $$('#ldMode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === D.mode)));
    try {
      if (!COINS.includes(coin)) { now.textContent = `청산 델타는 청산맵 자료가 있는 ${COINS.join('·')}만 볼 수 있어요.`; if (D.ser) D.ser.setData([]); return; }
      if (!D.chart) makeChart();
      if (!D.cache[coin]) now.textContent = '청산맵 자료로 계산하는 중…';
      const r = await series(coin), pts = r.pts[D.mode];
      D.ser.setData(pts.map(x => ({ time: x.t / 1000 + off(x.t / 1000), value: x.v })));
      const fk = coin + D.mode; if (D.fit !== fk) { D.fit = fk; D.chart.timeScale().fitContent(); }
      const last = pts[pts.length - 1];
      now.textContent = '';
      if (last) {
        const rel = D.mode === 'rel', more = last.v >= 0 ? '숏' : '롱';
        now.append('지금 ', el('b', { class: 'ld-big m ' + toneOf(last.v), text: `${compact(last.v)} ${coin}` }), ' · ',
          el('b', { text: `${rel ? '평소보다 ' : ''}${more} 청산 물량이 ${rel ? '많아요' : '더 많아요'} → ${last.v >= 0 ? '위쪽' : '아래쪽'}이 먹잇감` }),
          el('span', { class: 'muted', text: ` (${fdt(r.updated / 1000)} 청산맵 기준 · 15분마다)` }));
      }
      note.textContent = `${MODES[D.mode]}: ${D.mode === 'p15' ? '현재가 ±15%' : '현재가 ±5%'} 안에 남은 숏 청산 물량 − 롱 청산 물량 (${coin} 수량)${D.mode === 'rel' ? ', 직전 3일 평균을 뺀 값' : ''}. 청산맵과 같은 추정(5개 거래소 OI, 10·25·50·100배, 시장가 매수 비율로 롱/숏 나누기)이라 실제 포지션이 아닙니다. 먹잇감 = 가격이 그쪽으로 가면 청산이 연달아 터질 수 있는 자리라는 뜻이지, 그쪽으로 간다는 예측이 아닙니다.`;
    } catch (e) { now.textContent = e.message; }
    finally { D.busy = false; }
  }

  function start() {
    if (D.started) { render(); return; }
    D.started = true; render();
    setInterval(() => { if (!document.hidden && U.activeTab() === 'flow') render(); }, 120e3);
  }
  $('#ldMode').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; D.mode = b.dataset.v; store.set('ldMode', D.mode); render(); });
  window.addEventListener('flowcoin', () => { if (D.started) render(); });
  window.addEventListener('tabchange', e => { if (e.detail === 'flow') start(); });
  if (U.activeTab && U.activeTab() === 'flow') start();
})();
