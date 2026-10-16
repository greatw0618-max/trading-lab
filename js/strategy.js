// 방향성(상위 봉) 점수와 "예상 투자 결과" 계산: 과거 비슷한 상황에서 같은 계획이 목표에 닿았는지 셉니다.
(function (TA) {
  // arr(오름차순)에서 값이 t 이하인 마지막 위치
  function upper(arr, t) {
    let lo = 0, hi = arr.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m] <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans;
  }

  // 시각 t에 이미 마감된 상위 봉만 사용해 방향성 점수를 계산하는 함수를 만듭니다.
  TA.buildContext = function (h1, h4, d1) {
    const ict1 = h1 && h1.t.length > 30 ? TA.ict(h1).dirAt : null;
    const e50h4 = h4 ? TA.ema(h4.c, 50) : null;
    const d20 = d1 ? TA.ema(d1.c, 20) : null, d50 = d1 ? TA.ema(d1.c, 50) : null;
    const done = (s, t) => upper(s.t, t) - 1; // 다음 봉이 시작된 봉 = 마감된 봉
    return function (t) {
      const f = [0, 0, 0];
      if (ict1) { const i = done(h1, t); if (i >= 0) f[0] = ict1[i]; }
      if (e50h4) {
        const i = done(h4, t);
        if (i >= 5 && e50h4[i] != null && e50h4[i - 5] != null) {
          const c = h4.c[i], up = e50h4[i] > e50h4[i - 5];
          f[1] = c > e50h4[i] && up ? 1 : c < e50h4[i] && !up ? -1 : 0;
        }
      }
      if (d20) {
        const i = done(d1, t);
        if (i >= 0 && d50[i] != null) {
          const c = d1.c[i];
          f[2] = c > d20[i] && d20[i] > d50[i] ? 1 : c < d20[i] && d20[i] < d50[i] ? -1 : 0;
        }
      }
      const score = f[0] + f[1] + f[2];
      return { f, score, group: score >= 2 ? 'good' : score <= -2 ? 'bad' : 'mid' };
    };
  };
  TA.ctxLabels = ['1시간 시장구조(ICT)', '4시간 추세(EMA50)', '일봉 추세(EMA20/50)'];
  TA.groupName = { good: '상승 우호', mid: '중립', bad: '하락 우세' };

  const median = a => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  const pct = (a, q) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(q * b.length))]; };

  // 한 번의 가상 진입을 따라갑니다. side: 1 = 롱, -1 = 숏. 진입가는 그 시점 가격 대비 같은 비율로 맞춥니다.
  function simulate(s, i, side, rel, tp, sl, H) {
    const n = s.c.length, entry = s.c[i] * (1 + rel), end = Math.min(n - 1, i + H);
    let j = i;
    if (Math.abs(rel) > 0.0005) {
      // 지정가(현재가보다 유리한 가격) 또는 돌파 진입(불리한 가격): 그 가격에 닿아야 체결
      const wantLow = entry < s.c[i];
      for (j = i + 1; j <= end; j++) if (wantLow ? s.l[j] <= entry : s.h[j] >= entry) break;
      if (j > end) return { filled: false };
    }
    const tpPx = entry * (1 + side * tp), slPx = sl > 0 ? entry * (1 - side * sl) : null;
    let worst = 0;
    // 현재가 진입은 그 봉 종가에 산 것이므로 다음 봉부터 봅니다.
    for (let k = j === i ? i + 1 : j; k <= end; k++) {
      worst = Math.min(worst, side > 0 ? s.l[k] / entry - 1 : 1 - s.h[k] / entry);
      if (slPx != null && (side > 0 ? s.l[k] <= slPx : s.h[k] >= slPx)) return { filled: true, out: 'sl', bars: k - j, mae: Math.min(worst, -sl), ret: -sl };
      if (k === j && j !== i) continue; // 지정가가 체결된 봉에서는 익절을 세지 않음(보수적)
      if (side > 0 ? s.h[k] >= tpPx : s.l[k] <= tpPx) return { filled: true, out: 'tp', bars: k - j, mae: worst, ret: tp };
    }
    const ret = side > 0 ? s.c[end] / entry - 1 : 1 - s.c[end] / entry;
    return { filled: true, out: 'timeout', bars: end - j, mae: worst, ret };
  }

  // plan: { side, entry, tp(%), sl(%), holdHours, lev, amt }
  TA.planEval = function (s, ctx, plan) {
    const n = s.c.length, cur = s.c[n - 1];
    const barH = (s.t[n - 1] - s.t[Math.max(0, n - 50)]) / 3600 / Math.min(49, n - 1) || 1;
    const tfH = { '15m': 0.25, '1h': 1, '4h': 4, '1d': 24 }[s.interval] || barH;
    const H = Math.max(1, Math.round(plan.holdHours / tfH));
    const rel = plan.entry / cur - 1, tp = plan.tp / 100, sl = plan.sl / 100;
    const rsi = TA.rsi(s.c, 14), rNow = rsi[n - 1];
    const gNow = ctx ? ctx(s.t[n - 1] + 1).group : null;
    const gap = Math.max(2, Math.round(H / 6));
    // 표본: 앞으로 H봉을 볼 수 있는 과거 봉 전체
    const idx = [];
    for (let i = 30; i + H < n; i++) if (rsi[i] != null) idx.push(i);
    const groupOf = i => (ctx ? ctx(s.t[i] + 1).group : null);
    const tiers = [
      { name: `RSI ${rNow.toFixed(0)}±6 · 방향성 "${TA.groupName[gNow] || '-'}"`, test: i => Math.abs(rsi[i] - rNow) <= 6 && (!ctx || groupOf(i) === gNow) },
      { name: `RSI ${rNow.toFixed(0)}±8`, test: i => Math.abs(rsi[i] - rNow) <= 8 },
      { name: '조건 없이 전체 기간', test: () => true }
    ];
    const run = test => {
      const res = []; let last = -1e9;
      for (const i of idx) { if (i - last < gap || !test(i)) continue; last = i; res.push(simulate(s, i, plan.side, rel, tp, sl, H)); }
      return res;
    };
    let tier = null, res = null;
    for (const t of tiers) { const r = run(t.test); if (r.length >= 20 || t === tiers[tiers.length - 1]) { tier = t; res = r; break; } }
    const base = tier === tiers[2] ? res : run(tiers[2].test);
    const stat = rs => {
      const f = rs.filter(r => r.filled), tpR = f.filter(r => r.out === 'tp');
      return {
        samples: rs.length, filled: f.length, fillRate: rs.length ? f.length / rs.length : 0,
        win: tpR.length, winRate: f.length ? tpR.length / f.length : 0,
        sl: f.filter(r => r.out === 'sl').length, timeout: f.filter(r => r.out === 'timeout').length,
        medHours: median(tpR.map(r => r.bars * tfH)), maeMed: median(f.map(r => r.mae)), maeWorst10: pct(f.map(r => r.mae), 0.1),
        timeoutRet: f.filter(r => r.out === 'timeout').map(r => r.ret), all: f
      };
    };
    const st = stat(res), bs = stat(base);
    let ev = null;
    if (st.filled) ev = st.all.reduce((a, r) => a + r.ret, 0) / st.filled; // 1회당 평균 수익률(레버리지 전)
    let liqRisk = null;
    if (plan.lev > 1 && st.filled) {
      const liqMove = 0.9 / plan.lev; // 유지증거금을 감안한 대략적인 청산 거리
      liqRisk = { move: liqMove, rate: st.all.filter(r => r.mae <= -liqMove).length / st.filled };
    }
    return { tier: tier.name, H, holdHours: H * tfH, tfH, rNow, gNow, cur, rel, st, bs, ev, liqRisk,
      tpPx: plan.entry * (1 + plan.side * tp), slPx: sl > 0 ? plan.entry * (1 - plan.side * sl) : null, span: [s.t[0], s.t[n - 1]] };
  };

  // 분석(엘리엇·ICT·와이코프·방향성) 기준 유리/불리 요인
  TA.planFactors = function (s, an, ctxNow, plan, r) {
    const out = [], side = plan.side, L = side > 0 ? '롱' : '숏';
    const n = s.c.length, c = s.c[n - 1], { ew, ict, wy } = an;
    if (ctxNow) {
      const g = ctxNow.group, fav = side > 0 ? g === 'good' : g === 'bad', unfav = side > 0 ? g === 'bad' : g === 'good';
      out.push([fav ? 'good' : unfav ? 'bad' : 'warn', `방향성 점수 ${ctxNow.score > 0 ? '+' : ''}${ctxNow.score} (${TA.groupName[g]}) — ${fav ? `큰 흐름이 ${L} 방향과 같음` : unfav ? `큰 흐름이 ${L} 반대 방향` : '큰 흐름이 뚜렷하지 않음'}`]);
    }
    const w = ew && ew.cands[0];
    if (w) {
      const wave = w.wave;
      const legDir = w.type === 'impulse' ? ([1, 3, 5].includes(wave) ? w.dir : -w.dir) : (wave === 'B' ? -w.dir : w.dir);
      const withLeg = legDir === side;
      const ending = (w.type === 'impulse' && [2, 4].includes(wave)) || (w.type === 'abc' && wave === 'C') || (w.type === 'impulse' && wave === 5);
      // 2·4파, B파는 큰 흐름을 거스르는 조정 파동이라 같은 방향이어도 짧게만 유효합니다.
      const corrective = (w.type === 'impulse' && [2, 4].includes(wave)) || (w.type === 'abc' && wave === 'B');
      let tone = withLeg ? (corrective ? 'warn' : 'good') : ending ? 'warn' : 'bad';
      let txt = `엘리엇: ${w.name} ${w.now} (${w.pct}%) — 지금 파동은 ${legDir > 0 ? '상승' : '하락'} 중`;
      txt += withLeg ? (corrective ? `이라 ${L} 방향이지만, 큰 흐름을 거스르는 조정 파동이라 짧게만 유효` : `, ${L} 방향과 같음`)
        : ending ? `이지만 마무리 단계일 수 있어 반전 가능성 있음` : `이라 ${L}에 역행`;
      if (w.invalid != null) txt += ` · 무효화 ${TA.ui ? TA.ui.fp(w.invalid) : w.invalid.toFixed(2)}`;
      out.push([tone, txt]);
    }
    if (ict) {
      const tpPx = r.tpPx, lo = Math.min(plan.entry, tpPx), hi = Math.max(plan.entry, tpPx);
      const fp = v => TA.ui ? TA.ui.fp(v) : v.toFixed(2);
      const blockers = [...ict.fvgs, ...ict.obs].filter(z => z.dir === -side && ((side > 0 && z.bot > lo && z.bot < hi) || (side < 0 && z.top < hi && z.top > lo)));
      if (blockers.length) out.push(['warn', `ICT: 목표가 가기 전에 ${side > 0 ? '저항' : '지지'} 구간 ${blockers.slice(0, 2).map(z => `${fp(z.bot)}~${fp(z.top)}`).join(', ')} (${side > 0 ? '하락' : '상승'} FVG·오더블록)`]);
      const liq = side > 0 ? ict.bsl : ict.ssl;
      const magnet = liq.find(p => side > 0 ? p.p > plan.entry && p.p <= tpPx * 1.002 : p.p < plan.entry && p.p >= tpPx * 0.998);
      if (magnet) out.push(['good', `ICT: 목표 안쪽에 ${side > 0 ? '매수' : '매도'} 유동성 ${fp(magnet.p)} — 가격이 끌려가기 쉬운 자리`]);
      if (ict.range) {
        const prem = ict.range.pos >= 0.5;
        out.push([(side > 0) !== prem ? 'good' : 'warn', `ICT: 딜링 레인지 ${Math.round(ict.range.pos * 100)}% (${prem ? '프리미엄' : '디스카운트'}) — ${side > 0 ? (prem ? '비싼 쪽에서 롱' : '싼 쪽에서 롱') : (prem ? '비싼 쪽에서 숏' : '싼 쪽에서 숏')}`]);
      }
      if (ict.lastEvent) { const e = ict.lastEvent, same = e.dir === side; out.push([same ? 'good' : 'bad', `ICT: 마지막 구조 ${e.kind}${e.dir > 0 ? '↑' : '↓'} — ${same ? `${L} 방향` : `${L} 반대 방향`}`]); }
    }
    (an.div || []).forEach(d => {
      const same = d.dir === side;
      out.push([same ? 'good' : 'bad', `다이버전스: ${d.name}${d.provisional ? ' (미확정)' : ''} ${d.age}봉 전 — ${same ? `${L} 방향 신호` : `${L} 반대 방향 신호`}`]);
    });
    if (wy) { const fav = side > 0 ? wy.tone === 'good' : wy.tone === 'bad', unfav = side > 0 ? wy.tone === 'bad' : wy.tone === 'good'; out.push([fav ? 'good' : unfav ? 'bad' : 'warn', `와이코프: ${wy.schema} · ${wy.phase}`]); }
    // 변동성: 목표까지 움직이는 데 필요한 대략적인 시간(무작위 보행 가정)
    const atr = TA.atr(s.h, s.l, s.c, 14)[n - 1];
    if (atr) {
      const a = atr / c, need = Math.pow(plan.tp / 100 / a, 2), hrs = need * r.tfH;
      out.push([hrs <= r.holdHours ? 'good' : 'warn', `변동성: 봉당 평균 ${(a * 100).toFixed(2)}% 움직임 → ${plan.tp}% 이동에 대략 ${hrs < 1 ? Math.round(hrs * 60) + '분' : hrs < 48 ? hrs.toFixed(1) + '시간' : (hrs / 24).toFixed(1) + '일'} 예상${hrs > r.holdHours ? ' (보유 기간보다 김)' : ''}`]);
    }
    if (r.rNow != null) {
      if (side > 0 && r.rNow < 25) out.push(['good', `RSI ${r.rNow.toFixed(1)}: 단기 과매도라 짧은 반등이 나오기 쉬운 구간`]);
      if (side < 0 && r.rNow < 25) out.push(['bad', `RSI ${r.rNow.toFixed(1)}: 이미 과매도라 숏은 반등에 걸리기 쉬움`]);
      if (side < 0 && r.rNow > 75) out.push(['good', `RSI ${r.rNow.toFixed(1)}: 단기 과매수라 짧은 하락이 나오기 쉬운 구간`]);
      if (side > 0 && r.rNow > 75) out.push(['bad', `RSI ${r.rNow.toFixed(1)}: 이미 과매수라 롱은 눌림에 걸리기 쉬움`]);
    }
    return out;
  };
})(window.TA);
