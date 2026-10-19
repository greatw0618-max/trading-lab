// 매매 테스트 탭: 내가 포지션을 잡아 보고, 예상 결과·Claude 사전 평가를 저장한 뒤
// 진입가에 체결됐다고 가정하고 익절·손절 중 먼저 닿은 쪽으로 채점, 결과가 나오면 Claude가 사후 분석합니다.
// 차트 분석 탭의 자동 판독 규칙은 건드리지 않습니다.
(() => {
  const TA = window.TA, U = TA && TA.ui, LW = window.LightweightCharts;
  if (!U || !LW) return;
  const { el, fp, fpct, fusd, fdt, chip, store, toneOf } = U;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const cv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const tools = () => U.repTools;
  const PRED_HOURS = 168; // 예상 확률: 과거 비슷한 상황에서 7일 안에 목표·손절 중 먼저 닿은 쪽
  const VIEWS = [['elliott', '엘리엇'], ['ict', 'ICT'], ['wyckoff', '와이코프'], ['divergence', '다이버전스'], ['flow', '수급'], ['whale', '고래·청산맵']];
  const AGREE = { agree: ['good', '같은 방향'], conflict: ['bad', '반대'], neutral: ['flat', '중립'] };
  const T = { sym: store.get('ttSym', 'BTC'), side: +store.get('ttSide', '1') || 1, list: [], trades: {}, cur: null, local: false, working: false, charts: [], preview: null, reviews: [] };

  // ---------- 저장·불러오기 ----------
  async function save(kind, rec) {
    const r = await fetch('api/save?kind=' + kind, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dashboard': '1' }, body: JSON.stringify(rec) });
    if (!r.ok) throw new Error('저장 실패 (' + r.status + '). 서버를 다시 켜 주세요.');
  }
  async function loadIndex(kind) {
    try { const r = await fetch(`${kind}/index.json?v=${Date.now()}`, { cache: 'no-store' }); return r.ok ? (await r.json()).reports || [] : []; } catch (e) { return []; }
  }
  async function getRec(kind, id, cache) {
    if (cache[id]) return cache[id];
    const r = await fetch(`${kind}/${id}.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('파일 없음');
    return (cache[id] = await r.json());
  }
  const newId = (t, tag) => { const d = new Date(t * 1000), p = v => String(v).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${tag}`; };

  // ---------- 입력값과 미리보기 (자동 예상) ----------
  ['ttEntry', 'ttTp', 'ttSl', 'ttAmt', 'ttLev'].forEach(id => { const v = store.get(id, null); if (v != null && id !== 'ttEntry') $('#' + id).value = v; });
  function readForm() {
    const entry = +$('#ttEntry').value, tp = +$('#ttTp').value, sl = +$('#ttSl').value;
    const missing = [];
    if (!(entry > 0)) missing.push('진입가'); if (!(tp > 0)) missing.push('목표 수익'); if (!(sl > 0)) missing.push('손절');
    return { missing, side: T.side, entry, tp, sl, amt: Math.max(0, +$('#ttAmt').value || 0), lev: Math.min(50, Math.max(1, +$('#ttLev').value || 1)), memo: $('#ttMemo').value.trim() };
  }
  async function contextFor(sym) {
    if (TA.hasYahoo(sym)) { const [h1, d1] = await Promise.all([TA.loadYahoo(sym, '1h'), TA.loadYahoo(sym, '1d')]); return TA.buildContext(h1, TA.to4h(h1), d1); }
    const [h1, h4, d1] = await Promise.all([TA.loadHL(sym, '1h'), TA.loadHL(sym, '4h'), TA.loadHL(sym, '1d')]);
    return TA.buildContext(h1, h4, d1);
  }
  let pvSeq = 0;
  async function preview() {
    const id = ++pvSeq, f = readForm(), box = $('#ttPreview');
    let s; try { s = await TA.load(T.sym, '15m', 'hl'); } catch (e) { box.textContent = ''; box.append(el('p', { class: 'note pb down', text: e.message })); return; }
    if (id !== pvSeq) return;
    const cur = s.c[s.c.length - 1];
    $('#ttNow').title = '현재가 ' + fp(cur);
    if (!$('#ttEntry').value) $('#ttEntry').placeholder = '현재가 ' + fp(cur);
    box.textContent = '';
    if (f.missing.length) { T.preview = null; box.append(el('p', { class: 'note pb', text: `${f.missing.join(', ')}을(를) 입력하면 예상 결과가 바로 나옵니다. 진입가는 [현재가] 버튼으로 채울 수 있어요.` })); drawFormChart(s, null); return; }
    const target = f.entry * (1 + f.side * f.tp / 100), stop = f.entry * (1 - f.side * f.sl / 100), rr = f.tp / f.sl;
    let ctx = null; try { ctx = await contextFor(T.sym); } catch (e) {}
    if (id !== pvSeq) return;
    // 진입가에 바로 체결됐다고 가정하므로, 과거 비교는 "그 시점 가격에 바로 진입"으로 계산합니다.
    const plan = { side: f.side, entry: cur, tp: f.tp, sl: f.sl, holdHours: PRED_HOURS, amt: f.amt, lev: f.lev };
    const r = TA.planEval(s, ctx, plan), st = r.st, resolved = st.win + st.sl;
    const an = { ew: TA.elliott(s, TA.ewMult['15m']), ict: TA.ict(s), wy: TA.wyckoff(s), div: TA.divergence(s) };
    const ctxNow = ctx ? ctx(s.t[s.t.length - 1] + 1) : null;
    const factors = TA.planFactors(s, an, ctxNow, { ...plan, entry: f.entry }, { ...r, tpPx: target });
    const pWin = resolved ? st.win / resolved : null;
    T.preview = { f, cur, target, stop, rr, predict: { pWin, win: st.win, sl: st.sl, timeout: st.timeout, samples: st.filled, tier: r.tier, holdHours: PRED_HOURS, base: r.bs.win + r.bs.sl ? r.bs.win / (r.bs.win + r.bs.sl) : null, factors } };
    const L = f.side > 0 ? '롱' : '숏';
    const tile = (k, v, sub, cls) => el('div', { class: 'tile' }, el('div', { class: 'k', text: k }), el('div', { class: 'v ' + (cls || ''), text: v }), el('div', { class: 's', text: sub }));
    const money = v => (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) < 100 ? 2 : 0 });
    box.append(el('div', { class: 'tiles' },
      tile('목표가 (익절)', fp(target), `${f.side > 0 ? '+' : '-'}${f.tp}%`, f.side > 0 ? 'up' : 'down'),
      tile('손절가', fp(stop), `${f.side > 0 ? '-' : '+'}${f.sl}%`),
      tile('손익비', `${rr.toFixed(2)} : 1`, `익절 +${rr.toFixed(2)}R · 손절 −1R`),
      tile('예상 익절 확률', pWin == null ? '—' : (pWin * 100).toFixed(0) + '%', `과거 비슷한 상황 ${resolved}번 중 익절 ${st.win} · 손절 ${st.sl} (7일 안에 결론 난 경우)`, pWin == null ? '' : pWin >= 0.5 ? 'up' : 'down'),
      f.amt > 0 ? tile('금액', `${money(f.amt * f.lev * f.tp / 100)} / ${money(-f.amt * f.lev * f.sl / 100)}`, `투자금 $${f.amt.toLocaleString()} × ${f.lev}배 · 익절 / 손절`) : null));
    const good = factors.filter(x => x[0] === 'good'), rest = factors.filter(x => x[0] !== 'good');
    box.append(el('div', { class: 'cols' },
      el('div', null, el('h3', { text: `${L}에 유리한 점 (${good.length})` }), good.length ? el('ul', { class: 'vlist' }, good.map(([t, x]) => el('li', { class: t, text: x }))) : el('p', { class: 'note', text: '뚜렷하게 유리한 요인이 없습니다.' })),
      el('div', null, el('h3', { text: `불리하거나 주의할 점 (${rest.length})` }), rest.length ? el('ul', { class: 'vlist' }, rest.map(([t, x]) => el('li', { class: t, text: x }))) : el('p', { class: 'note', text: '뚜렷하게 불리한 요인이 없습니다.' }))));
    box.append(el('p', { class: 'note pb', text: `예상 확률 비교 기준: ${r.tier}. 조건 없이 아무 때나 같은 비율로 들어갔다면 ${T.preview.predict.base == null ? '—' : (T.preview.predict.base * 100).toFixed(0) + '%'}. 과거 통계일 뿐 미래를 보장하지 않습니다.` }));
    drawFormChart(s, { side: f.side, entry: f.entry, target, stop });
  }
  let pvTimer = null;
  const queuePreview = () => { clearTimeout(pvTimer); pvTimer = setTimeout(preview, 300); };

  function miniChart(box, height) {
    const ch = LW.createChart(box, {
      autoSize: true, height, layout: { background: { type: 'solid', color: cv('--panel') }, textColor: cv('--muted'), fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 10 },
      grid: { vertLines: { color: cv('--grid') }, horzLines: { color: cv('--grid') } }, rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false, timeVisible: true },
      localization: { locale: 'ko-KR' }
    });
    const up = cv('--up'), dn = cv('--down');
    const cs = ch.addCandlestickSeries({ upColor: up, downColor: dn, wickUpColor: up, wickDownColor: dn, borderVisible: false });
    return { ch, cs };
  }
  const off = t => -new Date(t * 1000).getTimezoneOffset() * 60;
  function setBars(cs, s, from) { const d = []; for (let i = from; i < s.t.length; i++) d.push({ time: s.t[i] + off(s.t[i]), open: s.o[i], high: s.h[i], low: s.l[i], close: s.c[i] }); cs.setData(d); }
  function planLines(cs, p) {
    const line = (price, color, title, style, w) => cs.createPriceLine({ price, color, title, lineWidth: w || 1, lineStyle: style, axisLabelVisible: true });
    line(p.entry, cv('--accent'), (p.side > 0 ? '롱' : '숏') + ' 진입', LW.LineStyle.Solid, 2);
    line(p.target, p.side > 0 ? cv('--up') : cv('--down'), '익절', LW.LineStyle.Dashed, 2);
    line(p.stop, cv('--muted'), '손절', LW.LineStyle.Dashed);
  }
  let formChart = null;
  function drawFormChart(s, p) {
    if (formChart) { try { formChart.ch.remove(); } catch (e) {} }
    const box = $('#ttChart'); box.textContent = '';
    formChart = miniChart(box, 300);
    setBars(formChart.cs, s, Math.max(0, s.t.length - 200));
    if (p) planLines(formChart.cs, p);
    const fc = formChart; setTimeout(() => { try { fc.ch.timeScale().fitContent(); } catch (e) {} }, 120);
  }

  // ---------- 채점 ----------
  // 1) 저장 후 24시간 안에 가격이 진입가에 닿아야 진입. 안 닿으면 진입 실패(0R).
  // 2) 진입한 뒤 익절·손절 중 먼저 닿은 쪽 (시간 제한 없음). 진입한 봉에서 손절가도 닿으면 손절,
  //    진입한 봉의 익절은 순서를 알 수 없어 세지 않음. 이후 같은 봉에서 둘 다 닿으면 손절.
  const ENTRY_HOURS = 24;
  async function evaluate(tr) {
    if (tr.result && tr.result.final) return tr.result;
    const p = tr.plan, dir = p.direction === 'long' ? 1 : -1, coin = TA.hlCoin(tr.sym);
    const start = Math.ceil(tr.created / 900) * 900, now = Date.now() / 1000, entryEnd = tr.created + ENTRY_HOURS * 3600;
    let t = start, mfe = 0, mae = 0, last = null, out = null, entered = null, stop = false;
    while (t < now && !out && !stop) {
      const end = Math.min(now, t + 30 * 86400);
      const rows = await TA.hl({ type: 'candleSnapshot', req: { coin, interval: '15m', startTime: t * 1000, endTime: Math.floor(end * 1000) } });
      const bars = rows.map(k => ({ t: k.t / 1000, h: +k.h, l: +k.l, c: +k.c })).filter(b => b.t >= t);
      for (const b of bars) {
        last = b;
        const hitS = dir > 0 ? b.l <= p.stop : b.h >= p.stop, hitT = dir > 0 ? b.h >= p.target : b.l <= p.target;
        if (!entered) {
          if (b.t >= entryEnd) { stop = true; break; }
          if (b.l <= p.entry && b.h >= p.entry) { entered = b.t; if (hitS) { out = { status: 'loss', at: b.t }; break; } }
          continue;
        }
        if (hitS) { out = { status: 'loss', at: b.t }; break; }
        if (hitT) { out = { status: 'win', at: b.t }; break; }
        mfe = Math.max(mfe, dir > 0 ? b.h / p.entry - 1 : 1 - b.l / p.entry);
        mae = Math.min(mae, dir > 0 ? b.l / p.entry - 1 : 1 - b.h / p.entry);
      }
      if (!bars.length) break;
      t = end;
    }
    const risk = Math.abs(p.entry - p.stop);
    let res;
    if (out) res = { status: out.status, at: out.at, r: out.status === 'win' ? p.rr : -1, final: true };
    else if (!entered) res = now >= entryEnd ? { status: 'noentry', at: null, r: 0, final: true } : { status: 'waiting', at: null, r: null, final: false };
    else res = { status: 'open', at: null, r: last ? dir * (last.c - p.entry) / risk : 0, final: false };
    res.entered = entered; res.last = last ? last.c : null; res.mfe = mfe; res.mae = mae; res.checked = Math.floor(now);
    if (out) res.hours = (out.at - tr.created) / 3600;
    return res;
  }

  U.tradeEvaluate = evaluate; // 확인용

  // ---------- Claude ----------
  const fr = v => v == null ? '' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + 'R';
  const RES_NAME = { win: '익절', loss: '손절', noentry: '진입 실패', open: '진입 · 진행 중', waiting: '진입 대기' };
  function done() { return T.list.map(it => T.trades[it.id]).filter(t => t && t.result && t.result.final); }
  function historyText(exceptId) {
    const d = done().filter(t => t.id !== exceptId);
    if (!d.length) return '아직 결과가 난 매매 기록 없음 (첫 기록)';
    const cnt = s => d.filter(t => t.result.status === s).length, win = cnt('win'), sumR = d.reduce((a, t) => a + t.result.r, 0);
    const L = [`결과 난 매매 ${d.length}개 · 익절 ${win} · 손절 ${cnt('loss')} · 진입 실패 ${cnt('noentry')} · 성공률 ${(win / d.length * 100).toFixed(0)}% · 합계 ${fr(sumR)}`];
    [5, 4, 3, 2, 1].forEach(k => { const g = d.filter(t => t.pre && t.pre.score === k); if (g.length) L.push(`- Claude 사전 평가 ${k}점: ${g.length}개 중 익절 ${g.filter(t => t.result.status === 'win').length}`); });
    ['long', 'short'].forEach(s => { const g = d.filter(t => t.plan.direction === s); if (g.length) L.push(`- ${s === 'long' ? '롱' : '숏'}: ${g.length}개 중 익절 ${g.filter(t => t.result.status === 'win').length}`); });
    L.push('최근 기록 (최신순):');
    d.slice(0, 15).forEach(t => L.push(`- ${fdt(t.created)} ${TA.disp(t.sym)} ${t.plan.direction === 'long' ? '롱' : '숏'} 진입 ${fp(t.plan.entry)} 목표 ${t.plan.tpPct}% 손절 ${t.plan.slPct}% (손익비 ${t.plan.rr.toFixed(2)}) · 사전 평가 ${t.pre ? t.pre.score + '점' : '-'} · 결과 ${RES_NAME[t.result.status]}${t.result.hours != null ? ' (' + t.result.hours.toFixed(1) + '시간)' : ''} · 이유: ${(t.memo || '-').slice(0, 60)}${t.post && t.post.lesson ? ' · 교훈: ' + t.post.lesson : ''}`));
    return L.join('\n');
  }
  async function marketData(sym) {
    const k = tools(), series = await Promise.all(k.TFS.map(tf => k.loadTf(sym, tf)));
    const tf = series.map((s, i) => k.tfText(s, k.TFS[i]).text);
    const [flow, whale] = await Promise.all([k.flowText(sym).catch(e => '수급 데이터 오류: ' + e.message), k.whaleText(sym)]);
    return `${tf.join('\n\n')}\n\n## 수급 (코인 선물 시장)\n${flow}\n\n## 고래·청산맵\n${whale}`;
  }
  const posText = tr => { const p = tr.plan; return `종목 ${TA.dispFull(tr.sym)} · ${p.direction === 'long' ? '롱' : '숏'} · 진입가 ${fp(p.entry)} (작성 시 현재가 ${fp(tr.price)}) · 익절 ${fp(p.target)} (${p.tpPct}%) · 손절 ${fp(p.stop)} (${p.slPct}%) · 손익비 ${p.rr.toFixed(2)}:1 · 레버리지 ${p.lev}배 · 작성 ${fdt(tr.created)}\n잡은 이유(사용자 메모): ${tr.memo || '없음'}`; };
  const predText = tr => { const x = tr.predict; return x ? `대시보드 예상: 과거 비슷한 상황(${x.tier})에서 7일 안에 결론 난 ${x.win + x.sl}번 중 익절 ${x.win}번 (${x.pWin == null ? '-' : (x.pWin * 100).toFixed(0) + '%'})\n대시보드 판독 요인:\n${(x.factors || []).map(f => `- [${f[0]}] ${f[1]}`).join('\n')}` : '대시보드 예상 없음'; };
  const HEAD = `너는 "매매연구소" 대시보드의 매매 코치다. 사용자는 차트 분석 초보인 데이트레이더이고, 자기가 잡은 연습 포지션을 평가받으며 배운다. 쉬운 한국어로 쓰고 전문 용어는 처음 나올 때 괄호로 짧게 풀이한다. 가격 숫자는 주어진 데이터에 있는 값이나 그로부터 계산한 값만 쓴다. 매수·매도를 지시하지 않고 근거와 개선점을 말한다. 채점 방식: 저장 후 24시간 안에 가격이 진입가(지정가)에 닿아야 진입하고, 안 닿으면 진입 실패(0R). 진입한 뒤에는 익절가와 손절가 중 먼저 닿은 쪽으로 판정(시간 제한 없음, 같은 15분봉에서 둘 다 닿으면 손절). 그래서 진입가가 24시간 안에 올 만한 자리인지도 평가한다. **JSON 하나로만** 답한다.`;

  async function preEval(tr) {
    const k = tools();
    const prompt = `${HEAD}

[할 일] 아래 포지션을 6개 관점(엘리엇, ICT, 와이코프, 다이버전스, 수급, 고래·청산맵)으로 평가해 사전 점수를 매긴다. 사용자의 지난 기록이 있으면 그 패턴(자주 하는 실수, 잘 맞았던 상황)도 근거로 쓴다.

${k.RULES}

[출력 JSON 형식]
{ "score": 1~5 정수 (익절 가능성과 근거의 질), "verdict": "한 줄 평가",
  "good": ["이 포지션의 좋은 점"], "bad": ["걱정되는 점"],
  "entryComment": "진입가 평가 한두 문장", "targetComment": "익절가 평가", "stopComment": "손절가 평가 (구조 바깥인지, 너무 좁거나 넓은지)",
  "views": { "elliott": "agree|conflict|neutral", "ict": "...", "wyckoff": "...", "divergence": "...", "flow": "...", "whale": "..." },
  "expectation": "예상 시나리오 두세 문장", "advice": "같은 생각이라면 이렇게 잡으면 더 좋다 (구체적 가격 포함)", "lesson": "초보자가 이 포지션에서 배울 점 한 줄" }

<포지션>
${posText(tr)}
${predText(tr)}
</포지션>

<지난 기록>
${historyText(tr.id)}
</지난 기록>

<시장 데이터>
${await marketData(tr.sym)}
</시장 데이터>`;
    return k.parseJson(await k.askClaude(prompt, () => {}));
  }
  async function postEval(tr) {
    const k = tools(), r = tr.result, coin = TA.hlCoin(tr.sym);
    const rows = await TA.hl({ type: 'candleSnapshot', req: { coin, interval: '1h', startTime: Math.floor(tr.created / 3600) * 3600 * 1000, endTime: Math.floor((r.at + 3600) * 1000) } }).catch(() => []);
    const path = rows.slice(0, 72).map(x => `${fdt(x.t / 1000)} ${fp(+x.o)}/${fp(+x.h)}/${fp(+x.l)}/${fp(+x.c)}`).join('\n');
    const prompt = `${HEAD}

[할 일] 결과가 난 포지션을 돌아보고 사후 분석을 쓴다. 왜 이렇게 됐는지, 사전 평가가 맞았는지, 다음에 무엇을 다르게 할지 정리한다.

[출력 JSON 형식]
{ "summary": "한 줄 요약", "why": ["결과가 이렇게 된 이유"], "preCheck": "사전 평가(점수·예상)가 맞았는지 평가",
  "didWell": ["잘한 점"], "mistakes": ["아쉬운 점"], "nextTime": "다음에 비슷한 상황이면 이렇게 (구체적으로)", "lesson": "교훈 한 줄 (다음 평가 때 참고하도록 짧게)" }

<포지션>
${posText(tr)}
${predText(tr)}
</포지션>

<Claude 사전 평가>
${tr.pre ? JSON.stringify({ score: tr.pre.score, verdict: tr.pre.verdict, good: tr.pre.good, bad: tr.pre.bad, expectation: tr.pre.expectation }) : '없음'}
</Claude 사전 평가>

<결과>
${r.status === 'win' ? '익절' : '손절'} · ${fdt(r.at)} (진입 후 ${r.hours.toFixed(1)}시간) · 그 전까지 최대 유리 ${fpct(r.mfe * 100, 2)} / 최대 불리 ${fpct(r.mae * 100, 2)} · ${fr(r.r)}
진입 후 1시간봉 (시각 시/고/저/종):
${path}
</결과>

<지난 기록>
${historyText(tr.id)}
</지난 기록>`;
    return k.parseJson(await k.askClaude(prompt, () => {}));
  }

  // 사전 평가가 없는 매매, 결과가 났는데 사후 분석이 없는 매매를 하나씩 처리합니다 (내 컴퓨터 대시보드에서만).
  async function work() {
    if (!T.local || T.working || !tools()) return;
    T.working = true;
    try {
      for (const it of T.list) {
        const tr = T.trades[it.id]; if (!tr) continue;
        const needPre = !tr.pre && (tr.preErr || 0) < 2, needPost = tr.result && tr.result.final && tr.result.status !== 'noentry' && !tr.post && (tr.postErr || 0) < 2;
        if (!needPre && !needPost) continue;
        window.TA_chatBusy = true;
        setStatus(needPre ? `${TA.disp(tr.sym)} 포지션을 Claude가 사전 평가하는 중… (1~2분)` : `${TA.disp(tr.sym)} 결과를 Claude가 사후 분석하는 중… (1~2분)`);
        try {
          if (needPre) { tr.pre = await preEval(tr); tr.pre.score = Math.max(1, Math.min(5, Math.round(+tr.pre.score || 1))); tr.plan.confidence = tr.pre.score; }
          else tr.post = await postEval(tr);
          delete tr.preErr; delete tr.postErr;
        } catch (e) { if (needPre) tr.preErr = (tr.preErr || 0) + 1; else tr.postErr = (tr.postErr || 0) + 1; tr.lastErr = e.message; }
        await save('trades', tr).catch(() => {});
        renderList(); if (T.cur === tr.id) renderView(); renderScore();
      }
      setStatus('');
    } finally { T.working = false; window.TA_chatBusy = false; }
  }
  async function scoreAll() {
    let changed = false;
    await Promise.all(T.list.map(async it => {
      const tr = T.trades[it.id]; if (!tr || (tr.result && tr.result.final)) return;
      try { tr.result = await evaluate(tr); changed = true; if (tr.result.final && T.local) await save('trades', tr).catch(() => {}); } catch (e) {}
    }));
    return changed;
  }

  // ---------- 저장 ----------
  const setStatus = (t, cls) => { const s = $('#ttStatus'); s.textContent = t; s.className = 'muted ' + (cls || ''); };
  async function saveTrade() {
    if (!T.local) { setStatus('저장은 내 컴퓨터 대시보드(http://localhost:8765)에서만 됩니다.', 'down'); return; }
    await preview();
    const pv = T.preview; if (!pv) { setStatus('진입가·목표 수익·손절을 먼저 입력해 주세요.', 'down'); return; }
    const f = pv.f, created = Math.floor(Date.now() / 1000);
    const tr = { id: newId(created, TA.disp(T.sym).replace(/[^A-Za-z0-9]/g, '')), sym: T.sym, created, price: pv.cur, memo: f.memo,
      plan: { direction: f.side > 0 ? 'long' : 'short', entry: f.entry, tpPct: f.tp, slPct: f.sl, target: pv.target, stop: pv.stop, rr: pv.rr, amt: f.amt, lev: f.lev, confidence: null },
      predict: pv.predict, pre: null, result: null, post: null, v: 1 };
    try {
      await save('trades', tr);
      T.trades[tr.id] = tr; T.cur = tr.id;
      T.list = await loadIndex('trades');
      $('#ttMemo').value = ''; $('#ttEntry').value = '';
      setStatus('저장했습니다. Claude 사전 평가를 시작합니다.', 'up');
      tr.result = await evaluate(tr).catch(() => null);
      renderList(); renderView(); renderScore();
      work();
    } catch (e) { setStatus(e.message, 'down'); }
  }

  // ---------- 화면 ----------
  const STATUS = { waiting: ['warn', '진입 대기'], open: ['warn', '진행 중'], win: ['good', '익절'], loss: ['bad', '손절'], noentry: ['bad', '진입 실패'] };
  const stars = n => { n = Math.max(0, Math.min(5, n | 0)); return '★'.repeat(n) + '☆'.repeat(5 - n); };
  const statusChip = r => r && STATUS[r.status] ? chip(STATUS[r.status][0], STATUS[r.status][1] + (r.r != null ? ' ' + fr(r.r) : '')) : chip('flat', '채점 전');
  function renderList() {
    const box = $('#ttList'); box.textContent = '';
    box.append(el('div', { class: 'ph' }, el('h2', { text: '매매 기록' }), el('small', { text: `${T.list.length}개` })));
    if (!T.list.length) { box.append(el('p', { class: 'note pb', text: '아직 기록이 없습니다. 위에서 포지션을 잡고 저장해 보세요.' })); return; }
    const ul = el('div', { class: 'rep-items' });
    T.list.forEach(it => {
      const tr = T.trades[it.id], dir = tr ? tr.plan.direction : it.direction;
      ul.append(el('button', { type: 'button', class: 'rep-item', 'aria-pressed': String(it.id === T.cur), onclick: () => { T.cur = it.id; renderList(); renderView(); } },
        el('span', { class: 'm', text: fdt(it.created) + (tr && tr.pre ? ' · 사전 ' + tr.pre.score + '점' : '') }), el('b', { text: TA.disp(it.sym) }),
        chip(dir === 'long' ? 'good' : 'bad', dir === 'long' ? '롱' : '숏'), statusChip(tr && tr.result)));
    });
    box.append(ul);
  }
  const ul = (arr, cls) => (arr || []).length ? el('ul', { class: 'vlist' }, arr.map(x => el('li', { class: cls || '', text: x }))) : null;
  function renderView() {
    T.charts.forEach(c => { try { c.remove(); } catch (e) {} }); T.charts = [];
    const box = $('#ttView'); box.textContent = '';
    const tr = T.cur && T.trades[T.cur];
    if (!tr) { box.append(el('section', { class: 'panel pb' }, el('p', { class: 'note', text: '기록을 고르면 예상·Claude 평가·결과·사후 분석이 여기에 나옵니다.' }))); return; }
    const p = tr.plan, long = p.direction === 'long', r = tr.result;
    const card = el('section', { class: 'panel rep-card' });
    card.append(el('div', { class: 'rep-top' }, el('span', { class: 'm', text: `${TA.dispFull(tr.sym)} · ${fdt(tr.created)} · 작성 시 ${fp(tr.price)}` }), statusChip(r)));
    card.append(el('div', { class: 'rep-title' }, el('span', { class: 'rep-badge ' + (long ? 'up' : 'down'), text: long ? '▲ 롱' : '▼ 숏' }),
      el('h2', { class: 'm', style: 'font-size:22px', text: `진입 ${fp(p.entry)} · 익절 ${fp(p.target)} · 손절 ${fp(p.stop)}` })));
    card.append(el('p', { class: 'rep-ctx', text: `목표 ${long ? '+' : '-'}${p.tpPct}% · 손절 ${long ? '-' : '+'}${p.slPct}% · 손익비 ${p.rr.toFixed(2)} : 1${p.lev > 1 ? ` · 레버리지 ${p.lev}배` : ''}${p.amt ? ` · 투자금 $${p.amt.toLocaleString()}` : ''}` }));
    if (tr.memo) card.append(el('p', { class: 'tt-memo' }, el('b', { text: '잡은 이유 ' }), tr.memo));
    // 결과
    if (r) {
      const L = [];
      if (r.status === 'waiting') L.push(`진입가 ${fp(p.entry)}에 아직 안 닿음 · ${fdt(tr.created + ENTRY_HOURS * 3600)}까지 안 닿으면 진입 실패${r.last != null ? ` · 지금 ${fp(r.last)}` : ''}`);
      else if (r.status === 'noentry') L.push(`24시간 안에 진입가 ${fp(p.entry)}에 닿지 않아 진입 실패 (0R)`);
      else {
        if (r.entered) L.push(`진입 ${fdt(r.entered)}`);
        if (r.status === 'open') { if (r.last != null) L.push(`지금 ${fp(r.last)} · 평가 손익 ${fr(r.r)}`); }
        else L.push(`${r.status === 'win' ? '익절' : '손절'} ${fdt(r.at)} · 저장 후 ${r.hours.toFixed(1)}시간`);
        L.push(`진입 후 최대 유리 ${fpct(r.mfe * 100, 2)} · 최대 불리 ${fpct(r.mae * 100, 2)}`);
      }
      if (p.amt && (r.status === 'win' || r.status === 'loss')) { const v = p.amt * p.lev * (r.status === 'win' ? p.tpPct : -p.slPct) / 100; L.push(`금액 ${v >= 0 ? '+' : '-'}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`); }
      card.append(el('div', { class: 'rep-result' }, el('b', { text: '결과' }), statusChip(r), el('span', { class: 'muted', text: L.join(' · ') })));
    }
    // 예상
    const x = tr.predict;
    if (x) card.append(el('div', { class: 'tt-block' }, el('h3', null, '대시보드 예상', chip(x.pWin == null ? 'flat' : x.pWin >= 0.5 ? 'good' : 'bad', x.pWin == null ? '—' : `익절 확률 ${(x.pWin * 100).toFixed(0)}%`)),
      el('p', { class: 'note', text: `과거 비슷한 상황(${x.tier})에서 7일 안에 결론 난 ${x.win + x.sl}번 중 익절 ${x.win}번` }),
      ul((x.factors || []).map(f => f[1]).slice(0, 8))));
    // Claude 사전 평가
    const pre = tr.pre;
    const preBox = el('div', { class: 'tt-block' }, el('h3', null, 'Claude 사전 평가', pre ? el('span', { class: 'rep-stars', text: stars(pre.score) + ` ${pre.score}점` }) : null));
    if (pre) {
      preBox.append(el('p', null, el('b', { text: pre.verdict || '' })));
      preBox.append(el('div', { class: 'rep-lights' }, VIEWS.map(([k, n]) => { const a = AGREE[(pre.views || {})[k]] || AGREE.neutral; return el('span', { class: 'rep-light' }, el('span', { class: 'muted', text: n }), chip(a[0], a[1])); })));
      preBox.append(el('div', { class: 'cols' }, el('div', null, el('h3', { text: '좋은 점' }), ul(pre.good, 'good')), el('div', null, el('h3', { text: '걱정되는 점' }), ul(pre.bad, 'bad'))));
      const kv = el('dl', { class: 'kv' });
      [['진입가', pre.entryComment], ['익절가', pre.targetComment], ['손절가', pre.stopComment], ['예상 시나리오', pre.expectation], ['더 좋은 방법', pre.advice], ['배울 점', pre.lesson]].forEach(([a, b]) => { if (b) kv.append(el('dt', { text: a }), el('dd', { style: 'font-family:var(--sans)', text: b })); });
      preBox.append(kv);
    } else preBox.append(el('p', { class: 'note', text: tr.preErr >= 2 ? `사전 평가를 받지 못했습니다: ${tr.lastErr || ''}` : T.local ? 'Claude가 평가하는 중이거나 순서를 기다리는 중입니다 (1~2분).' : '사전 평가는 내 컴퓨터 대시보드가 켜져 있을 때 만들어집니다.' }));
    card.append(preBox);
    // Claude 사후 분석
    if (r && r.final && r.status !== 'noentry') {
      const post = tr.post, pb = el('div', { class: 'tt-block' }, el('h3', { text: 'Claude 사후 분석' }));
      if (post) {
        pb.append(el('p', null, el('b', { text: post.summary || '' })), ul(post.why));
        if (post.preCheck) pb.append(el('p', null, el('b', { text: '사전 평가 점검 ' }), post.preCheck));
        pb.append(el('div', { class: 'cols' }, el('div', null, el('h3', { text: '잘한 점' }), ul(post.didWell, 'good')), el('div', null, el('h3', { text: '아쉬운 점' }), ul(post.mistakes, 'bad'))));
        if (post.nextTime) pb.append(el('p', null, el('b', { text: '다음에는 ' }), post.nextTime));
        if (post.lesson) pb.append(el('p', { class: 'rep-lesson' }, el('b', { text: '교훈 ' }), post.lesson));
      } else pb.append(el('p', { class: 'note', text: tr.postErr >= 2 ? `사후 분석을 받지 못했습니다: ${tr.lastErr || ''}` : T.local ? 'Claude가 분석하는 중이거나 순서를 기다리는 중입니다.' : '사후 분석은 내 컴퓨터 대시보드가 켜져 있을 때 만들어집니다.' }));
      card.append(pb);
    }
    // 차트
    const cbox = el('div', { class: 'tt-chart' });
    card.append(el('div', { class: 'tt-block' }, el('h3', { text: '15분봉 · ◆ 저장 시점' }), cbox));
    card.append(el('p', { class: 'note rep-disc', text: '연습용 기록입니다. 저장 후 24시간 안에 진입가에 닿아야 진입(안 닿으면 진입 실패 0R), 진입 후 하이퍼리퀴드 15분봉으로 익절·손절 중 먼저 닿은 쪽을 셉니다(같은 봉이면 손절). 투자 자문이 아닙니다.' }));
    box.append(card);
    (async () => {
      try {
        const s = await TA.load(tr.sym, '15m', 'hl'), c = miniChart(cbox, 300); T.charts.push(c.ch);
        const k0 = s.t.findIndex(t => t >= tr.created - 899), from = Math.max(0, Math.min(k0 < 0 ? s.t.length - 200 : k0 - 80, s.t.length - 200));
        setBars(c.cs, s, from); planLines(c.cs, { side: long ? 1 : -1, entry: p.entry, target: p.target, stop: p.stop });
        const mk = []; if (k0 >= from) mk.push({ time: s.t[k0] + off(s.t[k0]), position: long ? 'belowBar' : 'aboveBar', color: cv('--accent'), shape: long ? 'arrowUp' : 'arrowDown', text: '저장' });
        if (r && r.at) { const k1 = s.t.findIndex(t => t >= r.at); if (k1 >= from) mk.push({ time: s.t[k1] + off(s.t[k1]), position: 'aboveBar', color: r.status === 'win' ? cv('--up') : cv('--down'), shape: 'circle', text: r.status === 'win' ? '익절' : '손절' }); }
        mk.sort((a, b) => a.time - b.time); c.cs.setMarkers(mk);
        setTimeout(() => { try { c.ch.timeScale().fitContent(); } catch (e) {} }, 120);
      } catch (e) { cbox.append(el('p', { class: 'note', text: e.message })); }
    })();
  }

  function renderScore() {
    const box = $('#ttScore'); box.textContent = '';
    box.append(el('div', { class: 'ph' }, el('h2', { text: '내 매매 성적표' }), el('small', { text: '익절 = +손익비 R · 손절 = −1R · 진입 실패(24시간 안 미진입) = 0R · 1R은 손절 한 번에 잃는 금액' })));
    const all = T.list.map(it => T.trades[it.id]).filter(Boolean), d = done();
    if (!all.length) { box.append(el('p', { class: 'note pb', text: '기록이 쌓이면 성적이 나옵니다.' })); return; }
    const win = d.filter(t => t.result.status === 'win').length, sumR = d.reduce((a, t) => a + t.result.r, 0);
    const money = d.filter(t => t.plan.amt).reduce((a, t) => a + t.plan.amt * t.plan.lev * (t.result.status === 'win' ? t.plan.tpPct : -t.plan.slPct) / 100, 0);
    const predAvg = d.filter(t => t.predict && t.predict.pWin != null), pa = predAvg.length ? predAvg.reduce((a, t) => a + t.predict.pWin, 0) / predAvg.length : null;
    const tile = (k, v, sub, cls) => el('div', { class: 'tile' }, el('div', { class: 'k', text: k }), el('div', { class: 'v ' + (cls || ''), text: v }), el('div', { class: 's', text: sub }));
    box.append(el('div', { class: 'tiles' },
      tile('기록', String(all.length), `결과 ${d.length} · 진행 중 ${all.length - d.length}`),
      tile('성공률', d.length ? (win / d.length * 100).toFixed(0) + '%' : '—', `익절 ${win} · 손절 ${d.filter(t => t.result.status === 'loss').length} · 진입 실패 ${d.filter(t => t.result.status === 'noentry').length}`),
      tile('합계', d.length ? fr(sumR) : '—', d.length ? `1개당 평균 ${fr(sumR / d.length)}` : '', toneOf(sumR)),
      tile('금액 합계', money ? (money >= 0 ? '+' : '-') + '$' + Math.abs(money).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—', '투자금을 넣은 기록만', toneOf(money)),
      tile('예상 vs 실제', pa == null ? '—' : `${(pa * 100).toFixed(0)}% → ${(win / d.length * 100).toFixed(0)}%`, '대시보드 예상 익절 확률 평균 → 실제 성공률')));
    const tbl = (head, rows) => el('div', { class: 'tblwrap' }, el('table', null, el('thead', null, el('tr', null, head.map((h, i) => el('th', { class: i ? 'r' : '', text: h })))), el('tbody', null, rows)));
    const row = (name, g) => { const w = g.filter(t => t.result.status === 'win').length, s = g.reduce((a, t) => a + t.result.r, 0); return el('tr', null, el('td', { text: name }), el('td', { class: 'r m', text: g.length }), el('td', { class: 'r m', text: g.length ? (w / g.length * 100).toFixed(0) + '%' : '—' }), el('td', { class: 'r m ' + toneOf(s), text: g.length ? fr(s / g.length) : '—' })); };
    const cols = el('div', { class: 'cols' });
    cols.append(el('div', null, el('h3', { text: 'Claude 사전 평가 점수별 실제 결과' }), tbl(['점수', '개수', '성공률', '평균'], [5, 4, 3, 2, 1].map(k => row(stars(k), d.filter(t => t.pre && t.pre.score === k)))),
      el('p', { class: 'note', text: '점수가 높을수록 성공률이 높으면 Claude 평가를 믿을 만하다는 뜻입니다. 20~30개 이상 쌓여야 의미가 있습니다.' })));
    cols.append(el('div', null, el('h3', { text: '방향별' }), tbl(['방향', '개수', '성공률', '평균'], [row('롱', d.filter(t => t.plan.direction === 'long')), row('숏', d.filter(t => t.plan.direction === 'short'))])));
    box.append(cols);
  }

  // ---------- 전체 기록 종합 분석 (버튼) ----------
  async function runReview() {
    if (!T.local) { $('#ttRevStatus').textContent = '종합 분석은 내 컴퓨터 대시보드에서만 할 수 있습니다.'; return; }
    if (T.working) { $('#ttRevStatus').textContent = '다른 Claude 분석이 끝난 뒤 다시 눌러 주세요.'; return; }
    const all = T.list.map(it => T.trades[it.id]).filter(Boolean);
    if (!all.length) { $('#ttRevStatus').textContent = '분석할 기록이 없습니다.'; return; }
    T.working = true; window.TA_chatBusy = true; $('#ttRevGo').disabled = true;
    const t0 = Date.now();
    try {
      const k = tools();
      const lines = all.map(t => `- ${fdt(t.created)} ${TA.disp(t.sym)} ${t.plan.direction === 'long' ? '롱' : '숏'} 진입 ${fp(t.plan.entry)} 목표 ${t.plan.tpPct}% 손절 ${t.plan.slPct}% 손익비 ${t.plan.rr.toFixed(2)} · 예상 ${t.predict && t.predict.pWin != null ? (t.predict.pWin * 100).toFixed(0) + '%' : '-'} · 사전 ${t.pre ? t.pre.score + '점' : '-'} · 결과 ${t.result ? RES_NAME[t.result.status] + (t.result.hours != null ? ` ${t.result.hours.toFixed(1)}h` : '') : '-'} · 이유: ${(t.memo || '-').slice(0, 80)}${t.post && t.post.lesson ? ' · 교훈: ' + t.post.lesson : ''}`).join('\n');
      const prompt = `${HEAD}

[할 일] 사용자의 매매 테스트 전체 기록을 보고 종합 분석한다. 습관, 잘 맞는 상황, 반복되는 실수, Claude 사전 평가가 실제로 맞았는지(점수별 성공률), 다음에 시도해 볼 것을 정리한다. 기록이 적으면(20개 미만) 결론이 약하다고 솔직히 쓴다.

[출력 JSON 형식]
{ "headline": "한 줄 요약", "strengths": ["잘하는 점"], "weaknesses": ["약한 점·반복 실수"], "patterns": ["데이터에서 보이는 패턴 (숫자 포함)"],
  "claudeCheck": "Claude 사전 평가 점수와 실제 결과의 관계 평가", "tryNext": ["다음 매매에서 시도해 볼 것"], "dataNote": "데이터 양에 대한 한 줄" }

<통계>
${historyText(null)}
</통계>

<전체 기록 (최신순)>
${lines}
</전체 기록>`;
      const iv = setInterval(() => { $('#ttRevStatus').textContent = `Claude가 전체 기록을 분석하는 중… ${Math.round((Date.now() - t0) / 1000)}초`; }, 1000);
      let rv; try { rv = k.parseJson(await k.askClaude(prompt, () => {})); } finally { clearInterval(iv); }
      const created = Math.floor(Date.now() / 1000);
      const rec = { id: newId(created, 'ALL'), sym: 'ALL', created, count: all.length, plan: {}, review: rv };
      await save('reviews', rec);
      T.reviews.unshift(rec); renderReview();
      $('#ttRevStatus').textContent = `완료 · ${Math.round((Date.now() - t0) / 1000)}초`;
    } catch (e) { $('#ttRevStatus').textContent = '분석하지 못했습니다: ' + e.message; }
    finally { T.working = false; window.TA_chatBusy = false; $('#ttRevGo').disabled = false; }
  }
  function renderReview() {
    const box = $('#ttRevBody'); box.textContent = '';
    const rec = T.reviews[0];
    if (!rec) { box.append(el('p', { class: 'note', text: '아직 종합 분석이 없습니다. 기록이 몇 개 쌓이면 버튼을 눌러 보세요.' })); return; }
    const v = rec.review || {};
    box.append(el('p', { class: 'note', text: `${fdt(rec.created)} · 기록 ${rec.count}개 기준${v.dataNote ? ' · ' + v.dataNote : ''}` }), el('p', null, el('b', { text: v.headline || '' })));
    box.append(el('div', { class: 'cols' }, el('div', null, el('h3', { text: '잘하는 점' }), ul(v.strengths, 'good')), el('div', null, el('h3', { text: '약한 점' }), ul(v.weaknesses, 'bad'))));
    if ((v.patterns || []).length) box.append(el('h3', { text: '패턴' }), ul(v.patterns));
    if (v.claudeCheck) box.append(el('p', null, el('b', { text: 'Claude 평가 점검 ' }), v.claudeCheck));
    if ((v.tryNext || []).length) box.append(el('h3', { text: '다음에 시도해 볼 것' }), ul(v.tryNext, 'warn'));
  }

  // ---------- 이벤트 ----------
  function syncSym() {
    $$('#ttSym button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === T.sym)));
    $('#ttPick').textContent = TA.dispFull(T.sym);
    $$('#ttDir button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.v === T.side)));
  }
  $('#ttSym').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; T.sym = b.dataset.v; store.set('ttSym', T.sym); $('#ttEntry').value = ''; syncSym(); queuePreview(); });
  $('#ttSymForm').addEventListener('submit', async e => {
    e.preventDefault();
    const inp = $('#ttSymIn'), sym = await TA.resolveSym(inp.value).catch(() => null);
    if (!sym || !TA.hasHL(sym)) { inp.setCustomValidity(`"${inp.value}" 종목을 하이퍼리퀴드에서 찾지 못했습니다`); inp.reportValidity(); return; }
    inp.setCustomValidity(''); inp.value = ''; T.sym = sym; store.set('ttSym', sym); $('#ttEntry').value = ''; syncSym(); queuePreview();
  });
  $('#ttSymIn').addEventListener('input', () => $('#ttSymIn').setCustomValidity(''));
  $('#ttDir').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; T.side = +b.dataset.v; store.set('ttSide', T.side); syncSym(); queuePreview(); });
  $('#ttNow').addEventListener('click', async () => { try { const s = await TA.load(T.sym, '15m', 'hl'); const c = s.c[s.c.length - 1]; $('#ttEntry').value = +c.toPrecision(8); queuePreview(); } catch (e) {} });
  $('#ttParams').addEventListener('input', () => { ['ttTp', 'ttSl', 'ttAmt', 'ttLev'].forEach(id => store.set(id, $('#' + id).value)); queuePreview(); });
  $('#ttParams').addEventListener('submit', e => e.preventDefault());
  $('#ttSave').addEventListener('click', saveTrade);
  $('#ttRevGo').addEventListener('click', runReview);

  // ---------- 시작 ----------
  let started = false;
  async function loadAll() {
    T.list = await loadIndex('trades');
    await Promise.all(T.list.map(it => getRec('trades', it.id, T.trades).catch(() => null)));
    const rv = await loadIndex('reviews'), cache = {};
    T.reviews = (await Promise.all(rv.slice(0, 3).map(it => getRec('reviews', it.id, cache).catch(() => null)))).filter(Boolean);
  }
  async function start() {
    if (started) return; started = true;
    syncSym();
    try { const r = await fetch('api/ask/status', { headers: { 'X-Dashboard': '1' }, cache: 'no-store' }); T.local = r.ok; } catch (e) { T.local = false; }
    if (!T.local) { $('#ttSave').disabled = true; $('#ttRevGo').disabled = true; setStatus('기록 저장과 Claude 분석은 내 컴퓨터 대시보드(http://localhost:8765)에서만 됩니다. 저장된 기록은 여기서도 볼 수 있습니다.'); }
    queuePreview();
    await loadAll();
    if (!T.cur && T.list.length) T.cur = T.list[0].id;
    renderList(); renderView(); renderScore(); renderReview();
    if (await scoreAll()) { renderList(); renderView(); renderScore(); }
    work();
  }
  window.addEventListener('tabchange', e => { if (e.detail === 'test') start(); });
  window.addEventListener('themechange', () => { if (started) { renderView(); queuePreview(); } });
  if (U.activeTab() === 'test') start();
  // 내 컴퓨터 대시보드가 켜져 있으면 어느 탭을 보고 있든 5분마다 채점하고, 필요한 Claude 분석을 진행합니다.
  setInterval(async () => {
    if (!started) { if (!document.hidden) { try { const r = await fetch('api/ask/status', { headers: { 'X-Dashboard': '1' }, cache: 'no-store' }); if (r.ok) start(); } catch (e) {} } return; }
    if (await scoreAll()) { renderList(); if (U.activeTab() === 'test') renderView(); renderScore(); }
    work();
  }, 300000);
})();
