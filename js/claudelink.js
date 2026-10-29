// Claude 연결 (리포트 탭): 리포트 작성에 쓰는 이 PC의 Claude Code 로그인 상태를 보여 주고, 로그인 창을 엽니다.
// start-local.bat 서버(api/ask/status, api/login)에서만 작동합니다.
(function () {
  const $ = s => document.querySelector(s);
  if (!$('#claudeLink')) return;

  function show(st) {
    const el = $('#clState');
    el.className = 'note';
    $('#clLogin').hidden = !(st.reachable && st.available && !st.loggedIn);
    if (!st.reachable) { el.textContent = '이 주소에서는 Claude를 쓸 수 없습니다. 대시보드 폴더의 start-local.bat으로 열어 주세요 (http://localhost:8765).'; el.classList.add('warn'); }
    else if (!st.available) { el.textContent = '이 PC에서 Claude Code를 찾지 못했습니다. Claude 데스크톱 앱이 설치돼 있는지 확인해 주세요.'; el.classList.add('warn'); }
    else if (!st.loggedIn) { el.textContent = '로그인이 필요합니다. 오른쪽 버튼으로 로그인 창을 열고, 브라우저에서 Claude 계정으로 승인한 뒤 "상태 다시 확인"을 누르세요. (Claude Pro 또는 Max 플랜 필요)'; el.classList.add('warn'); }
    else { el.textContent = '연결됨 · 리포트는 내 Claude 구독으로 작성합니다 (추가 요금 없음).'; el.classList.add('up'); }
  }

  async function check(refresh) {
    $('#clState').textContent = '상태 확인 중…';
    try {
      const r = await fetch('api/ask/status' + (refresh ? '?refresh=1' : ''), { headers: { 'X-Dashboard': '1' }, cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      show({ reachable: true, available: !!j.available, loggedIn: !!j.loggedIn });
    } catch (e) { show({ reachable: false }); }
  }

  $('#clRecheck').addEventListener('click', () => check(true));
  $('#clLogin').addEventListener('click', async () => {
    try { await fetch('api/login', { method: 'POST', headers: { 'X-Dashboard': '1' } }); } catch (e) {}
    $('#clState').textContent = '로그인 창을 열었습니다. 브라우저에 뜬 Claude 페이지에서 승인을 마친 뒤 "상태 다시 확인"을 누르세요.';
  });
  check(false);
})();
