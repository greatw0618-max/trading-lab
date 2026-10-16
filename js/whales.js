// 고래 추적 탭: 지정 지갑 포지션, 상위 트레이더 포지션 집계, 청산 구간 맵, 리더보드
(() => {
  const TA = window.TA, U = TA.ui;
  if (!U) return;
  const { el, fp, fpct, fusd, fdt, chip, store, toneOf } = U;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];

  const DEFAULT_WALLETS = [
    { a: '0xb317d2bc2d3d2df5fa441b5bae0ab9d8b07283ae', label: '10·10 관세 숏 고래 (트럼프 내부자 의혹)' }
  ];
  let wallets;
  try { wallets = JSON.parse(store.get('wallets', 'null')) || DEFAULT_WALLETS; } catch (e) { wallets = DEFAULT_WALLETS; }
  const saveWallets = () => store.set('wallets', JSON.stringify(wallets));
  const short = a => a.slice(0, 6) + '…' + a.slice(-4);
  const DIR = { 'Open Long': '롱 진입', 'Close Long': '롱 정리', 'Open Short': '숏 진입', 'Close Short': '숏 정리', 'Long > Short': '롱→숏 전환', 'Short > Long': '숏→롱 전환', 'Buy': '현물 매수', 'Sell': '현물 매도' };
  const dirKo = d => DIR[d] || (d && d.startsWith('Liquidated') ? (d.includes('Long') ? '롱 강제청산' : '숏 강제청산') : d);
  const coinName = c => c.replace(/^xyz:/, '') + (c.startsWith('xyz:') ? ' (주식)' : '');

  async function pool(items, size, fn) {
    const out = new Array(items.length); let k = 0;
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
      while (k < items.length) { const i = k++; try { out[i] = await fn(items[i], i); } catch (e) { out[i] = null; } }
    }));
    return out;
  }

  // 메인 무기한 선물 + 주식(xyz) 포지션을 합쳐서 가져옵니다.
  async function positionsOf(addr) {
    const [m, x] = await Promise.all([
      TA.hl({ type: 'clearinghouseState', user: addr }),
      TA.hl({ type: 'clearinghouseState', user: addr, dex: 'xyz' }).catch(() => null)
    ]);
    const pos = [];
    [m, x].forEach(st => {
      if (!st) return;
      st.assetPositions.forEach(ap => {
        const p = ap.position, szi = +p.szi; if (!szi) return;
        const val = +p.positionValue;
        pos.push({ coin: p.coin, szi, side: szi > 0 ? 1 : -1, val, entry: +p.entryPx, mark: val / Math.abs(szi), upnl: +p.unrealizedPnl, roe: +p.returnOnEquity * 100,
          liq: p.liquidationPx == null ? null : +p.liquidationPx, lev: p.leverage ? p.leverage.value : null });
      });
    });
    const av = (+(m && m.marginSummary.accountValue) || 0) + (+(x && x.marginSummary.accountValue) || 0);
    return { pos, av };
  }

  // ---------- 추적 지갑 ----------
  function trackChanges(addr, pos) {
    let snap = null, log = [];
    try { snap = JSON.parse(store.get('snap.' + addr, 'null')); log = JSON.parse(store.get('chg.' + addr, '[]')); } catch (e) {}
    const now = {}; pos.forEach(p => { now[p.coin] = p.szi; });
    if (snap) {
      const at = Date.now() / 1000;
      const coins = new Set([...Object.keys(snap), ...Object.keys(now)]);
      coins.forEach(c => {
        const a = snap[c] || 0, b = now[c] || 0;
        if (a === b) return;
        let txt, tone;
        if (!a) { txt = `${coinName(c)} ${b > 0 ? '롱' : '숏'} 신규 진입`; tone = 'warn'; }
        else if (!b) { txt = `${coinName(c)} ${a > 0 ? '롱' : '숏'} 전량 정리`; tone = 'flat'; }
        else if (Math.sign(a) !== Math.sign(b)) { txt = `${coinName(c)} ${a > 0 ? '롱→숏' : '숏→롱'} 전환`; tone = 'warn'; }
        else { const ch = (Math.abs(b) / Math.abs(a) - 1) * 100; if (Math.abs(ch) < 2) return; txt = `${coinName(c)} ${b > 0 ? '롱' : '숏'} ${ch > 0 ? '증가' : '축소'} ${fpct(ch, 0)}`; tone = ch > 0 ? 'warn' : 'flat'; }
        log.unshift({ at, txt, tone });
      });
      log = log.slice(0, 12);
    }
    store.set('snap.' + addr, JSON.stringify(now)); store.set('chg.' + addr, JSON.stringify(log));
    return log;
  }

  async function loadWallets() {
    const box = $('#wallets');
    const data = await pool(wallets, 4, async w => {
      const [p, fills] = await Promise.all([positionsOf(w.a), TA.hl({ type: 'userFills', user: w.a })]);
      return { ...p, fills: fills.slice(0, 8), log: trackChanges(w.a, p.pos) };
    });
    box.textContent = '';
    if (!wallets.length) { box.append(el('div', { class: 'pb' }, el('p', { class: 'note', text: '추적 중인 지갑이 없습니다. 위에 주소를 넣거나, 아래 리더보드에서 "추적"을 누르세요.' }))); return; }
    wallets.forEach((w, k) => {
      const d = data[k];
      const head = el('div', { class: 'wallet-h' }, el('b', { text: w.label || short(w.a) }), el('span', { class: 'addr', text: w.a }),
        el('a', { href: `https://hypurrscan.io/address/${w.a}`, target: '_blank', rel: 'noopener', text: 'HypurrScan에서 보기' }),
        el('button', { class: 'btn rm', type: 'button', text: '삭제', onclick: () => { wallets.splice(k, 1); saveWallets(); loadWallets(); } }));
      const card = el('div', { class: 'wallet' }, head);
      if (!d) { card.append(el('p', { class: 'note down', text: '이 지갑의 정보를 불러오지 못했습니다. 주소를 확인하세요.' })); box.append(card); return; }
      const upnl = d.pos.reduce((a, p) => a + p.upnl, 0);
      card.append(el('div', { class: 'chg' }, el('span', { class: 'muted', text: `계좌 가치 ${fusd(d.av)}` }), el('span', { class: toneOf(upnl), text: `미실현 손익 ${fusd(upnl)}` }), el('span', { class: 'muted', text: `포지션 ${d.pos.length}개` })));
      if (d.log.length) card.append(el('div', { class: 'chg' }, el('span', { class: 'muted', text: '최근 변화' }), ...d.log.slice(0, 6).map(x => chip(x.tone, `${fdt(x.at)} ${x.txt}`))));
      if (d.pos.length) {
        const t = el('table', null, el('thead', null, el('tr', null, ...['코인', '방향', '규모', '진입가', '현재가', '미실현 손익', '청산가', '레버리지'].map((h, i) => el('th', { class: i > 1 ? 'r' : '', text: h })))));
        const tb = el('tbody');
        d.pos.sort((a, b) => b.val - a.val).forEach(p => tb.append(el('tr', null,
          el('td', null, el('b', { text: coinName(p.coin) })), el('td', null, chip(p.side > 0 ? 'good' : 'bad', p.side > 0 ? '롱' : '숏')),
          el('td', { class: 'r m', text: fusd(p.val) }), el('td', { class: 'r m', text: fp(p.entry) }), el('td', { class: 'r m', text: fp(p.mark) }),
          el('td', { class: 'r m ' + toneOf(p.upnl), text: `${fusd(p.upnl)} (${fpct(p.roe, 1)})` }),
          el('td', { class: 'r m', text: p.liq ? `${fp(p.liq)} (${fpct((p.liq / p.mark - 1) * 100, 1)})` : '—' }),
          el('td', { class: 'r m', text: p.lev ? p.lev + '배' : '—' }))));
        t.append(tb); card.append(el('div', { class: 'tblwrap' }, t));
      } else card.append(el('p', { class: 'note', text: '현재 열린 포지션이 없습니다.' }));
      if (d.fills.length) {
        const f = el('table', { class: 'fills' }, el('thead', null, el('tr', null, ...['최근 체결', '코인', '구분', '가격', '규모', '실현 손익'].map((h, i) => el('th', { class: i > 2 ? 'r' : '', text: h })))));
        const fb = el('tbody');
        d.fills.forEach(x => fb.append(el('tr', null, el('td', { class: 'm', text: fdt(x.time / 1000) }), el('td', { text: coinName(x.coin) }), el('td', { text: dirKo(x.dir) }),
          el('td', { class: 'r m', text: fp(+x.px) }), el('td', { class: 'r m', text: fusd(+x.px * +x.sz) }), el('td', { class: 'r m ' + toneOf(+x.closedPnl), text: +x.closedPnl ? fusd(+x.closedPnl) : '—' }))));
        f.append(fb); card.append(el('div', { class: 'tblwrap' }, f));
      }
      box.append(card);
    });
  }

  $('#addForm').addEventListener('submit', e => {
    e.preventDefault();
    const a = $('#w-addr').value.trim().toLowerCase(), label = $('#w-label').value.trim();
    if (!/^0x[0-9a-f]{40}$/.test(a)) { $('#w-addr').setCustomValidity('0x로 시작하는 42자리 지갑 주소를 넣어 주세요'); $('#w-addr').reportValidity(); return; }
    $('#w-addr').setCustomValidity('');
    if (!wallets.some(w => w.a === a)) wallets.unshift({ a, label }); saveWallets();
    $('#w-addr').value = ''; $('#w-label').value = ''; loadWallets();
  });
  $('#w-addr').addEventListener('input', () => $('#w-addr').setCustomValidity(''));

  // ---------- 리더보드 · 집계 ----------
  const W = { key: store.get('lbKey', 'mPnl'), n: +store.get('lbN', '40'), lb: null, agg: null, positions: [], liqCoin: store.get('liqCoin', 'BTC') };
  async function loadLB() {
    if (W.lb) return W.lb;
    const r = await fetch('data/leaderboard.json?v=' + Math.floor(Date.now() / 600e3));
    if (!r.ok) throw new Error('리더보드 파일이 아직 없습니다 (GitHub Actions 첫 실행 후 생성됩니다)');
    W.lb = await r.json(); return W.lb;
  }
  function syncSeg() {
    $$('#lbSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === W.key));
    $$('#lbN button').forEach(b => b.setAttribute('aria-pressed', +b.dataset.v === W.n));
  }
  async function loadAgg() {
    syncSeg();
    const tb = $('#agg tbody'); tb.textContent = '';
    tb.append(el('tr', null, el('td', { colspan: 7, class: 'muted', text: '상위 트레이더 포지션을 불러오는 중…' })));
    try {
      const lb = await loadLB();
      const top = lb.rows.slice().sort((a, b) => b[W.key] - a[W.key]).slice(0, W.n);
      const res = await pool(top, 4, r => positionsOf(r.a));
      W.positions = [];
      const by = {};
      res.forEach((x, i) => {
        if (!x) return;
        top[i].npos = x.pos.length;
        x.pos.forEach(p => {
          W.positions.push({ ...p, who: top[i].a });
          const g = by[p.coin] || (by[p.coin] = { coin: p.coin, long: 0, short: 0, nl: 0, ns: 0, mark: p.mark });
          if (p.side > 0) { g.long += p.val; g.nl++; } else { g.short += p.val; g.ns++; }
          g.mark = p.mark;
        });
      });
      W.agg = Object.values(by).sort((a, b) => (b.long + b.short) - (a.long + a.short));
      const ok = res.filter(Boolean).length;
      $('#aggNote').textContent = `${{ mPnl: '이번 달 수익', aPnl: '누적 수익', av: '계좌 규모' }[W.key]} 상위 ${W.n}명 중 ${ok}명의 현재 포지션 합계 · 주식(xyz) 포함`;
      renderAgg(); renderLiqSelect(); renderLiq(); renderLB(top);
    } catch (e) { tb.textContent = ''; tb.append(el('tr', null, el('td', { colspan: 7, class: 'down', text: e.message }))); }
  }
  function renderAgg() {
    const tb = $('#agg tbody'); tb.textContent = '';
    W.agg.slice(0, 30).forEach(g => {
      const tot = g.long + g.short, lp = tot ? g.long / tot * 100 : 50, net = g.long - g.short;
      tb.append(el('tr', { class: 'click', title: '청산 구간 맵 보기', onclick: () => { W.liqCoin = g.coin; store.set('liqCoin', g.coin); $('#liqCoin').value = g.coin; renderLiq(); $('#liq').scrollIntoView({ behavior: 'smooth', block: 'center' }); } },
        el('td', null, el('b', { text: coinName(g.coin) }), ' ',
          el('button', { class: 'btn', type: 'button', style: 'padding:1px 7px;font-size:12px', title: '이 종목을 매매 분석 탭에서 보기', text: '차트', onclick: e => { e.stopPropagation(); U.openChart && U.openChart(g.coin); } })),
        el('td', { class: 'r m up', text: fusd(g.long) }), el('td', { class: 'r m down', text: fusd(g.short) }),
        el('td', null, el('div', { class: 'bar-cell' }, el('div', { class: 'lsbar', title: `롱 ${lp.toFixed(0)}% : 숏 ${(100 - lp).toFixed(0)}%` }, el('i', { style: `width:${lp}%;background:var(--up)` }), el('i', { style: `width:${100 - lp}%;background:var(--down)` })), el('span', { class: 'm muted', text: `${lp.toFixed(0)}:${(100 - lp).toFixed(0)}` }))),
        el('td', { class: 'r m ' + toneOf(net), text: (net > 0 ? '롱 ' : '숏 ') + fusd(Math.abs(net)) }),
        el('td', { class: 'r m', text: `${g.nl} / ${g.ns}` }), el('td', { class: 'r m', text: fp(g.mark) })));
    });
    if (!W.agg.length) tb.append(el('tr', null, el('td', { colspan: 7, class: 'muted', text: '열린 포지션이 없습니다.' })));
  }
  function renderLiqSelect() {
    const sel = $('#liqCoin'); sel.textContent = '';
    W.agg.slice(0, 40).forEach(g => sel.append(el('option', { value: g.coin, text: coinName(g.coin) })));
    if (!W.agg.some(g => g.coin === W.liqCoin) && W.agg[0]) W.liqCoin = W.agg[0].coin;
    sel.value = W.liqCoin;
  }
  $('#liqCoin').addEventListener('change', e => { W.liqCoin = e.target.value; store.set('liqCoin', W.liqCoin); renderLiq(); });

  function renderLiq() {
    const box = $('#liq'); box.textContent = '';
    const ps = W.positions.filter(p => p.coin === W.liqCoin && p.liq);
    const g = W.agg && W.agg.find(x => x.coin === W.liqCoin);
    if (!g || !ps.length) { box.append(el('p', { class: 'note', text: '청산 가격이 있는 포지션이 없습니다 (교차 마진으로 여유가 크면 청산가가 표시되지 않습니다).' })); return; }
    const mark = g.mark, STEP = 2.5, SPAN = 50, bins = {};
    ps.forEach(p => {
      let d = (p.liq / mark - 1) * 100; d = Math.max(-SPAN, Math.min(SPAN, d));
      const b = Math.round(d / STEP) * STEP;
      const k = b === 0 ? (p.side > 0 ? -STEP : STEP) : b;
      const x = bins[k] || (bins[k] = { long: 0, short: 0, n: 0 }); if (p.side > 0) x.long += p.val; else x.short += p.val; x.n++;
    });
    const max = Math.max(...Object.values(bins).map(b => b.long + b.short));
    const rows = [];
    for (let b = SPAN; b >= -SPAN; b -= STEP) { if (b === 0) rows.push('now'); else if (bins[b]) rows.push(b); }
    let longTot = 0, shortTot = 0;
    Object.values(bins).forEach(b => { longTot += b.long; shortTot += b.short; });
    $('#liqNote').textContent = `${coinName(W.liqCoin)} · 위쪽 = 숏 포지션이 강제청산되는 가격 (가격이 오르면 숏 스퀴즈), 아래쪽 = 롱 포지션 청산 가격 · 집계 대상 ${ps.length}개 포지션`;
    rows.forEach(b => {
      if (b === 'now') { box.append(el('div', { class: 'liq-row now' }, el('span', { text: fp(mark) }), el('div', { class: 'track' }), el('span', { class: 'r', text: '현재가' }))); return; }
      const x = bins[b], v = x.long + x.short, price = mark * (1 + b / 100);
      const edge = Math.abs(b) === SPAN ? (b > 0 ? ' 이상' : ' 이하') : '';
      box.append(el('div', { class: 'liq-row', title: `${x.n}개 포지션` }, el('span', { text: `${fp(price)}${edge}` }),
        el('div', { class: 'track' }, el('div', { class: 'b', style: `width:${Math.max(2, v / max * 100)}%;background:${b > 0 ? 'var(--up)' : 'var(--down)'}` })),
        el('span', { class: 'r ' + (b > 0 ? 'up' : 'down'), text: `${fusd(v)} · ${fpct(b, 0)}` })));
    });
    box.append(el('p', { class: 'note', style: 'margin-top:8px;font-family:var(--sans)', text: `현재가 위 숏 청산 대기 ${fusd(shortTot)} · 아래 롱 청산 대기 ${fusd(longTot)}. 청산 물량이 몰린 가격대는 가격이 끌려가기 쉬운 "자석" 구간으로 봅니다. 상위 트레이더만 집계한 값이라 시장 전체가 아닙니다.` }));
  }

  function renderLB(top) {
    const lb = W.lb; $('#lbUpdated').textContent = `갱신 ${new Date(lb.updated).toLocaleString('ko-KR', { hour12: false })} · 위 집계 기준으로 정렬`;
    const tb = $('#lb tbody'); tb.textContent = '';
    top.forEach(r => {
      const tracked = wallets.some(w => w.a === r.a);
      tb.append(el('tr', null,
        el('td', null, el('b', { text: r.n || short(r.a) }), ' ', el('span', { class: 'addr', text: r.n ? short(r.a) : '' }), r.npos != null ? el('span', { class: 'muted', text: ` · 포지션 ${r.npos}개` }) : null),
        el('td', { class: 'r m', text: fusd(r.av) }), el('td', { class: 'r m ' + toneOf(r.dPnl), text: fusd(r.dPnl) }),
        el('td', { class: 'r m ' + toneOf(r.wPnl), text: fusd(r.wPnl) }), el('td', { class: 'r m ' + toneOf(r.mPnl), text: fusd(r.mPnl) }),
        el('td', { class: 'r m ' + toneOf(r.aPnl), text: fusd(r.aPnl) }),
        el('td', { class: 'r' }, el('button', { class: 'btn', type: 'button', disabled: tracked, text: tracked ? '추적 중' : '추적', onclick: e => { wallets.push({ a: r.a, label: r.n || '리더보드 ' + short(r.a) }); saveWallets(); e.target.disabled = true; e.target.textContent = '추적 중'; loadWallets(); } }))));
    });
  }

  $('#lbSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; W.key = b.dataset.v; store.set('lbKey', W.key); loadAgg(); });
  $('#lbN').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; W.n = +b.dataset.v; store.set('lbN', W.n); loadAgg(); });
  $('#aggRefresh').addEventListener('click', loadAgg);

  // ---------- 시작 ----------
  let started = false, tick = 0;
  function start() { if (started) return; started = true; loadWallets(); loadAgg(); }
  window.addEventListener('tabchange', e => { if (e.detail === 'whale') start(); });
  if (U.activeTab() === 'whale') start();
  setInterval(() => {
    if (!started || document.hidden || U.activeTab() !== 'whale') return;
    tick++; loadWallets();
    if (tick % 10 === 0) loadAgg();
  }, 30000);
})();
