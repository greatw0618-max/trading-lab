// 데이터 불러오기: 하이퍼리퀴드(실시간) + data/ 폴더의 야후 정규장 데이터(GitHub Actions가 갱신)
(function (TA) {
  const HL_API = 'https://api.hyperliquid.xyz/info';
  const IV_MS = { '15m': 9e5, '1h': 36e5, '4h': 144e5, '1d': 864e5 };
  TA.HL_COIN = { SOXL: 'xyz:SOXL', KORU: 'xyz:KORU', EWY: 'xyz:EWY' };
  TA.PAIR = { SOXL: 'SOXX', KORU: 'EWY', SOXX: 'SOXX', EWY: 'EWY' };
  TA.ETF_OF = { SOXL: 'SOXL', KORU: 'KORU', SOXX: 'SOXL', EWY: 'KORU' };
  // 야후 정규장 데이터가 있는 종목. 그 밖의 종목은 하이퍼리퀴드 이름(BTC, xyz:TSLA 등)을 그대로 씁니다.
  TA.YAHOO = new Set(['SOXL', 'KORU', 'SOXX', 'EWY']);
  TA.hasYahoo = sym => TA.YAHOO.has(sym);
  TA.hlCoin = sym => TA.HL_COIN[sym] || (TA.YAHOO.has(sym) ? null : sym);
  TA.hasHL = sym => !!TA.hlCoin(sym);
  TA.disp = sym => sym.startsWith('xyz:') ? sym.slice(4) : sym;
  TA.dispFull = sym => sym.startsWith('xyz:') ? sym.slice(4) + ' (주식)' : sym;

  // 요청이 몰려 429(요청 과다)가 오면 잠시 쉬었다가 최대 3번 다시 시도합니다.
  TA.hl = async function (body) {
    for (let attempt = 1; ; attempt++) {
      const r = await fetch(HL_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (r.ok) return r.json();
      if (r.status === 429 && attempt < 4) { await new Promise(res => setTimeout(res, 1500 * attempt + Math.random() * 500)); continue; }
      throw new Error(r.status === 429 ? '하이퍼리퀴드 요청이 잠시 몰렸습니다. 15초 뒤 자동으로 다시 불러옵니다' : '하이퍼리퀴드 응답 오류 ' + r.status);
    }
  };

  const cache = new Map();
  async function cached(key, ttl, fn) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.val;
    if (hit && hit.pending) return hit.pending;
    const pending = fn().then(val => { cache.set(key, { at: Date.now(), val }); return val; })
      .catch(e => { cache.delete(key); throw e; });
    cache.set(key, { at: 0, pending, val: hit && hit.val });
    return pending;
  }

  TA.loadYahoo = function (sym, iv) {
    return cached('y:' + sym + iv, 5 * 60e3, async () => {
      const r = await fetch(`data/${sym}_${iv}.json?v=${Math.floor(Date.now() / 300e3)}`);
      if (!r.ok) throw new Error(`data/${sym}_${iv}.json 파일을 찾을 수 없습니다`);
      const j = await r.json();
      return { t: j.t, o: j.o, h: j.h, l: j.l, c: j.c, v: j.v, interval: iv, symbol: sym, updated: j.updated, src: 'yahoo' };
    });
  };

  TA.loadHL = function (sym, iv) {
    const coin = TA.hlCoin(sym);
    if (!coin) return Promise.reject(new Error(`${sym}는 하이퍼리퀴드에 상장돼 있지 않습니다`));
    return cached('h:' + sym + iv, 15e3, async () => {
      const now = Date.now();
      const rows = await TA.hl({ type: 'candleSnapshot', req: { coin, interval: iv, startTime: now - 5000 * IV_MS[iv], endTime: now } });
      const s = { t: [], o: [], h: [], l: [], c: [], v: [], interval: iv, symbol: sym, src: 'hl', updated: new Date().toISOString() };
      rows.forEach(k => { s.t.push(Math.floor(k.t / 1000)); s.o.push(+k.o); s.h.push(+k.h); s.l.push(+k.l); s.c.push(+k.c); s.v.push(+k.v); });
      if (!s.t.length) throw new Error(`${TA.dispFull(sym)} 차트 데이터가 없습니다. 종목 이름을 확인하세요`);
      return s;
    });
  };

  // src: 'hl' | 'yahoo'. 야후 4시간봉은 1시간봉을 묶어서 만듭니다.
  TA.load = async function (sym, iv, src) {
    if (TA.hasHL(sym) && (src === 'hl' || !TA.hasYahoo(sym))) return TA.loadHL(sym, iv);
    if (iv === '4h') { const h = await TA.loadYahoo(sym, '1h'); return { ...TA.to4h(h), updated: h.updated, src: 'yahoo' }; }
    return TA.loadYahoo(sym, iv);
  };

  // 메인 무기한 선물 + 주식(xyz) 시세. 이름 → { markPx, prevDayPx, funding, ... }
  TA.loadCtx = function () {
    return cached('ctx', 10e3, async () => {
      const [main, xyz] = await Promise.all([
        TA.hl({ type: 'metaAndAssetCtxs' }),
        TA.hl({ type: 'metaAndAssetCtxs', dex: 'xyz' }).catch(() => null)
      ]);
      const out = {};
      [main, xyz].forEach(r => { if (r) r[0].universe.forEach((u, i) => { if (!u.isDelisted) out[u.name] = { ...r[1][i], maxLeverage: u.maxLeverage }; }); });
      return out;
    });
  };
  TA.loadXyzCtx = TA.loadCtx;

  // 검색용 종목 목록: 거래대금 순
  TA.loadUniverse = async function () {
    const ctx = await TA.loadCtx();
    return Object.entries(ctx).map(([name, x]) => ({ name, vol: +x.dayNtlVlm || 0, stock: name.startsWith('xyz:') }))
      .sort((a, b) => b.vol - a.vol);
  };
  // 사용자가 입력한 이름(btc, tsla, xyz:TSLA)을 실제 종목 이름으로 바꿉니다.
  TA.resolveSym = async function (q) {
    q = (q || '').trim(); if (!q) return null;
    const up = q.toUpperCase();
    if (TA.YAHOO.has(up)) return up;
    const list = await TA.loadUniverse();
    const lo = q.toLowerCase();
    const hit = list.find(x => x.name.toLowerCase() === lo) || list.find(x => !x.stock && x.name.toLowerCase() === lo)
      || list.find(x => TA.disp(x.name).toLowerCase() === lo.replace(/\s*\(주식\)$/, ''));
    return hit ? hit.name : null;
  };
})(window.TA);
