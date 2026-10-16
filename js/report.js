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
    L.push(`현재가 ${fp(c)} · RSI14 ${rsi == null ? '-' : rsi.toFixed(1)} · ATR14 ${fp(atr)} · EMA20 ${fp(e(20))} · EMA50 ${fp(e(50))} · EMA200 ${fp(e(200))}`);
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

  const isCoin = sym => !TA.hasYahoo(sym) && !TA.hlCoin(sym).startsWith('xyz:');
  async function bj(url) { const r = await fetch(url); if (!r.ok) throw new Error(r.status); return r.json(); }
  async function flowText(sym) {
    if (!isCoin(sym)) return '수급 데이터 없음 (주식은 OI·CVD·펀딩 데이터가 없습니다)';
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
6. 손익비 = |목표 − 진입 중앙| ÷ |진입 중앙 − 손절| 이 반드시 ${MIN_RR}.0 이상. 안 나오면 진입을 더 유리한 가격으로 옮겨서 맞춘다.
7. 이 리포트는 작성 시점부터 72시간 안에 채점된다. 24시간 안에 진입 구간에 안 닿으면 실패다.
8. 가격 숫자는 아래 데이터에 있는 값이나 그 값으로 계산한 값만 쓴다. 지어내지 않는다.
9. 매수·매도를 지시하는 말투("사세요") 대신 "롱 관점", "숏 관점"으로 쓴다.

${RULES}

[관점 6개] elliott(엘리엇), ict(ICT), wyckoff(와이코프), divergence(다이버전스), flow(수급), whale(고래·청산맵). 각 관점은 자기 데이터만 근거로 판단한다. 데이터가 없으면 dir "flat"으로 두고 body에 데이터가 없다고 쓴다.

[출력 JSON 형식]
{
  "direction": "long 또는 short",
  "confidence": 1~5 정수,
  "title": "한 줄 전략, 15자 이내 (예: 저점 위 눌림 매수)",
  "context": "지금 상황 한 줄, 숫자 포함 (예: 최근 3일 79,700~84,300 범위 · 전일 81,300 → 지금 82,200)",
  "entry": { "low": 숫자, "high": 숫자 },
  "target": 숫자,
  "stop": 숫자,
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

## 수급 (코인 선물 시장)
${d.flow}

## 고래·청산맵
${d.whale}
</데이터>`;
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
      const [flow, whale] = await Promise.all([flowText(sym).catch(e => '수급 데이터 오류: ' + e.message), whaleText(sym)]);
      const d = { created, price: s15.c[s15.c.length - 1], atrD: lastOf(TA.atr(d1.h, d1.l, d1.c, 14)), atr15: lastOf(TA.atr(s15.h, s15.l, s15.c, 14)), tf, flow, whale };
      const t0 = Date.now();
      const text = await askClaude(buildPrompt(sym, d), n => setStatus(`Claude가 6개 관점을 분석해서 쓰는 중… ${Math.round((Date.now() - t0) / 1000)}초 · ${n.toLocaleString()}자`));
      const c = parseJson(text);
      const plan = finalize(c, d);
      const dt = new Date(created * 1000), pad = v => String(v).padStart(2, '0');
      const id = `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}-${pad(dt.getHours())}${pad(dt.getMinutes())}${pad(dt.getSeconds())}-${TA.disp(sym).replace(/[^A-Za-z0-9]/g, '')}`;
      const rep = { id, sym, created, price: d.price, atrD: d.atrD, plan, claude: c, result: null, v: 1 };
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
  }
  window.addEventListener('tabchange', e => { if (e.detail === 'report') start(); });
  window.addEventListener('themechange', () => { if (started) render(); });
  if (U.activeTab() === 'report') start();
  // 열려 있는 동안 5분마다 다시 채점
  setInterval(async () => { if (!started || document.hidden || U.activeTab() !== 'report' || R.busy) return; await scoreAll(); renderList(); renderScore(); if (R.cur) { const box = $('.rep-result'); if (box && R.reports[R.cur].result) box.replaceWith(resultBox(R.reports[R.cur])); } }, 300000);
})();
