// 리포트 탭: 종목 하나를 15분·1시간·4시간·일봉과 6개 관점으로 Claude가 종합해 롱/숏 셋업 리포트를 씁니다.
// 리포트는 start-local.bat 서버가 reports/ 폴더에 저장하고, 72시간 동안 15분봉으로 결과를 자동 채점합니다.
(() => {
  const TA = window.TA, U = TA && TA.ui, LW = window.LightweightCharts;
  if (!U || !LW) return;
  const { el, fp, fpct, fusd, fdt, chip, store, toneOf } = U;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const cv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  const H = 3600, ENTRY_HOURS = 24, RESULT_HOURS = 72, MIN_RR = 2;
  const TFS = ['1d', '4h', '1h', '15m'];
  const TF_LABEL = { '15m': '15분', '1h': '1시간', '4h': '4시간', '1d': '일봉' };
  const TF_ROLE = { '1d': '배경', '4h': '방향', '1h': '방향', '15m': '진입 타이밍' };
  const TF_BARS = { '1d': 20, '4h': 24, '1h': 30, '15m': 32 };
  const VIEWS = [['elliott', '엘리엇 파동'], ['ict', 'ICT'], ['wyckoff', '와이코프'], ['divergence', '다이버전스'], ['flow', '수급 (OI·CVD·펀딩)'], ['whale', '고래·청산맵']];
  const VIEW_NAME = Object.fromEntries(VIEWS);
  const DIR_CHIP = { up: ['good', '▲ 상승'], down: ['bad', '▼ 하락'], flat: ['flat', '● 중립'] };
  const R = { sym: store.get('repSym', 'BTC'), busy: false, list: [], reports: {}, cur: null, charts: [], local: false, abort: null };

  // ---------- 데이터 모으기 ----------
  async function loadTf(sym, tf) {
    try { const s = await TA.load(sym, tf, 'hl'); if (s.t.length >= 60) return s; } catch (e) {}
    if (TA.hasYahoo(sym)) return TA.load(sym, tf, 'yahoo');
    throw new Error(`${TA.dispFull(sym)} ${TF_LABEL[tf]} 데이터를 불러오지 못했습니다`);
  }
  const lastOf = a => { for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i]; return null; };

  function tfText(s, tf) {
    const n = s.c.length, c = s.c[n - 1], L = [];
    const ew = TA.elliott(s, TA.ewMult[tf]), ict = TA.ict(s), wy = TA.wyckoff(s), div = TA.divergence(s);
    const rsi = lastOf(TA.rsi(s.c, 14)), atr = lastOf(TA.atr(s.h, s.l, s.c, 14));
    const e = k => lastOf(TA.ema(s.c, k));
    L.push(`## ${TF_LABEL[tf]} (${TF_ROLE[tf]}) · ${s.src === 'hl' ? '하이퍼리퀴드 24시간' : '미국 정규장'} · 마지막 봉 ${fdt(s.t[n - 1])}`);
    L.push(`현재가 ${fp(c)} · RSI14 ${rsi == null ? '-' : rsi.toFixed(1)} · ATR14 ${fp(atr)} · EMA10 ${fp(e(10))} · EMA20 ${fp(e(20))} · EMA60 ${fp(e(60))} · EMA120 ${fp(e(120))} · EMA200 ${fp(e(200))} (대시보드 차트 EMA는 10/20/60/120)`);
    const vAvg = s.v.slice(-21, -1).reduce((a, x) => a + x, 0) / 20;
    L.push(`거래량: 마지막 봉 ${Math.round(s.v[n - 1])} · 직전 20봉 평균 ${Math.round(vAvg)} (${vAvg ? (s.v[n - 1] / vAvg).toFixed(1) + '배' : '-'})`);
    L.push(`최근 ${TF_BARS[tf]}봉 (시각 시/고/저/종/거래량):`);
    for (let i = Math.max(0, n - TF_BARS[tf]); i < n; i++) L.push(`${fdt(s.t[i])} ${fp(s.o[i])}/${fp(s.h[i])}/${fp(s.l[i])}/${fp(s.c[i])}/${Math.round(s.v[i])}`);
    L.push(`[엘리엇] 지그재그 ${(ew.thr * 100).toFixed(1)}% · 큰 흐름 ${ew.bigDir > 0 ? '상승' : ew.bigDir < 0 ? '하락' : '불명'} · 고점·저점: ` + ew.zz.slice(-8).map(p => `${p.type === 'H' ? '고' : '저'} ${fp(p.p)}(${fdt(s.t[p.i])}${p.provisional ? ',진행' : ''})`).join(' → '));
    ew.cands.forEach((x, k) => L.push(`  후보${k + 1} ${x.name} ${x.now} ${x.pct}% · 점 ${x.seq.map((p, j) => (x.labels[j] || '시작') + ' ' + fp(p.p)).join(', ')}${x.target != null ? ' · 다음 목표 ' + fp(x.target) : ''}${x.targetNote ? '(' + x.targetNote + ')' : ''}${x.zone ? ' · 구간 ' + fp(x.zone[0]) + '~' + fp(x.zone[1]) : ''}${x.invalid != null ? ' · 무효화 ' + fp(x.invalid) : ''}`));
    L.push(`[ICT] ${ict.trend > 0 ? '상승' : ict.trend < 0 ? '하락' : '불명'} 구조 · 이벤트 ` + ict.events.slice(-3).map(x => `${x.kind}${x.dir > 0 ? '↑' : '↓'} ${fp(x.level)}(${fdt(s.t[x.i])})`).join(', '));
    if (ict.sweeps.length) L.push('  스윕: ' + ict.sweeps.slice(-3).map(w => `${w.dir > 0 ? '저점 아래' : '고점 위'} ${fp(w.level)}(${fdt(s.t[w.i])})`).join(', '));
    L.push(`  BSL ${ict.bsl.map(p => fp(p.p)).join(', ') || '-'} · SSL ${ict.ssl.map(p => fp(p.p)).join(', ') || '-'}`);
    if (ict.fvgs.length) L.push('  FVG: ' + ict.fvgs.map(g => `${g.dir > 0 ? '상승' : '하락'} ${fp(g.bot)}~${fp(g.top)}`).join(', '));
    if (ict.obs.length) L.push('  OB: ' + ict.obs.map(o => `${o.dir > 0 ? '상승' : '하락'} ${fp(o.bot)}~${fp(o.top)}`).join(', '));
    if (ict.range) L.push(`  딜링 레인지 ${fp(ict.range.lo)}~${fp(ict.range.hi)} 현재 ${Math.round(ict.range.pos * 100)}% (${ict.range.pos < 0.5 ? '디스카운트' : '프리미엄'}) · OTE ${fp(Math.min(...ict.range.ote))}~${fp(Math.max(...ict.range.ote))}`);
    L.push('[와이코프] ' + (wy ? `${wy.schema} · ${wy.phase}${wy.trending ? '' : ` · 박스 ${fp(wy.lo)}~${fp(wy.hi)}`} · 이벤트 ${wy.events.map(x => x.code + ' ' + fdt(s.t[x.i])).join(', ') || '없음'} · ${wy.volNote}` : '판독 불가'));
    L.push('[다이버전스] ' + (div.length ? div.map(d => `${d.name}${d.provisional ? '(진행 중)' : ''} 가격 ${fp(d.a.p)}→${fp(d.b.p)} RSI ${d.a.r.toFixed(1)}→${d.b.r.toFixed(1)} (${d.age}봉 전)`).join(' / ') : '최근 20봉 없음'));
    const dip = TA.dipView(ict, ew, wy, div);
    L.push(`[대시보드 종합 판독] ${dip.verdict[1]} (점수 ${dip.score})`);
    return { text: L.join('\n'), atr, price: c };
  }

  // 차트 분석 탭의 방향성 점수(1시간 ICT 구조 + 4시간 EMA50 + 일봉 EMA20/50)와 방향성 점검표(시장 기준·기초지수)
  async function contextFor(sym) {
    if (TA.hasYahoo(sym)) { const [h1, d1] = await Promise.all([TA.loadYahoo(sym, '1h'), TA.loadYahoo(sym, '1d')]); return TA.buildContext(h1, TA.to4h(h1), d1); }
    const [h1, h4, d1] = await Promise.all([TA.loadHL(sym, '1h'), TA.loadHL(sym, '4h'), TA.loadHL(sym, '1d')]);
    return TA.buildContext(h1, h4, d1);
  }
  const trendOf = s => { const n = s.c.length, c = s.c[n - 1], a = lastOf(TA.ema(s.c, 20)), b = lastOf(TA.ema(s.c, 50)); return a == null || b == null ? '데이터 부족' : c > a && a > b ? '상승 (가격 > EMA20 > EMA50)' : c < a && a < b ? '하락 (가격 < EMA20 < EMA50)' : '혼조'; };
  async function dashText(sym) {
    const L = [];
    try {
      const ctx = await contextFor(sym), now = ctx(Date.now() / 1000);
      L.push(`[방향성 점수] ${now.score > 0 ? '+' : ''}${now.score} (${TA.groupName[now.group]}) · ${TA.ctxLabels.map((x, i) => `${x} ${now.f[i] > 0 ? '▲' : now.f[i] < 0 ? '▼' : '–'}`).join(' · ')}`);
    } catch (e) { L.push('[방향성 점수] 계산 실패: ' + e.message); }
    const refs = TA.hasYahoo(sym) ? [[TA.PAIR[TA.ETF_OF[sym]], '4h', 'yahoo', '기초지수'], [TA.PAIR[TA.ETF_OF[sym]], '1d', 'yahoo', '기초지수']]
      : sym.startsWith('xyz:') ? [['xyz:XYZ100', '4h', 'hl', '나스닥100 · 시장 기준'], ['xyz:XYZ100', '1d', 'hl', '나스닥100 · 시장 기준']]
      : sym !== 'BTC' ? [['BTC', '4h', 'hl', '시장 기준'], ['BTC', '1d', 'hl', '시장 기준']] : [];
    if (!refs.length) L.push('[방향성 점검표 · 시장 기준] 이 종목(BTC)이 시장 기준이라 따로 비교할 종목이 없음');
    if (refs.length) {
      L.push('[방향성 점검표 · 시장 기준]');
      for (const [s2, tf, src, tag] of refs) {
        try {
          const s = await TA.load(s2, tf, src), ew = TA.elliott(s, TA.ewMult[tf]), ict = TA.ict(s), wy = TA.wyckoff(s), dv = TA.divergence(s)[0], t = ew.cands[0];
          L.push(`- ${TA.dispFull(s2)} ${TF_LABEL[tf]} (${tag}): 추세 ${trendOf(s)} / ICT ${ict.trend > 0 ? '상승' : ict.trend < 0 ? '하락' : '불명'} 구조${ict.lastEvent ? ' ' + ict.lastEvent.kind : ''} / 엘리엇 ${t ? `${t.name} ${t.now} ${t.pct}%` : '-'} / 와이코프 ${wy ? wy.schema + ' ' + wy.phase : '-'} / 다이버전스 ${dv ? dv.name : '없음'} / RSI ${lastOf(TA.rsi(s.c, 14)).toFixed(1)}`);
        } catch (e) { L.push(`- ${TA.dispFull(s2)} ${TF_LABEL[tf]}: 데이터 오류`); }
      }
    }
    return L.join('\n');
  }

  const isCoin = sym => !TA.hasYahoo(sym) && !TA.hlCoin(sym).startsWith('xyz:');
  async function bj(url) { const r = await fetch(url); if (!r.ok) throw new Error(r.status); return r.json(); }
  // 시장 수급 탭과 같은 데이터(1시간·15분) + 거래소별 시장가 + 하이퍼리퀴드. 실패하면 바이낸스만으로 대신합니다.
  async function flowText(sym) {
    if (!isCoin(sym)) return '수급 데이터 없음 (주식은 OI·CVD·펀딩 데이터가 없습니다)';
    if (U.flowSnapshot) {
      try {
        const [h1, m15, ctx] = await Promise.all([U.flowSnapshot(sym, '1h', 12), U.flowSnapshot(sym, '15m', 8), TA.loadCtx().catch(() => ({}))]);
        const L = [h1, m15];
        const x = U.cvdxSummary && U.cvdxSummary(sym); L.push(x || '[거래소별 시장가 순매수] 이 기기에 모인 기록 없음 (시장 수급 탭을 열어 두면 모입니다)');
        const hl = ctx[sym]; if (hl) L.push(`[하이퍼리퀴드] 펀딩(1시간) ${(hl.funding * 100).toFixed(4)}% · OI ${fusd(hl.openInterest * hl.markPx)} · 프리미엄 ${hl.premium != null ? (hl.premium * 100).toFixed(4) + '%' : '-'}`);
        return L.join('\n\n');
      } catch (e) { /* 아래 바이낸스 요약으로 */ }
    }
    return flowTextBinance(sym);
  }
  async function flowTextBinance(sym) {
    const p = sym + 'USDT', F = 'https://fapi.binance.com', L = [];
    const [kl, oi, ls, top, fund, ctx] = await Promise.allSettled([
      bj(`${F}/fapi/v1/klines?symbol=${p}&interval=1h&limit=48`), bj(`${F}/futures/data/openInterestHist?symbol=${p}&period=1h&limit=48`),
      bj(`${F}/futures/data/globalLongShortAccountRatio?symbol=${p}&period=1h&limit=48`), bj(`${F}/futures/data/topLongShortPositionRatio?symbol=${p}&period=1h&limit=48`),
      bj(`${F}/fapi/v1/fundingRate?symbol=${p}&limit=6`), TA.loadCtx()]);
    if (kl.status === 'fulfilled' && kl.value.length) {
      const k = kl.value; let cvd = 0; const cvdAt = [];
      k.forEach(x => { cvd += 2 * (+x[9]) - (+x[5]); cvdAt.push(cvd); });
      const n = k.length, cvd12 = cvdAt[n - 1] - cvdAt[Math.max(0, n - 13)];
      L.push(`바이낸스 선물 최근 48시간: 가격 ${fp(+k[0][1])} → ${fp(+k[n - 1][4])} (${fpct((k[n - 1][4] / k[0][1] - 1) * 100)}) · CVD 누적 ${Math.round(cvd).toLocaleString()} (최근 12시간 ${Math.round(cvd12).toLocaleString()}) 코인`);
      L.push('최근 6시간 시장가 매수 비중: ' + k.slice(-6).map(x => `${fdt(x[0] / 1000).slice(-5)} ${(x[9] / x[5] * 100).toFixed(0)}%`).join(', '));
    } else L.push('바이낸스 CVD: 데이터 없음');
    if (oi.status === 'fulfilled' && oi.value.length) { const o = oi.value, a = +o[0].sumOpenInterestValue, b = +o[o.length - 1].sumOpenInterestValue, m = +o[Math.max(0, o.length - 13)].sumOpenInterestValue; L.push(`바이낸스 OI ${fusd(b)} · 48시간 ${fpct((b / a - 1) * 100)} · 최근 12시간 ${fpct((b / m - 1) * 100)}`); }
    if (ls.status === 'fulfilled' && ls.value.length) { const x = ls.value; L.push(`개인 롱 비중 ${(x[x.length - 1].longAccount * 100).toFixed(1)}% (24시간 전 ${(x[Math.max(0, x.length - 25)].longAccount * 100).toFixed(1)}%)`); }
    if (top.status === 'fulfilled' && top.value.length) { const x = top.value; L.push(`상위 트레이더 롱 비중 ${(x[x.length - 1].longAccount * 100).toFixed(1)}% (24시간 전 ${(x[Math.max(0, x.length - 25)].longAccount * 100).toFixed(1)}%)`); }
    if (fund.status === 'fulfilled' && fund.value.length) L.push('바이낸스 펀딩(8시간): ' + fund.value.map(f => (f.fundingRate * 100).toFixed(4) + '%').join(', '));
    if (ctx.status === 'fulfilled' && ctx.value[sym]) { const x = ctx.value[sym]; L.push(`하이퍼리퀴드 펀딩(1시간) ${(x.funding * 100).toFixed(4)}% · OI ${fusd(x.openInterest * x.markPx)} · 프리미엄 ${x.premium != null ? (x.premium * 100).toFixed(4) + '%' : '-'}`); }
    return L.join('\n');
  }
  async function whaleText(sym) {
    if (!U.whaleSnapshot) return '고래 데이터 없음';
    try {
      const w = await U.whaleSnapshot(TA.hlCoin(sym));
      if (!w.nLong && !w.nShort) return `하이퍼리퀴드 이번 달 수익 상위 ${w.traders}명 중 이 종목 포지션 없음`;
      const L = [`하이퍼리퀴드 이번 달 수익 상위 ${w.traders}명: 롱 ${w.nLong}명 ${fusd(w.longUsd)} (평균 진입 ${fp(w.avgEntryLong)}) · 숏 ${w.nShort}명 ${fusd(w.shortUsd)} (평균 진입 ${fp(w.avgEntryShort)})`];
      if (w.liq.length) L.push('큰 포지션 청산 가격: ' + w.liq.map(x => `${x.side} ${fp(x.liq)}(${fpct(x.distPct, 1)}, ${fusd(x.val)})`).join(', '));
      else L.push('청산 가격이 표시된 포지션 없음 (교차 마진)');
      const near = (w.liqMap || []).filter(b => Math.abs(b.pct) <= 15);
      if (near.length) L.push('청산 구간 맵 (현재가 ±15%, 2.5% 칸): ' + near.map(b => `${fpct(b.pct, 1)} ${fp(b.price)} ${b.pct > 0 ? '숏 청산' : '롱 청산'} ${fusd(b.pct > 0 ? b.short : b.long)}`).join(' · '));
      if (U.whaleVsRetail) { const wv = await U.whaleVsRetail(TA.hlCoin(sym)).catch(() => null); if (wv) L.push(wv); }
      (w.tracked || []).forEach(t => L.push(`추적 지갑 "${t.label}": ${t.pos.length ? t.pos.map(p => `${p.side > 0 ? '롱' : '숏'} ${fusd(p.val)} 진입 ${fp(p.entry)} 청산가 ${p.liq ? fp(p.liq) : '-'} 미실현 ${fusd(p.upnl)}`).join(', ') : '이 종목 포지션 없음'}${t.log.length ? ' · 최근 변화: ' + t.log.map(c => c.txt).join(', ') : ''}`));
      return L.join('\n');
    } catch (e) { return '고래 데이터를 불러오지 못했습니다: ' + e.message; }
  }

  // ---------- Claude에게 보낼 지시문 ----------
  const RULES = `[대시보드 자동 판독 계산 방식]
- 엘리엇: ATR 지그재그(15분 5배, 1시간 4배, 4시간·일봉 3배)로 고점·저점을 찾고 충격파(2파는 1파 시작점 아래로 안 감, 4파는 1파 고점과 안 겹침, 3파가 가장 짧지 않음)와 ABC 조정을 피보나치 비율로 점수화. 목표는 아직 닿지 않은 첫 비율(3파 1.618→2.618→4.236배, 5파 0.618→1→1.618배, C파 A의 1→1.618→2.618배, C파 목표 구간 A의 0.9~1.272배).
- ICT: 좌우 3봉 프랙탈 고점·저점, 종가 돌파 BOS(지속)·CHoCH(전환), 꼬리로 깨고 종가 복귀는 유동성 스윕, 안 채워진 3봉 갭 FVG, 구조를 깬 움직임 직전 반대색 봉은 오더블록, 레인지 50% 기준 프리미엄·디스카운트, OTE 62~79%.
- 와이코프: 최근 약 80봉 박스(저가 5%·고가 95% 분위), 이전 흐름으로 축적·분산, 최근 30봉의 스프링·업스러스트·SOS·SOW, 하락봉/상승봉 거래량 비교.
- 다이버전스: 프랙탈 저점(고점) 두 개의 가격과 RSI14 비교. 일반=반전 전조, 히든=추세 지속.`;

  function buildPrompt(sym, d) {
    const a = d.atrD, a15 = d.atr15;
    return `너는 "매매연구소" 대시보드의 리포트 작성자다. 데이트레이더를 위한 셋업 리포트를 **JSON 하나로만** 답한다. JSON 밖에는 아무것도 쓰지 않는다.

[사용자] 차트 분석 초보인 데이트레이더. 쉬운 한국어로 쓰고, 전문 용어는 처음 나올 때 괄호로 짧게 풀이한다.

[셋업 규칙 — 반드시 지킨다]
1. 방향은 "long"(롱 관점) 또는 "short"(숏 관점) 중 하나. 관망은 없다. 근거가 약하면 confidence(1~5)를 낮게 준다.
2. 봉 역할: 일봉 = 배경, 4시간·1시간 = 오늘의 방향, 15분 = 진입 타이밍과 손절. 봉끼리 충돌하면 큰 봉을 우선하고 충돌 사실을 적는다.
3. 진입 구간: 현재가 ${fp(d.price)}에서 24시간 안에 닿을 수 있는 거리(일봉 ATR ${fp(a)} 이내). 구간 폭은 15분 ATR(${fp(a15)})의 1~3배.
4. 목표는 1개. 진입 중앙에서 2일 변동폭(일봉 ATR × 2 = ${fp(2 * a)}) 이내이면서 근거 있는 가격(유동성, FVG, 오더블록, 파동 목표, 박스 경계, 청산 밀집 가격 등).
5. 손절: 15분·1시간 구조(직전 저점·고점, 스윕 저점, 오더블록 등) 바깥.
6. 손익비 = |목표 − 진입 중앙| ÷ |진입 중앙 − 손절| 이 반드시 ${MIN_RR}.0 이상. 안 나오면 진입 방식·목표·손절을 다시 검토해서 맞춘다. 진입만 유리한 쪽으로 미는 것은 체결 확률을 떨어뜨리므로, 그렇게 할 때는 그 가격에 24시간 안에 올 근거를 entryReason에 숫자로 적는다. 2:1이 나오는 근거 있는 셋업이 정말 없으면 confidence를 1로 둔다.
7. 이 리포트는 작성 시점부터 72시간 안에 채점된다. 24시간 안에 진입 구간에 안 닿으면 실패다.
8. 가격 숫자는 아래 데이터에 있는 값이나 그 값으로 계산한 값만 쓴다. 지어내지 않는다.
9. 매수·매도를 지시하는 말투("사세요") 대신 "롱 관점", "숏 관점"으로 쓴다.
10. 진입 방식은 네가 모든 데이터를 보고 가장 적중 확률이 높은 것을 고른다. 목표는 "이 리포트가 익절로 끝날 확률"을 최대로 하는 것이다. 희망이나 관점에 대한 확신을 섞지 말고 데이터로만 판단한다.
   - 되돌림형(pullback): 현재가보다 유리한 쪽(롱이면 아래, 숏이면 위)의 근거 있는 자리(ICT 구간, 피보나치, 박스 경계 등)에 지정가로 진입. 박스권·추세 약함·반대쪽 유동성 스윕이 먼저 나올 근거가 있을 때.
   - 돌파형(breakout): 현재가보다 불리한 쪽(롱이면 위, 숏이면 아래)의 확인 가격을 넘어서면 진입. 가격이 예측 방향으로 움직여야 체결되므로, 추세·수급·시장 상태가 한쪽으로 강할 때. 손절은 돌파한 구조의 반대편 바깥.
   - 즉시형(immediate): 현재가에서 15분 ATR(${fp(a15)}) 1배 이내 진입. 이미 근거 자리에 와 있고 바로 출발할 근거가 있을 때.
   - 반드시 알아 둘 것(역선택): 되돌림 지정가는 예측이 맞으면 가격이 바로 가 버려 체결이 안 되고, 예측이 틀릴 때 주로 체결된다. 아래 <지난 리포트 성적>에서 진입 방식별 체결률·익절률을 확인하고, 그 결과를 이번 선택의 근거로 쓴다.
   - 근거: 15분·1시간 모멘텀(연속 봉 방향, 거래량 배수), 지금 시장 상태, 봉 해석(신규 롱/숏, 청산, 스퀴즈), 선물·현물 CVD, OI 증감, 거래소별 시장가, 방향성 점수, 고래 움직임. entryReason에 왜 이 방식인지와 24시간 안에 진입가에 올 근거를 숫자로 적는다.
11. 아래 데이터(4개 봉 판독, 방향성 점수·점검표, 시장 수급 1시간·15분, 지금 시장 상태(가격×OI)·OI 급증 알림, 거래소별 시장가, 하이퍼리퀴드, 고래 vs 개인·스마트머니·고래 평단, 고래 청산가 지도, 고래 움직임 피드, 상위 트레이더 청산맵, 추적 지갑)를 모두 검토한다.
   - 지금 시장 상태가 "하락 추세 가속·롱이 들어오는데 못 오름", "포지션 쌓이는 중" 같은 상태면 진입 타점과 손절 위치에 반영한다 (털릴 쪽 청산 가격대 안쪽에 손절을 두지 않는다).
   - OI 급증 알림이 있으면 털릴 쪽 구간을 목표나 위험 요인에 반영한다.
   - 고래 청산가 지도에서 가까운 큰 청산 구간은 목표 후보(자석)나 손절 위험 구간으로 쓴다. 판단에 쓰지 않은 데이터나 데이터가 없던 항목은 dataNotes에 이유와 함께 적는다.
12. 진입·목표·손절이 각각 어떤 분석법·데이터 근거로 정해졌는지 basis에 적는다.

${RULES}

[관점 6개] elliott(엘리엇), ict(ICT), wyckoff(와이코프), divergence(다이버전스), flow(수급), whale(고래·청산맵). 각 관점은 자기 데이터만 근거로 판단한다. 데이터가 없으면 dir "flat"으로 두고 body에 데이터가 없다고 쓴다.

[출력 JSON 형식]
{
  "direction": "long 또는 short",
  "confidence": 1~5 정수,
  "title": "한 줄 전략, 15자 이내 (예: 저점 위 눌림 매수)",
  "context": "지금 상황 한 줄, 숫자 포함 (예: 최근 3일 79,700~84,300 범위 · 전일 81,300 → 지금 82,200)",
  "entryType": "pullback 또는 breakout 또는 immediate",
  "entryReason": "왜 되돌림형/즉시형인지, 진입가에 24시간 안에 올 근거 (숫자 포함 두세 문장)",
  "entry": { "low": 숫자, "high": 숫자 },
  "target": 숫자,
  "stop": 숫자,
  "basis": { "entry": "진입 구간 근거 (분석법·데이터)", "target": "목표 근거", "stop": "손절 근거" },
  "dataNotes": "판단에 쓰지 않았거나 없던 데이터와 이유 (모두 썼으면 '모두 반영')",
  "confluence": [ { "text": "진입 구간에 겹친 근거, 20자 이내", "view": "elliott|ict|wyckoff|divergence|flow|whale" } ],
  "invalidation": "이렇게 되면 틀린 판단이라는 한 문장",
  "risks": [ "위험 요인 1~3개" ],
  "timeframes": { "1d": { "dir": "up|down|flat", "line": "한 줄 판독" }, "4h": {...}, "1h": {...}, "15m": {...} },
  "views": [
    { "key": "elliott", "dir": "up|down|flat", "confidence": 1~5,
      "tf": { "1d": "한 줄", "4h": "한 줄", "1h": "한 줄", "15m": "한 줄" },
      "body": "이 관점의 근거 설명 3~6문장",
      "levels": [ { "label": "가격 이름", "price": 숫자 } ],
      "wrongIf": "이 관점이 틀리는 조건 한 문장",
      "lesson": "초보자가 오늘 이 관점에서 배울 점 한 줄" }
  ],
  "summary": { "agree": ["관점끼리 일치하는 점"], "conflict": ["충돌하는 점"], "base": "기본 시나리오", "alt": "대안 시나리오", "checkpoints": ["언제 무엇을 확인할지"] }
}
- confluence는 2~5개, views는 6개 모두 위 순서(elliott, ict, wyckoff, divergence, flow, whale)대로.

<데이터>
종목: ${TA.dispFull(sym)} · 작성 시각 ${fdt(d.created)} (이 기기 현지 시간)
현재가 ${fp(d.price)} · 일봉 ATR14 ${fp(a)} · 15분 ATR14 ${fp(a15)}

${d.tf.map(x => x.text).join('\n\n')}

## 대시보드 방향성 점수·점검표
${d.dash}

## 수급 (코인 선물 시장)
${d.flow}

## 고래·청산맵
${d.whale}
</데이터>

<지난 리포트 성적>
${d.track}
</지난 리포트 성적>`;
  }

  // 진입 방식: 최종 진입가가 현재가 기준 어느 쪽인지로 정합니다 (롱: 아래 = 되돌림, 위 = 돌파 / 숏은 반대).
  function entryTypeOf(rep) {
    const p = rep.plan, dir = p.direction === 'long' ? 1 : -1, near = rep.atr15 ? rep.atr15 : rep.price * 0.0015;
    const off = (p.entry - rep.price) * dir; // 음수 = 유리한 쪽(되돌림), 양수 = 불리한 쪽(돌파)
    return Math.abs(p.entry - rep.price) <= near ? 'immediate' : off < 0 ? 'pullback' : 'breakout';
  }
  const TYPE_NAME = { pullback: '되돌림형', breakout: '돌파형', immediate: '즉시형' };
  // 지난 리포트 성적: Claude가 진입 방식을 고를 때 근거로 씁니다.
  function trackText() {
    const reps = R.list.map(it => R.reports[it.id]).filter(r => r && r.result && ['win', 'loss', 'noentry', 'timeout'].includes(r.result.status));
    if (!reps.length) return '아직 결과가 난 리포트 없음';
    const L = [`결과가 난 리포트 ${reps.length}개 (진입 방식은 최종 진입가가 현재가 기준 어느 쪽이었는지로 분류)`];
    ['pullback', 'breakout', 'immediate'].forEach(k => {
      const g = reps.filter(r => entryTypeOf(r) === k); if (!g.length) { L.push(`- ${TYPE_NAME[k]}: 아직 없음`); return; }
      const ent = g.filter(r => r.result.status !== 'noentry'), w = ent.filter(r => r.result.status === 'win').length, ne = g.filter(r => r.result.status === 'noentry');
      const neRight = ne.filter(r => r.result.dirHit).length, sumR = g.reduce((t, r) => t + (r.result.r || 0), 0);
      L.push(`- ${TYPE_NAME[k]}: ${g.length}개 · 체결 ${ent.length}개(${Math.round(ent.length / g.length * 100)}%) · 체결 후 익절 ${w}/${ent.length} · 손절 ${ent.filter(r => r.result.status === 'loss').length} · 진입 실패 ${ne.length}개 중 72시간 뒤 방향이 맞았던 것 ${neRight}개 · 합계 ${sumR.toFixed(2)}R`);
    });
    ['long', 'short'].forEach(s => { const g = reps.filter(r => r.plan.direction === s); if (g.length) L.push(`- ${s === 'long' ? '롱' : '숏'} 관점 ${g.length}개 · 익절 ${g.filter(r => r.result.status === 'win').length} · 72시간 방향 적중 ${g.filter(r => r.result.dirHit).length}/${g.filter(r => r.result.dirHit != null).length}`); });
    // 사후 검증(리테스트) 결과: 관점별 맞음/틀림과 최근 교훈
    const rv = reps.filter(r => r.review);
    if (rv.length) {
      L.push(`사후 검증된 리포트 ${rv.length}개 · 관점별 판단 (맞음/틀림): ` + VIEWS.map(([k, nm]) => { const g = rv.map(r => r.review.views && r.review.views[k] && r.review.views[k].result); return `${nm} ${g.filter(x => x === '맞음').length}/${g.filter(x => x === '틀림').length}`; }).join(', '));
      L.push('최근 사후 검증 교훈 (다음 판단에 반드시 반영):');
      rv.slice(0, 10).forEach(r => { if (r.review.lesson) L.push(`- ${fdt(r.created)} ${TA.disp(r.sym)} ${r.plan.direction === 'long' ? '롱' : '숏'} → ${r.review.lesson}`); });
    }
    L.push('최근 12개:');
    reps.slice(0, 12).forEach(r => L.push(`- ${fdt(r.created)} ${TA.disp(r.sym)} ${r.plan.direction === 'long' ? '롱' : '숏'} ${TYPE_NAME[entryTypeOf(r)]} 손익비 ${r.plan.rr.toFixed(2)} → ${({ win: '익절', loss: '손절', noentry: '진입 실패', timeout: '시간 만료' })[r.result.status]}${r.result.dirHit != null ? ` (72시간 방향 ${r.result.dirHit ? '맞음' : '틀림'})` : ''}`));
    return L.join('\n');
  }

  // ---------- Claude 호출 (start-local.bat 서버 → 이 PC의 Claude Code) ----------
  async function askClaude(prompt, onProgress) {
    const ctrl = new AbortController(); R.abort = ctrl;
    const ERR = '\u0001ERR:';
    const r = await fetch('api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dashboard': '1' }, body: JSON.stringify({ prompt }), signal: ctrl.signal });
    if (!r.ok || !r.body) throw new Error('로컬 서버 응답 오류 ' + r.status);
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = '';
    for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); onProgress(buf.length); }
    buf += dec.decode();
    const k = buf.indexOf(ERR);
    if (k >= 0) {
      const why = buf.slice(k + ERR.length).trim();
      throw new Error(why === 'NOT_FOUND' ? '이 PC에서 Claude Code를 찾지 못했습니다.' : /log ?in|logged|auth|401/i.test(why) ? 'Claude Code 로그인이 필요합니다. 차트 분석 탭의 "분석법 질문하기 → 연결 설정"에서 로그인해 주세요.' : /limit|usage|quota|429/i.test(why) ? 'Claude 플랜의 사용 한도에 도달했습니다. 한도가 초기화된 뒤 다시 시도해 주세요.' : '답을 받지 못했습니다: ' + why);
    }
    return buf;
  }
  function parseJson(text) {
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('Claude 답에서 리포트 내용을 찾지 못했습니다');
    return JSON.parse(text.slice(a, b + 1));
  }

  // ---------- 규칙 점검: 손익비 2:1, 진입·목표 거리 ----------
  function finalize(c, d) {
    const dir = c.direction === 'short' ? -1 : 1, notes = [];
    let lo = Math.min(+c.entry.low, +c.entry.high), hi = Math.max(+c.entry.low, +c.entry.high);
    const target = +c.target, stop = +c.stop;
    if (![lo, hi, target, stop].every(isFinite)) throw new Error('리포트 가격이 숫자가 아닙니다');
    let mid = (lo + hi) / 2;
    if (dir * (target - mid) <= 0 || dir * (mid - stop) <= 0) throw new Error(`${dir > 0 ? '롱' : '숏'} 관점인데 목표·손절 위치가 반대입니다`);
    let rr = dir * (target - mid) / (dir * (mid - stop));
    if (rr < MIN_RR - 1e-9) {
      const m2 = (target + MIN_RR * stop) / (1 + MIN_RR), shift = m2 - mid;
      lo += shift; hi += shift; mid = m2; rr = MIN_RR;
      notes.push(`손익비를 ${MIN_RR}:1로 맞추려고 진입 구간을 ${fp(Math.abs(shift))} ${dir > 0 ? '낮췄' : '높였'}습니다.`);
    }
    const room = Math.abs(mid - stop) * 0.4; // 진입 구간이 손절선에 너무 붙지 않게
    if ((hi - lo) / 2 > room) { lo = mid - room; hi = mid + room; }
    if (Math.abs(mid - d.price) > d.atrD) notes.push(`진입 구간이 현재가에서 하루 평균 변동폭(${fp(d.atrD)})보다 멀어 24시간 안에 닿지 않을 수 있습니다.`);
    if (Math.abs(target - mid) > 2 * d.atrD) notes.push(`목표가 이틀 평균 변동폭(${fp(2 * d.atrD)})보다 멀어 72시간 안에 닿기 어려울 수 있습니다.`);
    return { direction: dir > 0 ? 'long' : 'short', confidence: Math.max(1, Math.min(5, Math.round(+c.confidence || 1))), entryLow: lo, entryHigh: hi, entry: mid, target, stop, rr, notes };
  }

  // ---------- 리포트 만들기 ----------
  const setStatus = (t, cls) => { const s = $('#repStatus'); s.textContent = t; s.className = 'muted ' + (cls || ''); };
  async function generate() {
    if (R.busy) { if (R.abort) R.abort.abort(); return; }
    if (!R.local) { setStatus('리포트 작성은 내 컴퓨터 대시보드(start-local.bat, http://localhost:8765)에서만 할 수 있습니다.', 'down'); return; }
    const sym = R.sym;
    R.busy = true; window.TA_chatBusy = true; $('#repGo').textContent = '작성 중지';
    try {
      setStatus('봉 4개와 수급·고래 데이터를 모으는 중…');
      const series = await Promise.all(TFS.map(tf => loadTf(sym, tf)));
      const tf = series.map((s, i) => tfText(s, TFS[i]));
      const s15 = series[3], d1 = series[0];
      const created = Math.floor(Date.now() / 1000);
      const [flow, whale, dash] = await Promise.all([flowText(sym).catch(e => '수급 데이터 오류: ' + e.message), whaleText(sym), dashText(sym).catch(e => '방향성 데이터 오류: ' + e.message)]);
      const d = { created, price: s15.c[s15.c.length - 1], atrD: lastOf(TA.atr(d1.h, d1.l, d1.c, 14)), atr15: lastOf(TA.atr(s15.h, s15.l, s15.c, 14)), tf, flow, whale, dash, track: trackText() };
      // 리포트에 어떤 데이터가 들어갔는지 기록 (화면의 "반영한 데이터")
      const has = (t, bad) => !!t && !bad.some(b => t.includes(b));
      const coverage = [
        ['차트 판독 4개 봉 (엘리엇·ICT·와이코프·다이버전스·종합)', true],
        ['방향성 점수', has(dash, ['계산 실패'])], ['방향성 점검표 (시장 기준·기초지수)', /점검표/.test(dash)],
        ['시장 수급 1시간·15분 (OI·선물/현물 CVD·코인베이스 프리미엄·펀딩·롱 비중·봉 해석)', /\[시장 수급\]/.test(flow)],
        ['지금 시장 상태 (가격 × OI) · OI 급증 알림', /\[지금 시장 상태\]/.test(flow)],
        ['거래소별 시장가 순매수', /\[거래소별 시장가 순매수\] [^\n]*\n/.test(flow) && !/모인 기록 없음/.test(flow)],
        ['하이퍼리퀴드 펀딩·OI', /하이퍼리퀴드/.test(flow)],
        ['고래 · 상위 트레이더 포지션', has(whale, ['고래 데이터 없음', '불러오지 못했습니다'])], ['청산 구간 맵 (상위 트레이더)', /청산 구간 맵/.test(whale)], ['추적 지갑', /추적 지갑/.test(whale)],
        ['고래 vs 개인 · 스마트머니 · 고래 평단 (513계정 스캔)', /\[고래 vs 개인\]/.test(whale)], ['고래 청산가 지도 (513계정 스캔)', /\[고래 청산가 지도\]/.test(whale)], ['고래 움직임 피드', /고래 움직임:/.test(whale)]
      ];
      const t0 = Date.now();
      const text = await askClaude(buildPrompt(sym, d), n => setStatus(`Claude가 6개 관점을 분석해서 쓰는 중… ${Math.round((Date.now() - t0) / 1000)}초 · ${n.toLocaleString()}자`));
      const c = parseJson(text);
      const plan = finalize(c, d);
      const dt = new Date(created * 1000), pad = v => String(v).padStart(2, '0');
      const id = `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}-${pad(dt.getHours())}${pad(dt.getMinutes())}${pad(dt.getSeconds())}-${TA.disp(sym).replace(/[^A-Za-z0-9]/g, '')}`;
      // 차트 분석 탭 "예상 투자 결과"와 같은 계산으로, 이 셋업이 과거 비슷한 상황에서 어땠는지
      let odds = null;
      try {
        const ctx = await contextFor(sym), side = plan.direction === 'long' ? 1 : -1;
        const r = TA.planEval(s15, ctx, { side, entry: plan.entry, tp: Math.abs(plan.target / plan.entry - 1) * 100, sl: Math.abs(plan.stop / plan.entry - 1) * 100, holdHours: 72, amt: 0, lev: 1 });
        odds = { fillRate: r.st.fillRate, winRate: r.st.winRate, win: r.st.win, sl: r.st.sl, timeout: r.st.timeout, filled: r.st.filled, tier: r.tier };
      } catch (e) {}
      const rep = { id, sym, created, price: d.price, atrD: d.atrD, atr15: d.atr15, plan, claude: c, odds, coverage, result: null, v: 3 };
      plan.entryTypeClaimed = c.entryType; plan.entryType = entryTypeOf(rep);
      await saveReport(rep);
      R.reports[id] = rep; R.cur = id;
      await loadList(); renderList(); render();
      await scoreAll(); renderList(); render(); renderScore();
      setStatus(`작성 완료 · ${Math.round((Date.now() - t0) / 1000)}초`, 'up');
    } catch (e) {
      setStatus(e.name === 'AbortError' ? '작성을 중지했습니다.' : '리포트를 만들지 못했습니다: ' + e.message, e.name === 'AbortError' ? '' : 'down');
    } finally { R.busy = false; R.abort = null; window.TA_chatBusy = false; $('#repGo').textContent = 'Claude 리포트 작성'; }
  }
  async function saveReport(rep) {
    const r = await fetch('api/report/save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dashboard': '1' }, body: JSON.stringify(rep) });
    if (!r.ok) throw new Error('리포트 저장 실패 (' + r.status + '). 서버를 다시 켜 주세요.');
  }

  // ---------- 채점 (15분봉, 작성 시점부터 72시간) ----------
  async function evaluate(rep) {
    if (rep.result && rep.result.final) return rep.result;
    const now = Date.now() / 1000, t0 = rep.created, p = rep.plan, dir = p.direction === 'long' ? 1 : -1;
    const end = Math.min(now, t0 + RESULT_HOURS * H);
    const coin = TA.hlCoin(rep.sym);
    const rows = await TA.hl({ type: 'candleSnapshot', req: { coin, interval: '15m', startTime: Math.floor(t0 / 900) * 900 * 1000, endTime: Math.floor(end * 1000) } });
    const start = Math.ceil(t0 / 900) * 900;
    const bars = rows.map(k => ({ t: k.t / 1000, h: +k.h, l: +k.l, c: +k.c })).filter(b => b.t >= start && b.t < t0 + RESULT_HOURS * H);
    const risk = Math.abs(p.entry - p.stop);
    let entered = null, outcome = null;
    for (const b of bars) {
      const hitS = dir > 0 ? b.l <= p.stop : b.h >= p.stop, hitT = dir > 0 ? b.h >= p.target : b.l <= p.target;
      if (!entered) {
        if (b.t >= t0 + ENTRY_HOURS * H) break;
        if (b.l <= p.entry && b.h >= p.entry) { entered = b.t; if (hitS) { outcome = { status: 'loss', at: b.t }; break; } }
        continue;
      }
      if (hitS) { outcome = { status: 'loss', at: b.t }; break; } // 같은 봉에서 둘 다 닿으면 손절로
      if (hitT) { outcome = { status: 'win', at: b.t }; break; }
    }
    const last = bars[bars.length - 1], done72 = now >= t0 + RESULT_HOURS * H;
    let status, rMult = null;
    if (outcome) { status = outcome.status; rMult = status === 'win' ? p.rr : -1; }
    else if (!entered) { status = now >= t0 + ENTRY_HOURS * H ? 'noentry' : 'waiting'; rMult = status === 'noentry' ? 0 : null; }
    else if (done72) { status = 'timeout'; rMult = last ? dir * (last.c - p.entry) / risk : 0; }
    else { status = 'open'; rMult = last ? dir * (last.c - p.entry) / risk : 0; }
    const res = { status, r: rMult, entered, at: outcome ? outcome.at : null, last: last ? last.c : null, final: done72, checked: Math.floor(now) };
    if (done72 && last) {
      res.price72 = last.c; res.move = Math.sign(last.c - rep.price);
      res.dirHit = dir * (last.c - rep.price) > 0;
      res.views = Object.fromEntries((rep.claude.views || []).map(v => [v.key, v.dir === 'flat' ? null : (v.dir === 'up' ? 1 : -1) === res.move]));
    }
    return res;
  }
  U.reportEvaluate = evaluate; // 확인용
  // 매매 테스트 탭이 같은 데이터 수집·Claude 호출을 씁니다.
  U.repTools = { loadTf, tfText, flowText, whaleText, dashText, trackText, askClaude, parseJson, RULES, TFS, TF_LABEL };
  const STATUS = {
    waiting: ['warn', '진입 대기'], open: ['warn', '진입 · 진행 중'], win: ['good', '성공'], loss: ['bad', '손절 실패'],
    noentry: ['bad', '진입 실패'], timeout: ['flat', '시간 만료']
  };
  const fr = v => v == null ? '' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + 'R';
  const statusChip = res => { if (!res) return chip('flat', '채점 전'); const [c, t] = STATUS[res.status]; return chip(c, t + (res.r != null && res.status !== 'waiting' ? ' ' + fr(res.r) : '')); };
  async function scoreAll() {
    await Promise.all(R.list.map(async it => {
      const rep = await getReport(it.id).catch(() => null); if (!rep) return;
      if (rep.result && rep.result.final) return;
      try {
        const res = await evaluate(rep);
        rep.result = res;
        if (res.final && R.local) await saveReport(rep).catch(() => {});
      } catch (e) {}
    }));
  }

  // ---------- 사후 검증 (리테스트): 72시간이 끝난 리포트의 판단을 실제 가격 흐름에 다시 대 봅니다 ----------
  async function retestData(rep) {
    const t0 = rep.created, end = t0 + RESULT_HOURS * H, coin = TA.hlCoin(rep.sym), p = rep.plan, c = rep.claude;
    const [m15, h1] = await Promise.all([
      TA.hl({ type: 'candleSnapshot', req: { coin, interval: '15m', startTime: Math.floor(t0 / 900) * 900 * 1000, endTime: end * 1000 } }),
      TA.hl({ type: 'candleSnapshot', req: { coin, interval: '1h', startTime: Math.floor(t0 / 3600) * 3600 * 1000, endTime: end * 1000 } })]);
    const bars = m15.map(k => ({ t: k.t / 1000, h: +k.h, l: +k.l, c: +k.c })).filter(b => b.t >= Math.ceil(t0 / 900) * 900 && b.t < end);
    if (!bars.length) throw new Error('작성 이후 가격 데이터 없음');
    // 리포트에 나온 가격마다 언제 처음 닿았는지
    const levels = [['진입 상단', p.entryHigh], ['진입 하단', p.entryLow], ['진입 중앙', p.entry], ['목표', p.target], ['손절', p.stop]];
    (c.views || []).forEach(v => (v.levels || []).forEach(l => { if (isFinite(+l.price)) levels.push([`${VIEW_NAME[v.key] || v.key} · ${l.label}`, +l.price]); }));
    const touch = price => { const b = bars.find(x => x.l <= price && x.h >= price); return b ? fdt(b.t) + ` (${((b.t - t0) / H).toFixed(1)}시간 뒤)` : '72시간 동안 안 닿음'; };
    let hi = -Infinity, lo = Infinity, hiT = 0, loT = 0; bars.forEach(b => { if (b.h > hi) { hi = b.h; hiT = b.t; } if (b.l < lo) { lo = b.l; loT = b.t; } });
    const at = h => { const x = bars.filter(b => b.t < t0 + h * H); return x.length ? x[x.length - 1].c : null; };
    const path = h1.filter(k => k.t / 1000 < end).map(k => `${fdt(k.t / 1000)} ${fp(+k.o)}/${fp(+k.h)}/${fp(+k.l)}/${fp(+k.c)}`).join('\n');
    const r = rep.result || {};
    return `작성 ${fdt(t0)} 가격 ${fp(rep.price)} → 4시간 뒤 ${fp(at(4))} · 24시간 뒤 ${fp(at(24))} · 72시간 뒤 ${fp(at(72))}
72시간 최고 ${fp(hi)} (${fdt(hiT)}) · 최저 ${fp(lo)} (${fdt(loT)})
채점 결과: ${({ win: '익절', loss: '손절', noentry: '진입 실패', timeout: '시간 만료' })[r.status] || r.status}${r.entered ? ` · 진입 ${fdt(r.entered)}` : ''}${r.at ? ` · ${r.status === 'win' ? '익절' : '손절'} ${fdt(r.at)}` : ''} · ${r.r != null ? r.r.toFixed(2) + 'R' : ''} · 72시간 방향 ${r.dirHit == null ? '-' : r.dirHit ? '맞음' : '틀림'}
리포트에 나온 가격이 처음 닿은 시각:
${levels.map(([n, v]) => `- ${n} ${fp(v)}: ${touch(v)}`).join('\n')}
작성 후 1시간봉 (시각 시/고/저/종):
${path}`;
  }
  async function retest(rep) {
    const c = rep.claude, p = rep.plan;
    const orig = JSON.stringify({ direction: p.direction, confidence: p.confidence, entry: [p.entryLow, p.entryHigh], target: p.target, stop: p.stop, rr: +p.rr.toFixed(2), entryType: p.entryType, entryTypeClaimed: p.entryTypeClaimed, entryReason: c.entryReason, basis: c.basis, title: c.title, confluence: c.confluence, invalidation: c.invalidation, risks: c.risks, timeframes: c.timeframes,
      views: (c.views || []).map(v => ({ key: v.key, dir: v.dir, confidence: v.confidence, levels: v.levels, wrongIf: v.wrongIf, body: v.body })), summary: c.summary });
    const prompt = `너는 "매매연구소" 리포트의 사후 검증 담당이다. 72시간이 끝난 리포트를 실제 가격 흐름과 하나씩 대조해서, 각 판단이 왜 맞았고 왜 틀렸는지 다시 검증(리테스트)한다. **JSON 하나로만** 답한다.
- 결과만 보고 끼워 맞추지 말고, 작성 시점에 알 수 있었던 근거와 실제로 일어난 가격 순서를 비교한다.
- 맞았어도 근거가 틀렸으면(우연히 맞음) 그렇게 쓴다. 틀렸어도 근거는 맞았는데 시장이 다른 이유로 움직였으면 그렇게 쓴다.
- 가격·시각은 아래 데이터에 있는 값만 쓴다. 쉬운 한국어로 쓴다.

[출력 JSON 형식]
{ "verdict": "한 줄 총평",
  "directionCheck": "방향 판단이 맞았는지와 이유",
  "entryCheck": "진입 방식(되돌림/돌파/즉시)과 진입 가격 선택이 맞았는지, 실제로 가격이 어떤 순서로 움직였는지",
  "stopCheck": "손절 위치가 적절했는지 (너무 가까웠나, 구조 안쪽이었나)",
  "targetCheck": "목표가가 적절했는지 (너무 멀었나, 더 가까운 근거가 있었나)",
  "views": { "elliott": { "result": "맞음|틀림|판단불가", "why": "한두 문장" }, "ict": {...}, "wyckoff": {...}, "divergence": {...}, "flow": {...}, "whale": {...} },
  "luck": "결과에 운이 크게 작용했는지 (예: 근거는 틀렸는데 우연히 맞음)",
  "missed": ["작성 때 데이터에 있었는데 놓친 신호"],
  "lesson": "다음 리포트에 쓸 교훈 한 줄 (구체적으로)" }

<원래 리포트>
${orig}
</원래 리포트>

<실제로 일어난 일>
${await retestData(rep)}
</실제로 일어난 일>`;
    return parseJson(await askClaude(prompt, () => {}));
  }
  let reviewing = false;
  // 내 컴퓨터 대시보드에서 72시간이 끝났는데 사후 검증이 없는 리포트를 하나씩 검증합니다.
  // 이 기능을 넣기 전 리포트(v3 미만)는 자동으로 하지 않고, "지난 리포트 모두 검증" 버튼으로만 합니다.
  async function reviewWork(all) {
    if (!R.local || reviewing || R.busy) return;
    reviewing = true;
    try {
      const todo = R.list.map(it => R.reports[it.id]).filter(r => r && r.result && r.result.final && !r.review && (r.reviewErr || 0) < 2 && (all || (r.v || 1) >= 3));
      for (let i = 0; i < todo.length; i++) {
        if (R.busy) break;
        const rep = todo[i];
        window.TA_chatBusy = true;
        $('#repRevStatus') && ($('#repRevStatus').textContent = `${TA.disp(rep.sym)} ${fdt(rep.created)} 리포트를 사후 검증하는 중… (${i + 1}/${todo.length})`);
        try { rep.review = await retest(rep); rep.review.at = Math.floor(Date.now() / 1000); delete rep.reviewErr; }
        catch (e) { rep.reviewErr = (rep.reviewErr || 0) + 1; rep.reviewLastErr = e.message; }
        await saveReport(rep).catch(() => {});
        if (R.cur === rep.id) render(); renderScore();
      }
    } finally { reviewing = false; window.TA_chatBusy = false; $('#repRevStatus') && ($('#repRevStatus').textContent = ''); }
  }

  // ---------- 기록 불러오기 ----------
  async function loadList() {
    try {
      const r = await fetch('reports/index.json?v=' + Date.now(), { cache: 'no-store' });
      R.list = r.ok ? (await r.json()).reports || [] : [];
    } catch (e) { R.list = []; }
  }
  async function getReport(id) {
    if (R.reports[id]) return R.reports[id];
    const r = await fetch(`reports/${id}.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('리포트 파일 없음');
    return (R.reports[id] = await r.json());
  }

  // ---------- 화면: 기록 목록 ----------
  function renderList() {
    const box = $('#repList'); box.textContent = '';
    box.append(el('div', { class: 'ph' }, el('h2', { text: '리포트 기록' }), el('small', { text: `${R.list.length}개` })));
    if (!R.list.length) { box.append(el('p', { class: 'note pb', text: '아직 리포트가 없습니다. 종목을 고르고 "Claude 리포트 작성"을 눌러 보세요.' })); return; }
    const ul = el('div', { class: 'rep-items' });
    R.list.forEach(it => {
      const rep = R.reports[it.id], p = rep ? rep.plan : { direction: it.direction };
      ul.append(el('button', { type: 'button', class: 'rep-item', 'aria-pressed': String(it.id === R.cur), onclick: () => { R.cur = it.id; render(); renderList(); } },
        el('span', { class: 'm', text: fdt(it.created) }), el('b', { text: TA.disp(it.sym) }),
        chip(p.direction === 'long' ? 'good' : 'bad', p.direction === 'long' ? '롱' : '숏'),
        statusChip(rep && rep.result)));
    });
    box.append(ul);
  }

  // ---------- 화면: 리포트 본문 ----------
  function stars(n) { n = Math.max(0, Math.min(5, n | 0)); return '★'.repeat(n) + '☆'.repeat(5 - n); }
  function ladder(rep) {
    const p = rep.plan, cur = rep.result && rep.result.last != null ? rep.result.last : rep.price;
    const pts = [p.target, p.entryHigh, p.entryLow, p.stop, rep.price, cur];
    let max = Math.max(...pts), min = Math.min(...pts); const pad = (max - min) * 0.08; max += pad; min -= pad;
    const y = v => ((max - v) / (max - min) * 100).toFixed(2) + '%';
    const long = p.direction === 'long';
    const pct = v => fpct((v / p.entry - 1) * 100, 1);
    const row = (v, cls, label, sub) => el('div', { class: 'lad-l ' + cls, style: `top:${y(v)}` }, el('span', { class: 'lad-k', text: label + (sub ? ' · ' + sub : '') }), el('b', { text: fp(v) }));
    return el('div', { class: 'ladder' },
      el('div', { class: 'lad-bar' },
        el('div', { class: 'lad-zone', style: `top:${y(p.entryHigh)};height:calc(${y(p.entryLow)} - ${y(p.entryHigh)})` }),
        el('div', { class: 'lad-line t', style: `top:${y(p.target)}` }), el('div', { class: 'lad-line s', style: `top:${y(p.stop)}` }),
        el('div', { class: 'lad-dot', style: `top:${y(cur)}`, title: '현재가' })),
      el('div', { class: 'lad-labels' },
        row(p.target, 't', '목표', pct(p.target)),
        row(long ? p.entryHigh : p.entryLow, 'e', '진입 구간', `${fp(p.entryLow)}~${fp(p.entryHigh)}`),
        row(p.stop, 's', '손절', pct(p.stop))),
      el('div', { class: 'lad-cur', style: `top:${y(cur)}` }, el('span', { class: 'lad-k', text: rep.result && rep.result.last != null ? '지금' : '작성 시' }), el('b', { text: fp(cur) })));
  }
  function render() {
    R.charts.forEach(c => { try { c.remove(); } catch (e) {} }); R.charts = [];
    const box = $('#repView'); box.textContent = '';
    const rep = R.cur && R.reports[R.cur];
    if (!rep) {
      box.append(el('section', { class: 'panel pb' }, el('p', { class: 'note', text: R.list.length ? '왼쪽 기록에서 리포트를 고르세요.' : '종목을 고르고 "Claude 리포트 작성"을 누르면 여기에 리포트가 나옵니다. 1~3분 걸립니다.' })));
      return;
    }
    const c = rep.claude, p = rep.plan, long = p.direction === 'long';
    // 요약 카드
    const card = el('section', { class: 'panel rep-card' });
    card.append(el('div', { class: 'rep-top' }, el('span', { class: 'm', text: `${TA.dispFull(rep.sym)} · 기준 15분 · ${fdt(rep.created)}` }), statusChip(rep.result)));
    card.append(el('div', { class: 'rep-title' }, el('span', { class: 'rep-badge ' + (long ? 'up' : 'down'), text: long ? '▲ 롱 관점' : '▼ 숏 관점' }), el('h2', { text: c.title || '' })));
    card.append(el('p', { class: 'rep-ctx', text: c.context || '' }));
    const right = el('div', { class: 'rep-right' },
      el('div', { class: 'rep-k', text: '손익비' }), el('div', { class: 'rep-rr m', text: `${p.rr.toFixed(1)} : 1` }),
      el('div', { class: 'rep-sub', text: `진입 중앙 ${fp(p.entry)} 기준 · ${fpct((p.target / p.entry - 1) * 100, 2)} / ${fpct((p.stop / p.entry - 1) * 100, 2)} · 확신도 ${stars(p.confidence)}` }),
      el('div', { class: 'rep-k', text: `진입 구간에 겹친 근거 ${(c.confluence || []).length}가지` }),
      el('ol', { class: 'rep-conf' }, (c.confluence || []).map(x => el('li', null, el('span', { text: x.text }), x.view ? chip('flat', VIEW_NAME[x.view] || x.view) : null))),
      el('div', { class: 'rep-k down', text: '이렇게 되면 틀린 판단' }), el('p', { class: 'rep-inv', text: c.invalidation || '' }));
    card.append(el('div', { class: 'rep-body' }, ladder(rep), right));
    // 진입 타점 판단과 근거 (v2 리포트부터)
    if (c.entryType || c.basis) {
      const et = rep.plan.entryType || entryTypeOf(rep), etLabel = { pullback: '되돌림형 · 유리한 자리에서 지정가', breakout: '돌파형 · 확인 가격을 넘으면 진입', immediate: '즉시형 · 현재가 근처 진입' }[et];
      const kv = el('dl', { class: 'kv' });
      if (c.entryReason) kv.append(el('dt', { text: '판단 근거' }), el('dd', { style: 'font-family:var(--sans)', text: c.entryReason }));
      [['진입 근거', 'entry'], ['목표 근거', 'target'], ['손절 근거', 'stop']].forEach(([a, k]) => { if (c.basis && c.basis[k]) kv.append(el('dt', { text: a }), el('dd', { style: 'font-family:var(--sans)', text: c.basis[k] })); });
      card.append(el('div', { class: 'tt-block' }, el('h3', null, '진입 타점 판단', chip(et === 'pullback' ? 'flat' : 'warn', etLabel)), kv));
    }
    if (rep.odds) {
      const o = rep.odds;
      card.append(el('p', { class: 'note' }, el('b', { text: '대시보드 예상 ' }), `과거 비슷한 상황(${o.tier})에서 72시간 안에 이 진입가 체결 ${(o.fillRate * 100).toFixed(0)}%, 체결된 ${o.filled}번 중 목표 먼저 ${o.win}번 (${(o.winRate * 100).toFixed(0)}%) · 손절 먼저 ${o.sl}번 · 미결 ${o.timeout}번`));
    }
    if (rep.coverage) {
      card.append(el('details', { class: 'rep-cov' }, el('summary', { text: `반영한 데이터 ${rep.coverage.filter(x => x[1]).length}/${rep.coverage.length}` }),
        el('ul', { class: 'vlist' }, rep.coverage.map(([n, ok]) => el('li', { class: ok ? 'good' : 'bad', text: `${n}${ok ? '' : ' — 없음'}` }))),
        c.dataNotes ? el('p', { class: 'note', text: 'Claude 메모: ' + c.dataNotes }) : null));
    }
    card.append(el('div', { class: 'rep-lights' }, (c.views || []).map(v => { const [cls, t] = DIR_CHIP[v.dir] || DIR_CHIP.flat; return el('span', { class: 'rep-light' }, el('span', { class: 'muted', text: VIEW_NAME[v.key] || v.key }), chip(cls, t.split(' ')[0])); })));
    if ((c.risks || []).length) card.append(el('div', { class: 'rep-risk' }, el('b', { text: '⚠ 위험' }), el('ul', null, c.risks.map(x => el('li', { text: x })))));
    if (p.notes.length) card.append(el('ul', { class: 'rep-notes' }, p.notes.map(x => el('li', { text: x }))));
    if (rep.result) card.append(resultBox(rep));
    card.append(el('p', { class: 'note rep-disc', text: `진입 유효 ${ENTRY_HOURS}시간 · 결과 확인 ${RESULT_HOURS}시간 · 리포트는 Claude가 대시보드 판독과 수급·고래 데이터로 쓴 분석이며 투자 자문이 아닙니다. 투자 판단과 책임은 본인에게 있습니다.` }));
    box.append(card);

    // 봉별 차트 4개
    const charts = el('section', { class: 'panel' }, el('div', { class: 'ph' }, el('h2', { text: '봉별 차트' }), el('small', { text: '큰 봉부터 · 선: 진입 구간 · 목표 · 손절 · ◆ 리포트 작성 시점' })));
    const grid = el('div', { class: 'rep-charts' });
    TFS.forEach(tf => {
      const t = (c.timeframes || {})[tf] || {}, [cls, txt] = DIR_CHIP[t.dir] || DIR_CHIP.flat;
      const cbox = el('div', { class: 'rep-chart' });
      grid.append(el('div', { class: 'rep-cell' }, el('div', { class: 'rep-ch' }, el('b', { text: `${TF_LABEL[tf]} · ${TF_ROLE[tf]}` }), chip(cls, txt)), cbox, el('p', { class: 'rep-line', text: t.line || '' })));
      drawMini(cbox, rep, tf);
    });
    charts.append(grid); box.append(charts);

    // 관점별 상세 6개
    const vs = el('section', { class: 'panel' }, el('div', { class: 'ph' }, el('h2', { text: '관점별 분석' }), el('small', { text: '6개 관점 · Claude 작성' })));
    const vgrid = el('div', { class: 'rep-views' });
    VIEWS.forEach(([key, name]) => {
      const v = (c.views || []).find(x => x.key === key); if (!v) return;
      const [cls, txt] = DIR_CHIP[v.dir] || DIR_CHIP.flat;
      const sec = el('article', { class: 'rep-view' }, el('h3', null, name, chip(cls, txt), el('span', { class: 'rep-stars', title: '확신도', text: stars(v.confidence) })));
      const tb = el('dl', { class: 'kv' }); TFS.forEach(tf => { if (v.tf && v.tf[tf]) tb.append(el('dt', { text: TF_LABEL[tf] }), el('dd', { style: 'font-family:var(--sans)', text: v.tf[tf] })); });
      sec.append(tb, el('p', { text: v.body || '' }));
      if ((v.levels || []).length) { const kv = el('dl', { class: 'kv' }); v.levels.forEach(l => kv.append(el('dt', { text: l.label }), el('dd', { text: fp(+l.price) }))); sec.append(kv); }
      if (v.wrongIf) sec.append(el('p', { class: 'rep-wrong' }, el('b', { text: '틀리는 조건 ' }), v.wrongIf));
      if (v.lesson) sec.append(el('p', { class: 'rep-lesson' }, el('b', { text: '오늘 배울 점 ' }), v.lesson));
      vgrid.append(sec);
    });
    vs.append(vgrid); box.append(vs);

    // 종합 의견
    const s = c.summary || {};
    const sum = el('section', { class: 'panel' }, el('div', { class: 'ph' }, el('h2', { text: '종합 의견' })));
    const list = (title, arr, cls) => (arr || []).length ? el('div', null, el('h3', { text: title }), el('ul', { class: 'vlist' }, arr.map(x => el('li', { class: cls, text: x })))) : null;
    sum.append(el('div', { class: 'pb rep-sum' },
      el('div', { class: 'cols' }, list('일치하는 점', s.agree, 'good'), list('충돌하는 점', s.conflict, 'warn')),
      s.base ? el('p', null, el('b', { text: '기본 시나리오 ' }), s.base) : null,
      s.alt ? el('p', null, el('b', { text: '대안 시나리오 ' }), s.alt) : null,
      list('체크포인트', s.checkpoints, '')));
    box.append(sum);

    // 사후 검증 (리테스트)
    const rvBox = el('section', { class: 'panel' }, el('div', { class: 'ph' }, el('h2', { text: '사후 검증 (리테스트)' }), el('small', { text: '72시간이 끝난 뒤 Claude가 각 판단을 실제 가격 흐름에 다시 대 보고 왜 맞았는지·틀렸는지 확인' })));
    const rv = rep.review;
    if (rv) {
      const kv = el('dl', { class: 'kv' });
      [['방향', rv.directionCheck], ['진입', rv.entryCheck], ['손절', rv.stopCheck], ['목표', rv.targetCheck], ['운', rv.luck]].forEach(([a, b]) => { if (b) kv.append(el('dt', { text: a }), el('dd', { style: 'font-family:var(--sans)', text: b })); });
      const vt = el('dl', { class: 'kv' });
      VIEWS.forEach(([k, nm]) => { const v = rv.views && rv.views[k]; if (!v) return; vt.append(el('dt', null, nm + ' ', chip(v.result === '맞음' ? 'good' : v.result === '틀림' ? 'bad' : 'flat', v.result)), el('dd', { style: 'font-family:var(--sans)', text: v.why || '' })); });
      rvBox.append(el('div', { class: 'pb rep-sum' }, el('p', null, el('b', { text: rv.verdict || '' })), kv, el('h3', { text: '관점별 검증' }), vt,
        (rv.missed || []).length ? el('div', null, el('h3', { text: '놓친 신호' }), el('ul', { class: 'vlist' }, rv.missed.map(x => el('li', { class: 'warn', text: x })))) : null,
        rv.lesson ? el('p', { class: 'rep-lesson' }, el('b', { text: '다음 리포트에 쓸 교훈 ' }), rv.lesson) : null,
        el('p', { class: 'note', text: `검증 ${fdt(rv.at)} · 이 교훈은 다음 리포트를 쓸 때 Claude에게 함께 전달됩니다.` })));
    } else if (rep.result && rep.result.final) {
      rvBox.append(el('div', { class: 'pb' }, el('p', { class: 'note', text: rep.reviewErr >= 2 ? `검증하지 못했습니다: ${rep.reviewLastErr || ''}` : '아직 검증 전입니다.' }),
        R.local ? el('button', { class: 'btn primary', type: 'button', text: '지금 검증', onclick: async e => { e.target.disabled = true; e.target.textContent = '검증 중… (1~2분)'; delete rep.reviewErr; R.cur = rep.id; reviewing = false; await reviewOne(rep); } }) : el('p', { class: 'note', text: '검증은 내 컴퓨터 대시보드에서 합니다.' })));
    } else rvBox.append(el('p', { class: 'note pb', text: `72시간(${fdt(rep.created + RESULT_HOURS * H)})이 끝나면 내 컴퓨터 대시보드에서 자동으로 검증합니다.` }));
    box.append(rvBox);
  }
  async function reviewOne(rep) {
    window.TA_chatBusy = true;
    try { rep.review = await retest(rep); rep.review.at = Math.floor(Date.now() / 1000); delete rep.reviewErr; }
    catch (e) { rep.reviewErr = (rep.reviewErr || 0) + 1; rep.reviewLastErr = e.message; }
    finally { window.TA_chatBusy = false; }
    await saveReport(rep).catch(() => {});
    render(); renderScore();
  }
  function resultBox(rep) {
    const r = rep.result, p = rep.plan;
    const L = [];
    if (r.entered) L.push(`진입 ${fdt(r.entered)} (${fp(p.entry)})`); else if (r.status === 'waiting') L.push(`진입 대기 · ${fdt(rep.created + ENTRY_HOURS * H)}까지`);
    if (r.at) L.push(`${r.status === 'win' ? '목표' : '손절'} 도달 ${fdt(r.at)}`);
    if (r.last != null) L.push(`${r.final ? '72시간 시점' : '지금'} ${fp(r.last)}`);
    if (r.final && r.dirHit != null) L.push(`방향 ${r.dirHit ? '적중 ↗' : '빗나감'}`);
    if (!r.final) L.push(`최종 채점 ${fdt(rep.created + RESULT_HOURS * H)}`);
    return el('div', { class: 'rep-result' }, el('b', { text: '결과' }), statusChip(r), el('span', { class: 'muted', text: L.join(' · ') }));
  }

  async function drawMini(box, rep, tf) {
    try {
      const s = await loadTf(rep.sym, tf);
      const off = t => -new Date(t * 1000).getTimezoneOffset() * 60;
      const n = s.t.length, from = Math.max(0, n - 140);
      const ch = LW.createChart(box, {
        autoSize: true, layout: { background: { type: 'solid', color: cv('--panel') }, textColor: cv('--muted'), fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 10 },
        grid: { vertLines: { color: cv('--grid') }, horzLines: { color: cv('--grid') } }, rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false, timeVisible: tf !== '1d' },
        handleScroll: false, handleScale: false, localization: { locale: 'ko-KR' }
      });
      R.charts.push(ch);
      const up = cv('--up'), dn = cv('--down');
      const cs = ch.addCandlestickSeries({ upColor: up, downColor: dn, wickUpColor: up, wickDownColor: dn, borderVisible: false, priceLineVisible: false });
      const data = []; for (let i = from; i < n; i++) data.push({ time: s.t[i] + off(s.t[i]), open: s.o[i], high: s.h[i], low: s.l[i], close: s.c[i] });
      cs.setData(data);
      const p = rep.plan, line = (price, color, title, style) => cs.createPriceLine({ price, color, title, lineWidth: 1, lineStyle: style, axisLabelVisible: true });
      line(p.target, p.direction === 'long' ? up : dn, '목표', LW.LineStyle.Dashed);
      line(p.entryHigh, cv('--accent'), '진입', LW.LineStyle.Solid); line(p.entryLow, cv('--accent'), '', LW.LineStyle.Solid);
      line(p.stop, cv('--muted'), '손절', LW.LineStyle.Dashed);
      const k = s.t.findIndex(t => t >= rep.created - (tf === '1d' ? 86400 : tf === '4h' ? 14400 : tf === '1h' ? 3600 : 900) + 1);
      if (k >= from) cs.setMarkers([{ time: s.t[k] + off(s.t[k]), position: 'aboveBar', color: cv('--accent'), shape: 'arrowDown', text: '작성' }]);
      ch.timeScale().fitContent();
    } catch (e) { box.append(el('p', { class: 'note', text: e.message })); }
  }

  // ---------- 성적표 ----------
  function renderScore() {
    const box = $('#repScore'); box.textContent = '';
    box.append(el('div', { class: 'ph' }, el('h2', { text: '백테스트 성적표' }), el('small', { text: `성공 = 진입 후 목표 먼저 · 손절 실패 −1R · 진입 실패(${ENTRY_HOURS}시간 안 미진입) 0R · 시간 만료 = ${RESULT_HOURS}시간 시점 가격으로 계산` })));
    const reps = R.list.map(it => R.reports[it.id]).filter(r => r && r.result);
    const done = reps.filter(r => ['win', 'loss', 'noentry', 'timeout'].includes(r.result.status));
    const fin = reps.filter(r => r.result.final);
    if (!reps.length) { box.append(el('p', { class: 'note pb', text: '채점할 리포트가 아직 없습니다.' })); return; }
    const cnt = k => done.filter(r => r.result.status === k).length;
    const sumR = done.reduce((t, r) => t + (r.result.r || 0), 0);
    const tile = (k, v, sub, cls) => el('div', { class: 'tile' }, el('div', { class: 'k', text: k }), el('div', { class: 'v ' + (cls || ''), text: v }), el('div', { class: 's', text: sub }));
    const dirN = fin.filter(r => r.result.dirHit != null), dirHit = dirN.filter(r => r.result.dirHit).length;
    box.append(el('div', { class: 'tiles' },
      tile('판정 끝난 리포트', String(done.length), `진행 중 ${reps.length - done.length}개`),
      tile('성공률', done.length ? (cnt('win') / done.length * 100).toFixed(0) + '%' : '—', `성공 ${cnt('win')} · 손절 ${cnt('loss')} · 진입 실패 ${cnt('noentry')} · 시간 만료 ${cnt('timeout')}`),
      tile('합계', fr(sumR) || '0R', '1R = 손절 한 번에 잃는 금액', toneOf(sumR)),
      tile('기대값', done.length ? fr(sumR / done.length) : '—', '리포트 1개당 평균', toneOf(sumR)),
      tile('방향 적중률', dirN.length ? (dirHit / dirN.length * 100).toFixed(0) + '%' : '—', `${RESULT_HOURS}시간 뒤 추천 방향으로 갔는지 · ${dirN.length}개`)));
    // 확신도별
    const byConf = [5, 4, 3, 2, 1].map(k => { const g = done.filter(r => r.plan.confidence === k); return g.length ? [k, g] : null; }).filter(Boolean);
    const tbl = (head, rows) => el('div', { class: 'tblwrap' }, el('table', null, el('thead', null, el('tr', null, head.map((h, i) => el('th', { class: i ? 'r' : '', text: h })))), el('tbody', null, rows)));
    const cols = el('div', { class: 'cols pb' });
    // 진입 타점 판단별: 되돌림형·즉시형 각각 진입률과 진입 후 익절률
    const byType = [['pullback', '되돌림형'], ['breakout', '돌파형'], ['immediate', '즉시형']].map(([k, nm]) => {
      const g = done.filter(r => entryTypeOf(r) === k), ent = g.filter(r => r.result.status !== 'noentry'), w = ent.filter(r => r.result.status === 'win').length, s = g.reduce((t, r) => t + (r.result.r || 0), 0);
      return el('tr', null, el('td', { text: nm }), el('td', { class: 'r m', text: g.length }), el('td', { class: 'r m', text: g.length ? (ent.length / g.length * 100).toFixed(0) + '%' : '—' }), el('td', { class: 'r m', text: ent.length ? (w / ent.length * 100).toFixed(0) + '%' : '—' }), el('td', { class: 'r m ' + toneOf(s), text: g.length ? fr(s / g.length) : '—' }));
    });
    cols.append(el('div', null, el('h3', { text: '진입 타점 판단별' }), tbl(['판단', '개수', '진입률', '진입 후 익절', '평균'], byType), el('p', { class: 'note', text: '진입 방식은 최종 진입가가 작성 시 가격 기준 어느 쪽이었는지로 분류합니다 (롱: 아래 = 되돌림, 위 = 돌파).' })));
    cols.append(el('div', null, el('h3', { text: '확신도별' }), byConf.length ? tbl(['확신도', '개수', '성공률', '평균'], byConf.map(([k, g]) => {
      const s = g.reduce((t, r) => t + (r.result.r || 0), 0);
      return el('tr', null, el('td', { text: stars(k) }), el('td', { class: 'r m', text: g.length }), el('td', { class: 'r m', text: (g.filter(r => r.result.status === 'win').length / g.length * 100).toFixed(0) + '%' }), el('td', { class: 'r m ' + toneOf(s), text: fr(s / g.length) }));
    })) : el('p', { class: 'note', text: '판정 끝난 리포트가 쌓이면 보입니다.' })));
    // 관점별 방향 적중
    const vrows = VIEWS.map(([key, name]) => {
      const g = fin.filter(r => r.result.views && r.result.views[key] != null), hit = g.filter(r => r.result.views[key]).length;
      return el('tr', null, el('td', { text: name }), el('td', { class: 'r m', text: g.length }), el('td', { class: 'r m', text: g.length ? (hit / g.length * 100).toFixed(0) + '%' : '—' }));
    });
    cols.append(el('div', null, el('h3', { text: `관점별 방향 적중 (${RESULT_HOURS}시간 뒤)` }), tbl(['관점', '개수', '적중률'], vrows), el('p', { class: 'note', text: '중립으로 본 관점은 세지 않습니다.' })));
    box.append(cols);
    const rvd = reps.filter(r => r.review), left = reps.filter(r => r.result.final && !r.review).length;
    const rvRows = VIEWS.map(([k, nm]) => { const g = rvd.map(r => r.review.views && r.review.views[k] && r.review.views[k].result), ok = g.filter(x => x === '맞음').length, bad = g.filter(x => x === '틀림').length; return el('tr', null, el('td', { text: nm }), el('td', { class: 'r m', text: ok }), el('td', { class: 'r m', text: bad }), el('td', { class: 'r m', text: ok + bad ? Math.round(ok / (ok + bad) * 100) + '%' : '—' })); });
    box.append(el('div', { class: 'pb' }, el('h3', { text: `관점별 사후 검증 (리테스트 ${rvd.length}개)` }), tbl(['관점', '맞음', '틀림', '적중률'], rvRows),
      el('div', { class: 'inrow', style: 'margin-top:8px;align-items:center' }, R.local && left ? el('button', { class: 'btn', type: 'button', text: `지난 리포트 모두 검증 (${left}개 · 1개당 1~2분)`, onclick: e => { e.target.disabled = true; reviewWork(true); } }) : null, el('span', { class: 'muted', id: 'repRevStatus', style: 'font-size:12.5px' }))));
  }

  // ---------- 종목 고르기 ----------
  function syncSym() {
    $$('#repSym button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === R.sym)));
    const inSeg = $$('#repSym button').some(b => b.dataset.v === R.sym);
    $('#repIn').value = inSeg ? '' : TA.disp(R.sym);
    $('#repPick').textContent = TA.dispFull(R.sym);
  }
  $('#repSym').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; R.sym = b.dataset.v; store.set('repSym', R.sym); syncSym(); });
  $('#repForm').addEventListener('submit', async e => {
    e.preventDefault();
    const inp = $('#repIn'), sym = await TA.resolveSym(inp.value).catch(() => null);
    if (!sym || !TA.hasHL(sym)) { inp.setCustomValidity(`"${inp.value}" 종목을 하이퍼리퀴드에서 찾지 못했습니다`); inp.reportValidity(); return; }
    inp.setCustomValidity(''); R.sym = sym; store.set('repSym', sym); syncSym();
  });
  $('#repIn').addEventListener('input', () => $('#repIn').setCustomValidity(''));
  $('#repGo').addEventListener('click', generate);

  // ---------- 시작 ----------
  let started = false;
  async function start() {
    if (started) return; started = true;
    syncSym();
    try { const r = await fetch('api/ask/status', { headers: { 'X-Dashboard': '1' }, cache: 'no-store' }); R.local = r.ok; } catch (e) { R.local = false; }
    if (!R.local) setStatus('리포트 작성은 내 컴퓨터 대시보드(start-local.bat)에서만 됩니다. 저장된 리포트는 여기서도 볼 수 있습니다.');
    await loadList();
    await Promise.all(R.list.map(it => getReport(it.id).catch(() => null)));
    if (!R.cur && R.list.length) R.cur = R.list[0].id;
    renderList(); render();
    await scoreAll(); renderList(); render(); renderScore();
    reviewWork(false);
  }
  window.addEventListener('tabchange', e => { if (e.detail === 'report') start(); });
  window.addEventListener('themechange', () => { if (started) render(); });
  if (U.activeTab() === 'report') start();
  // 열려 있는 동안 5분마다 다시 채점
  setInterval(async () => { if (!started || document.hidden || U.activeTab() !== 'report' || R.busy) return; await scoreAll(); renderList(); renderScore(); reviewWork(false); if (R.cur) { const box = $('.rep-result'); if (box && R.reports[R.cur].result) box.replaceWith(resultBox(R.reports[R.cur])); } }, 300000);
})();
