// 호가 탭: 여러 거래소 호가(걸려 있는 매수·매도 주문)를 합쳐 현재가 근처가 평소보다 두꺼운지 얇은지 봅니다.
//  - 가까운 호가 ±0.1%: 바이낸스 선물·바이빗·OKX 선물·하이퍼리퀴드 (호가를 그 깊이까지 주는 곳)
//  - 넓은 호가 ±1%: 바이낸스 현물(5000칸)·OKX 선물(전체 호가)·하이퍼리퀴드(100달러 묶음) — 나머지 거래소는 ±1%까지 안 줌
//  - 평소 = 이 기기에 모은 기록의 중앙값 (3일 넘게 모이면 같은 시간대 ±1시간끼리 비교). 화면을 열어 둔 동안 30초마다 모읍니다.
//  - 경고: 바이낸스 선물 최근 15분 시장가 순매수가 평소의 2배를 넘게 한쪽으로 몰리는데
//          그 방향 호가가 평소의 0.7배 아래로 얇아지면 "얇아짐", 오히려 1배 이상 버티고 가격도 안 밀리면 "받아 내는 중"
(() => {
  const TA = window.TA, U = TA && TA.ui, LW = window.LightweightCharts;
  if (!U || !LW) return;
  const { el, store, fp, fusd, fdt, toneOf } = U;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const cv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const off = t => -new Date(t * 1000).getTimezoneOffset() * 60;
  const COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'HYPE'];
  const BANDS = { near: 0.001, wide: 0.01 };
  const KEEP = 3 * 864e5, EVERY = 30e3;
  const THIN = 0.7, FLOW_X = 2; // [기본값] 얇아짐 기준(평소의 0.7배), 시장가 몰림 기준(평소의 2배)
  const SRC = {
    binF: { name: '바이낸스 선물' }, byb: { name: '바이빗 선물' }, okx: { name: 'OKX 선물' }, hl: { name: '하이퍼리퀴드' }, binS: { name: '바이낸스 현물' }
  };
  const B = { coin: store.get('bookCoin', 'BTC'), band: store.get('bookBand', 'wide'), hist: [], last: null, flow: null, ct: {}, chart: null, s: {}, started: false, timer: null, busy: false, fit: null };
  if (!COINS.includes(B.coin)) B.coin = 'BTC';
  if (!BANDS[B.band]) B.band = 'wide';
  const compact = v => { const a = Math.abs(v), s = v < 0 ? '-' : v > 0 ? '+' : ''; return a >= 1e6 ? s + (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? s + (a / 1e3).toFixed(1) + 'K' : s + a.toFixed(a < 10 ? 2 : a < 100 ? 1 : 0); };
  const qty = v => compact(v).replace('+', '') + ' ' + B.coin;
  const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

  // ---------- 호가 받기 ----------
  const j = async (u, o) => { const r = await fetch(u, o); if (!r.ok) throw new Error(r.status); return r.json(); };
  const hlBook = async (c, sig) => { const d = await j('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'l2Book', coin: c, nSigFigs: sig }) }); return [d.levels[0].map(x => [+x.px, +x.sz]), d.levels[1].map(x => [+x.px, +x.sz])]; };
  async function okxCt(c) { // OKX 선물은 계약 수로 주므로 코인 수량으로 바꿀 값
    if (B.ct[c]) return B.ct[c];
    const d = await j(`https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=${c}-USDT-SWAP`);
    return (B.ct[c] = +d.data[0].ctVal);
  }
  const FETCH = {
    binF: async c => { const d = await j(`https://fapi.binance.com/fapi/v1/depth?symbol=${c}USDT&limit=1000`); return [d.bids.map(x => [+x[0], +x[1]]), d.asks.map(x => [+x[0], +x[1]])]; },
    byb: async c => { const d = await j(`https://api.bybit.com/v5/market/orderbook?category=linear&symbol=${c}USDT&limit=500`); return [d.result.b.map(x => [+x[0], +x[1]]), d.result.a.map(x => [+x[0], +x[1]])]; },
    okx: async c => { const [ct, d] = await Promise.all([okxCt(c), j(`https://www.okx.com/api/v5/market/books-full?instId=${c}-USDT-SWAP&sz=5000`)]); const b = d.data[0]; return [b.bids.map(x => [+x[0], +x[1] * ct]), b.asks.map(x => [+x[0], +x[1] * ct])]; },
    hl: async c => { const [n, w] = await Promise.all([hlBook(c, 4), hlBook(c, 3)]); return { near: n, wide: w }; }, // 가까운 건 촘촘한 묶음, 넓은 건 굵은 묶음
    binS: async c => { const d = await j(`https://api.binance.com/api/v3/depth?symbol=${c}USDT&limit=5000`); return [d.bids.map(x => [+x[0], +x[1]]), d.asks.map(x => [+x[0], +x[1]])]; }
  };
  // 현재가 ±pct 안의 잔량 합계. 그 거래소 호가가 ±pct까지 닿지 않으면 null (부분 합계로 왜곡되지 않게)
  function band([bids, asks], mid, pct) {
    if (!bids.length || !asks.length) return null;
    const lo = mid * (1 - pct), hi = mid * (1 + pct);
    if (bids[bids.length - 1][0] > lo || asks[asks.length - 1][0] < hi) return null;
    let b = 0, a = 0; bids.forEach(([p, s]) => { if (p >= lo) b += s; }); asks.forEach(([p, s]) => { if (p <= hi) a += s; });
    return [b, a];
  }
  async function sample() {
    const c = B.coin, books = {};
    await Promise.all(Object.keys(FETCH).map(async k => { try { books[k] = await FETCH[k](c); } catch (e) {} }));
    const ref = books.binF || books.byb || (books.hl && books.hl.near); if (!ref) throw new Error('호가를 받지 못했어요');
    const mid = (ref[0][0][0] + ref[1][0][0]) / 2, s = { t: Date.now(), p: mid, near: {}, wide: {} };
    for (const k of Object.keys(books)) {
      const bk = books[k], n = band(k === 'hl' ? bk.near : bk, mid, BANDS.near), w = band(k === 'hl' ? bk.wide : bk, mid, BANDS.wide);
      if (n) s.near[k] = n.map(v => +v.toFixed(4)); if (w) s.wide[k] = w.map(v => +v.toFixed(4));
    }
    s.walls = walls(books, mid);
    return s;
  }
  // 벽: 넓은 호가를 주는 곳을 합쳐 현재가 ±1%를 0.1% 폭 칸으로 묶음
  function walls(books, mid) {
    const w = mid * 0.001, n = 10, bid = new Array(n).fill(0), ask = new Array(n).fill(0);
    const add = ([bids, asks]) => { bids.forEach(([p, s]) => { const i = Math.floor((mid - p) / w); if (i >= 0 && i < n) bid[i] += s; }); asks.forEach(([p, s]) => { const i = Math.floor((p - mid) / w); if (i >= 0 && i < n) ask[i] += s; }); };
    if (books.binS) add(books.binS); if (books.okx) add(books.okx); if (books.hl) add(books.hl.wide);
    return { w, bid, ask };
  }

  // ---------- 기록 (이 기기에 3일 보관, 1분에 하나) ----------
  const SKEY = () => 'book.' + B.coin;
  function load() { try { B.hist = JSON.parse(store.get(SKEY(), '[]')).filter(x => x.t > Date.now() - KEEP); } catch (e) { B.hist = []; } }
  function keep(s) {
    const { walls: _, ...row } = s, last = B.hist[B.hist.length - 1];
    if (last && Math.floor(last.t / 60e3) === Math.floor(row.t / 60e3)) B.hist[B.hist.length - 1] = row; else B.hist.push(row);
    const cut = Date.now() - KEEP; while (B.hist.length && B.hist[0].t < cut) B.hist.shift();
    try { store.set(SKEY(), JSON.stringify(B.hist)); } catch (e) {}
  }
  // 지금 들어온 거래소만으로 합계 (평소와 같은 거래소끼리 비교)
  const total = (row, bandKey, keys) => { const m = row[bandKey]; if (!keys.every(k => m[k])) return null; return keys.reduce((s, k) => [s[0] + m[k][0], s[1] + m[k][1]], [0, 0]); };
  function baseline(bandKey, keys) {
    const now = Date.now(), span = B.hist.length ? now - B.hist[0].t : 0, sameHour = span > 3 * 864e5 - 36e5;
    const rows = B.hist.filter(r => sameHour ? Math.abs(((r.t - now) % 864e5 + 864e5 + 432e5) % 864e5 - 432e5) <= 36e5 : true).map(r => total(r, bandKey, keys)).filter(Boolean);
    if (rows.length < 20) return { ok: false, n: rows.length };
    return { ok: true, b: median(rows.map(r => r[0])), a: median(rows.map(r => r[1])), n: rows.length, how: sameHour ? '같은 시간대 ±1시간' : `모은 기록 ${Math.round(span / 36e5)}시간` };
  }

  // ---------- 시장가 순매수 (바이낸스 선물 1분봉의 시장가 매수량) ----------
  async function flow() {
    const k = await j(`https://fapi.binance.com/fapi/v1/klines?symbol=${B.coin}USDT&interval=1m&limit=1500`);
    const net = k.map(x => 2 * +x[9] - +x[5]), roll = [];
    let s = 0; net.forEach((v, i) => { s += v; if (i >= 15) s -= net[i - 15]; if (i >= 14) roll.push(s); });
    const typ = median(roll.slice(0, -1).map(Math.abs)) || 1, last = roll[roll.length - 1];
    const p15 = +k[k.length - 16][4], pNow = +k[k.length - 1][4];
    return { net: last, typ, x: last / typ, move: pNow / p15 - 1, coin: B.coin };
  }

  // ---------- 화면 ----------
  function makeChart() {
    B.chart = LW.createChart($('#bkChart'), {
      autoSize: true, layout: { background: { type: 'solid', color: cv('--panel') }, textColor: cv('--muted'), fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 11 },
      grid: { vertLines: { color: cv('--grid') }, horzLines: { color: cv('--grid') } }, rightPriceScale: { borderVisible: false }, leftPriceScale: { visible: true, borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false }, localization: { locale: 'ko-KR' }
    });
    const fmt = { type: 'custom', minMove: 0.01, formatter: v => v.toFixed(2) + '배' };
    B.s.price = B.chart.addLineSeries({ color: cv('--muted'), lineWidth: 1, priceScaleId: 'left', priceLineVisible: false, lastValueVisible: true });
    B.s.bid = B.chart.addLineSeries({ color: '#2bc3a5', lineWidth: 2, priceFormat: fmt, priceLineVisible: false });
    B.s.ask = B.chart.addLineSeries({ color: '#f15f69', lineWidth: 2, priceFormat: fmt, priceLineVisible: false });
    B.s.bid.createPriceLine({ price: 1, color: cv('--faint'), lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '평소' });
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => B.chart.timeScale().fitContent(), 200); });
    window.addEventListener('themechange', () => B.chart.applyOptions({ layout: { background: { type: 'solid', color: cv('--panel') }, textColor: cv('--muted') }, grid: { vertLines: { color: cv('--grid') }, horzLines: { color: cv('--grid') } } }));
  }
  function drawWalls(wl, mid) {
    const box = $('#bkWalls'); box.textContent = '';
    if (!wl) return;
    const W = Math.max(320, box.clientWidth), H = 190, dpr = devicePixelRatio;
    const cnv = el('canvas', { width: W * dpr, height: H * dpr, style: `width:${W}px;height:${H}px;display:block` }); box.append(cnv);
    const g = cnv.getContext('2d'); g.scale(dpr, dpr);
    const padL = 12, padR = 12, padB = 22, plotH = H - padB - 22, n = wl.bid.length, cw = (W - padL - padR) / (n * 2);
    const max = Math.max(1e-9, ...wl.bid, ...wl.ask), x0 = padL + n * cw;
    const top3 = arr => arr.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, 2).map(x => x[1]);
    const tb = top3(wl.bid), ta = top3(wl.ask);
    g.font = '11px JetBrains Mono, Consolas, monospace'; g.textAlign = 'center';
    wl.bid.forEach((v, i) => { const h = v / max * plotH, x = x0 - (i + 1) * cw; g.fillStyle = tb.includes(i) ? '#2bc3a5' : 'rgba(43,195,165,.45)'; g.fillRect(x + 1, 22 + plotH - h, cw - 2, h); if (tb.includes(i)) { g.fillStyle = cv('--fg'); g.fillText(qty(v), x + cw / 2, 22 + plotH - h - 4); } });
    wl.ask.forEach((v, i) => { const h = v / max * plotH, x = x0 + i * cw; g.fillStyle = ta.includes(i) ? '#f15f69' : 'rgba(241,95,105,.45)'; g.fillRect(x + 1, 22 + plotH - h, cw - 2, h); if (ta.includes(i)) { g.fillStyle = cv('--fg'); g.fillText(qty(v), x + cw / 2, 22 + plotH - h - 4); } });
    g.strokeStyle = cv('--fg'); g.setLineDash([4, 3]); g.beginPath(); g.moveTo(x0, 14); g.lineTo(x0, 22 + plotH); g.stroke(); g.setLineDash([]);
    g.fillStyle = cv('--fg'); g.fillText(`현재가 ${fp(mid)}`, x0, 11);
    g.fillStyle = cv('--muted');
    [-1, -0.5, 0.5, 1].forEach(pc => { const x = x0 + pc / 0.1 * cw; g.fillText(`${pc > 0 ? '+' : ''}${pc}% ${fp(mid * (1 + pc / 100))}`, Math.max(50, Math.min(W - 50, x)), H - 6); });
    g.textAlign = 'left'; g.fillStyle = '#2bc3a5'; g.fillText('← 매수 호가 (받쳐 주는 쪽)', padL, 11); g.textAlign = 'right'; g.fillStyle = '#f15f69'; g.fillText('매도 호가 (누르는 쪽) →', W - padR, 11);
    const wtxt = (arr, idx, side) => idx.map(i => `현재가 ${side === 'b' ? '아래' : '위'} ${(i * 0.1).toFixed(1)}~${((i + 1) * 0.1).toFixed(1)}% (${fp(mid * (1 + (side === 'b' ? -1 : 1) * (i + 0.5) * 0.001))} 근처) ${qty(arr[i])}`).join(', ');
    $('#bkWallTxt').textContent = `가장 두꺼운 매수 호가: ${wtxt(wl.bid, tb, 'b')} · 가장 두꺼운 매도 호가: ${wtxt(wl.ask, ta, 'a')}`;
  }
  function render() {
    $$('#bkCoin button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === B.coin)));
    $$('#bkBand button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === B.band)));
    const s = B.last, sum = $('#bkSum'), cards = $('#bkCards'); if (!s) return;
    const keys = Object.keys(s[B.band]), cur = total(s, B.band, keys), base = baseline(B.band, keys), pctTxt = B.band === 'near' ? '±0.1%' : '±1%';
    sum.textContent = ''; cards.textContent = '';
    if (!cur) { sum.textContent = '호가를 받지 못했어요.'; return; }
    const rb = base.ok ? cur[0] / base.b : null, ra = base.ok ? cur[1] / base.a : null;
    // 한 줄 판정
    const f = B.flow && B.flow.coin === B.coin ? B.flow : null;
    let verdict = '', tone = '';
    if (rb != null && f) {
      const sellRush = f.x <= -FLOW_X, buyRush = f.x >= FLOW_X;
      if (sellRush && rb < THIN) { verdict = `⚠ 시장가 매도가 몰리는데 받쳐 주던 매수 호가가 평소의 ${rb.toFixed(2)}배로 얇아졌어요 → 아래로 미끄러지기 쉬운 상태`; tone = 'down'; }
      else if (buyRush && ra < THIN) { verdict = `⚠ 시장가 매수가 몰리는데 누르던 매도 호가가 평소의 ${ra.toFixed(2)}배로 얇아졌어요 → 위로 튀기 쉬운 상태`; tone = 'up'; }
      else if (sellRush && rb >= 1 && f.move > -0.0015) { verdict = `시장가 매도가 몰리는데 매수 호가가 평소의 ${rb.toFixed(2)}배로 버티고 가격도 안 밀려요 → 누군가 받아 내는 중`; tone = 'up'; }
      else if (buyRush && ra >= 1 && f.move < 0.0015) { verdict = `시장가 매수가 몰리는데 매도 호가가 평소의 ${ra.toFixed(2)}배로 버티고 가격도 안 올라요 → 누군가 받아 내는 중(위에서 팔고 있음)`; tone = 'down'; }
      else if (rb >= 1.3 && ra >= 1.3) verdict = '위아래 호가가 모두 평소보다 두꺼워요 → 충격을 잘 받아 내는 상태, 횡보가 나오기 쉬움';
      else if (rb < THIN && ra < THIN) verdict = '위아래 호가가 모두 평소보다 얇아요 → 작은 주문에도 크게 움직일 수 있는 상태';
      else verdict = '특별한 쏠림 없음';
    } else if (!base.ok) verdict = `평소 기준을 만들려고 기록을 모으는 중이에요 (${base.n}/20). 이 탭을 열어 두면 30초마다 쌓여요.`;
    sum.append(el('div', { class: 'bk-v ' + tone, text: verdict }),
      el('div', { class: 'muted', style: 'font-size:12px', text: `${fdt(s.t / 1000)} · ${B.coin} 현재가 ${fp(s.p)} · ${pctTxt} 안 · 합친 곳: ${keys.map(k => SRC[k].name).join(', ')}${base.ok ? ` · 평소 = ${base.how} 중앙값` : ''}` }));
    const card = (t, v, sub, cls) => el('div', { class: 'bk-card' }, el('div', { class: 'muted', text: t }), el('div', { class: 'bk-num m ' + (cls || ''), text: v }), el('div', { class: 'muted', style: 'font-size:12px', text: sub }));
    const usd = v => fusd(v * s.p);
    cards.append(
      card('매수 호가 (받쳐 주는 쪽)', qty(cur[0]), `${usd(cur[0])}${rb != null ? ` · 평소의 ${rb.toFixed(2)}배` : ''}`, rb != null && rb < THIN ? 'down' : 'up'),
      card('매도 호가 (누르는 쪽)', qty(cur[1]), `${usd(cur[1])}${ra != null ? ` · 평소의 ${ra.toFixed(2)}배` : ''}`, ra != null && ra < THIN ? 'up' : 'down'),
      card('쏠림 (매수 ÷ 매도)', (cur[0] / cur[1]).toFixed(2) + '배', cur[0] >= cur[1] ? '매수 쪽이 두꺼움' : '매도 쪽이 두꺼움', toneOf(cur[0] - cur[1])),
      card('최근 15분 시장가 순매수', f ? `${compact(f.net)} ${B.coin}` : '-', f ? `평소의 ${Math.abs(f.x).toFixed(1)}배 · 바이낸스 선물` : '불러오는 중', f ? toneOf(f.net) : ''));
    // 두께 흐름 그래프
    if (!B.chart) makeChart();
    const pts = base.ok ? B.hist.map(r => ({ r, v: total(r, B.band, keys) })).filter(x => x.v) : [];
    const T = r => Math.floor(r.t / 1000) + off(r.t / 1000);
    B.s.bid.setData(pts.map(x => ({ time: T(x.r), value: x.v[0] / base.b })));
    B.s.ask.setData(pts.map(x => ({ time: T(x.r), value: x.v[1] / base.a })));
    B.s.price.setData(B.hist.map(r => ({ time: T(r), value: r.p })));
    const fk = B.coin + B.band; if (B.fit !== fk && pts.length) { B.fit = fk; B.chart.timeScale().fitContent(); }
    $('#bkChartNote').textContent = base.ok ? `초록 = 매수 호가, 빨강 = 매도 호가 (${pctTxt}, 평소 = 1배). 회색 = 가격(왼쪽 축). 기록 ${B.hist.length}분치 · ${fdt(B.hist[0].t / 1000)}부터` : '평소 기준이 생기면(기록 20개 이상) 두께 흐름이 그려져요.';
    // 벽
    drawWalls(s.walls, s.p);
    // 거래소별 표
    const tb = $('#bkTable'); tb.textContent = '';
    tb.append(el('div', { class: 'bk-row bk-head' }, el('span', { text: '거래소' }), el('span', { class: 'r', text: '±0.1% 매수' }), el('span', { class: 'r', text: '±0.1% 매도' }), el('span', { class: 'r', text: '±1% 매수' }), el('span', { class: 'r', text: '±1% 매도' })));
    Object.keys(SRC).forEach(k => {
      const n = s.near[k], w = s.wide[k], c = v => v ? qty(v) : '—';
      tb.append(el('div', { class: 'bk-row' }, el('span', { text: SRC[k].name }), el('span', { class: 'r m up', text: c(n && n[0]) }), el('span', { class: 'r m down', text: c(n && n[1]) }), el('span', { class: 'r m up', text: c(w && w[0]) }), el('span', { class: 'r m down', text: c(w && w[1]) })));
    });
  }
  async function tick() {
    if (B.busy || U.activeTab() !== 'book' || document.hidden) return; B.busy = true;
    try {
      const s = await sample(); B.last = s; keep(s);
      if (!B.flow || B.flow.coin !== B.coin || Date.now() - B.flowAt > 60e3) { try { B.flow = await flow(); B.flowAt = Date.now(); } catch (e) {} }
      render();
    } catch (e) { $('#bkSum').textContent = e.message; }
    finally { B.busy = false; }
  }
  function start() {
    if (!B.started) { B.started = true; load(); setInterval(tick, EVERY); document.addEventListener('visibilitychange', tick); }
    tick();
  }
  $('#bkCoin').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.dataset.v === B.coin) return; B.coin = b.dataset.v; store.set('bookCoin', B.coin); B.last = null; B.flow = null; B.fit = null; load(); $('#bkSum').textContent = '불러오는 중…'; tick(); });
  $('#bkBand').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; B.band = b.dataset.v; store.set('bookBand', B.band); B.fit = null; render(); });
  window.addEventListener('tabchange', e => { if (e.detail === 'book') start(); });
  if (U.activeTab() === 'book') start();
})();
