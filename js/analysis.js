// ICT · 엘리엇 파동 · 와이코프 자동 판독. 모두 규칙 기반 추정이며 확정 판단이 아닙니다.
(function (TA) {
  const last = a => a[a.length - 1];

  // ───────────────────────── ICT ─────────────────────────
  TA.ict = function (s, k = 3) {
    const n = s.c.length, atr = TA.atr(s.h, s.l, s.c, 14);
    const piv = TA.fractals(s, k).sort((a, b) => a.conf - b.conf);
    const events = [], dirAt = new Int8Array(n);
    let lastH = null, lastL = null, trend = 0, pi = 0;
    const highs = [], lows = [];
    for (let i = 0; i < n; i++) {
      while (pi < piv.length && piv[pi].conf <= i) {
        const p = { ...piv[pi], broken: false };
        if (p.type === 'H') { lastH = p; highs.push(p); } else { lastL = p; lows.push(p); }
        pi++;
      }
      if (lastH && !lastH.broken && s.c[i] > lastH.p) {
        events.push({ i, dir: 1, kind: trend === -1 ? 'CHoCH' : 'BOS', level: lastH.p, from: lastH.i });
        trend = 1; lastH.broken = true;
      }
      if (lastL && !lastL.broken && s.c[i] < lastL.p) {
        events.push({ i, dir: -1, kind: trend === 1 ? 'CHoCH' : 'BOS', level: lastL.p, from: lastL.i });
        trend = -1; lastL.broken = true;
      }
      dirAt[i] = trend;
    }
    const c = last(s.c), a = last(atr) || c * 0.01;

    // 유동성: 아직 깨지지 않은 고점(매수 유동성, BSL) / 저점(매도 유동성, SSL)
    const intactH = [], intactL = [];
    const from = Math.max(0, n - 300);
    highs.filter(p => p.i >= from).forEach(p => { let maxAfter = -Infinity; for (let j = p.i + 1; j < n; j++) maxAfter = Math.max(maxAfter, s.h[j]); if (maxAfter <= p.p) intactH.push(p); });
    lows.filter(p => p.i >= from).forEach(p => { let minAfter = Infinity; for (let j = p.i + 1; j < n; j++) minAfter = Math.min(minAfter, s.l[j]); if (minAfter >= p.p) intactL.push(p); });
    const bsl = intactH.filter(p => p.p > c).sort((x, y) => x.p - y.p).slice(0, 3);
    const ssl = intactL.filter(p => p.p < c).sort((x, y) => y.p - x.p).slice(0, 3);

    // 유동성 스윕: 최근 12봉 안에서 이전 고점/저점을 꼬리로 깨고 종가는 다시 안쪽으로 들어온 봉
    const sweeps = [];
    for (let i = Math.max(1, n - 12); i < n; i++) {
      const prevL = lows.filter(p => p.conf < i && p.i >= i - 80);
      const prevH = highs.filter(p => p.conf < i && p.i >= i - 80);
      const sl = prevL.filter(p => s.l[i] < p.p && s.c[i] > p.p).sort((x, y) => x.p - y.p)[0];
      const sh = prevH.filter(p => s.h[i] > p.p && s.c[i] < p.p).sort((x, y) => y.p - x.p)[0];
      if (sl) sweeps.push({ i, dir: 1, level: sl.p });
      if (sh) sweeps.push({ i, dir: -1, level: sh.p });
    }

    // FVG(공정가치 갭): 3봉 사이에 비어 있는 가격대. 다시 채워지지 않은 것만.
    const fvgs = [];
    for (let i = Math.max(2, n - 250); i < n; i++) {
      const minGap = 0.15 * (atr[i] || a);
      if (s.l[i] > s.h[i - 2] && s.l[i] - s.h[i - 2] > minGap) fvgs.push({ i: i - 1, dir: 1, top: s.l[i], bot: s.h[i - 2] });
      if (s.h[i] < s.l[i - 2] && s.l[i - 2] - s.h[i] > minGap) fvgs.push({ i: i - 1, dir: -1, top: s.l[i - 2], bot: s.h[i] });
    }
    const openFvg = fvgs.filter(g => {
      for (let j = g.i + 2; j < n; j++) {
        if (g.dir === 1 && s.l[j] <= g.bot) return false;
        if (g.dir === -1 && s.h[j] >= g.top) return false;
      }
      return true;
    }).filter(g => Math.abs((g.top + g.bot) / 2 - c) < 6 * a);

    // 오더블록: 구조를 깬 상승(하락) 직전의 마지막 반대색 봉
    const obs = [];
    events.filter(e => e.i >= n - 250).forEach(e => {
      let ext = e.from, j;
      if (e.dir === 1) {
        for (j = e.from; j <= e.i; j++) if (s.l[j] < s.l[ext]) ext = j;
        for (j = ext; j >= Math.max(0, ext - 6); j--) if (s.c[j] < s.o[j]) break;
        if (j < 0 || s.c[j] >= s.o[j]) j = ext;
        const ob = { i: j, dir: 1, top: s.h[j], bot: s.l[j], kind: e.kind };
        let ok = true; for (let x = e.i + 1; x < n; x++) if (s.c[x] < ob.bot) { ok = false; break; }
        if (ok) obs.push(ob);
      } else {
        for (j = e.from; j <= e.i; j++) if (s.h[j] > s.h[ext]) ext = j;
        for (j = ext; j >= Math.max(0, ext - 6); j--) if (s.c[j] > s.o[j]) break;
        if (j < 0 || s.c[j] <= s.o[j]) j = ext;
        const ob = { i: j, dir: -1, top: s.h[j], bot: s.l[j], kind: e.kind };
        let ok = true; for (let x = e.i + 1; x < n; x++) if (s.c[x] > ob.top) { ok = false; break; }
        if (ok) obs.push(ob);
      }
    });
    const nearObs = obs.filter(o => Math.abs((o.top + o.bot) / 2 - c) < 8 * a).slice(-4);

    // 딜링 레인지: 가장 최근 확정 고점·저점 사이. 50% 위는 프리미엄, 아래는 디스카운트.
    let range = null;
    const lh = last(highs), ll = last(lows);
    if (lh && ll) {
      let hi = lh.p, lo = ll.p;
      for (let j = Math.min(lh.i, ll.i); j < n; j++) { hi = Math.max(hi, s.h[j]); lo = Math.min(lo, s.l[j]); }
      const legUp = ll.i < lh.i;
      const pos = (c - lo) / (hi - lo || 1);
      const ote = legUp ? [hi - 0.79 * (hi - lo), hi - 0.62 * (hi - lo)] : [lo + 0.62 * (hi - lo), lo + 0.79 * (hi - lo)];
      range = { hi, lo, eq: (hi + lo) / 2, pos, legUp, ote, from: Math.min(lh.i, ll.i) };
    }
    return { trend, events, lastEvent: last(events), dirAt, bsl, ssl, sweeps, fvgs: openFvg.slice(-6), obs: nearObs, range, atr: a };
  };

  // ───────────────────────── 엘리엇 파동 ─────────────────────────
  const near = (x, lo, hi) => x >= lo && x <= hi;
  function fibScore(r, ideal, ok) { return near(r, ideal[0], ideal[1]) ? 1 : near(r, ok[0], ok[1]) ? 0.5 : 0; }

  function evalImpulse(P, dir) {
    // P: 피벗 가격 배열(시작점 포함). 마지막 다리는 진행 중.
    const x = P.map(p => p * dir);
    const L = []; for (let i = 1; i < x.length; i++) L.push(Math.abs(x[i] - x[i - 1]));
    const m = L.length; // 진행 중인 파동 번호 = m
    let score = 0, max = 0;
    const rules = [];
    if (m >= 2) { if (x[2] <= x[0]) return null; rules.push('2파가 1파 시작점을 넘지 않음'); const r = L[1] / L[0]; score += fibScore(r, [0.5, 0.65], [0.3, 0.9]); max++; }
    if (m >= 3) { if (x[3] <= x[1] && m > 3) return null; const r = L[2] / L[0]; if (m > 3) { score += fibScore(r, [1.5, 2.8], [1.0, 4.5]); max++; } }
    if (m >= 4) { if (x[4] <= x[1]) return null; rules.push('4파가 1파 고점과 겹치지 않음'); const r = L[3] / L[2]; score += fibScore(r, [0.23, 0.5], [0.14, 0.62]); max++; }
    if (m >= 5) { if (L[2] < L[0] && L[2] < L[4]) return null; rules.push('3파가 가장 짧지 않음'); }
    return { score, max, rules, L, x };
  }

  function evalABC(P, dir) {
    // dir: 조정 방향(-1 = 하락 조정). P: [시작, A끝, B끝, C진행]
    const x = P.map(p => p * dir);
    const L = []; for (let i = 1; i < x.length; i++) L.push(Math.abs(x[i] - x[i - 1]));
    const m = L.length;
    let score = 0, max = 0;
    if (m >= 2) { const r = L[1] / L[0]; if (r >= 1) return null; score += fibScore(r, [0.38, 0.79], [0.2, 0.95]); max++; }
    if (m >= 3) { const r = L[2] / L[0]; score += fibScore(r, [0.9, 1.7], [0.6, 2.7]); max++; }
    return { score, max, L, x };
  }

  TA.elliott = function (s, mult = 4) {
    const thr = TA.zigzagThreshold(s, mult);
    const zz = TA.zigzag(s, thr);
    const n = s.c.length, c = last(s.c);
    if (zz.length < 3) return { thr, zz, cands: [] };
    // 진행 중인 마지막 점을 현재가로 맞춤
    const P = zz.slice(-9).map(p => ({ ...p }));
    const lp = last(P); if (lp.provisional) { lp.cur = c; }
    // 큰 흐름: 확정된 고점·저점이 높아지는지(상승) 낮아지는지(하락). 판단이 안 되면 EMA200으로 대신합니다.
    const conf = zz.filter(p => !p.provisional);
    const hs = conf.filter(p => p.type === 'H').slice(-2), ls = conf.filter(p => p.type === 'L').slice(-2);
    let bigDir = 0;
    if (hs.length === 2 && ls.length === 2) {
      if (hs[1].p > hs[0].p && ls[1].p > ls[0].p) bigDir = 1;
      else if (hs[1].p < hs[0].p && ls[1].p < ls[0].p) bigDir = -1;
    }
    if (!bigDir) { const e200 = TA.ema(s.c, Math.min(200, Math.floor(n / 2))); if (last(e200) != null) bigDir = c > last(e200) ? 1 : -1; }
    const cands = [];
    for (let len = 2; len <= 6; len++) {
      if (P.length < len) break;
      const seq = P.slice(-len);
      const prices = seq.map((p, k) => k === seq.length - 1 && p.cur != null ? p.p : p.p);
      const dir = prices[1] > prices[0] ? 1 : -1;
      const ev = evalImpulse(prices, dir);
      if (ev) {
        const wave = len - 1;
        const conf = (ev.max ? ev.score / ev.max : 0.4) * 0.6 + Math.min(wave, 4) * 0.06 + (dir === bigDir ? 0.12 : 0);
        cands.push({ type: 'impulse', dir, wave, seq, ev, conf, labels: seq.map((_, k) => String(k)) });
      }
    }
    for (let len = 2; len <= 4; len++) {
      if (P.length < len + 1) break;
      const seq = P.slice(-len);
      const prices = seq.map(p => p.p);
      const dir = prices[1] > prices[0] ? 1 : -1;
      // 직전 파동(조정 이전 추세)은 조정 방향과 반대여야 함
      const pre = P[P.length - len - 1];
      if (!pre || (prices[0] - pre.p) * dir > 0) continue;
      const ev = evalABC(prices, dir);
      if (ev) {
        const wave = ['', 'A', 'B', 'C'][len - 1];
        const preLen = Math.abs(prices[0] - pre.p);
        const conf = (ev.max ? ev.score / ev.max : 0.4) * 0.6 + (len - 1) * 0.06 + (dir !== bigDir ? 0.1 : 0) + (ev.L[0] < preLen ? 0.06 : 0);
        cands.push({ type: 'abc', dir, wave, seq, ev, conf, labels: ['', 'A', 'B', 'C'].slice(0, len) });
      }
    }
    cands.sort((a, b) => b.conf - a.conf);
    const total = cands.slice(0, 3).reduce((t, x) => t + x.conf, 0) || 1;
    const top = cands.slice(0, 3).map(x => ({ ...x, pct: Math.round(x.conf / total * 100), ...describeWave(x, c) }));
    return { thr, zz, cands: top, bigDir };
  };
  // 봉 주기별 파동 크기(ATR 배수). 큰 봉일수록 배수를 낮춰 주기마다 다른 크기의 파동을 셉니다.
  TA.ewMult = { '15m': 5, '1h': 4, '4h': 3, '1d': 3 };

  function describeWave(w, c) {
    const p = w.seq.map(q => q.p), d = w.dir, up = d === 1;
    const len = (a, b) => Math.abs(p[b] - p[a]);
    let name, now, zone = null, target = null, invalid = null, dip, targetNote = null;
    // 진행 중인 파동의 목표가: 이미 지나간 비율은 건너뛰고, 아직 도달하지 않은 첫 비율을 고릅니다.
    const passed = [];
    const nextTarget = (base, unit, ratios) => {
      for (const r of ratios) {
        const t = base + d * r * unit;
        if (d > 0 ? t > c : t < c) return { t, r };
        passed.push(r);
      }
      return null;
    };
    if (w.type === 'impulse') {
      name = (up ? '상승' : '하락') + ' 충격파';
      now = `${w.wave}파 진행 중`;
      if (w.wave === 1) { invalid = p[0]; dip = up ? ['warn', '상승 1파 초입. 아직 추세 확인 전이라 신호 신뢰도가 낮음'] : ['bad', '하락 1파 진행. 하락 추세가 막 시작됐을 수 있음']; }
      if (w.wave === 2) { zone = [p[1] - d * 0.618 * len(0, 1), p[1] - d * 0.5 * len(0, 1)]; invalid = p[0]; target = p[1];
        dip = up ? ['good', '상승 추세 안의 2파 조정. 1파의 50~61.8% 되돌림 구간에서 조정이 끝나기 쉬운 자리'] : ['warn', '하락 2파 반등 중. 반등 뒤 하락 3파가 남아 있을 수 있음']; }
      if (w.wave === 3) { const nt = nextTarget(p[2], len(0, 1), [1.618, 2.618, 4.236]); target = nt && nt.t; targetNote = nt ? `1파 길이의 ${nt.r}배 확장` : '4.236배 확장까지 넘어섬'; invalid = p[2];
        dip = up ? ['warn', '상승 3파 진행 중. 가장 강하고 긴 상승 구간이라 눌림이 짧고 얕음'] : ['bad', '하락 3파 진행 중. 가장 강하고 긴 하락 구간이라 과매도가 반복돼도 계속 빠질 수 있음']; }
      if (w.wave === 4) { zone = [p[3] - d * 0.382 * len(2, 3), p[3] - d * 0.236 * len(2, 3)]; invalid = p[1]; target = p[3];
        dip = up ? ['good', '상승 4파 조정. 1파 고점 위에서 지지되면 마지막 5파 상승이 남아 있음'] : ['warn', '하락 4파 반등 중. 반등 뒤 마지막 하락 5파가 남아 있을 수 있음']; }
      if (w.wave === 5) { const nt = nextTarget(p[4], len(0, 1), [0.618, 1, 1.618]); target = nt && nt.t; targetNote = nt ? `1파 길이의 ${nt.r}배` : '1파의 1.618배를 넘어선 5파 연장'; invalid = p[4];
        dip = up ? ['warn', '상승 5파 막바지. 상승이 끝나면 큰 조정(ABC)이 올 수 있음'] : ['good', '하락 5파 막바지. 하락 사이클이 끝나가는 구간이라 반등 가능성이 커지지만, 5파 연장도 흔함']; }
    } else {
      name = up ? '반등형 조정 (A↑ B↓ C↑)' : '하락형 조정 (A↓ B↑ C↓)';
      now = `${w.wave}파 진행 중`;
      if (w.wave === 'A') { invalid = null;
        dip = up ? ['warn', '반등 A파. 아직 큰 하락 추세 안의 반등일 수 있음'] : ['warn', '조정 A파 하락. B파 반등 후 C파 하락이 한 번 더 남아 있을 수 있음']; }
      if (w.wave === 'B') { zone = [p[1] - d * 0.618 * len(0, 1), p[1] - d * 0.382 * len(0, 1)]; invalid = p[0];
        dip = up ? ['bad', '반등 조정의 B파 하락. 이후 C파 반등이 남았지만 큰 추세는 하락'] : ['warn', '조정 B파 반등 중. C파 하락이 남아 있을 수 있음']; }
      if (w.wave === 'C') {
        const nt = nextTarget(p[2], len(0, 1), [1, 1.618, 2.618]); target = nt && nt.t;
        targetNote = nt ? `C = A의 ${nt.r}배` : 'C가 A의 2.618배를 넘어섬';
        // C=A 구간을 이미 지나쳤으면 구간 표시는 생략합니다.
        const z = [p[2] + d * 0.9 * len(0, 1), p[2] + d * 1.272 * len(0, 1)];
        zone = (d > 0 ? c > Math.max(...z) : c < Math.min(...z)) ? null : z; invalid = null;
        dip = up ? ['warn', '반등 C파. 반등이 끝나면 원래 하락 추세로 돌아갈 수 있음'] : ['good', '하락 조정의 마지막 C파. C=A 목표가 부근에서 조정이 마무리될 가능성']; }
    }
    if (zone) zone.sort((a, b) => a - b);
    if (passed.length) targetNote = (targetNote ? targetNote + ' · ' : '') + `${passed.join('·')}배 목표는 이미 지나침 (파동 연장 중)`;
    return { name, now, zone, target, invalid, dip, targetNote };
  }

  // ───────────────────────── 와이코프 ─────────────────────────
  TA.wyckoff = function (s) {
    const n = s.c.length, W = Math.min(80, Math.floor(n / 3));
    if (n < 60) return null;
    const atr = TA.atr(s.h, s.l, s.c, 14), vma = TA.sma(s.v, 20), c = last(s.c), a = last(atr);
    const st = n - W;
    const lowsW = s.l.slice(st, n - 5), highsW = s.h.slice(st, n - 5);
    const lo = TA.percentile(lowsW, 0.05), hi = TA.percentile(highsW, 0.95);
    const slope = TA.slope(s.c.slice(st)) * W / (a || 1);
    const preStart = Math.max(0, st - W);
    const priorMove = (s.c[st] - s.c[preStart]) / s.c[preStart];
    const width = (hi - lo) / lo;
    const trending = Math.abs(slope) > 7 && (slope > 0 ? c > hi : c < lo);
    const events = [];
    const vAvg = i => vma[i] || s.v[i] || 1;
    for (let i = st; i < n; i++) {
      const big = s.v[i] > 2 * vAvg(i), wide = (s.h[i] - s.l[i]) > 1.8 * (atr[i] || a);
      if (i < st + W * 0.35 && big && wide && s.c[i] < s.o[i] && s.l[i] <= lo * 1.01) events.push({ i, code: 'SC', name: '셀링 클라이맥스', dir: 1 });
      if (i < st + W * 0.35 && big && wide && s.c[i] > s.o[i] && s.h[i] >= hi * 0.99) events.push({ i, code: 'BC', name: '바잉 클라이맥스', dir: -1 });
      if (i >= n - 30 && s.l[i] < lo && (s.c[i] > lo || (i + 1 < n && s.c[i + 1] > lo))) events.push({ i, code: 'Spring', name: '스프링', dir: 1 });
      if (i >= n - 30 && s.h[i] > hi && (s.c[i] < hi || (i + 1 < n && s.c[i + 1] < hi))) events.push({ i, code: 'UT', name: '업스러스트', dir: -1 });
      if (i >= n - 30 && s.c[i] > hi && s.v[i] > 1.5 * vAvg(i) && s.c[i] > s.o[i]) events.push({ i, code: 'SOS', name: '강세 신호(SOS)', dir: 1 });
      if (i >= n - 30 && s.c[i] < lo && s.v[i] > 1.5 * vAvg(i) && s.c[i] < s.o[i]) events.push({ i, code: 'SOW', name: '약세 신호(SOW)', dir: -1 });
    }
    // 같은 종류 이벤트는 가장 최근 것만
    const uniq = []; const seen = {};
    for (let k = events.length - 1; k >= 0; k--) { if (!seen[events[k].code]) { seen[events[k].code] = 1; uniq.unshift(events[k]); } }
    // 거래량 분석: 범위 안 하락봉 vs 상승봉 평균 거래량
    let dv = 0, dn = 0, uv = 0, un = 0;
    for (let i = st; i < n; i++) { if (s.c[i] < s.o[i]) { dv += s.v[i]; dn++; } else { uv += s.v[i]; un++; } }
    const volRatio = (dv / (dn || 1)) / ((uv / (un || 1)) || 1);
    const has = code => uniq.find(e => e.code === code);
    const lastIdx = code => (has(code) || { i: -1 }).i;
    let schema, phase, tone, text;
    if (trending) {
      schema = slope > 0 ? '마크업' : '마크다운';
      phase = slope > 0 ? '상승 추세 (Phase E 이후)' : '하락 추세 (마크다운)';
      tone = slope > 0 ? 'good' : 'bad';
      text = slope > 0 ? '박스권을 벗어나 상승 추세가 이어지는 중. 눌림은 짧고 얕은 편' : '박스권 하단을 깨고 하락 추세가 이어지는 중. 과매도가 반복돼도 저점이 계속 낮아질 수 있음';
    } else {
      const accum = priorMove < -0.03 || (priorMove <= 0.03 && c < TA.ema(s.c, 50).slice(-1)[0]);
      schema = accum ? (priorMove < -0.03 ? '축적' : '재분산 또는 축적') : (priorMove > 0.03 ? '분산' : '재축적 또는 분산');
      if (accum) {
        if (c < lo && lastIdx('Spring') < n - 3) { phase = '박스권 하단 이탈'; tone = 'bad'; text = '축적 박스 하단을 깨고 회복하지 못함. 스프링이 아니라 하락 지속(마크다운)일 수 있음'; }
        else if (has('SOS') && c > (lo + hi) / 2) { phase = 'Phase D (상승 전환 확인)'; tone = 'good'; text = '박스 상단을 거래량과 함께 돌파한 강세 신호(SOS) 발생. 되돌림(LPS)이 매수 관점의 자리'; }
        else if (has('Spring')) { phase = 'Phase C (스프링)'; tone = 'good'; text = '박스 하단을 잠깐 깨고 다시 올라온 스프링 발생. 매도 물량 소진을 시험하는 단계로, 저점을 다시 깨지 않는지가 핵심'; }
        else { phase = 'Phase B (바닥 다지기)'; tone = 'warn'; text = '하락 후 박스권에서 물량을 주고받는 중. 박스 하단 근처 매수는 가능하지만 스프링(하단 이탈 후 복귀)이 한 번 더 나올 수 있음'; }
      } else {
        if (c > hi && lastIdx('UT') < n - 3) { phase = '박스권 상단 돌파'; tone = 'good'; text = '박스 상단을 넘어 유지 중. 재축적 후 상승 재개일 수 있음'; }
        else if (has('SOW') && c < (lo + hi) / 2) { phase = 'Phase D (하락 전환 확인)'; tone = 'bad'; text = '박스 하단을 거래량과 함께 깬 약세 신호(SOW) 발생. 반등(LPSY)은 매도 물량이 나오는 자리'; }
        else if (has('UT')) { phase = 'Phase C (업스러스트)'; tone = 'warn'; text = '박스 상단을 잠깐 넘었다가 밀려 내려온 업스러스트 발생. 분산이라면 이후 하락 전환 가능성'; }
        else { phase = 'Phase B (고점 박스권)'; tone = 'warn'; text = '상승 후 박스권. 분산(고점 형성)인지 재축적(쉬었다 상승)인지 아직 판단하기 이른 단계'; }
      }
    }
    const volNote = volRatio > 1.25 ? '박스 안에서 하락할 때 거래량이 더 많음 → 매도 압력 우위' : volRatio < 0.8 ? '박스 안에서 상승할 때 거래량이 더 많음 → 매수 압력 우위' : '상승·하락 거래량이 비슷함';
    return { schema, phase, tone, text, lo, hi, width, start: st, events: uniq, volRatio, volNote, trending };
  };

  // ───────────────────────── 다이버전스 (가격 vs RSI) ─────────────────────────
  // 일반: 추세가 약해지는 신호(반전 전조). 히든: 추세 안의 되돌림이 끝나는 신호(추세 지속).
  TA.DIV_TEXT = {
    'regular,1': ['일반 강세 다이버전스', '가격은 저점을 낮췄는데 RSI 저점은 높아짐 → 하락 힘이 약해지는 중, 반등 전조'],
    'hidden,1': ['히든 강세 다이버전스', '가격 저점은 높아졌는데 RSI 저점은 낮아짐 → 상승 추세 안의 눌림, 상승 지속 신호'],
    'regular,-1': ['일반 약세 다이버전스', '가격은 고점을 높였는데 RSI 고점은 낮아짐 → 상승 힘이 약해지는 중, 하락 전조'],
    'hidden,-1': ['히든 약세 다이버전스', '가격 고점은 낮아졌는데 RSI 고점은 높아짐 → 하락 추세 안의 반등, 하락 지속 신호']
  };
  TA.divergence = function (s, k = 3, recent = 20) {
    const n = s.c.length, rsi = TA.rsi(s.c, 14);
    const piv = TA.fractals(s, k).filter(p => rsi[p.i] != null);
    const lows = piv.filter(p => p.type === 'L'), highs = piv.filter(p => p.type === 'H');
    // 아직 확정 전인 현재 봉도 후보로 넣습니다(최근 k봉 중 가장 낮거나 높은 봉).
    const curLo = { i: n - 1, p: s.l[n - 1], provisional: true }, curHi = { i: n - 1, p: s.h[n - 1], provisional: true };
    let minI = n - 1, maxI = n - 1;
    for (let j = n - 1; j >= Math.max(0, n - k); j--) { if (s.l[j] < s.l[minI]) minI = j; if (s.h[j] > s.h[maxI]) maxI = j; }
    curLo.i = minI; curLo.p = s.l[minI]; curHi.i = maxI; curHi.p = s.h[maxI];
    const out = [];
    const check = (list, cur, dir) => {
      const cands = list.slice(-3);
      const pairs = [];
      if (cands.length >= 2) pairs.push([cands[cands.length - 2], cands[cands.length - 1]]);
      if (cands.length >= 1 && cur.i - cands[cands.length - 1].i >= k + 1) pairs.push([cands[cands.length - 1], cur]);
      for (const [a, b] of pairs.reverse()) {
        const gap = b.i - a.i;
        if (gap < 5 || gap > 80 || n - 1 - b.i > recent) continue;
        const ra = rsi[a.i], rb = rsi[b.i];
        // 두 점 사이에 그 선을 뚫는 봉이 있으면 무효(제대로 된 저점·고점 쌍이 아님)
        let clean = true;
        for (let j = a.i + 1; j < b.i; j++) { const lv = a.p + (b.p - a.p) * (j - a.i) / gap; if (dir > 0 ? s.l[j] < lv : s.h[j] > lv) { clean = false; break; } }
        if (!clean) continue;
        let type = null;
        if (dir > 0) { if (b.p < a.p && rb > ra + 1) type = 'regular'; else if (b.p > a.p && rb < ra - 1) type = 'hidden'; }
        else { if (b.p > a.p && rb < ra - 1) type = 'regular'; else if (b.p < a.p && rb > ra + 1) type = 'hidden'; }
        if (!type) continue;
        const strong = dir > 0 ? Math.min(ra, rb) < 30 : Math.max(ra, rb) > 70;
        const [name, text] = TA.DIV_TEXT[type + ',' + dir];
        out.push({ type, dir, a: { i: a.i, p: a.p, r: ra }, b: { i: b.i, p: b.p, r: rb }, provisional: !!b.provisional, age: n - 1 - b.i, strong, name, text });
        break;
      }
    };
    check(lows, curLo, 1);
    check(highs, curHi, -1);
    return out.sort((x, y) => x.age - y.age);
  };

  // ───────────────────────── 종합 판독 ─────────────────────────
  TA.dipView = function (ict, ew, wy, divs) {
    const items = [];
    let score = 0;
    (divs || []).forEach(d => {
      items.push([d.dir > 0 ? 'good' : 'bad', `다이버전스: ${d.name}${d.provisional ? ' (진행 중, 미확정)' : ''} — ${d.age}봉 전`]);
      score += d.dir;
    });
    if (ict) {
      const e = ict.lastEvent, sw = ict.sweeps.filter(x => x.dir === 1).slice(-1)[0];
      if (sw) { items.push(['good', `ICT: 직전 저점 아래 매도 유동성을 쓸고(스윕) 종가가 다시 위로 회복`]); score += 1; }
      if (e && e.dir === 1 && e.kind === 'CHoCH') { items.push(['good', 'ICT: 하락 구조가 상승으로 전환(CHoCH)됨']); score += 1; }
      else if (e && e.dir === -1) { items.push(['bad', `ICT: 시장 구조 하락 (${e.kind === 'BOS' ? '저점 갱신 BOS 지속' : '상승→하락 전환 CHoCH'})`]); score -= 1; }
      else if (e && e.dir === 1) { items.push(['good', 'ICT: 시장 구조 상승 (BOS)']); score += 1; }
      if (ict.range) items.push(ict.range.pos < 0.5 ? ['good', `ICT: 디스카운트 구간 (딜링 레인지 ${Math.round(ict.range.pos * 100)}% 위치)`] : ['warn', `ICT: 프리미엄 구간 (딜링 레인지 ${Math.round(ict.range.pos * 100)}% 위치, 비싼 쪽)`]);
    }
    if (ew && ew.cands[0]) {
      const w = ew.cands[0];
      items.push([w.dip[0], `엘리엇: ${w.name} ${w.now} (${w.pct}%) — ${w.dip[1]}`]);
      score += w.dip[0] === 'good' ? 1 : w.dip[0] === 'bad' ? -1 : 0;
    }
    if (wy) {
      items.push([wy.tone, `와이코프: ${wy.schema} · ${wy.phase}`]);
      score += wy.tone === 'good' ? 1 : wy.tone === 'bad' ? -1 : 0;
    }
    const verdict = score >= 2 ? ['good', '상승 쪽 우세'] : score <= -2 ? ['bad', '하락 쪽 우세'] : ['warn', '혼조'];
    return { items, score, verdict };
  };
})(window.TA);
