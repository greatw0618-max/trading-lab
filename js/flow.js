// 시장 수급 탭: 가격 · OI(스테이블/코인 마진) · 선물·현물 시장가(CVD) · 코인베이스 프리미엄 · 펀딩 · 롱 비중
// 바이낸스·바이비트·코인베이스는 브라우저에서 바로, OKX는 로컬 서버(start-local.bat)를 거쳐 받습니다.
(() => {
  const TA = window.TA, U = TA && TA.ui, LW = window.LightweightCharts;
  if (!U || !LW) return;
  const { el, fp, fpct, fusd, fdt, chip, store, toneOf } = U;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const cv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const off = t => -new Date(t * 1000).getTimezoneOffset() * 60;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const IV = {
    '5m': { label: '5분', ms: 3e5, bybit: '5min', okx: '5m', okxSpot: '5m', spotAgg: 1, cb: 300, cbAgg: 1 },
    '15m': { label: '15분', ms: 9e5, bybit: '15min', okx: '15m', okxSpot: '5m', spotAgg: 3, cb: 900, cbAgg: 1 },
    '1h': { label: '1시간', ms: 36e5, bybit: '1h', okx: '1H', okxSpot: '1H', spotAgg: 1, cb: 3600, cbAgg: 1 },
    '4h': { label: '4시간', ms: 144e5, bybit: '4h', okx: '4H', okxSpot: '1H', spotAgg: 4, cb: 3600, cbAgg: 4 },
    '1d': { label: '1일', ms: 864e5, bybit: '1d', okx: '1Dutc', okxSpot: '1D', spotAgg: 1, cb: 86400, cbAgg: 1 }
  };
  const F = { coin: store.get('flowCoin', 'BTC'), iv: store.get('flowIv', '15m'), n: 300, d: null, load: 0, started: false, key: null };
  if (!IV[F.iv]) F.iv = '15m';

  // ---------- 데이터 받기 ----------
  async function j(url, opt) {
    for (let a = 1; ; a++) {
      const r = await fetch(url, opt);
      if (r.ok) return r.json();
      if ((r.status === 429 || r.status === 418) && a < 3) { await sleep(1500 * a); continue; }
      throw new Error(r.status);
    }
  }
  async function okx(path) {
    const r = await j('api/proxy/okx?path=' + encodeURIComponent(path), { headers: { 'X-Dashboard': '1' }, cache: 'no-store' });
    if (r.code !== '0') throw new Error(r.msg || 'okx');
    return r.data;
  }
  async function okxPaged(base, need) {
    let out = [], end = '';
    for (let k = 0; k < 4 && out.length < need; k++) {
      const d = await okx(base + '&limit=100' + (end ? '&end=' + end : ''));
      if (!d.length) break;
      out = out.concat(d); end = d[d.length - 1][0];
    }
    return out;
  }
  async function bybitOI(cat, sym, iv, need) {
    let out = [], cursor = '';
    for (let k = 0; k < 3 && out.length < need; k++) {
      const r = await j(`https://api.bybit.com/v5/market/open-interest?category=${cat}&symbol=${sym}&intervalTime=${iv}&limit=200${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
      if (r.retCode !== 0) throw new Error(r.retMsg);
      out = out.concat(r.result.list); cursor = r.result.nextPageCursor;
      if (!cursor) break;
    }
    return out;
  }

  async function fetchAll(c, ivKey) {
    const iv = IV[ivKey], n = F.n, sym = c + 'USDT', lim = Math.min(500, n);
    const now = Date.now();
    const jobs = {
      fut: j(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${ivKey}&limit=${n}`),
      spot: j(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${ivKey}&limit=${n}`),
      oiBinU: j(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${sym}&period=${ivKey}&limit=${lim}`),
      oiBinC: j(`https://dapi.binance.com/futures/data/openInterestHist?pair=${c}USD&contractType=ALL&period=${ivKey}&limit=${lim}`),
      oiBybL: bybitOI('linear', sym, iv.bybit, n),
      oiBybI: bybitOI('inverse', c + 'USD', iv.bybit, n),
      lsG: j(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=${ivKey}&limit=${lim}`),
      lsT: j(`https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${sym}&period=${ivKey}&limit=${lim}`),
      fund: j(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}&startTime=${now - n * iv.ms - 864e5}&limit=1000`),
      prem: j(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`),
      cb: j(`https://api.exchange.coinbase.com/products/${c}-USD/candles?granularity=${iv.cb}`),
      okxFut: okxPaged(`/api/v5/rubik/stat/taker-volume-contract?instId=${c}-USDT-SWAP&period=${iv.okx}&unit=0`, n),
      okxOI: okxPaged(`/api/v5/rubik/stat/contracts/open-interest-history?instId=${c}-USDT-SWAP&period=${iv.okx}`, n),
      okxSpot: okx(`/api/v5/rubik/stat/taker-volume?ccy=${c}&instType=SPOT&period=${iv.okxSpot}`)
    };
    const keys = Object.keys(jobs), res = await Promise.allSettled(Object.values(jobs)), out = {}, fail = [];
    keys.forEach((k, i) => { if (res[i].status === 'fulfilled') out[k] = res[i].value; else fail.push(k); });
    return { out, fail };
  }

  // ---------- 하나의 시간축으로 맞추기 ----------
  function build(raw, ivKey) {
    const iv = IV[ivKey], ms = iv.ms, fut = raw.fut;
    const n = fut.length, t = fut.map(k => k[0]);
    const idx = new Map(t.map((x, i) => [x, i]));
    const arr = () => new Array(n).fill(null);
    const d = { t, o: fut.map(k => +k[1]), h: fut.map(k => +k[2]), l: fut.map(k => +k[3]), c: fut.map(k => +k[4]),
      fBin: fut.map(k => 2 * (+k[9]) - (+k[5])), fOkx: arr(), sBin: arr(), sOkx: arr(), sClose: arr(), cb: arr(),
      oiBinU: arr(), oiBinC: arr(), oiBybL: arr(), oiBybI: arr(), oiOkx: arr(), fund: arr(), lsG: arr(), lsT: arr() };
    const bucket = ts => Math.floor(ts / ms) * ms;
    // 스냅샷 값(OI, 롱 비중)은 그 시각에 끝난 봉에 붙입니다.
    const snap = (rows, key, getTs, getV) => (rows || []).forEach(r => { const i = idx.get(bucket(getTs(r)) - ms); if (i != null) d[key][i] = getV(r); });
    (raw.spot || []).forEach(k => { const i = idx.get(k[0]); if (i != null) { d.sBin[i] = 2 * (+k[9]) - (+k[5]); d.sClose[i] = +k[4]; } });
    (raw.okxFut || []).forEach(r => { const i = idx.get(+r[0]); if (i != null) d.fOkx[i] = (+r[2]) - (+r[1]); });
    if (raw.okxSpot) { // 5분/1시간 단위를 이 봉 주기로 묶습니다
      const agg = new Map();
      raw.okxSpot.forEach(r => { const b = bucket(+r[0]); agg.set(b, (agg.get(b) || 0) + (+r[2]) - (+r[1])); });
      agg.forEach((v, b) => { const i = idx.get(b); if (i != null) d.sOkx[i] = v; });
      // 5분 데이터는 이틀치뿐이라, 빈 봉이 섞인 맨 앞 묶음은 버립니다
      if (iv.spotAgg > 1) { const first = d.sOkx.findIndex(v => v != null); if (first >= 0) d.sOkx[first] = null; }
    }
    if (raw.cb) {
      const agg = new Map();
      raw.cb.slice().reverse().forEach(r => agg.set(bucket(r[0] * 1000), +r[4])); // 오래된 것부터 → 묶음의 마지막 종가
      agg.forEach((v, b) => { const i = idx.get(b); if (i != null) d.cb[i] = v; });
    }
    snap(raw.oiBinU, 'oiBinU', r => r.timestamp, r => +r.sumOpenInterestValue);
    snap(raw.oiBinC, 'oiBinC', r => r.timestamp, r => +r.sumOpenInterestValue); // 코인 수량 → 아래에서 달러로 환산
    snap(raw.oiBybL, 'oiBybL', r => +r.timestamp, r => +r.openInterest);        // 코인 수량
    snap(raw.oiBybI, 'oiBybI', r => +r.timestamp, r => +r.openInterest);        // 달러(1계약 = 1달러)
    snap(raw.okxOI, 'oiOkx', r => +r[0], r => +r[3]);                           // 달러
    snap(raw.lsG, 'lsG', r => r.timestamp, r => +r.longAccount * 100);
    snap(raw.lsT, 'lsT', r => r.timestamp, r => +r.longAccount * 100);
    for (let i = 0; i < n; i++) {
      if (d.oiBinC[i] != null) d.oiBinC[i] *= d.c[i];
      if (d.oiBybL[i] != null) d.oiBybL[i] *= d.c[i];
    }
    // 거래소 데이터가 한 칸이라도 비면 합계가 순간적으로 뚝 떨어져 보이므로, 빈 칸은 직전 값(맨 앞은 첫 값)으로 채웁니다.
    ['oiBinU', 'oiBinC', 'oiBybL', 'oiBybI', 'oiOkx', 'lsG', 'lsT'].forEach(k => {
      const a = d[k], first = a.findIndex(v => v != null);
      if (first < 0) return;
      for (let i = 0; i < first; i++) a[i] = a[first];
      for (let i = first + 1; i < n; i++) if (a[i] == null) a[i] = a[i - 1];
    });
    // 펀딩: 봉이 끝나는 시각 이전에 마지막으로 정산된 값, 마지막 봉은 예상 펀딩
    const fr = (raw.fund || []).map(f => [f.fundingTime, +f.fundingRate * 100]).sort((a, b) => a[0] - b[0]);
    let p = 0, cur = null;
    for (let i = 0; i < n; i++) { while (p < fr.length && fr[p][0] <= t[i] + ms) cur = fr[p++][1]; d.fund[i] = cur; }
    if (raw.prem) d.fund[n - 1] = +raw.prem.lastFundingRate * 100;
    d.nextFunding = raw.prem ? +raw.prem.nextFundingTime : null;
    // 합계
    d.oiStable = d.t.map((_, i) => sum([d.oiBinU[i], d.oiBybL[i]]));
    d.oiCoin = d.t.map((_, i) => sum([d.oiBinC[i], d.oiBybI[i]]));
    d.oiTotal = d.t.map((_, i) => sum([d.oiStable[i], d.oiCoin[i], d.oiOkx[i]]));
    d.fSum = d.t.map((_, i) => sum([d.fBin[i], d.fOkx[i]]));
    d.sSum = d.t.map((_, i) => sum([d.sBin[i], d.sOkx[i]]));
    d.cbp = d.t.map((_, i) => d.cb[i] != null && d.sClose[i] != null ? d.cb[i] - d.sClose[i] : null);
    const cum = a => { let s = 0, seen = false; return a.map(v => { if (v != null) { s += v; seen = true; } return seen ? s : null; }); };
    ['fBin', 'fOkx', 'fSum', 'sBin', 'sOkx', 'sSum'].forEach(k => { d['cvd_' + k] = cum(d[k]); });
    classify(d);
    return d;
  }
  const sum = vs => { let s = 0, any = false; vs.forEach(v => { if (v != null) { s += v; any = true; } }); return any ? s : null; };

  // ---------- 봉 해석 ----------
  const KIND = { newLong: ['신규 롱', 'good'], shortCover: ['숏 터짐(숏 청산)', 'good'], newShort: ['신규 숏', 'bad'], longLiq: ['롱 터짐(롱 청산)', 'bad'], flat: ['OI 변화 작음', 'flat'] };
  function classify(d) {
    const n = d.t.length; d.kind = new Array(n).fill(null); d.dp = new Array(n).fill(null); d.doi = new Array(n).fill(null);
    for (let i = 1; i < n; i++) {
      d.dp[i] = d.c[i] / d.c[i - 1] - 1;
      if (d.oiTotal[i] != null && d.oiTotal[i - 1]) d.doi[i] = d.oiTotal[i] / d.oiTotal[i - 1] - 1;
      const oi = d.doi[i], pr = d.dp[i];
      if (oi == null) continue;
      d.kind[i] = Math.abs(oi) < 0.0005 ? 'flat' : oi > 0 ? (pr >= 0 ? 'newLong' : 'newShort') : (pr >= 0 ? 'shortCover' : 'longLiq');
    }
    // 스퀴즈: OI가 평소보다 크게 줄면서 가격이 크게 움직인 봉
    const sd = a => { const v = a.filter(x => x != null); const m = v.reduce((s, x) => s + x, 0) / (v.length || 1); return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length || 1)); };
    const sOi = sd(d.doi), sP = sd(d.dp);
    d.squeeze = [];
    for (let i = 1; i < n; i++) {
      if (d.doi[i] == null) continue;
      if (d.doi[i] < -2 * sOi && Math.abs(d.dp[i]) > 1.2 * sP) d.squeeze.push({ i, up: d.dp[i] > 0 });
    }
  }

  // ---------- 차트 ----------
  const PANES = [
    { id: 'price', h: 300, label: '가격' }, { id: 'oi', h: 140, label: 'OI 합계' }, { id: 'oisplit', h: 120, label: 'OI 구성' },
    { id: 'fcvd', h: 130, label: '선물 시장가 (CVD)' }, { id: 'scvd', h: 130, label: '현물 시장가 (CVD)' },
    { id: 'cbp', h: 100, label: '코인베이스 프리미엄' }, { id: 'fund', h: 100, label: '펀딩' }, { id: 'ls', h: 110, label: '롱 비중' }
  ];
  let C = null;
  const compact = v => { if (v == null || !isFinite(v)) return '—'; const a = Math.abs(v), s = v < 0 ? '-' : ''; return a >= 1e9 ? s + (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? s + (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? s + (a / 1e3).toFixed(1) + 'K' : s + a.toFixed(a < 10 ? 2 : 0); };
  function makeCharts() {
    const box = $('#flowPanes'); box.textContent = '';
    const base = (last) => ({
      autoSize: true, layout: { background: { type: 'solid', color: cv('--panel') }, textColor: cv('--muted'), fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 11, attributionLogo: last },
      grid: { vertLines: { color: cv('--grid') }, horzLines: { color: cv('--grid') } },
      rightPriceScale: { borderVisible: false, minimumWidth: 78 }, timeScale: { visible: last, borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: LW.CrosshairMode.Normal }, localization: { locale: 'ko-KR' }
    });
    C = { panes: {}, charts: [] };
    PANES.forEach((p, k) => {
      const wrap = el('div', { class: 'fpane' }, el('div', { class: 'flabel', id: 'fl-' + p.id }), el('div', { style: `height:${p.h}px` }));
      box.append(wrap);
      const ch = LW.createChart(wrap.lastChild, base(k === PANES.length - 1));
      C.panes[p.id] = { ch, s: {} }; C.charts.push(ch);
    });
    const P = C.panes, nl = { priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false };
    const vol = { type: 'custom', minMove: 0.01, formatter: v => compact(v) };
    P.price.s.c = P.price.ch.addCandlestickSeries({ borderVisible: false });
    P.oi.s.t = P.oi.ch.addAreaSeries({ lineWidth: 2, priceFormat: vol, ...nl });
    P.oisplit.s.st = P.oisplit.ch.addLineSeries({ lineWidth: 2, priceFormat: vol, ...nl });
    P.oisplit.s.cm = P.oisplit.ch.addLineSeries({ lineWidth: 2, priceScaleId: 'left', priceFormat: vol, ...nl });
    P.oisplit.ch.applyOptions({ leftPriceScale: { visible: true, borderVisible: false } });
    ['fcvd', 'scvd'].forEach(id => {
      P[id].s.sum = P[id].ch.addLineSeries({ lineWidth: 2, priceFormat: vol, ...nl });
      P[id].s.bin = P[id].ch.addLineSeries({ lineWidth: 1, priceFormat: vol, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      P[id].s.okx = P[id].ch.addLineSeries({ lineWidth: 1, priceFormat: vol, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    });
    P.cbp.s.h = P.cbp.ch.addHistogramSeries({ priceFormat: { type: 'custom', minMove: 0.01, formatter: v => (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(Math.abs(v) < 10 ? 2 : 0) }, ...nl });
    P.fund.s.h = P.fund.ch.addHistogramSeries({ priceFormat: { type: 'custom', minMove: 0.0001, formatter: v => v.toFixed(4) + '%' }, ...nl });
    P.ls.s.g = P.ls.ch.addLineSeries({ lineWidth: 2, priceFormat: { type: 'price', precision: 1, minMove: 0.1 }, ...nl });
    P.ls.s.t = P.ls.ch.addLineSeries({ lineWidth: 2, priceFormat: { type: 'price', precision: 1, minMove: 0.1 }, ...nl });
    let syncing = false;
    C.charts.forEach(ch => ch.timeScale().subscribeVisibleLogicalRangeChange(r => {
      if (syncing || !r) return; syncing = true; C.charts.forEach(o => { if (o !== ch) o.timeScale().setVisibleLogicalRange(r); }); syncing = false;
    }));
    C.charts.forEach(ch => ch.subscribeCrosshairMove(prm => {
      if (!F.d) return;
      const i = prm && prm.time != null ? F.times.indexOf(prm.time) : -1;
      hover(i >= 0 ? i : null);
      if (prm && prm.time != null) C.charts.forEach(o => { if (o !== ch) { try { const s = firstSeries(o); const v = valueAt(o, i); if (s && v != null) o.setCrosshairPosition(v, prm.time, s); } catch (e) {} } });
      else C.charts.forEach(o => { if (o !== ch) { try { o.clearCrosshairPosition(); } catch (e) {} } });
    }));
    applyTheme();
  }
  const firstSeries = ch => { const p = Object.values(C.panes).find(x => x.ch === ch); return p && Object.values(p.s)[0]; };
  function valueAt(ch, i) {
    const d = F.d, id = Object.keys(C.panes).find(k => C.panes[k].ch === ch);
    return { price: d.c, oi: d.oiTotal, oisplit: d.oiStable, fcvd: d.cvd_fSum, scvd: d.cvd_sSum, cbp: d.cbp, fund: d.fund, ls: d.lsG }[id][i];
  }
  function applyTheme() {
    if (!C) return;
    C.charts.forEach(ch => ch.applyOptions({ layout: { background: { type: 'solid', color: cv('--panel') }, textColor: cv('--muted') }, grid: { vertLines: { color: cv('--grid') }, horzLines: { color: cv('--grid') } } }));
    const P = C.panes, up = cv('--up'), dn = cv('--down');
    P.price.s.c.applyOptions({ upColor: up, downColor: dn, wickUpColor: up, wickDownColor: dn });
    P.oi.s.t.applyOptions({ lineColor: cv('--e10'), topColor: cv('--zone-ict'), bottomColor: 'transparent' });
    P.oisplit.s.st.applyOptions({ color: cv('--e60') }); P.oisplit.s.cm.applyOptions({ color: cv('--e20') });
    ['fcvd', 'scvd'].forEach(id => { P[id].s.sum.applyOptions({ color: cv('--accent') }); P[id].s.bin.applyOptions({ color: cv('--e10') }); P[id].s.okx.applyOptions({ color: cv('--muted') }); });
    P.ls.s.g.applyOptions({ color: cv('--e10') }); P.ls.s.t.applyOptions({ color: cv('--e60') });
    if (F.d) draw(true);
  }
  window.addEventListener('themechange', applyTheme);

  function draw(keep) {
    const d = F.d, P = C.panes, n = d.t.length;
    const T = F.times = d.t.map(ms => Math.floor(ms / 1000) + off(ms / 1000));
    const line = a => a.map((v, i) => v == null ? { time: T[i] } : { time: T[i], value: v });
    const range = C.charts[0].timeScale().getVisibleLogicalRange();
    const dec = d.c[n - 1] >= 1000 ? 1 : d.c[n - 1] >= 10 ? 2 : d.c[n - 1] >= 1 ? 3 : 5;
    P.price.s.c.applyOptions({ priceFormat: { type: 'price', precision: dec, minMove: 1 / 10 ** dec } });
    P.price.s.c.setData(T.map((t, i) => ({ time: t, open: d.o[i], high: d.h[i], low: d.l[i], close: d.c[i] })));
    P.price.s.c.setMarkers(d.squeeze.map(q => ({ time: T[q.i], position: q.up ? 'belowBar' : 'aboveBar', color: q.up ? cv('--up') : cv('--down'), shape: q.up ? 'arrowUp' : 'arrowDown', text: q.up ? '숏 스퀴즈' : '롱 청산 몰림' })));
    P.oi.s.t.setData(line(d.oiTotal));
    P.oisplit.s.st.setData(line(d.oiStable)); P.oisplit.s.cm.setData(line(d.oiCoin));
    P.fcvd.s.sum.setData(line(d.cvd_fSum)); P.fcvd.s.bin.setData(line(d.cvd_fBin)); P.fcvd.s.okx.setData(line(d.cvd_fOkx));
    P.scvd.s.sum.setData(line(d.cvd_sSum)); P.scvd.s.bin.setData(line(d.cvd_sBin)); P.scvd.s.okx.setData(line(d.cvd_sOkx));
    const up = cv('--up'), dn = cv('--down');
    P.cbp.s.h.setData(d.cbp.map((v, i) => v == null ? { time: T[i] } : { time: T[i], value: v, color: v >= 0 ? up : dn }));
    P.fund.s.h.setData(d.fund.map((v, i) => v == null ? { time: T[i] } : { time: T[i], value: v, color: v >= 0 ? up : dn }));
    P.ls.s.g.setData(line(d.lsG)); P.ls.s.t.setData(line(d.lsT));
    if (keep && range) C.charts[0].timeScale().setVisibleLogicalRange(range);
    else { C.charts[0].timeScale().applyOptions({ barSpacing: 5 }); C.charts[0].timeScale().scrollToRealTime(); }
    hover(null); summary(); renderState();
  }

  // ---------- 설명 ----------
  const coinAmt = v => v == null ? '—' : (v > 0 ? '+' : '') + compact(v) + ' ' + F.coin;
  function hover(iIn) {
    const d = F.d; if (!d) return;
    // 마우스를 올리지 않았을 때는 가장 최근에 끝난 봉(진행 중인 마지막 봉은 OI가 아직 안 나옴)
    const n = d.t.length, i = iIn == null ? Math.max(0, n - 2) : iIn;
    const lbl = (id, parts) => { const e = $('#fl-' + id); e.textContent = ''; e.append(el('b', { text: PANES.find(p => p.id === id).label }), ...parts); };
    const sp = (cls, t) => el('span', { class: cls || '', text: t });
    lbl('price', [sp('', ` 시 ${fp(d.o[i])} 고 ${fp(d.h[i])} 저 ${fp(d.l[i])} 종 ${fp(d.c[i])}`)]);
    lbl('oi', [sp('', ` ${fusd(d.oiTotal[i])}`), sp(toneOf(d.doi[i]), d.doi[i] == null ? '' : ` (${fpct(d.doi[i] * 100, 2)})`)]);
    lbl('oisplit', [sp('fk e60', ` 스테이블 마진 ${fusd(d.oiStable[i])}`), sp('fk e20', ` · 코인 마진 ${fusd(d.oiCoin[i])} (왼쪽 축)`), sp('muted', d.oiOkx[i] != null ? ` · OKX ${fusd(d.oiOkx[i])} (합계에만 포함)` : '')]);
    ['f', 's'].forEach(x => lbl(x + 'cvd', [sp('fk acc', ` 합산 ${coinAmt(d['cvd_' + x + 'Sum'][i])}`), sp('fk e10', ` · 바이낸스 ${coinAmt(d['cvd_' + x + 'Bin'][i])}`), sp('muted', ` · OKX ${coinAmt(d['cvd_' + x + 'Okx'][i])}`)]));
    lbl('cbp', [sp(toneOf(d.cbp[i]), d.cbp[i] == null ? ' 데이터 없음' : ` ${d.cbp[i] < 0 ? '-' : '+'}$${Math.abs(d.cbp[i]).toFixed(Math.abs(d.cbp[i]) < 10 ? 2 : 0)}`)]);
    lbl('fund', [sp(toneOf(d.fund[i]), d.fund[i] == null ? ' —' : ` ${d.fund[i].toFixed(4)}%`), sp('muted', i === n - 1 ? ' (다음 정산 예상)' : ' (8시간마다 정산된 값)'), sp('muted', ` · 다음 예상 ${d.fund[n - 1] == null ? '—' : d.fund[n - 1].toFixed(4) + '%'}`)]);
    lbl('ls', [sp('fk e10', ` 개인 ${d.lsG[i] == null ? '—' : d.lsG[i].toFixed(1) + '%'}`), sp('fk e60', ` · 탑트레이더 ${d.lsT[i] == null ? '—' : d.lsT[i].toFixed(1) + '%'}`)]);
    // 위쪽 해설 줄
    const box = $('#flowHover'); box.textContent = '';
    const k = d.kind[i], oiAbs = d.oiTotal[i] != null && d.oiTotal[i - 1] != null ? d.oiTotal[i] - d.oiTotal[i - 1] : null;
    const endT = (d.t[i] + IV[F.iv].ms) / 1000;
    const when = F.iv === '1d' ? fdt(d.t[i] / 1000).slice(0, -6) + ' 하루' : `${fdt(d.t[i] / 1000)}~${fdt(endT).slice(-5)}`;
    box.append(el('b', { class: 'm', text: when }),
      ' · 가격 ', el('b', { class: toneOf(d.dp[i]), text: d.dp[i] == null ? '—' : fpct(d.dp[i] * 100, 2) }),
      ' · OI ', el('b', { class: toneOf(d.doi[i]), text: d.doi[i] == null ? '—' : `${fpct(d.doi[i] * 100, 2)} (${oiAbs >= 0 ? '+' : '-'}${fusd(Math.abs(oiAbs))})` }),
      ...(k ? [' → ', chip(KIND[k][1], KIND[k][0])] : []),
      ` · 선물 시장가 ${d.fSum[i] == null ? '—' : (d.fSum[i] >= 0 ? '매수' : '매도') + ' 우위 ' + coinAmt(d.fSum[i])}`,
      ` · 현물 ${d.sSum[i] == null ? '—' : (d.sSum[i] >= 0 ? '매수' : '매도') + ' 우위 ' + coinAmt(d.sSum[i])}`,
      d.cbp[i] != null ? ` · 코인베이스 프리미엄 ${d.cbp[i] < 0 ? '-' : '+'}$${Math.abs(d.cbp[i]).toFixed(Math.abs(d.cbp[i]) < 10 ? 2 : 0)}` : '');
  }

  function summary() {
    const d = F.d, n = d.t.length, box = $('#flowSum'); box.textContent = '';
    const cnt = {}; d.kind.forEach(k => { if (k) cnt[k] = (cnt[k] || 0) + 1; });
    const i0 = d.oiTotal.findIndex(v => v != null);
    const dpAll = d.c[n - 1] / d.c[0] - 1, doiAll = i0 >= 0 && d.oiTotal[n - 1] ? d.oiTotal[n - 1] / d.oiTotal[i0] - 1 : null;
    const hrs = n * IV[F.iv].ms / 36e5, span = hrs < 48 ? `${Math.round(hrs)}시간` : `${(hrs / 24).toFixed(1)}일`;
    const row = (k, ...v) => box.append(el('div', { class: 'srow' }, el('b', { text: k }), el('div', null, ...v)));
    row('가격', `${IV[F.iv].label}봉 ${span} 동안 `, el('b', { class: toneOf(dpAll), text: fpct(dpAll * 100, 2) }), ` (${fp(d.c[0])} → ${fp(d.c[n - 1])})`);
    row('OI', doiAll == null ? '—' : el('b', { class: toneOf(doiAll), text: fpct(doiAll * 100, 2) }), doiAll == null ? '' : ` (${fusd(d.oiTotal[i0])} → ${fusd(d.oiTotal[n - 1])})`);
    row('봉 종류', ...['newLong', 'shortCover', 'newShort', 'longLiq', 'flat'].map(k => [chip(KIND[k][1], `${KIND[k][0]} ${cnt[k] || 0}봉`), ' ']).flat());
    const fT = d.cvd_fSum[n - 1], sT = d.cvd_sSum[n - 1];
    const tips = [];
    if (fT != null && sT != null) {
      if (fT > 0 && sT > 0) tips.push(['good', '선물·현물 모두 시장가 매수가 우위입니다. 실제 매수세가 받쳐 주는 흐름입니다.']);
      else if (fT < 0 && sT < 0) tips.push(['bad', '선물·현물 모두 시장가 매도가 우위입니다. 위에서 던지는 물량이 많은 흐름입니다.']);
      else if (sT > 0 && fT < 0) tips.push(['warn', '현물은 시장가로 사고, 선물은 시장가로 파는 중입니다. 현물 매수에 대한 헤지이거나 숏이 쌓이는 중일 수 있습니다.']);
      else tips.push(['warn', '선물은 시장가로 사는데 현물은 팔고 있습니다. 레버리지(선물) 매수가 이끄는 흐름이라 현물 뒷받침이 약합니다.']);
    }
    const cbAvg = avg(d.cbp.slice(-Math.min(48, n)));
    if (cbAvg != null) tips.push([cbAvg >= 0 ? 'good' : 'bad', `최근 코인베이스 프리미엄 평균 ${cbAvg < 0 ? '-' : '+'}$${Math.abs(cbAvg).toFixed(Math.abs(cbAvg) < 10 ? 2 : 0)}: ${cbAvg >= 0 ? '미국 현물이 바이낸스보다 비싸게 거래 → 미국 쪽 매수세가 강함' : '미국 현물이 바이낸스보다 싸게 거래 → 미국 쪽 매수세가 약함'}`]);
    const f = d.fund[n - 1];
    if (f != null) tips.push([Math.abs(f) > 0.03 ? 'warn' : 'flat', `예상 펀딩 ${f.toFixed(4)}%: ${f > 0.03 ? '롱이 숏에게 많이 내는 중 → 롱 쏠림' : f < -0.01 ? '숏이 롱에게 내는 중 → 숏 쏠림, 숏 스퀴즈 주의' : '쏠림이 크지 않음'}`]);
    const g = d.lsG[n - 1];
    if (g != null) tips.push([g >= 65 ? 'warn' : 'flat', `개인 계좌의 ${g.toFixed(1)}%가 롱: ${g >= 65 ? '개인이 롱으로 몰려 있어, 가격이 빠지면 롱 청산이 연쇄로 나올 수 있음' : g <= 40 ? '개인이 숏 쪽으로 몰려 있음' : '한쪽으로 크게 쏠리지 않음'}`]);
    if (d.squeeze.length) tips.push(['warn', `차트의 화살표 ${d.squeeze.length}곳: OI가 평소보다 크게 줄면서 가격이 급하게 움직인 봉 (숏 스퀴즈 / 롱 청산 몰림)`]);
    row('해석', el('ul', { class: 'vlist' }, tips.map(([t, x]) => el('li', { class: t, text: x }))));
  }
  const avg = a => { const v = a.filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };

  // ---------- 지금 시장 상태 (가격 × OI) ----------
  // 최근 1시간(봉 여러 개를 묶음)의 가격·OI 변화로 상태를 나누고, 24시간 중 같은 상태였던 비율과 해석을 보여 줍니다.
  const STATES = {
    upOiUp: { tag: '가격 ↑ · OI ↑', title: '상승 추세 강화', mean: '오르면서 포지션이 늘어남. 새 롱이 들어오며 밀어 올리는 흐름', check: ['시장가 매수(CVD)도 같이 늘면 진짜 매수세', 'CVD가 줄면 지정가로 받치는 숏이 쌓이는 중 → 뒤늦게 숏 스퀴즈나 급락 둘 다 가능', '펀딩이 크게 +로 가면 롱 과열'] },
    dnOiUp: { tag: '가격 ↓ · OI ↑', title: '하락 추세 가속', mean: '내리면서 포지션이 늘어남. 신규 숏이거나, 떨어질 때 롱이 물타기 하는 중', check: ['시장가 매도 우위면 신규 숏이 내리꽂는 중', '시장가 매수 우위인데 가격이 못 오르면 롱이 흡수당하는 중', '개인 롱 비중↑ = 개인이 저가에서 받는 중 (아래로 가면 털릴 물량)', '롱 털림 직후면 위 순서가 바뀜'] },
    upOiDn: { tag: '가격 ↑ · OI ↓', title: '숏 청산 반등', mean: '오르는데 포지션이 줄어듦. 숏이 터지거나 정리하며 오르는 중 (새 매수는 약할 수 있음)', check: ['OI가 다시 늘기 시작하면 새 롱이 붙는 진짜 상승', 'OI가 계속 줄며 오르면 숏 청산이 끝날 때 멈출 수 있음', '현물 CVD가 같이 오르면 더 믿을 만함'] },
    dnOiDn: { tag: '가격 ↓ · OI ↓', title: '롱 청산 하락', mean: '내리는데 포지션이 줄어듦. 롱이 털리거나 정리하며 내리는 중', check: ['청산이 몰린 뒤 OI가 바닥을 찍으면 하락이 멈추기 쉬움', '개인 롱 비중이 줄면 털림이 진행 중', '현물 매수가 들어오면 반등 신호'] },
    flatOiUp: { tag: '가격 → · OI ↑', title: '포지션 쌓이는 중', mean: '가격은 그대로인데 포지션이 늘어남. 양쪽이 힘겨루기 중이라 곧 한쪽으로 크게 흔들릴 수 있음', check: ['어느 쪽이 더 많이 쌓였는지 (롱 비중·CVD)', '쌓인 쪽의 청산 가격대가 가까운지', '돌파 방향으로 청산이 연쇄로 나오기 쉬움'] },
    flatOiDn: { tag: '가격 → · OI ↓', title: '포지션 정리 중', mean: '가격은 그대로인데 포지션이 줄어듦. 양쪽이 같이 빠지며 관망하는 흐름', check: ['거래가 줄어드는 구간이면 큰 움직임 전 휴식일 수 있음', 'OI가 다시 늘기 시작하는 방향을 확인'] },
    quiet: { tag: '가격 → · OI →', title: '조용한 구간', mean: '가격과 포지션 모두 큰 변화가 없음', check: ['박스권 위아래 경계 확인', '거래량·OI가 갑자기 늘어나는 봉을 기다림'] }
  };
  function stateOf(dp, doi, pTh, oTh) {
    if (dp == null || doi == null) return null;
    const pf = Math.abs(dp) < pTh, of = Math.abs(doi) < oTh;
    if (pf && of) return 'quiet';
    if (pf) return doi > 0 ? 'flatOiUp' : 'flatOiDn';
    if (of) return 'quiet';
    return dp > 0 ? (doi > 0 ? 'upOiUp' : 'upOiDn') : (doi > 0 ? 'dnOiUp' : 'dnOiDn');
  }
  // 계산: 최근 1시간 가격 × OI(코인 수량) 상태와 24시간 비율 (시장 수급 탭과 리포트가 같이 씀)
  function computeState(d, ivKey) {
    const n = d.t.length, ms = IV[ivKey].ms, k = Math.max(1, Math.round(36e5 / ms)), day = Math.max(k, Math.round(864e5 / ms));
    const win = (i, w) => { const a = i - w; if (a < 0 || d.oiTotal[a] == null || d.oiTotal[i] == null) return null; return { dp: d.c[i] / d.c[a] - 1, doi: (d.oiTotal[i] / d.c[i]) / (d.oiTotal[a] / d.c[a]) - 1 }; }; // OI는 코인 수량 기준
    // 기준: 1시간 가격 변화가 최근 1시간 변화들의 중앙값 절반보다 작으면 "가격 그대로", OI는 0.15% 미만이면 "변화 없음"
    const hist = []; for (let i = k; i < n; i++) { const w = win(i, k); if (w) hist.push(Math.abs(w.dp)); }
    hist.sort((a, b) => a - b);
    const pTh = Math.max(0.0015, (hist[Math.floor(hist.length / 2)] || 0.003) * 0.5), oTh = 0.0015;
    const now = win(n - 1, k);
    if (!now) return null;
    const cur = stateOf(now.dp, now.doi, pTh, oTh);
    const states = []; for (let i = Math.max(k, n - day); i < n; i++) { const w = win(i, k); states.push({ i, s: w ? stateOf(w.dp, w.doi, pTh, oTh) : null }); }
    const same = states.filter(x => x.s === cur);
    let dPx = 0, dOi = 0; same.forEach(x => { dPx += d.c[x.i] - d.c[x.i - 1]; if (d.oiTotal[x.i] != null && d.oiTotal[x.i - 1] != null) dOi += d.oiTotal[x.i] / d.c[x.i] - d.oiTotal[x.i - 1] / d.c[x.i - 1]; });
    let fc = 0; for (let i = n - k; i < n; i++) if (d.fSum[i] != null) fc += d.fSum[i];
    const oiCoin = d.oiTotal[n - 1] / d.c[n - 1] - d.oiTotal[n - 1 - k] / d.c[n - 1 - k];
    let sub = '';
    if (cur === 'dnOiUp') sub = fc > 0 ? '롱이 들어오는데 가격이 못 올라요' : '신규 숏이 시장가로 내리꽂고 있어요';
    else if (cur === 'upOiUp') sub = fc > 0 ? '새 롱이 시장가로 밀어 올리고 있어요' : '오르지만 시장가 매수는 약해요 (숏이 쌓이는 중일 수 있어요)';
    else if (cur === 'upOiDn') sub = '숏이 터지며 올라가는 중이에요';
    else if (cur === 'dnOiDn') sub = '롱이 털리며 내려가는 중이에요';
    else if (cur === 'flatOiUp') sub = '어느 쪽이든 크게 흔들릴 수 있어요 · 주의!!';
    const cnt = {}; states.forEach(x => { if (x.s) cnt[x.s] = (cnt[x.s] || 0) + 1; });
    const ls = a => { const x = a[n - 1 - k], y = a[n - 1]; return x != null && y != null ? [x, y] : null; };
    return { k, n, cur, sub, now, states, same, dPx, dOi, fc, oiCoin, cnt, lsG: ls(d.lsG), lsT: ls(d.lsT) };
  }
  // 계산: OI 급증 알림
  function computeAlert(d, k, n, coin) {
    const ch = []; const oc = i => d.oiTotal[i] / d.c[i]; // 코인 수량 기준 OI
    for (let i = k; i < n; i++) if (d.oiTotal[i] != null && d.oiTotal[i - k] != null) ch.push(oc(i) / oc(i - k) - 1);
    const m = ch.reduce((s, x) => s + x, 0) / (ch.length || 1), sd = Math.sqrt(ch.reduce((s, x) => s + (x - m) ** 2, 0) / (ch.length || 1));
    const doi = oc(n - 1) / oc(n - 1 - k) - 1, dp = d.c[n - 1] / d.c[n - 1 - k] - 1, z = sd ? (doi - m) / sd : 0;
    const surge = doi > 0.008 && z >= 2, flat = Math.abs(dp) < 0.005;
    const out = { surge, flat, doi, dp, z };
    if (!surge) return out;
    const price = d.c[n - 1], g = d.lsG[n - 1];
    let fc = 0; for (let i = n - k; i < n; i++) if (d.fSum[i] != null) fc += d.fSum[i];
    // 털릴 쪽: 개인 롱 비중이 높거나(55%↑) 시장가 매수로 쌓였으면 롱, 반대면 숏
    const side = g != null && g >= 55 ? 1 : g != null && g <= 45 ? -1 : fc >= 0 ? 1 : -1;
    // 25~50배 레버리지로 막 들어온 포지션이 청산되는 가격대 (추정)
    const lo = side > 0 ? price * (1 - 0.9 / 25) : price * (1 + 0.9 / 50), hi = side > 0 ? price * (1 - 0.9 / 50) : price * (1 + 0.9 / 25);
    const newOiCoin = oc(n - 1) - oc(n - 1 - k);
    const shareTop = d.lsT[n - 1] != null ? d.lsT[n - 1] / 100 : 0.5, cexEst = Math.max(0, newOiCoin * (side > 0 ? shareTop : 1 - shareTop));
    const hlReal = U.whaleLiqIn ? U.whaleLiqIn(hlName(coin), Math.min(lo, hi), Math.max(lo, hi), side) : null;
    return { ...out, price, g, fc, side, lo: Math.min(lo, hi), hi: Math.max(lo, hi), edge: side > 0 ? hi : lo, newOiCoin, cexEst, hlReal };
  }
  // 리포트용 글: 지금 시장 상태 + OI 급증 알림
  function stateText(d, ivKey, coin) {
    const st = computeState(d, ivKey); if (!st) return '[지금 시장 상태] OI 데이터 부족';
    const S = STATES[st.cur], tot = st.states.length;
    const L = [`[지금 시장 상태] ${coin} · ${IV[ivKey].label}봉으로 본 최근 1시간: ${S.tag} "${S.title}"${st.sub ? ' — ' + st.sub : ''}`,
      `24시간 중 이 상태 ${tot ? Math.round(st.same.length / tot * 100) : 0}% (${st.same.length}봉) · 그동안 가격 ${st.dPx >= 0 ? '+' : ''}${fp(st.dPx)} · OI ${st.dOi >= 0 ? '+' : ''}${Math.round(st.dOi).toLocaleString()} ${coin}`,
      `1시간: 가격 ${fpct(st.now.dp * 100, 2)} · OI ${st.oiCoin >= 0 ? '+' : ''}${Math.round(st.oiCoin).toLocaleString()} ${coin} (${fpct(st.now.doi * 100, 2)}) · 선물 CVD ${Math.round(st.fc).toLocaleString()} ${coin} · 개인 롱 ${st.lsG ? st.lsG[0].toFixed(1) + '→' + st.lsG[1].toFixed(1) + '%' : '-'} · 탑트레이더 롱 ${st.lsT ? st.lsT[0].toFixed(1) + '→' + st.lsT[1].toFixed(1) + '%' : '-'}`,
      `뜻: ${S.mean}`,
      '24시간 상태 비율: ' + Object.keys(STATES).filter(s => st.cnt[s]).sort((a, b) => st.cnt[b] - st.cnt[a]).map(s => `${STATES[s].title} ${Math.round(st.cnt[s] / tot * 100)}%`).join(', ')];
    const al = computeAlert(d, st.k, st.n, coin);
    if (!al.surge) L.push(`[OI 급증 알림] 없음 · 최근 1시간 OI ${fpct(al.doi * 100, 2)} (평소 대비 ${al.z.toFixed(1)} 표준편차)`);
    else L.push(`[OI 급증 알림] 발생 · 최근 1시간 OI ${fpct(al.doi * 100, 2)} (+${Math.round(al.newOiCoin).toLocaleString()} ${coin}, ${al.z.toFixed(1)} 표준편차) · 가격 ${al.flat ? '보합' : fpct(al.dp * 100, 2)} · ${al.side > 0 ? '아래 털릴 롱' : '위 털릴 숏'} 추정 구간 ${fp(al.lo)}~${fp(al.hi)} · HL 고래 실제 ${al.hlReal ? al.hlReal.size.toFixed(1) + ' ' + coin + ' ' + al.hlReal.n + '명' : '집계 없음'} · CEX 추정 ${Math.round(al.cexEst).toLocaleString()} ${coin}`);
    return L.join('\n');
  }
  // 그리기: 시장 수급 탭
  function renderState() {
    const box = $('#flowState'); if (!box || !F.d) return;
    const d = F.d, st = computeState(d, F.iv);
    box.textContent = '';
    if (!st) { box.append(el('p', { class: 'note pb', text: 'OI 데이터가 부족해 상태를 판단할 수 없습니다.' })); return; }
    const { cur, sub, now, states, same, dPx, dOi, fc, oiCoin, cnt } = st, S = STATES[cur];
    const lsWin = v => v ? `${v[0].toFixed(1)} → ${v[1].toFixed(1)}%` : '-';
    const card = el('div', { class: 'st-card st-' + cur },
      el('div', { class: 'st-top' }, el('span', { class: 'muted', text: S.tag }), chip('warn', `지금 · ${IV[F.iv].label}봉 기준 1시간`)),
      el('h3', { text: S.title }), sub ? el('p', { class: 'st-sub', text: sub }) : null,
      el('div', { class: 'muted', style: 'font-size:12.5px', text: '24시간 중 이 상태' }),
      el('div', { class: 'st-pct m', text: `${states.length ? Math.round(same.length / states.length * 100) : 0}% · ${same.length}봉` }),
      el('p', { class: 'note m', text: `그동안 가격 ${dPx >= 0 ? '+' : ''}${fp(dPx)} · OI ${dOi >= 0 ? '+' : ''}${Math.round(dOi).toLocaleString()} ${F.coin}` }),
      el('p', null, el('b', { text: '뜻 · ' }), S.mean),
      el('div', null, el('b', { text: '확인할 것' }), el('ul', { class: 'vlist' }, S.check.map(x => el('li', { text: x })))),
      el('p', { class: 'note m', text: `1시간: 가격 ${fpct(now.dp * 100, 2)} · OI ${oiCoin >= 0 ? '+' : ''}${Math.round(oiCoin).toLocaleString()} ${F.coin} (${fpct(now.doi * 100, 2)}, 코인 수량 기준) · 선물 CVD ${coinAmt(fc)}` }),
      el('p', { class: 'note', text: `들어온 쪽 · 개인 롱 비중 ${lsWin(st.lsG)} · 탑트레이더 롱 ${lsWin(st.lsT)}` }));
    const others = el('div', { class: 'st-others' }, el('div', { class: 'muted', style: 'font-size:12.5px;font-weight:700', text: '24시간 상태 비율' }),
      ...Object.keys(STATES).filter(s => cnt[s]).sort((a, b) => cnt[b] - cnt[a]).map(s => el('div', { class: 'st-orow' + (s === cur ? ' cur' : '') }, el('span', { text: `${STATES[s].tag} ${STATES[s].title}` }), el('b', { class: 'm', text: `${Math.round(cnt[s] / states.length * 100)}%` }))));
    box.append(el('div', { class: 'st-wrap' }, card, others, oiAlert(d, st.k, st.n)));
  }
  function oiAlert(d, k, n) {
    const a = computeAlert(d, k, n, F.coin), box = el('div', { class: 'st-alert' });
    if (!a.surge) {
      box.append(el('div', { class: 'muted', style: 'font-size:12.5px;font-weight:700', text: 'OI 급증 알림' }), el('p', { class: 'note', text: `지금은 없음 · 최근 1시간 OI ${fpct(a.doi * 100, 2)} (평소 변화의 ${a.z.toFixed(1)}배 표준편차). 기준: 1시간 OI +0.8% 이상이면서 평소보다 2 표준편차 넘게 늘 때` }));
      return box;
    }
    box.classList.add('on');
    box.append(el('div', { class: 'st-top' }, chip('flat', a.flat ? '보합' : a.dp > 0 ? '상승 중' : '하락 중'), chip('hot', 'OI 급증')),
      el('h3', { text: a.flat ? '가격은 그대로인데 OI가 급하게 늘었어요' : `가격이 ${a.dp > 0 ? '오르면서' : '내리면서'} OI가 급하게 늘었어요` }),
      el('p', { text: `최근 1시간 OI ${fpct(a.doi * 100, 2)} (+${Math.round(a.newOiCoin).toLocaleString()} ${F.coin}) · 평소보다 ${a.z.toFixed(1)} 표준편차 · 포지션이 쌓이는 중 → 어느 쪽이든 크게 흔들릴 수 있어요 · 주의!!` }),
      el('div', { class: 'st-risk' }, el('b', { class: a.side > 0 ? 'down' : 'up', text: `${a.side > 0 ? '아래 주의!! · 털릴 롱' : '위 주의!! · 털릴 숏'}` }),
        el('div', { class: 'm st-zone', text: `${fp(a.lo)} ~ ${fp(a.hi)} ${fpct((a.edge / a.price - 1) * 100, 1)}` }),
        el('div', { class: 'note', text: `(HL 실제 ${a.hlReal ? `${a.hlReal.size >= 10 ? Math.round(a.hlReal.size).toLocaleString() : a.hlReal.size.toFixed(1)} ${F.coin} · ${a.hlReal.n}명` : '고래 추적 탭을 열면 집계'} · CEX 추정 ${Math.round(a.cexEst).toLocaleString()} ${F.coin})` })),
      el('p', { class: 'note', text: `털릴 쪽은 개인 롱 비중(${a.g == null ? '-' : a.g.toFixed(1) + '%'})과 시장가 방향(${coinAmt(a.fc)})으로 정했어요. 가격대는 막 들어온 25~50배 포지션이 청산되는 자리를 계산한 추정이고, CEX 추정은 늘어난 OI × 탑트레이더 ${a.side > 0 ? '롱' : '숏'} 비중이에요.` }));
    return box;
  }
  U.flowStateTest = { oiAlert, F, IV }; // 확인용
  const hlName = c => c; // 하이퍼리퀴드 코인 이름은 바이낸스와 같음 (BTC, ETH …)

  // ---------- 불러오기 ----------
  const SRC = { oiBinC: '바이낸스 코인 마진 OI', oiBybL: '바이비트 OI', oiBybI: '바이비트 코인 마진 OI', lsG: '개인 롱 비중', lsT: '탑트레이더 롱 비중', fund: '펀딩', cb: '코인베이스', okxFut: 'OKX 선물', okxOI: 'OKX OI', okxSpot: 'OKX 현물', spot: '바이낸스 현물', oiBinU: '바이낸스 OI' };
  async function load(quiet) {
    const id = ++F.load, key = F.coin + '|' + F.iv;
    syncButtons();
    if (!quiet) $('#flowStatus').textContent = '불러오는 중…';
    try {
      const { out, fail } = await fetchAll(F.coin, F.iv);
      if (id !== F.load) return;
      if (!out.fut || !out.fut.length) throw new Error(`바이낸스 선물에 ${F.coin}USDT가 없습니다. 다른 코인을 골라 주세요.`);
      F.d = build(out, F.iv);
      if (!C) makeCharts();
      draw(F.key === key); F.key = key;
      const okxMissing = fail.filter(k => k.startsWith('okx')).length === 3;
      const others = fail.filter(k => !k.startsWith('okx')).map(k => SRC[k] || k);
      $('#flowStatus').textContent = `${new Date().toLocaleTimeString('ko-KR', { hour12: false })} 갱신` +
        (okxMissing ? ' · OKX 데이터 없음 (start-local.bat으로 연 경우에만 받아짐)' : '') + (others.length ? ' · 없는 데이터: ' + others.join(', ') : '');
    } catch (e) {
      if (id === F.load) $('#flowStatus').textContent = '불러오지 못했습니다: ' + (e.message || e);
    }
  }
  function syncButtons() {
    $$('#flowCoin button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === F.coin)));
    $$('#flowIv button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === F.iv)));
    const inSeg = $$('#flowCoin button').some(b => b.dataset.v === F.coin);
    if (document.activeElement !== $('#flowIn')) $('#flowIn').value = inSeg ? '' : F.coin;
  }
  function setCoin(c) { c = c.trim().toUpperCase().replace(/USDT$/, ''); if (!/^[A-Z0-9]{2,15}$/.test(c) || c === F.coin) return; F.coin = c; store.set('flowCoin', c); load(); window.dispatchEvent(new CustomEvent('flowcoin', { detail: c })); }
  $('#flowCoin').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setCoin(b.dataset.v); });
  $('#flowIv').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.dataset.v === F.iv) return; F.iv = b.dataset.v; store.set('flowIv', F.iv); load(); });
  $('#flowForm').addEventListener('submit', e => { e.preventDefault(); setCoin($('#flowIn').value); });

  // 질문하기 창·리포트에 함께 보낼 요약 (시장 수급 탭과 같은 데이터·계산)
  function flowSummary(d, coin, ivKey, rows) {
    const ca = v => v == null ? '—' : (v > 0 ? '+' : '') + compact(v) + ' ' + coin, n = d.t.length, last = Math.max(0, n - rows), L = [`[시장 수급] ${coin} ${IV[ivKey].label}봉 (바이낸스·바이비트·OKX·코인베이스 공개 데이터)`];
    for (let i = last; i < n; i++) L.push(`${fdt(d.t[i] / 1000)} 종가 ${fp(d.c[i])} · 가격 ${d.dp[i] == null ? '-' : fpct(d.dp[i] * 100, 2)} · OI ${fusd(d.oiTotal[i])} (${d.doi[i] == null ? '-' : fpct(d.doi[i] * 100, 2)}) ${d.kind[i] ? KIND[d.kind[i]][0] : ''} · 선물 델타 ${ca(d.fSum[i])} · 현물 델타 ${ca(d.sSum[i])} · CB프리미엄 ${d.cbp[i] == null ? '-' : d.cbp[i].toFixed(2)} · 펀딩 ${d.fund[i] == null ? '-' : d.fund[i].toFixed(4) + '%'} · 개인 롱 ${d.lsG[i] == null ? '-' : d.lsG[i].toFixed(1) + '%'} · 탑 롱 ${d.lsT[i] == null ? '-' : d.lsT[i].toFixed(1) + '%'}`);
    const k = Math.max(0, n - 24), cnt = {};
    for (let i = k; i < n; i++) if (d.kind[i]) cnt[d.kind[i]] = (cnt[d.kind[i]] || 0) + 1;
    const ch = (a) => { const x = a[k], y = a[n - 1]; return x && y != null ? fpct((y / x - 1) * 100, 2) : '-'; };
    const delta = a => { let s = 0, any = false; for (let i = k; i < n; i++) if (a[i] != null) { s += a[i]; any = true; } return any ? ca(s) : '-'; };
    L.push(`최근 24봉 요약: 가격 ${ch(d.c)} · OI 합계 ${ch(d.oiTotal)} (스테이블 마진 ${ch(d.oiStable)}, 코인 마진 ${ch(d.oiCoin)}) · 선물 시장가 순매수 ${delta(d.fSum)} · 현물 시장가 순매수 ${delta(d.sSum)} · 봉 해석 ${Object.entries(cnt).map(([x, c]) => KIND[x][0] + ' ' + c).join(', ') || '-'}`);
    const sq = d.squeeze.filter(s => s.i >= k);
    if (sq.length) L.push('스퀴즈(OI 급감 + 큰 움직임): ' + sq.map(s => `${fdt(d.t[s.i] / 1000)} ${s.up ? '숏 스퀴즈(위로)' : '롱 스퀴즈(아래로)'}`).join(', '));
    if (d.nextFunding) L.push(`다음 펀딩 ${fdt(d.nextFunding / 1000)} · 예상 펀딩 ${d.fund[n - 1] == null ? '-' : d.fund[n - 1].toFixed(4) + '%'}`);
    L.push(`전체 기간 누적 선물 CVD ${ca(d.cvd_fSum[n - 1])}, 현물 CVD ${ca(d.cvd_sSum[n - 1])}`);
    return L.join('\n');
  }
  U.flowContext = function () { return F.d ? flowSummary(F.d, F.coin, F.iv, 12) : null; };
  // 리포트용: 원하는 코인·봉으로 시장 수급 탭과 같은 데이터를 새로 받아 요약합니다.
  U.flowSnapshot = async function (coin, ivKey, rows = 12) {
    const { out, fail } = await fetchAll(coin, ivKey);
    if (!out.fut || !out.fut.length) throw new Error(`${coin} 바이낸스 선물 데이터 없음`);
    const d = build(out, ivKey);
    return flowSummary(d, coin, ivKey, rows) + (ivKey === '15m' ? '\n' + stateText(d, ivKey, coin) : '') + (fail.length ? `\n(받지 못한 데이터: ${fail.join(', ')})` : '');
  };

  // 탭이 처음 열릴 때 시작, 열려 있는 동안 30초마다 갱신
  window.addEventListener('tabchange', e => { if (e.detail === 'flow' && !F.started) { F.started = true; load(); } });
  if (U.activeTab && U.activeTab() === 'flow') { F.started = true; load(); }
  setInterval(() => { if (F.started && !document.hidden && U.activeTab() === 'flow') load(true); }, 30000);
})();
