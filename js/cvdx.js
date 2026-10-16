// 시장 수급 탭 · 거래소별 시장가 매수(CVD)와 순매수 순위
// 거래소마다 체결을 1분 단위로 모읍니다(시장가 매수량 / 매도량, 코인 수량).
//  - 바이낸스: 1분봉의 시장가 매수량으로 정확한 과거 기록
//  - 크라켄·비트스탬프·데리빗: 공개 체결 기록으로 최근 기록을 채운 뒤 실시간
//  - OKX·비트파이넥스: 컴퓨터 서버(start-local)를 거쳐 과거 기록, 실시간은 어디서나
//  - 코인베이스·바이빗: 과거 체결을 주지 않아 페이지를 연 뒤부터 실시간으로 모음
// 모은 기록은 이 기기에 48시간까지 저장해 다음에 열 때 이어집니다.
(() => {
  const TA = window.TA, U = TA && TA.ui, LW = window.LightweightCharts;
  if (!U || !LW) return;
  const { el, fp, store, toneOf } = U;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const cv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const MIN = 60e3, KEEP = 48 * 60 * MIN;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const off = t => -new Date(t * 1000).getTimezoneOffset() * 60;

  const EX = {
    spot: [
      { id: 'binance', name: '바이낸스', color: '#e0a106' }, { id: 'coinbase', name: '코인베이스', color: '#3b82f6' },
      { id: 'bybit', name: '바이빗', color: '#8f98a6' }, { id: 'okx', name: 'OKX', color: '#b07cf0' },
      { id: 'bitstamp', name: '비트스탬프', color: '#14a89a' }, { id: 'kraken', name: '크라켄', color: '#6366f1' },
      { id: 'bitfinex', name: '비트파이넥스', color: '#22b35a' }
    ],
    fut: [
      { id: 'binance', name: '바이낸스', color: '#e0a106' }, { id: 'bybit', name: '바이빗', color: '#8f98a6' },
      { id: 'okx', name: 'OKX', color: '#b07cf0' }, { id: 'bitfinex', name: '비트파이넥스', color: '#22b35a' },
      { id: 'deribit', name: '데리빗', color: '#e0559a' }
    ]
  };
  const WIN = { '15m': 15, '1h': 60, '4h': 240, '1d': 1440 };
  const X = { coin: null, win: store.get('xcvdWin', '4h'), b: {}, start: {}, live: {}, ws: [], hidden: {}, started: false, timers: [], dirty: false };
  if (!WIN[X.win]) X.win = '4h';
  try { X.hidden = JSON.parse(store.get('xcvdHidden', '{}')); } catch (e) {}
  const key = (m, id) => m + '.' + id;

  // ---------- 1분 묶음에 체결 더하기 ----------
  function add(m, id, ts, qty, isBuy) {
    if (!(qty > 0) || !isFinite(ts)) return;
    const k = key(m, id), mts = Math.floor(ts / MIN) * MIN;
    const b = X.b[k] || (X.b[k] = new Map());
    const v = b.get(mts) || [0, 0];
    if (isBuy) v[0] += qty; else v[1] += qty;
    b.set(mts, v);
    if (!X.start[k] || mts < X.start[k]) X.start[k] = mts;
    X.dirty = true;
  }
  // 과거 기록은 실시간 수집이 시작되기 전 구간에만 넣어 같은 체결이 두 번 세이지 않게 합니다.
  const before = (m, id, ts) => !X.live[key(m, id)] || ts < X.live[key(m, id)];
  function setBucket(m, id, mts, buy, sell) { // 바이낸스·OKX처럼 묶음 단위로 받는 경우 덮어쓰기
    const k = key(m, id), b = X.b[k] || (X.b[k] = new Map());
    b.set(mts, [buy, sell]);
    if (!X.start[k] || mts < X.start[k]) X.start[k] = mts;
    X.dirty = true;
  }

  // ---------- 저장 · 불러오기 ----------
  const SKEY = () => 'xcvd.' + X.coin;
  function save() {
    if (!X.dirty || !X.coin) return; X.dirty = false;
    const cut = Date.now() - KEEP, out = {};
    for (const [k, b] of Object.entries(X.b)) {
      if (k.endsWith('.binance')) continue; // 바이낸스는 매번 정확히 다시 받음
      const rows = []; b.forEach((v, t) => { if (t >= cut) rows.push([t, +v[0].toFixed(6), +v[1].toFixed(6)]); });
      if (rows.length) out[k] = rows;
    }
    store.set(SKEY(), JSON.stringify(out));
  }
  function load() {
    X.b = {}; X.start = {}; X.live = {}; X.plast = {}; X.pmin = {};
    try {
      const saved = JSON.parse(store.get(SKEY(), '{}')), cut = Date.now() - KEEP;
      for (const [k, rows] of Object.entries(saved)) {
        const b = new Map(); rows.forEach(([t, bu, se]) => { if (t >= cut) b.set(t, [bu, se]); });
        if (b.size) { X.b[k] = b; X.start[k] = Math.min(...b.keys()); X.plast[k] = Math.max(...b.keys()) + MIN; X.pmin[k] = new Set(b.keys()); }
      }
    } catch (e) {}
  }

  // ---------- 과거 기록 ----------
  async function j(url, opt) { const r = await fetch(url, opt); if (!r.ok) throw new Error(r.status); return r.json(); }
  const proxy = (name, path) => j(`api/proxy/${name}?path=` + encodeURIComponent(path), { headers: { 'X-Dashboard': '1' }, cache: 'no-store' });
  const SYM = c => ({
    binance: c + 'USDT', coinbase: c + '-USD', bybit: c + 'USDT', okxSpot: c + '-USDT', okxSwap: c + '-USDT-SWAP',
    bitstamp: c.toLowerCase() + 'usd', krakenRest: (c === 'BTC' ? 'XBT' : c) + 'USD', krakenWs: c + '/USD',
    bfxSpot: 't' + c + 'USD', bfxPerp: 't' + c + 'F0:USTF0', deribit: c === 'BTC' || c === 'ETH' ? c + '-PERPETUAL' : c + '_USDC-PERPETUAL'
  });

  async function binance() { // 1분봉 1440개(하루) = 두 번에 나눠 받기
    const c = X.coin, s = SYM(c), now = Date.now();
    for (const [m, base] of [['spot', 'https://api.binance.com/api/v3/klines'], ['fut', 'https://fapi.binance.com/fapi/v1/klines']]) {
      try {
        const a = await j(`${base}?symbol=${s.binance}&interval=1m&limit=1000&startTime=${now - 1440 * MIN}`);
        const last = a.length ? a[a.length - 1][0] + MIN : now - 440 * MIN;
        const b = last < now - MIN ? await j(`${base}?symbol=${s.binance}&interval=1m&limit=1000&startTime=${last}`) : [];
        [...a, ...b].forEach(k => { const vol = +k[5], buy = +k[9]; setBucket(m, 'binance', k[0], buy, vol - buy); });
      } catch (e) {}
    }
  }
  async function backfill() {
    const c = X.coin, s = SYM(c), now = Date.now(), from = now - 1440 * MIN;
    const tasks = [
      // 비트스탬프: 하루치(약 5MB)는 6시간에 한 번만, 평소에는 최근 1시간
      (async () => {
        const lastDay = +store.get('xcvdBsDay.' + c, '0'), span = now - lastDay > 6 * 3600e3 ? 'day' : 'hour';
        const a = await j(`https://www.bitstamp.net/api/v2/transactions/${s.bitstamp}/?time=${span}`);
        if (span === 'day') store.set('xcvdBsDay.' + c, String(now));
        a.forEach(t => { const ts = +t.date * 1000; if (fresh('spot', 'bitstamp', ts)) add('spot', 'bitstamp', ts, +t.amount, t.type === '0'); });
      })(),
      // 크라켄: 최근 8시간(또는 저장된 기록 이후)부터 1000건씩 앞으로, 최대 30번
      (async () => {
        let since = String((now - 8 * 60 * MIN) * 1e6);
        for (let k = 0; k < 30; k++) {
          const r = await j(`https://api.kraken.com/0/public/Trades?pair=${s.krakenRest}&since=${since}`);
          if (r.error && r.error.length) break;
          const pk = Object.keys(r.result).find(x => x !== 'last'), rows = r.result[pk] || [];
          rows.forEach(t => { const ts = t[2] * 1000; if (fresh('spot', 'kraken', ts)) add('spot', 'kraken', ts, +t[1], t[3] === 'b'); });
          since = r.result.last;
          if (rows.length < 1000) break;
          await sleep(1100);
        }
      })(),
      // 데리빗 무기한: 1000건씩, 최근 것부터 거꾸로 최대 60번(약 4시간)
      (async () => {
        let end = now;
        for (let k = 0; k < 60; k++) {
          const r = await j(`https://www.deribit.com/api/v2/public/get_last_trades_by_instrument_and_time?instrument_name=${s.deribit}&start_timestamp=${from}&end_timestamp=${end}&count=1000&sorting=desc`);
          const tr = (r.result && r.result.trades) || [];
          tr.forEach(t => { if (fresh('fut', 'deribit', t.timestamp)) add('fut', 'deribit', t.timestamp, s.deribit.includes('_USDC') ? t.amount : t.amount / t.price, t.direction === 'buy'); });
          if (!r.result || !r.result.has_more || !tr.length) break;
          end = tr[tr.length - 1].timestamp - 1;
          if (end < now - 4 * 60 * MIN) break;
          await sleep(150);
        }
      })(),
      // OKX: 5분 단위 시장가 매수·매도 집계(컴퓨터 서버를 거쳐서)
      (async () => {
        const d = await proxy('okx', `/api/v5/rubik/stat/taker-volume?ccy=${c}&instType=SPOT&period=5m`);
        (d.data || []).forEach(r => { const ts = +r[0]; if (fresh5('spot', 'okx', ts)) setBucket('spot', 'okx', ts, +r[2], +r[1]); });
      })(),
      (async () => {
        let end = '';
        for (let k = 0; k < 3; k++) {
          const d = await proxy('okx', `/api/v5/rubik/stat/taker-volume-contract?instId=${s.okxSwap}&period=5m&unit=0&limit=100${end ? '&end=' + end : ''}`);
          const rows = d.data || []; if (!rows.length) break;
          rows.forEach(r => { const ts = +r[0]; if (fresh5('fut', 'okx', ts)) setBucket('fut', 'okx', ts, +r[2], +r[1]); });
          end = rows[rows.length - 1][0];
        }
      })(),
      // 비트파이넥스: 10000건씩(컴퓨터 서버를 거쳐서)
      // 비트파이넥스는 요청을 빨리 보내면 막혀서, 최신 것부터 거꾸로 2.5초 간격으로 3번까지
      (async () => {
        if (now - +store.get('xcvdBfxBlock', '0') < 10 * 60e3) return; // 막힌 뒤 10분은 쉬기
        for (const [m, sym] of [['spot', s.bfxSpot], ['fut', s.bfxPerp]]) {
          const floor = from;
          let end = Date.now();
          for (let k = 0; k < 3; k++) {
            let a;
            try { a = await proxy('bitfinex', `/v2/trades/${sym}/hist?limit=10000&sort=-1&start=${floor}&end=${end}`); }
            catch (e) { store.set('xcvdBfxBlock', String(Date.now())); return; }
            if (!Array.isArray(a) || !a.length) break;
            a.forEach(t => { if (fresh(m, 'bitfinex', t[1])) add(m, 'bitfinex', t[1], Math.abs(t[2]), t[2] > 0); });
            end = a[a.length - 1][1] - 1;
            if (a.length < 10000 || end <= floor) break;
            await sleep(2500);
          }
          await sleep(2500);
        }
      })()
    ];
    await Promise.allSettled(tasks);
  }
  // 과거 기록은 저장된 기록이 없는 분(페이지를 닫아 둔 시간 포함)만 채워, 같은 체결을 두 번 세지 않습니다.
  const lastTs = (m, id) => X.plast[key(m, id)] || null;
  const fresh = (m, id, ts) => { const p = X.pmin[key(m, id)]; return before(m, id, ts) && !(p && p.has(Math.floor(ts / MIN) * MIN)); };
  const fresh5 = (m, id, ts) => [0, 1, 2, 3, 4].every(i => fresh(m, id, ts + i * MIN)); // OKX 5분 묶음

  // ---------- 실시간 (웹소켓) ----------
  function socket(name, url, onOpen, onMsg, ping) {
    let ws, alive = true, timer;
    const open = () => {
      if (!alive) return;
      try { ws = new WebSocket(url); } catch (e) { return; }
      ws.onopen = () => { onOpen(ws); if (ping) timer = setInterval(() => { try { ping(ws); } catch (e) {} }, 20000); };
      ws.onmessage = e => { try { onMsg(e.data, ws); } catch (err) {} };
      ws.onclose = () => { clearInterval(timer); if (alive) setTimeout(open, 5000); };
      ws.onerror = () => { try { ws.close(); } catch (e) {} };
    };
    open();
    return { close() { alive = false; clearInterval(timer); try { ws.close(); } catch (e) {} } };
  }
  const goLive = (m, id) => { const k = key(m, id); if (!X.live[k]) { X.live[k] = Date.now(); if (!X.start[k]) X.start[k] = Math.floor(Date.now() / MIN) * MIN; } };
  async function connect() {
    const c = X.coin, s = SYM(c);
    let ctVal = { BTC: 0.01, ETH: 0.1, SOL: 1 }[c] || 1;
    try { const r = await j(`https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=${s.okxSwap}`); if (r.data && r.data[0]) ctVal = +r.data[0].ctVal; } catch (e) {}
    X.ws.push(socket('coinbase', 'wss://ws-feed.exchange.coinbase.com',
      w => { w.send(JSON.stringify({ type: 'subscribe', product_ids: [s.coinbase], channels: ['matches'] })); goLive('spot', 'coinbase'); },
      d => { const m = JSON.parse(d); if (m.type === 'match') add('spot', 'coinbase', Date.parse(m.time), +m.size, m.side === 'sell'); })); // side = 메이커 쪽이라 반대가 시장가
    for (const [m, path] of [['spot', 'spot'], ['fut', 'linear']]) {
      X.ws.push(socket('bybit-' + m, `wss://stream.bybit.com/v5/public/${path}`,
        w => { w.send(JSON.stringify({ op: 'subscribe', args: ['publicTrade.' + s.bybit] })); goLive(m, 'bybit'); },
        d => { const r = JSON.parse(d); if (r.topic && r.data) r.data.forEach(t => add(m, 'bybit', +t.T, +t.v, t.S === 'Buy')); },
        w => w.send(JSON.stringify({ op: 'ping' }))));
    }
    X.ws.push(socket('okx', 'wss://ws.okx.com:8443/ws/v5/public',
      w => { w.send(JSON.stringify({ op: 'subscribe', args: [{ channel: 'trades', instId: s.okxSpot }, { channel: 'trades', instId: s.okxSwap }] })); goLive('spot', 'okx'); goLive('fut', 'okx'); },
      d => { if (d === 'pong') return; const r = JSON.parse(d); if (r.data && r.arg) r.data.forEach(t => { const swap = t.instId.endsWith('SWAP'); add(swap ? 'fut' : 'spot', 'okx', +t.ts, +t.sz * (swap ? ctVal : 1), t.side === 'buy'); }); },
      w => w.send('ping')));
    X.ws.push(socket('kraken', 'wss://ws.kraken.com/v2',
      w => { w.send(JSON.stringify({ method: 'subscribe', params: { channel: 'trade', symbol: [s.krakenWs], snapshot: false } })); goLive('spot', 'kraken'); },
      d => { const r = JSON.parse(d); if (r.channel === 'trade' && r.type === 'update') r.data.forEach(t => add('spot', 'kraken', Date.parse(t.timestamp), +t.qty, t.side === 'buy')); },
      w => w.send(JSON.stringify({ method: 'ping' }))));
    X.ws.push(socket('bitstamp', 'wss://ws.bitstamp.net',
      w => { w.send(JSON.stringify({ event: 'bts:subscribe', data: { channel: 'live_trades_' + s.bitstamp } })); goLive('spot', 'bitstamp'); },
      d => { const r = JSON.parse(d); if (r.event === 'trade') add('spot', 'bitstamp', +r.data.microtimestamp / 1000, +r.data.amount, r.data.type === 0); }));
    const bfxChan = {};
    X.ws.push(socket('bitfinex', 'wss://api-pub.bitfinex.com/ws/2',
      w => { [s.bfxSpot, s.bfxPerp].forEach(sym => w.send(JSON.stringify({ event: 'subscribe', channel: 'trades', symbol: sym }))); goLive('spot', 'bitfinex'); goLive('fut', 'bitfinex'); },
      d => {
        const r = JSON.parse(d);
        if (r.event === 'subscribed') { bfxChan[r.chanId] = r.symbol === s.bfxPerp ? 'fut' : 'spot'; return; }
        if (Array.isArray(r) && r[1] === 'te' && bfxChan[r[0]]) { const t = r[2]; add(bfxChan[r[0]], 'bitfinex', t[1], Math.abs(t[2]), t[2] > 0); }
      }));
    X.ws.push(socket('deribit', 'wss://www.deribit.com/ws/api/v2',
      w => {
        w.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'public/subscribe', params: { channels: [`trades.${s.deribit}.100ms`] } }));
        w.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'public/set_heartbeat', params: { interval: 30 } }));
        goLive('fut', 'deribit');
      },
      (d, w) => {
        const r = JSON.parse(d);
        if (r.method === 'heartbeat' && r.params && r.params.type === 'test_request') { w.send(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'public/test' })); return; }
        if (r.method === 'subscription' && r.params && Array.isArray(r.params.data)) r.params.data.forEach(t => add('fut', 'deribit', t.timestamp, s.deribit.includes('_USDC') ? t.amount : t.amount / t.price, t.direction === 'buy'));
      }));
  }

  // ---------- 화면 ----------
  let C = null;
  const compact = v => { const a = Math.abs(v), s = v < 0 ? '-' : v > 0 ? '+' : ''; return a >= 1e6 ? s + (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? s + (a / 1e3).toFixed(1) + 'K' : s + a.toFixed(a < 10 ? 2 : a < 100 ? 1 : 0); };
  const amt = v => compact(v) + ' ' + X.coin;
  const fdt = t => { const d = new Date(t); return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  function makeCharts() {
    C = {};
    ['spot', 'fut'].forEach(m => {
      const ch = LW.createChart($('#xc-' + m), {
        autoSize: true, layout: { background: { type: 'solid', color: cv('--panel') }, textColor: cv('--muted'), fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 11, attributionLogo: m === 'fut' },
        grid: { vertLines: { color: cv('--grid') }, horzLines: { color: cv('--grid') } },
        rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
        crosshair: { mode: LW.CrosshairMode.Normal }, localization: { locale: 'ko-KR' }
      });
      const s = {};
      EX[m].forEach(e => { s[e.id] = ch.addLineSeries({ color: e.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, priceFormat: { type: 'custom', minMove: 0.01, formatter: v => compact(v) } }); });
      C[m] = { ch, s };
    });
    window.addEventListener('themechange', () => ['spot', 'fut'].forEach(m => C[m].ch.applyOptions({ layout: { background: { type: 'solid', color: cv('--panel') }, textColor: cv('--muted') }, grid: { vertLines: { color: cv('--grid') }, horzLines: { color: cv('--grid') } } })));
  }
  function render() {
    if (!X.coin) return;
    if (!C) makeCharts();
    const now = Date.now(), wMin = WIN[X.win], from = Math.floor((now - wMin * MIN) / MIN) * MIN;
    $$('#xcWin button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === X.win)));
    $('#xcSince').textContent = `${fdt(from)} 이후 · ${X.coin}`;
    // 1일 창은 5분, 그 밖은 1분 단위로 그립니다
    const step = wMin >= 1440 ? 5 * MIN : MIN;
    ['spot', 'fut'].forEach(m => {
      const leg = $('#xl-' + m); leg.textContent = '';
      const rows = EX[m].map(e => {
        const k = key(m, e.id), b = X.b[k];
        let net = 0, pts = [], cum = 0, lastT = null;
        const st = X.start[k];
        if (b && st != null) {
          const ts = [...b.keys()].filter(t => t >= from).sort((a, z) => a - z);
          ts.forEach(t => { const v = b.get(t); net += v[0] - v[1]; cum += v[0] - v[1]; const bt = Math.floor(t / step) * step; if (bt !== lastT) { pts.push({ t: bt, v: cum }); lastT = bt; } else pts[pts.length - 1].v = cum; });
        }
        const has = b && st != null;
        const partial = has && st > from + 2 * MIN;
        const ser = C[m].s[e.id];
        ser.applyOptions({ visible: !X.hidden[k] && has });
        ser.setData(pts.map(p => ({ time: Math.floor(p.t / 1000) + off(p.t / 1000), value: p.v })));
        const btn = el('button', { type: 'button', class: 'xleg' + (X.hidden[k] ? ' off' : ''), title: '눌러서 선 켜기/끄기', onclick: () => { X.hidden[k] = !X.hidden[k]; store.set('xcvdHidden', JSON.stringify(X.hidden)); render(); } },
          el('i', { style: `background:${e.color}` }), e.name + ' ', el('b', { class: has ? toneOf(net) : 'muted', text: has ? amt(net) : '대기 중' }));
        leg.append(btn);
        return { e, net, has, partial, st };
      });
      // 기간이나 코인을 바꿨을 때만 전체 기간에 맞춤(그 밖에는 사용자가 확대한 상태 유지)
      const fk = X.coin + X.win; if (C[m].fit !== fk) { C[m].fit = fk; C[m].fitUntil = Date.now() + 90e3; } // 과거 기록이 채워지는 처음 90초 동안은 계속 맞춤
      if (Date.now() < C[m].fitUntil) C[m].ch.timeScale().fitContent();
      // 순위 막대
      const box = $('#xb-' + m); box.textContent = '';
      const valid = rows.filter(r => r.has).sort((a, z) => z.net - a.net);
      const total = valid.reduce((s, r) => s + r.net, 0), max = Math.max(1e-9, ...valid.map(r => Math.abs(r.net)));
      const lead = valid.filter(r => Math.sign(r.net) === Math.sign(total)).sort((a, z) => Math.abs(z.net) - Math.abs(a.net))[0];
      $('#xt-' + m).textContent = '';
      $('#xt-' + m).append(`${valid.length}곳 합산 `, el('b', { class: toneOf(total), text: amt(total) }), ` · ${total >= 0 ? '매수 우위' : '매도 우위'}`);
      valid.forEach(r => {
        const w = Math.abs(r.net) / max * 50;
        box.append(el('div', { class: 'xrow' },
          el('span', { class: 'xn' }, r.e.name, lead && r === lead ? el('span', { class: 'chip good', style: 'margin-left:6px', text: '주도' }) : '',
            r.partial ? el('span', { class: 'muted', style: 'font-size:11px;margin-left:6px', text: `${fdt(r.st).slice(6)}부터` }) : ''),
          el('span', { class: 'xbar' }, el('i', { style: r.net >= 0 ? `left:50%;width:${w}%;background:var(--up)` : `right:50%;width:${w}%;background:var(--down)` })),
          el('span', { class: 'xv m ' + toneOf(r.net), text: amt(r.net) })));
      });
      rows.filter(r => !r.has).forEach(r => box.append(el('div', { class: 'xrow' }, el('span', { class: 'xn muted', text: r.e.name }), el('span'), el('span', { class: 'xv muted', text: '연결 중' }))));
    });
    // 출처
    const starts = [...EX.spot.map(e => ['spot', e]), ...EX.fut.map(e => ['fut', e])].map(([m, e]) => { const st = X.start[key(m, e.id)]; return st ? `${e.name}${m === 'fut' ? '(선물)' : ''} ${fdt(st)}` : null; }).filter(Boolean);
    $('#xcSrc').textContent = `기록 시작: ${starts.join(' · ')} · 바이낸스 = 1분봉의 시장가 매수량, 나머지 = 실시간 체결(이 기기에 48시간 보관). 코인베이스·바이빗은 과거 체결을 주지 않아 이 페이지를 연 뒤부터 모입니다. OKX·비트파이넥스의 과거 기록은 컴퓨터(start-local)에서만 채워집니다.`;
  }

  // ---------- 시작 · 코인 바꾸기 ----------
  async function startCoin(c) {
    if (X.coin === c) return;
    save(); X.ws.forEach(w => w.close()); X.ws = [];
    X.coin = c; load();
    render();
    connect();
    await binance(); render();
    await backfill(); render();
  }
  function start() {
    if (X.started) return; X.started = true;
    startCoin(store.get('flowCoin', 'BTC'));
    X.timers.push(setInterval(() => { if (!document.hidden && U.activeTab() === 'flow') render(); }, 5000));
    X.timers.push(setInterval(() => { binance().then(() => { if (U.activeTab() === 'flow') render(); }); }, 60000));
    X.timers.push(setInterval(save, 30000));
    window.addEventListener('beforeunload', save);
  }
  $('#xcWin').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; X.win = b.dataset.v; store.set('xcvdWin', X.win); render(); });
  window.addEventListener('flowcoin', e => { if (X.started) startCoin(e.detail); });
  window.addEventListener('tabchange', e => { if (e.detail === 'flow') start(); });
  if (U.activeTab && U.activeTab() === 'flow') start();
})();
