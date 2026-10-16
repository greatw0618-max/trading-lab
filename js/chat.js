// 분석법 질문하기: ICT·엘리엇·와이코프·다이버전스에 대해 Claude에게 묻고 답을 받는 대화창.
// 무료 방식: start-local.bat 서버가 이 PC의 Claude Code(내 Claude 구독)로 전달합니다.
// API 방식: 키는 이 브라우저의 localStorage에만 저장되고, 요청은 브라우저에서 Anthropic API로 바로 갑니다.
import Anthropic from 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm';

const TA = window.TA, U = TA && TA.ui;
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const store = U ? U.store : { get: (k, d) => d, set() {} };

const MODEL = 'claude-opus-5-5';
const PRICE = { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 }; // 1M 토큰당 달러
const MAX_SAVED = 40;

const METHODS = {
  ict: { name: 'ICT', sugg: ['지금 차트의 ICT 구조를 쉽게 설명해줘', 'BOS와 CHoCH는 어떻게 구분해?', 'FVG와 오더블록은 실전에서 어떻게 써?', '유동성 스윕이 나오면 무엇을 확인해야 해?'] },
  elliott: { name: '엘리엇 파동', sugg: ['지금 엘리엇 카운트가 왜 이렇게 나왔어?', '3파와 C파는 어떻게 구분해?', '대안 카운트가 맞다면 어떤 흐름이 나와?', '파동 무효화 가격은 어떻게 활용해?'] },
  wyckoff: { name: '와이코프', sugg: ['지금 와이코프 국면을 설명해줘', '스프링이 진짜인지 가짜인지 어떻게 알아?', '축적과 재분산은 어떻게 구별해?', '거래량은 와이코프에서 어떻게 읽어?'] },
  divergence: { name: '다이버전스', sugg: ['지금 차트에 다이버전스가 있어? 의미는?', '일반 다이버전스와 히든 다이버전스 차이는?', '다이버전스가 실패하는 경우는 언제야?', '다이버전스를 다른 분석법과 같이 보는 법은?'] }
};
const GENERAL_SUGG = ['지금 차트를 네 가지 분석법으로 종합해서 설명해줘', '분석법끼리 신호가 엇갈리면 어떻게 봐야 해?', '이 차트에서 가장 중요한 가격대는 어디야?'];

// 바뀌지 않는 부분이라 프롬프트 캐시에 잘 걸리도록 고정해 둡니다.
const SYSTEM = `너는 "매매연구소" 대시보드 안에 있는 차트 분석 도우미다. 사용자는 한국어로 질문하고, ICT(스마트머니 개념), 엘리엇 파동, 와이코프, 다이버전스(가격과 RSI) 분석법을 공부하며 자기 매매에 적용하려 한다. 사용자는 주로 SOXL·KORU 같은 3배 레버리지 ETF와 하이퍼리퀴드 코인을 짧게 매매한다.

답하는 방식:
- 한국어로, 짧은 문단과 목록으로 답한다. 어려운 용어는 처음 나올 때 쉬운 말로 풀어 준다. 지연에 민감한 채팅이므로 바로 본론부터 답한다.
- 사용자가 <차트 데이터>를 보내면 그 안의 숫자와 날짜를 근거로 지금 차트에 적용해 설명한다. 데이터에 없는 가격이나 사실은 지어내지 않고, 모르면 데이터에 없다고 말한다.
- [질문 분석법]이 지정되면 그 관점 중심으로 답하고, 다른 분석법과 연결하면 이해에 도움이 될 때만 짧게 덧붙인다.
- 대시보드 판독은 아래 규칙으로 계산한 자동 추정이다. "왜 이렇게 나왔어?"라고 물으면 이 규칙과 데이터로 설명하고, 사람이 보면 다르게 셀 수 있는 부분도 솔직히 말한다.
- 매수·매도·보유를 지시하거나 특정 가격에 사라/팔라고 권하지 않는다. 대신 시나리오(이렇게 되면 이런 해석), 확인할 신호, 무효화 조건을 정리한다. 사용자가 매매 결정을 직접 물으면 결정은 본인 몫이라고 한 줄로 말한 뒤 판단 기준을 정리해 준다.

대시보드 계산 방식:
- 엘리엇: ATR 기반 지그재그(봉 주기별 배수 15분 5, 1시간 4, 4시간·일봉 3)로 고점·저점을 찾고, 마지막 2~6개 점을 충격파(1~5파)와 조정파(A-B-C) 규칙(2파는 1파 시작점 아래로 안 감, 4파는 1파 고점과 안 겹침, 3파가 가장 짧지 않음)과 피보나치 비율(2파 50~61.8% 되돌림, 3파 1.618배, 4파 23.6~38.2%, C=A)로 점수화해 상위 3개 후보와 가능성 %를 낸다. 큰 흐름(확정된 고점·저점이 높아지는지)과 같은 방향의 카운트에 가산점을 준다. 목표가는 아직 닿지 않은 첫 비율(1.618 → 2.618 → 4.236배 등)을 쓴다.
- ICT: 좌우 3봉 프랙탈 고점·저점, 종가 돌파로 BOS(추세 지속)와 CHoCH(추세 전환), 꼬리로 깨고 종가가 되돌아오면 유동성 스윕, 3봉 사이 갭은 FVG(다시 채워지지 않은 것만), 구조를 깬 움직임 직전의 반대색 봉은 오더블록, 최근 고점~저점 딜링 레인지 50% 기준 프리미엄·디스카운트, OTE는 62~79% 되돌림.
- 와이코프: 최근 약 80봉으로 박스(저점 5%·고점 95% 분위)를 잡고, 그 전 흐름으로 축적·분산을 나눈다. 최근 30봉의 스프링·업스러스트·SOS·SOW, 박스 초반 거래량 폭발 봉으로 SC·BC를 찾고, 하락봉과 상승봉의 평균 거래량을 비교한다.
- 다이버전스: 좌우 3봉 프랙탈 저점(또는 고점) 두 개의 가격과 RSI14를 비교한다. 일반 강세(가격 저점↓, RSI 저점↑), 히든 강세(가격 저점↑, RSI 저점↓), 일반 약세(가격 고점↑, RSI 고점↓), 히든 약세(가격 고점↓, RSI 고점↑). 최근 20봉 안의 것만 보고, 마지막 점이 아직 확정 전이면 "진행 중"이다.
- 방향성 점수: 1시간 ICT 구조, 4시간 EMA50 추세, 일봉 EMA20/50 추세를 각각 +1/0/-1로 더한 값(+2 이상 상승 우호, -2 이하 하락 우세).
- 예상 투자 결과: 과거 봉 중 RSI와 방향성 점수가 지금과 비슷했던 시점에 같은 비율의 진입·목표·손절로 들어갔다고 가정하고 보유 기간 안에 목표에 먼저 닿은 비율을 센 값이다.`;

// ---------- 상태 ----------
let key = store.get('chatKey', '') || '';
// 답변 방식: 'free' = 이 PC의 Claude Code(내 Claude 구독, 추가 요금 없음), 'api' = API 키(유료)
let mode = store.get('chatMode', 'free') === 'api' ? 'api' : 'free';
let free = { checked: false, reachable: false, available: false, loggedIn: false };
let msgs = [];
try { msgs = JSON.parse(store.get('chatLog', '[]')).filter(m => m && m.role && typeof m.content === 'string'); } catch (e) { msgs = []; }
let busy = false, current = null, spend = +store.get('chatSpend', '0') || 0;
try { JSON.parse(store.get('chatMethods', '[]')).forEach(v => { const c = $(`#chatMethods input[value="${v}"]`); if (c) c.checked = true; }); } catch (e) {}
const saveLog = () => store.set('chatLog', JSON.stringify(msgs.filter(m => !m.pending).slice(-MAX_SAVED)));
const checkedMethods = () => $$('#chatMethods input:checked').map(c => c.value);

// ---------- 간단한 마크다운 표시 (먼저 HTML을 이스케이프해서 안전하게) ----------
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
function md(text) {
  const lines = text.split('\n'), out = [];
  let list = null, para = [], table = [];
  const flushPara = () => { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>` + list.items.map(i => '<li>' + inline(i) + '</li>').join('') + `</${list.tag}>`); list = null; } };
  const flushTable = () => {
    if (!table.length) return;
    const rows = table.filter(r => !/^\|\s*:?-{2,}/.test(r)).map(r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
    out.push('<div class="tblwrap"><table>' + rows.map((r, i) => '<tr>' + r.map(c => (i === 0 ? '<th>' : '<td>') + inline(c) + (i === 0 ? '</th>' : '</td>')).join('') + '</tr>').join('') + '</table></div>');
    table = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*\|.*\|\s*$/.test(line)) { flushPara(); flushList(); table.push(line.trim()); continue; }
    flushTable();
    let m;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = line.match(/^#{1,6}\s+(.*)/))) { flushPara(); flushList(); out.push('<h4>' + inline(m[1]) + '</h4>'); continue; }
    if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { flushPara(); if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; } list.items.push(m[1]); continue; }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { flushPara(); if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; } list.items.push(m[1]); continue; }
    flushList(); para.push(line);
  }
  flushPara(); flushList(); flushTable();
  return out.join('');
}

// ---------- 화면 ----------
const usd = v => '$' + (v < 0.01 ? v.toFixed(4) : v.toFixed(3));
function render() {
  const log = $('#chatLog'); log.textContent = '';
  if (!msgs.length) {
    const m = checkedMethods().map(v => METHODS[v].name);
    log.innerHTML = `<div class="chat-empty"><b>${m.length ? esc(m.join(' · ')) + '에 대해' : '분석법을 고르고'} 궁금한 걸 물어보세요.</b>` +
      '<span>"지금 보는 차트의 분석 결과를 함께 보내기"가 켜져 있으면, 화면에 보이는 종목·봉 주기의 엘리엇·ICT·와이코프·다이버전스 판독값과 최근 30봉 가격이 질문과 함께 전달됩니다. 이전 대화도 이어서 기억합니다.</span></div>';
    return;
  }
  for (const m of msgs) log.append(bubble(m));
  log.scrollTop = log.scrollHeight;
}
function bubble(m) {
  const div = document.createElement('div');
  div.className = 'msg ' + (m.role === 'user' ? 'user' : 'bot') + (m.error ? ' err' : '');
  if (m.role === 'user') div.textContent = m.display || m.content;
  else if (m.pending && !m.content) div.innerHTML = '<span class="typing">생각하는 중…</span>';
  else div.innerHTML = md(m.content);
  if (m.meta) { const s = document.createElement('span'); s.className = 'meta'; s.textContent = m.meta; div.append(s); }
  return div;
}
let paintQueued = false;
function repaintLast() {
  if (paintQueued) return; paintQueued = true;
  requestAnimationFrame(() => {
    paintQueued = false;
    const log = $('#chatLog'), last = log.lastElementChild, m = msgs[msgs.length - 1];
    if (!last || !m) return;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    last.replaceWith(bubble(m));
    if (atBottom) log.scrollTop = log.scrollHeight;
  });
}
function renderSugg() {
  const box = $('#chatSugg'); box.textContent = '';
  const ms = checkedMethods();
  const list = ms.length ? ms.flatMap(v => METHODS[v].sugg.slice(0, ms.length > 1 ? 2 : 4)) : GENERAL_SUGG;
  list.forEach(q => { const b = document.createElement('button'); b.type = 'button'; b.textContent = q; b.addEventListener('click', () => send(q)); box.append(b); });
  $('#chatIn').placeholder = ms.length ? `${ms.map(v => METHODS[v].name).join('·')}에 대해 궁금한 걸 물어보세요 (Enter 보내기, Shift+Enter 줄바꿈)` : '궁금한 걸 물어보세요 (Enter 보내기, Shift+Enter 줄바꿈)';
}
const freeReady = () => free.reachable && free.available && free.loggedIn;
function renderKey() {
  $$('#chatMode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === mode)));
  $('#chatFree').hidden = mode !== 'free'; $('#chatApi').hidden = mode !== 'api';
  $('#chatKeyBtn').textContent = mode === 'free' ? (freeReady() ? '무료 연결됨' : '연결 설정') : (key ? 'API 키 연결됨' : '연결 설정');
  $('#chatKeyState').textContent = key ? `저장된 키: ${key.slice(0, 10)}…${key.slice(-4)}` : '아직 저장된 키가 없습니다.';
  const st = $('#chatFreeState');
  $('#chatLogin').hidden = !(free.reachable && free.available && !free.loggedIn);
  st.className = 'note';
  if (!free.checked) st.textContent = '상태 확인 중…';
  else if (!free.reachable) { st.textContent = '이 화면은 무료 방식을 쓸 수 없는 주소로 열려 있습니다. 대시보드 폴더의 start-local.bat으로 열면(주소 http://localhost:8765) 무료로 질문할 수 있습니다.'; st.classList.add('warn'); }
  else if (!free.available) { st.textContent = '이 PC에서 Claude Code를 찾지 못했습니다. Claude 데스크톱 앱이 설치돼 있는지 확인해 주세요.'; st.classList.add('warn'); }
  else if (!free.loggedIn) { st.textContent = 'Claude Code에 아직 로그인하지 않았습니다. 아래 버튼으로 로그인 창을 열고, 브라우저에서 지금 쓰시는 Claude 계정으로 승인한 뒤 "상태 다시 확인"을 누르세요. (Claude Pro 또는 Max 플랜이 필요합니다)'; st.classList.add('warn'); }
  else { st.textContent = '연결됨 · 질문은 내 Claude 구독으로 답합니다 (추가 요금 없음).'; st.classList.add('up'); }
  $('#chatCost').textContent = mode === 'api' && spend > 0 ? `이 브라우저 API 누적 사용료 약 ${usd(spend)}` : mode === 'free' ? '무료 (내 Claude 구독)' : '';
}
async function checkFree(refresh) {
  try {
    const r = await fetch('api/ask/status' + (refresh ? '?refresh=1' : ''), { headers: { 'X-Dashboard': '1' }, cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    free = { checked: true, reachable: true, available: !!j.available, loggedIn: !!j.loggedIn };
  } catch (e) { free = { checked: true, reachable: false, available: false, loggedIn: false }; }
  renderKey();
  return freeReady();
}
function setBusy(b) {
  busy = b;
  window.TA_chatBusy = b; // 답변을 받는 중에는 자동 새로고침을 미룹니다

  $('#chatSend').textContent = b ? '중지' : '보내기';
  $('#chatSend').classList.toggle('primary', !b);
}

// ---------- 보내기 ----------
// 이전 대화는 질문 문장만 남기고, 차트 데이터는 이번 질문에만 붙입니다(토큰 절약).
function historyFor(nowContent) {
  const done = msgs.filter(m => !m.pending && !m.error);
  done.pop(); // 방금 넣은 이번 질문
  return [...done.map(m => ({ role: m.role, content: m.role === 'user' ? (m.display || m.content) : m.content })), { role: 'user', content: nowContent }];
}

async function send(question) {
  question = (question || '').trim();
  if (!question || busy) return;
  if (mode === 'free' && !freeReady()) {
    if (!(await checkFree(true))) { $('#chatKey').hidden = false; $('#chatFreeState').scrollIntoView({ block: 'nearest' }); return; }
  }
  if (mode === 'api' && !key) { $('#chatKey').hidden = false; $('#chatKeyIn').focus(); $('#chatKeyState').textContent = '먼저 API 키를 저장해 주세요.'; return; }
  const ms = checkedMethods();
  const ctx = $('#chatCtx').checked && U && U.chartContext ? U.chartContext() : null;
  let content = '';
  if (ms.length) content += `[질문 분석법: ${ms.map(v => METHODS[v].name).join(', ')}]\n`;
  if (ctx) content += `<차트 데이터>\n${ctx.text}\n</차트 데이터>\n\n`;
  content += `질문: ${question}`;
  const meta = [ms.length ? ms.map(v => METHODS[v].name).join('·') : '', ctx ? `${ctx.label} 차트 데이터 포함` : ''].filter(Boolean).join(' · ');
  msgs.push({ role: 'user', content, display: question, meta });
  const bot = { role: 'assistant', content: '', pending: true };
  msgs.push(bot);
  $('#chatIn').value = '';
  render(); setBusy(true);
  const history = historyFor(content);
  try {
    if (mode === 'free') await askFree(history, bot); else await askApi(history, bot);
  } finally {
    bot.pending = false; current = null;
    setBusy(false); repaintLast(); saveLog(); renderKey();
  }
}

// 무료: 로컬 서버(start-local.bat)가 이 PC의 Claude Code로 전달합니다.
async function askFree(history, bot) {
  const turns = history.slice(0, -1).map(m => `[${m.role === 'user' ? '사용자' : '도우미'}]\n${m.content}`).join('\n\n');
  const prompt = `${SYSTEM}\n\n${turns ? '[이전 대화]\n' + turns + '\n\n' : ''}[이번 질문]\n${history[history.length - 1].content}`;
  const ctrl = new AbortController();
  current = { abort: () => ctrl.abort() };
  const ERR = '\u0001ERR:';
  try {
    const r = await fetch('api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dashboard': '1' }, body: JSON.stringify({ prompt }), signal: ctrl.signal });
    if (!r.ok || !r.body) throw new Error('로컬 서버 응답 오류 ' + r.status);
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const k = buf.indexOf(ERR);
      bot.content = k >= 0 ? buf.slice(0, k) : buf;
      repaintLast();
    }
    buf += dec.decode();
    const k = buf.indexOf(ERR);
    if (k >= 0) {
      const why = buf.slice(k + ERR.length).trim();
      const before = buf.slice(0, k).trim();
      bot.error = !before;
      bot.content = (before ? before + '\n\n' : '') + (
        why === 'NOT_FOUND' ? '이 PC에서 Claude Code를 찾지 못했습니다.'
        : /log ?in|logged|auth|credential|401/i.test(why) ? 'Claude Code 로그인이 필요합니다. "연결 설정"에서 로그인한 뒤 다시 보내 주세요.'
        : /limit|usage|quota|429/i.test(why) ? 'Claude 플랜의 사용 한도에 도달했습니다. 한도가 초기화된 뒤 다시 보내 주세요. (' + why + ')'
        : '답변을 받지 못했습니다: ' + why);
      if (/log ?in|logged|auth/i.test(why)) { free.loggedIn = false; $('#chatKey').hidden = false; }
    } else {
      bot.content = buf.trim() || '(빈 답변을 받았습니다. 다시 보내 주세요.)';
      bot.meta = '내 Claude 구독으로 답변 · 추가 요금 없음';
    }
  } catch (err) {
    if (err.name === 'AbortError') bot.content = (bot.content || '') + '\n\n(중지했습니다)';
    else { bot.error = true; bot.content = '로컬 서버에 연결하지 못했습니다. start-local.bat 창이 켜져 있는지 확인해 주세요. (' + (err.message || err) + ')'; }
  }
}

// 유료: API 키로 Anthropic API를 직접 부릅니다.
async function askApi(history, bot) {
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
  try {
    current = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      system: SYSTEM,
      messages: history
    });
    current.on('text', delta => { bot.content += delta; repaintLast(); });
    const final = await current.finalMessage();
    if (final.stop_reason === 'refusal') {
      bot.content = (bot.content ? bot.content + '\n\n' : '') + '이 질문은 안전 정책에 걸려 답을 받지 못했습니다. 표현을 바꿔 다시 물어보세요.';
    } else if (final.stop_reason === 'max_tokens') {
      bot.content += '\n\n(답변이 길어 중간에 끊겼습니다. "이어서 설명해줘"라고 물어보세요.)';
    }
    const u = final.usage || {};
    const cost = ((u.input_tokens || 0) * PRICE.in + (u.output_tokens || 0) * PRICE.out + (u.cache_read_input_tokens || 0) * PRICE.cacheRead + (u.cache_creation_input_tokens || 0) * PRICE.cacheWrite) / 1e6;
    spend += cost; store.set('chatSpend', String(spend));
    bot.meta = `Claude Opus 5.5 (API) · 이번 답변 약 ${usd(cost)}`;
  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError) {
      bot.content = (bot.content || '') + '\n\n(중지했습니다)';
    } else {
      bot.error = true;
      bot.content = err instanceof Anthropic.AuthenticationError ? 'API 키가 올바르지 않습니다. "연결 설정"에서 키를 다시 확인해 주세요.'
        : err instanceof Anthropic.PermissionDeniedError ? '이 API 키로는 이 모델을 쓸 수 없습니다. Anthropic 콘솔에서 키 권한과 결제 상태를 확인해 주세요.'
        : err instanceof Anthropic.RateLimitError ? '요청이 잠시 몰렸습니다. 1분쯤 뒤에 다시 보내 주세요.'
        : err instanceof Anthropic.BadRequestError ? '요청을 처리하지 못했습니다: ' + (err.message || '') + (/credit|balance/i.test(err.message || '') ? ' (API 크레딧이 부족할 수 있습니다)' : '')
        : err instanceof Anthropic.APIConnectionError ? 'Anthropic 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.'
        : err instanceof Anthropic.APIError ? `Anthropic API 오류 (${err.status}): ${err.message}`
        : '답변을 받는 중 문제가 생겼습니다: ' + (err && err.message || err);
    }
  }
}

// ---------- 이벤트 ----------
$('#chatForm').addEventListener('submit', e => {
  e.preventDefault();
  if (busy) { if (current) current.abort(); return; }
  send($('#chatIn').value);
});
$('#chatIn').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!busy) send($('#chatIn').value); }
});
$('#chatMethods').addEventListener('change', () => { store.set('chatMethods', JSON.stringify(checkedMethods())); renderSugg(); if (!msgs.length) render(); });
$('#chatKeyBtn').addEventListener('click', () => { $('#chatKey').hidden = !$('#chatKey').hidden; if (!$('#chatKey').hidden && mode === 'free') checkFree(true); });
$('#chatMode').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  mode = b.dataset.v; store.set('chatMode', mode); renderKey();
  if (mode === 'free') checkFree(true); else $('#chatKeyIn').focus();
});
$('#chatRecheck').addEventListener('click', () => checkFree(true));
$('#chatLogin').addEventListener('click', async () => {
  try { await fetch('api/login', { method: 'POST', headers: { 'X-Dashboard': '1' } }); } catch (e) {}
  $('#chatFreeState').textContent = '로그인 창을 열었습니다. 브라우저에 뜬 Claude 페이지에서 승인을 마친 뒤 "상태 다시 확인"을 누르세요.';
});
$('#chatApi').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('#chatKeyIn').value.trim();
  if (!/^sk-ant-/.test(v)) { $('#chatKeyState').textContent = 'sk-ant-로 시작하는 Anthropic API 키를 넣어 주세요.'; return; }
  key = v; store.set('chatKey', key); $('#chatKeyIn').value = ''; renderKey();
  $('#chatKeyState').textContent = '저장했습니다. 이제 질문할 수 있습니다.';
  setTimeout(() => { $('#chatKey').hidden = true; renderKey(); }, 1200);
});
$('#chatKeyDel').addEventListener('click', () => { key = ''; store.set('chatKey', ''); renderKey(); });
let clearArmed = null;
$('#chatClear').addEventListener('click', () => {
  if (!msgs.length) return;
  if (!clearArmed) {
    $('#chatClear').textContent = '한 번 더 누르면 지워집니다';
    clearArmed = setTimeout(() => { clearArmed = null; $('#chatClear').textContent = '대화 지우기'; }, 3000);
    return;
  }
  clearTimeout(clearArmed); clearArmed = null; $('#chatClear').textContent = '대화 지우기';
  if (current) current.abort();
  msgs = []; saveLog(); render();
});

// ---------- 시작 ----------
renderKey(); renderSugg(); render();
checkFree(false).then(ok => { if ((mode === 'free' && !ok) || (mode === 'api' && !key)) $('#chatKey').hidden = false; });
