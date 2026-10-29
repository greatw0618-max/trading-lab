// 신호 자동 관측: 내 컴퓨터 대시보드가 열려 있는 동안(어느 탭이든) 1시간마다 주요 코인의 신호를 기록하고,
// 4·24·72시간 뒤 가격과 비교해 신호별 적중률을 셉니다. Claude를 부르지 않으므로 사용량이 들지 않습니다.
// 기록은 서버가 obs/<날짜>.json으로 저장합니다. 결과(가격 비교)는 저장하지 않고 볼 때마다 1시간봉으로 계산합니다.
(() => {
  const TA = window.TA, U = TA && TA.ui;
  if (!U || !U.repTools) return;
  const { el, fdt } = U, T = U.repTools;
  const $ = s => document.querySelector(s);
  const COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'HYPE'], HZ = [4, 24, 72], H = 3600;
  const MIN_EFF = 20;          // 독립 표본이 이보다 적으면 "표본 부족"
  const GOOD = 0.55, BAD = 0.45; // 검증 기준: 앞 기간·뒤 기간 모두 55% 이상(또는 45% 이하)
  const O = { local: false, days: {}, loaded: false, busy: false, stats: null, statsAt: 0 };
  const pad = v => String(v).padStart(2, '0');
  const dayOf = t => { const d = new Date(t * 1000); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; };
  const rows = () => Object.values(O.days).flat();
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---------- 기록 불러오기 ----------
  async function load() {
    try {
      const r = await fetch('obs/index.json?v=' + Date.now(), { cache: 'no-store' });
      const days = r.ok ? (await r.json()).days || [] : [];
      await Promise.all(days.map(async d => {
        if (O.days[d] && d !== dayOf(Date.now() / 1000)) return;
        const x = await fetch(`obs/${d}.json?v=${Date.now()}`, { cache: 'no-store' });
        if (x.ok) O.days[d] = await x.json();
      }));
    } catch (e) {}
    O.loaded = true;
  }

  // ---------- 관측: 리포트가 기록하는 것과 같은 신호 ----------
  async function signalsOf(coin) {
    const series = await Promise.all(T.TFS.map(tf => T.loadTf(coin, tf)));
    const s = {};
    series.forEach((x, i) => Object.entries(T.tfText(x, T.TFS[i]).sig).forEach(([k, v]) => { if (v) s[T.TFS[i] + '.' + k] = v; }));
    try { const ctx = await T.contextFor(coin), v = Math.sign(ctx(Date.now() / 1000).score); if (v) s.dash = v; } catch (e) {}
    Object.entries(await T.flowSignals(coin).catch(() => ({}))).forEach(([k, v]) => { if (v) s['flow.' + k] = v; });
    const w = U.whaleSignals ? await U.whaleSignals(TA.hlCoin(coin)).catch(() => null) : null;
    Object.entries(w || {}).forEach(([k, v]) => { if (v) s['whale.' + k] = v; });
    const m15 = series[3];
    return { p: m15.c[m15.c.length - 1], s, w: !!w };
  }
  const lockKey = 'obs.lock', TAB = Math.random().toString(36).slice(2);
  const readLock = () => { try { return JSON.parse(localStorage.getItem(lockKey) || 'null'); } catch (e) { return null; } };
  const writeLock = v => { try { v ? localStorage.setItem(lockKey, JSON.stringify(v)) : localStorage.removeItem(lockKey); } catch (e) {} };
  async function observe() {
    if (!O.local || O.busy || window.TA_chatBusy) return;
    const now = Date.now() / 1000, slot = Math.floor(now / H) * H;
    if (now - slot < 120) return; // 정각 봉이 닫히고 2분 뒤
    const lock = readLock(); if (lock && lock.tab !== TAB && Date.now() - lock.at < 10 * 60e3) return; // 다른 탭이 기록 중
    O.busy = true;
    try {
      await load();
      const day = dayOf(slot), have = new Set((O.days[day] || []).filter(r => r.t === slot).map(r => r.c));
      const todo = COINS.filter(c => !have.has(c)); if (!todo.length) return;
      writeLock({ tab: TAB, at: Date.now() });
      const add = [];
      for (const c of todo) {
        try { add.push({ t: slot, c, at: Math.floor(Date.now() / 1000), ...(await signalsOf(c)) }); } catch (e) {}
        await sleep(1500); // 하이퍼리퀴드 요청이 몰리지 않게
      }
      if (!add.length) return;
      const list = (O.days[day] || []).concat(add);
      const push = new Date(slot * 1000).getHours() % 6 === 0 ? 1 : 0; // GitHub 업로드는 6시간마다
      const r = await fetch(`api/obs/save?day=${day}&push=${push}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dashboard': '1' }, body: JSON.stringify(list, (k, v) => k === 'mv' ? undefined : v) }); // 결과(mv)는 저장하지 않음
      if (r.ok) { O.days[day] = list; O.stats = null; if (U.activeTab() === 'report') render(); }
    } finally { O.busy = false; writeLock(null); }
  }

  // ---------- 채점: 관측 시점 가격 → 4·24·72시간 뒤 1시간봉 종가 ----------
  async function computeStats() {
    const all = rows(); if (!all.length) return { n: 0 };
    const from = Math.min(...all.map(r => r.t));
    const close = {};
    for (const c of COINS) {
      if (!all.some(r => r.c === c)) continue;
      try {
        const k = await TA.hl({ type: 'candleSnapshot', req: { coin: TA.hlCoin(c), interval: '1h', startTime: (from - H) * 1000, endTime: Date.now() } });
        const m = new Map(); k.forEach(x => m.set(x.t / 1000, +x.c)); close[c] = m;
      } catch (e) {}
    }
    // 관측 t의 h시간 뒤 가격 = [t + h − 1시간]에 시작한 1시간봉의 종가 (아직 안 닫혔으면 결과 없음)
    const now = Date.now() / 1000, out = {};
    all.forEach(r => { r.mv = {}; HZ.forEach(h => { const m = close[r.c], v = m && now >= r.t + h * H ? m.get(r.t + h * H - H) : null; if (v != null && r.p) r.mv[h] = Math.sign(v - r.p); }); });
    const mid = all.map(r => r.t).sort((a, b) => a - b)[Math.floor(all.length / 2)];
    // 독립 표본: 같은 코인의 관측은 h시간 안에서 결과가 거의 겹치므로, 코인별 h시간 칸 수로 셉니다
    const eff = (g, h) => new Set(g.map(r => r.c + ':' + Math.floor(r.t / (h * H)))).size;
    const rate = (g, key, h) => { const x = g.filter(r => r.s[key] && r.mv[h]); return { n: x.length, hit: x.filter(r => r.s[key] === r.mv[h]).length, eff: eff(x, h) }; };
    const keys = [...T.TFS.flatMap(tf => T.SIG_CHART.map(([k]) => tf + '.' + k)), ...T.SIG_OTHER.map(([k]) => k)];
    keys.forEach(key => {
      out[key] = {};
      HZ.forEach(h => {
        const a = rate(all, key, h), f = rate(all.filter(r => r.t < mid), key, h), b = rate(all.filter(r => r.t >= mid), key, h);
        out[key][h] = { ...a, rate: a.n ? a.hit / a.n : null, front: f.n ? f.hit / f.n : null, back: b.n ? b.hit / b.n : null, verdict: verdict(a, f, b) };
      });
    });
    // 신호 합의: 관측마다 (상승 신호 수 − 하락 신호 수)를 구간으로 나눠 실제로 오른 비율
    const BUCKETS = [['+8 이상', v => v >= 8], ['+4 ~ +7', v => v >= 4 && v <= 7], ['−3 ~ +3', v => v >= -3 && v <= 3], ['−7 ~ −4', v => v <= -4 && v >= -7], ['−8 이하', v => v <= -8]];
    const cons = BUCKETS.map(([name, f]) => {
      const g = all.filter(r => f(Object.values(r.s).reduce((t, v) => t + v, 0)));
      return { name, ...Object.fromEntries(HZ.map(h => { const x = g.filter(r => r.mv[h]); return [h, { n: x.length, eff: eff(x, h), up: x.length ? x.filter(r => r.mv[h] > 0).length / x.length : null }]; })) };
    });
    return { n: all.length, first: from, last: Math.max(...all.map(r => r.t)), coins: new Set(all.map(r => r.c)).size, mid, sig: out, cons };
  }
  function verdict(a, f, b) {
    if (a.eff < MIN_EFF || !f.n || !b.n) return 'few';
    const fr = f.hit / f.n, br = b.hit / b.n, r = a.hit / a.n;
    if (fr >= GOOD && br >= GOOD) return 'up';
    if (fr <= BAD && br <= BAD) return 'rev';
    return r >= GOOD || r <= BAD ? 'cand' : 'flat';
  }
  const VERDICT = { few: ['muted', '표본 부족'], up: ['up', '검증됨 · 맞음'], rev: ['down', '검증됨 · 반대로 맞음'], cand: ['', '후보 · 확인 중'], flat: ['muted', '반반'] };
  async function stats() {
    if (O.stats && Date.now() - O.statsAt < 30 * 60e3) return O.stats;
    if (!O.loaded) await load();
    O.stats = await computeStats(); O.statsAt = Date.now();
    return O.stats;
  }
  const nameOf = key => {
    const [a, b] = key.split('.');
    if (T.TFS.includes(a)) return `${T.TF_LABEL[a]} ${(T.SIG_CHART.find(x => x[0] === b) || [, b])[1]}`;
    return (T.SIG_OTHER.find(x => x[0] === key) || [, key])[1];
  };

  // ---------- 리포트 지시문에 넣을 요약 (검증된 신호만 확률로, 나머지는 개수만) ----------
  U.obsBrief = async function (coin, now) {
    const st = await stats().catch(() => null);
    if (!st || !st.n) return '아직 관측 기록 없음';
    const L = [`관측 ${st.n}건 (${fdt(st.first)}~${fdt(st.last)}, 코인 ${st.coins}개) · 검증 = 관측 기간을 앞·뒤로 나눠 두 기간 모두 ${Math.round(GOOD * 100)}% 이상(또는 ${Math.round(BAD * 100)}% 이하), 독립 표본 ${MIN_EFF}개 이상`];
    const ver = [];
    Object.entries(st.sig).forEach(([key, hs]) => HZ.forEach(h => { const x = hs[h]; if (x.verdict === 'up' || x.verdict === 'rev') ver.push({ key, h, x }); }));
    if (!ver.length) L.push('검증된 신호: 아직 없음 (표본이 쌓이는 중이라 신호별 확률은 판단 근거로 쓰지 않는다)');
    else {
      L.push('검증된 신호 (지금 이 종목의 값 → 과거 같은 신호일 때 그 방향으로 간 비율):');
      ver.forEach(({ key, h, x }) => {
        const v = now ? now[key] || 0 : null, dirTxt = v > 0 ? '상승' : v < 0 ? '하락' : '신호 없음';
        L.push(`- ${nameOf(key)} · ${h}시간: 신호 방향대로 간 비율 ${Math.round(x.rate * 100)}% (${x.n}건, 독립 ${x.eff}) ${x.verdict === 'rev' ? '→ 반대로 쓰면 맞는 신호' : ''} · 지금 ${dirTxt}`);
      });
    }
    if (now) {
      const score = Object.values(now).reduce((t, v) => t + v, 0), b = st.cons.find(c => ({ '+8 이상': score >= 8, '+4 ~ +7': score >= 4 && score <= 7, '−3 ~ +3': score >= -3 && score <= 3, '−7 ~ −4': score <= -4 && score >= -7, '−8 이하': score <= -8 })[c.name]);
      if (b) L.push(`신호 합의: 지금 ${score > 0 ? '+' : ''}${score} (${b.name}) → 과거 같은 구간에서 오른 비율 ` + HZ.map(h => `${h}시간 ${b[h].up == null ? '-' : Math.round(b[h].up * 100) + '%'} (독립 ${b[h].eff})`).join(' · '));
    }
    return L.join('\n');
  };

  // ---------- 화면 (리포트 탭 아래) ----------
  async function render() {
    const box = $('#obsPanel'); if (!box) return;
    const st = await stats().catch(() => null);
    box.textContent = '';
    box.append(el('div', { class: 'ph' }, el('h2', { text: '신호 자동 관측' }),
      el('small', { text: `내 컴퓨터 대시보드가 열려 있으면 1시간마다 ${COINS.join('·')}의 신호를 기록 · Claude 사용량 없음 · ${HZ.join('·')}시간 뒤 가격 방향과 비교` })));
    if (!st || !st.n) { box.append(el('p', { class: 'note pb', text: O.local ? '첫 관측을 기다리는 중입니다 (매시 정각 2분 뒤).' : '관측 기록이 아직 없습니다. 내 컴퓨터 대시보드를 열어 두면 쌓입니다.' })); return; }
    const pb = el('div', { class: 'pb' });
    pb.append(el('p', { class: 'note', text: `관측 ${st.n}건 · ${fdt(st.first)} ~ ${fdt(st.last)} · 코인 ${st.coins}개 · 검증: 기간을 ${fdt(st.mid)} 기준 앞·뒤로 나눠 두 기간 모두 ${Math.round(GOOD * 100)}% 이상이면 "맞음", 모두 ${Math.round(BAD * 100)}% 이하면 "반대로 맞음" (독립 표본 ${MIN_EFF}개 이상일 때만). 칸 = 신호 방향대로 간 비율 (독립 표본 수). 검증된 신호만 리포트 지시문에 확률로 들어갑니다.` }));
    const cell = x => { const [cls] = VERDICT[x.verdict]; return el('td', { class: 'r m ' + cls, title: x.front != null ? `앞 기간 ${Math.round(x.front * 100)}% · 뒤 기간 ${x.back != null ? Math.round(x.back * 100) + '%' : '-'}` : '', text: x.n ? `${Math.round(x.rate * 100)}% (${x.eff})` : '—' }); };
    const best = hs => { const o = ['up', 'rev', 'cand', 'flat', 'few']; return HZ.map(h => hs[h].verdict).sort((a, b) => o.indexOf(a) - o.indexOf(b))[0]; };
    const table = keys => el('div', { class: 'tblwrap', style: 'margin-top:8px' }, el('table', null,
      el('thead', null, el('tr', null, ['신호', ...HZ.map(h => h + '시간 뒤'), '판정'].map((x, i) => el('th', { class: i ? 'r' : '', text: x })))),
      el('tbody', null, keys.map(key => { const hs = st.sig[key], [cls, txt] = VERDICT[best(hs)]; return el('tr', null, el('td', { text: nameOf(key) }), HZ.map(h => cell(hs[h])), el('td', { class: 'r ' + cls, text: txt })); }))));
    pb.append(el('h3', { text: '수급·고래·방향성 신호' }), table(T.SIG_OTHER.map(([k]) => k)));
    T.TFS.forEach(tf => pb.append(el('h3', { text: `차트 신호 · ${T.TF_LABEL[tf]}` }), table(T.SIG_CHART.map(([k]) => tf + '.' + k))));
    pb.append(el('h3', { text: '신호 합의 (상승 신호 수 − 하락 신호 수)' }), el('div', { class: 'tblwrap' }, el('table', null,
      el('thead', null, el('tr', null, ['합의 점수', ...HZ.map(h => h + '시간 뒤 오른 비율')].map((x, i) => el('th', { class: i ? 'r' : '', text: x })))),
      el('tbody', null, st.cons.map(c => el('tr', null, el('td', { text: c.name }), HZ.map(h => el('td', { class: 'r m' + (c[h].eff < MIN_EFF ? ' muted' : ''), text: c[h].up == null ? '—' : `${Math.round(c[h].up * 100)}% (${c[h].eff})` }))))))));
    box.append(pb);
  }

  // ---------- 바이낸스 실시간 강제청산 (청산맵 영상 가설 3) ----------
  // 바이낸스 선물이 무료로 공개하는 강제청산 체결(종목별 1초에 1건까지)을 모읍니다. SELL = 롱이 청산됨, BUY = 숏이 청산됨.
  // 이 탭이 연결된 뒤 충분한 시간이 지나야 값을 돌려줍니다 (중간에 끊겼으면 모자란 값이 되므로).
  const LIQ = { list: [], since: null, ws: null };
  function liqConnect() {
    try {
      const ws = new WebSocket('wss://fstream.binance.com/market/ws/!forceOrder@arr'); LIQ.ws = ws;
      ws.onopen = () => { if (LIQ.since == null) LIQ.since = Date.now() / 1000; };
      ws.onmessage = e => {
        try {
          const o = JSON.parse(e.data).o, c = o.s.replace(/USDT$/, '');
          if (!COINS.includes(c)) return;
          LIQ.list.push({ t: o.T / 1000, c, side: o.S === 'SELL' ? 1 : -1, usd: +o.z * +o.ap });
          const cut = Date.now() / 1000 - 24 * H; while (LIQ.list.length && LIQ.list[0].t < cut) LIQ.list.shift();
        } catch (err) {}
      };
      ws.onclose = () => { LIQ.since = null; LIQ.list = []; setTimeout(liqConnect, 30e3); }; // 끊기면 처음부터 다시 셉니다
    } catch (e) {}
  }
  U.liqPrints = (coin, sec) => {
    const now = Date.now() / 1000;
    if (LIQ.since == null || now - LIQ.since < sec) return null;
    const g = LIQ.list.filter(x => x.c === coin && x.t >= now - sec);
    return { long: g.filter(x => x.side > 0).reduce((t, x) => t + x.usd, 0), short: g.filter(x => x.side < 0).reduce((t, x) => t + x.usd, 0), n: g.length };
  };

  // ---------- 시작 ----------
  (async () => {
    try { const r = await fetch('api/ask/status', { headers: { 'X-Dashboard': '1' }, cache: 'no-store' }); O.local = r.ok; } catch (e) {}
    if (U.activeTab() === 'report') render();
    if (O.local) { liqConnect(); setTimeout(observe, 90e3); setInterval(observe, 5 * 60e3); }
  })();
  window.addEventListener('tabchange', e => { if (e.detail === 'report') render(); });
  U.obsTest = { stats: () => { O.stats = null; return stats(); }, observe, rows };
})();
