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
          el('button', { class: 'btn', type: 'button', style: 'padding:1px 7px;font-size:12px', title: '이 종목을 차트 분석 탭에서 보기', text: '차트', onclick: e => { e.stopPropagation(); U.openChart && U.openChart(g.coin); } })),
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

  // 리포트 탭용: 이번 달 수익 상위 n명이 이 종목에 건 롱·숏 합계와 청산 가격 분포
  U.whaleSnapshot = async function (coin, n = 40) {
    const lb = await loadLB();
    const top = lb.rows.slice().sort((a, b) => b.mPnl - a.mPnl).slice(0, n);
    const res = await pool(top, 4, r => positionsOf(r.a));
    const ps = [];
    res.forEach(x => { if (x) x.pos.forEach(p => { if (p.coin === coin) ps.push(p); }); });
    const long = ps.filter(p => p.side > 0), short = ps.filter(p => p.side < 0);
    const sum = a => a.reduce((t, p) => t + p.val, 0);
    const mark = ps.length ? ps[0].mark : null;
    const liq = ps.filter(p => p.liq).map(p => ({ side: p.side > 0 ? '롱' : '숏', liq: p.liq, val: p.val, distPct: mark ? (p.liq / mark - 1) * 100 : null }))
      .sort((a, b) => b.val - a.val).slice(0, 15);
    // 청산 구간 맵: 고래 추적 탭과 같은 방식(현재가 대비 2.5% 칸)으로 롱·숏 청산 대기 금액
    const bins = {};
    if (mark) ps.filter(p => p.liq).forEach(p => {
      let d = (p.liq / mark - 1) * 100; d = Math.max(-50, Math.min(50, d));
      const b = Math.round(d / 2.5) * 2.5, k = b === 0 ? (p.side > 0 ? -2.5 : 2.5) : b;
      const x = bins[k] || (bins[k] = { long: 0, short: 0 }); if (p.side > 0) x.long += p.val; else x.short += p.val;
    });
    const liqMap = Object.entries(bins).map(([k, v]) => ({ pct: +k, price: mark * (1 + k / 100), long: v.long, short: v.short })).sort((a, b) => b.pct - a.pct);
    // 추적 지갑(고래 추적 탭의 지갑 목록): 이 종목 포지션과 최근 변화
    const tracked = await pool(wallets, 4, async w => {
      const x = await positionsOf(w.a);
      const pos = x.pos.filter(p => p.coin === coin);
      let log = []; try { log = JSON.parse(store.get('chg.' + w.a, '[]')).filter(c => c.txt.includes(coinName(coin))).slice(0, 3); } catch (e) {}
      return { label: w.label || short(w.a), pos, log };
    });
    return { traders: res.filter(Boolean).length, mark, longUsd: sum(long), shortUsd: sum(short), nLong: long.length, nShort: short.length,
      avgEntryLong: long.length ? sum(long.map(p => ({ val: p.val * p.entry }))) / sum(long) : null,
      avgEntryShort: short.length ? sum(short.map(p => ({ val: p.val * p.entry }))) / sum(short) : null, liq, liqMap, tracked: tracked.filter(Boolean) };
  };

  // ---------- 고래 스캔: 계정가치 상위 500 + 이달 수익 상위 60, 계정을 하나씩 돌며 다시 조회 ----------
  // 조회할 때마다 직전 조회와 포지션을 비교해 큰 변화(약 $25만 이상)를 "고래 움직임 피드"에 남깁니다.
  const WS = { list: [], snap: {}, feed: [], idx: 0, cycle: 0, scanned: 0, running: false, t0: Date.now(), perAcc: null, coin: store.get('wsCoin', 'BTC'), lastRender: 0, retail: {}, mark: {} };
  const FEED_MIN_USD = 250000, FEED_KEEP = 400;
  try { WS.snap = JSON.parse(store.get('wscan.snap', '{}')) || {}; WS.feed = JSON.parse(store.get('wscan.feed', '[]')) || []; } catch (e) { WS.snap = {}; WS.feed = []; }
  const saveScan = () => { store.set('wscan.snap', JSON.stringify(WS.snap)); store.set('wscan.feed', JSON.stringify(WS.feed.slice(0, FEED_KEEP))); };
  async function buildScanList() {
    const lb = await loadLB(), rows = lb.rows;
    const byAv = rows.slice().sort((a, b) => b.av - a.av).slice(0, 500), byM = rows.slice().sort((a, b) => b.mPnl - a.mPnl).slice(0, 60);
    const smart = new Set(byM.map(r => r.a)), seen = new Set(), list = [];
    [...byAv, ...byM].forEach(r => { if (seen.has(r.a)) return; seen.add(r.a); list.push({ a: r.a, n: r.n, av: r.av, smart: smart.has(r.a) }); });
    WS.list = list;
  }
  // 메인 무기한 선물만 조회 (코인). 1계정 = 요청 1번.
  async function scanOne(acc) {
    const st = await TA.hl({ type: 'clearinghouseState', user: acc.a });
    const now = Math.floor(Date.now() / 1000), pos = {};
    st.assetPositions.forEach(ap => {
      const p = ap.position, szi = +p.szi; if (!szi) return;
      const val = +p.positionValue;
      pos[p.coin] = { s: szi, e: +p.entryPx, m: val / Math.abs(szi), l: p.liquidationPx == null ? null : +p.liquidationPx, v: p.leverage ? p.leverage.value : null };
    });
    const prev = WS.snap[acc.a];
    if (prev) {
      const coins = new Set([...Object.keys(prev.p), ...Object.keys(pos)]);
      coins.forEach(c => {
        const a = prev.p[c] ? prev.p[c].s : 0, b = pos[c] ? pos[c].s : 0;
        if (a === b) return;
        const mark = (pos[c] || prev.p[c]).m;
        if (Math.abs(b - a) * mark < FEED_MIN_USD) return;
        const kind = !a ? (b > 0 ? '롱 신규' : '숏 신규') : !b ? (a > 0 ? '롱 정리' : '숏 정리') : Math.sign(a) !== Math.sign(b) ? '방향 바꿈' : Math.abs(b) > Math.abs(a) ? (b > 0 ? '롱 늘림' : '숏 늘림') : (b > 0 ? '롱 줄임' : '숏 줄임');
        WS.feed.unshift({ t: now, a: acc.a, coin: c, kind, from: a, to: b, px: mark, lev: (pos[c] || prev.p[c]).v, prevT: prev.t, smart: acc.smart });
      });
      if (WS.feed.length > FEED_KEEP) WS.feed.length = FEED_KEEP;
    }
    WS.snap[acc.a] = { t: now, p: pos };
  }
  async function scanLoop() {
    if (WS.running) return; WS.running = true;
    try {
      if (!WS.list.length) await buildScanList();
      for (;;) {
        if (document.hidden) { await new Promise(r => setTimeout(r, 5000)); continue; }
        const acc = WS.list[WS.idx];
        try { await scanOne(acc); WS.scanned = Math.max(WS.scanned, WS.idx + 1); } catch (e) { await new Promise(r => setTimeout(r, 3000)); }
        WS.idx++;
        if (WS.idx > 5) WS.perAcc = (Date.now() - WS.t0) / WS.idx;
        if (WS.idx >= WS.list.length) { WS.idx = 0; WS.t0 = Date.now(); WS.cycle++; WS.scanned = WS.list.length; saveScan(); await buildScanList().catch(() => {}); }
        if (WS.idx % 20 === 0) saveScan();
        if (Date.now() - WS.lastRender > 4000 && U.activeTab() === 'whale') { WS.lastRender = Date.now(); renderWhaleCard(); renderFeed(); }
        await new Promise(r => setTimeout(r, 250)); // 하이퍼리퀴드 요청 한도를 넘지 않게 천천히
      }
    } finally { WS.running = false; }
  }

  // ---------- 고래 vs 개인 ----------
  async function loadRetail(coin) {
    const hit = WS.retail[coin]; if (hit && Date.now() - hit.at < 120e3) return hit;
    try {
      const r = await fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${coin}USDT&period=1h&limit=5`);
      if (!r.ok) throw new Error(r.status);
      const x = await r.json(); if (!x.length) throw new Error('없음');
      const now = x[x.length - 1], ago = x[0];
      return (WS.retail[coin] = { at: Date.now(), ratio: +now.longShortRatio, long: +now.longAccount * 100, ago: +ago.longAccount * 100 });
    } catch (e) { return (WS.retail[coin] = { at: Date.now(), err: true }); }
  }
  const fcoin = (v, c) => `${Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)} ${c}`;
  function whaleStats(coin, mark) {
    const L = [], S = [];
    WS.list.forEach(acc => { const sn = WS.snap[acc.a]; const p = sn && sn.p[coin]; if (!p) return; (p.s > 0 ? L : S).push({ ...p, a: acc.a, smart: acc.smart }); });
    const size = a => a.reduce((t, p) => t + Math.abs(p.s), 0);
    const avgEntry = a => { const s = size(a); return s ? a.reduce((t, p) => t + p.e * Math.abs(p.s), 0) / s : null; };
    // 헤지 추정: 숏이면서 레버리지 5배 이하, 청산가가 40% 넘게 멀거나 없음 → 현물을 들고 가격 하락을 막는 숏일 가능성
    const hedge = S.filter(p => (p.v == null || p.v <= 5) && (p.l == null || (mark && p.l / mark - 1 > 0.4)));
    const sm = { L: L.filter(p => p.smart), S: S.filter(p => p.smart) };
    return { L, S, long: size(L), short: size(S), avgL: avgEntry(L), avgS: avgEntry(S), hedge, hedgeSize: size(hedge), sm: { nL: sm.L.length, nS: sm.S.length, long: size(sm.L), short: size(sm.S) } };
  }
  async function renderWhaleCard() {
    const box = $('#wsBody'); if (!box) return;
    const coin = WS.coin;
    $$('#wsCoin button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === coin)));
    let mark = WS.mark[coin];
    try { const ctx = await TA.loadCtx(); if (ctx[coin]) mark = WS.mark[coin] = +ctx[coin].markPx; } catch (e) {}
    const st = whaleStats(coin, mark), rt = await loadRetail(coin);
    box.textContent = '';
    const tot = st.long + st.short, net = st.long - st.short, lp = tot ? st.long / tot * 100 : 50;
    const wSide = !tot ? null : net / tot > 0.1 ? 1 : net / tot < -0.1 ? -1 : 0;
    const rSide = rt.err ? null : rt.long >= 55 ? 1 : rt.long <= 45 ? -1 : 0;
    const word = s => s > 0 ? '롱 쪽' : s < 0 ? '숏 쪽' : '팽팽';
    const head = wSide == null ? '고래 포지션을 모으는 중이에요' : rSide == null ? `고래는 ${word(wSide)}이에요` : wSide === rSide && wSide !== 0 ? `고래와 개인 모두 ${word(wSide)}이에요` : wSide !== 0 && rSide !== 0 && wSide !== rSide ? `고래는 ${word(wSide)}, 개인은 ${word(rSide)}으로 갈렸어요` : `고래는 ${word(wSide)}, 개인은 ${word(rSide)}이에요`;
    const scanTxt = `리더보드 계정 ${WS.scanned}/${WS.list.length} 조회${WS.cycle ? ` · ${WS.cycle}바퀴 완료` : ''} · ${coin} 보유 ${st.L.length + st.S.length}명 · 이 창이 열려 있는 동안 계정을 하나씩 다시 조회 ${WS.perAcc ? ` (한 바퀴 약 ${Math.max(1, Math.round(WS.list.length * WS.perAcc / 60000))}분)` : ''}`;
    const hero = el('div', { class: 'ws-hero' }, el('h3', { text: head }));
    if (st.hedge.length && wSide === -1) {
      const exL = st.long, exS = st.short - st.hedgeSize, exN = exL - exS;
      hero.append(el('p', { text: `다만 숏 ${st.hedge.length}개(${fcoin(st.hedgeSize, coin)})는 5배 이하 · 청산가가 멀어 현물 헤지일 가능성이 커요 → 방향 베팅과 구분해서 보세요` }),
        el('p', { class: 'note', text: `헤지 추정을 빼면 롱 ${fcoin(exL, coin)} · 숏 ${fcoin(exS, coin)} → ${exN >= 0 ? '순롱' : '순숏'} ${fcoin(Math.abs(exN), coin)}` }));
    }
    hero.append(el('p', { class: 'note', text: scanTxt }));
    box.append(hero);
    const bar = (p, title) => el('div', { class: 'lsbar ws-bar', title }, el('i', { style: `width:${p}%;background:var(--up)` }), el('i', { style: `width:${100 - p}%;background:var(--down)` }));
    const g = el('div', { class: 'ws-grid' });
    g.append(el('div', { class: 'ws-cell' }, el('div', { class: 'muted', text: 'HL 고래 (실제 포지션)' }),
      el('div', { class: 'ws-big m' }, `롱 ${fcoin(st.long, coin)} · 숏 ${fcoin(st.short, coin)}`), bar(lp, ''),
      el('p', { class: 'note' }, `롱 ${lp.toFixed(0)}% · 숏 ${(100 - lp).toFixed(0)}% → `, el('b', { class: toneOf(net), text: `${net >= 0 ? '순롱' : '순숏'} ${fcoin(Math.abs(net), coin)}` }), ` · 롱 ${st.L.length}계정 · 숏 ${st.S.length}계정${mark ? ` · 약 ${fusd(Math.abs(net) * mark)}` : ''}`)));
    g.append(el('div', { class: 'ws-cell' }, el('div', { class: 'muted', text: '개인 (바이낸스 전체 계정 롱숏 비율)' }),
      rt.err ? el('p', { class: 'note', text: '바이낸스에 이 코인 선물이 없거나 불러오지 못했습니다.' }) : el('div', { class: 'ws-big m', text: `L/S ${rt.ratio.toFixed(2)}` }),
      rt.err ? null : bar(rt.long, ''), rt.err ? null : el('p', { class: 'note', text: `롱 ${rt.long.toFixed(0)}% · 숏 ${(100 - rt.long).toFixed(0)}% (계정 수 기준) · 4시간 전 롱 ${rt.ago.toFixed(0)}%` })));
    const smTot = st.sm.long + st.sm.short;
    g.append(el('div', { class: 'ws-cell' }, el('div', { class: 'muted', text: '스마트머니 · 이달 수익 상위 60 계정의 방향' }),
      el('div', { class: 'ws-big m', text: `롱 ${st.sm.nL} · 숏 ${st.sm.nS}` }), bar(smTot ? st.sm.long / smTot * 100 : 50, ''),
      el('p', { class: 'note', text: `지금 ${coin}를 들고 있는 ${st.sm.nL + st.sm.nS}명 · 물량 롱 ${fcoin(st.sm.long, coin)} · 숏 ${fcoin(st.sm.short, coin)}${smTot ? ` · 돈 잘 버는 고래는 ${st.sm.long >= st.sm.short ? '롱' : '숏'} 쪽이 더 커요` : ''}` })));
    const pnl = (avg, side) => avg && mark ? (side > 0 ? mark / avg - 1 : avg / mark - 1) * 100 : null;
    const pl = pnl(st.avgL, 1), ps = pnl(st.avgS, -1);
    g.append(el('div', { class: 'ws-cell' }, el('div', { class: 'muted', text: `고래 평단 · 물량 가중${mark ? ` · 현재가 ${fp(mark)}` : ''}` }),
      el('div', { class: 'ws-two' },
        el('div', null, el('div', { class: 'muted', text: `롱 평단 · ${st.L.length}계정` }), el('div', { class: 'ws-big m', text: st.avgL ? fp(st.avgL) : '—' }), pl == null ? null : el('p', { class: 'note' }, '지금 ', el('b', { class: toneOf(pl), text: fpct(pl, 1) }), pl >= 0 ? ' 이익 · 여유 있게 버티는 중' : ' 손실 · 손절 압박')),
        el('div', null, el('div', { class: 'muted', text: `숏 평단 · ${st.S.length}계정` }), el('div', { class: 'ws-big m', text: st.avgS ? fp(st.avgS) : '—' }), ps == null ? null : el('p', { class: 'note' }, '지금 ', el('b', { class: toneOf(ps), text: fpct(ps, 1) }), ps >= 0 ? ' 이익' : ' 손실', st.hedge.length ? ` · 헤지 추정 ${fcoin(st.hedgeSize, coin)} 포함` : '')))));
    box.append(g);
    box.append(el('p', { class: 'note pb', text: `고래 = 하이퍼리퀴드 계정가치 상위 500 + 이달 수익 상위 60 중 지금 ${coin}를 들고 있는 계정 (메인 무기한 선물). 개인 = 바이낸스 ${coin}USDT 전체 계정 롱숏 비율 (계정 수, 물량 아님). 헤지 추정은 숏·레버리지 5배 이하·청산가 40% 이상 멀거나 없음 기준의 추정입니다.` }));
  }

  // ---------- 고래 움직임 피드 ----------
  function renderFeed() {
    const box = $('#wsFeed'); if (!box) return;
    const all = $('#wsFeedAll') && $('#wsFeedAll').checked;
    const rows = WS.feed.filter(f => all || f.coin === WS.coin).slice(0, 80);
    box.textContent = '';
    if (!rows.length) { box.append(el('p', { class: 'note pb', text: WS.cycle ? `아직 ${all ? '' : WS.coin + ' '}큰 포지션 변화가 없습니다.` : '첫 바퀴 조회가 끝나면(같은 계정을 두 번 조회해야 비교 가능) 변화가 쌓이기 시작합니다.' })); return; }
    const name = c => c.replace(/^xyz:/, '');
    rows.forEach(f => {
      const sz = v => Math.abs(v) >= 1000 ? Math.round(Math.abs(v)).toLocaleString() : Math.abs(v) >= 10 ? Math.abs(v).toFixed(1) : Math.abs(v).toFixed(2);
      const up = f.kind.startsWith('롱') ? f.kind.includes('정리') || f.kind.includes('줄임') ? 'bad' : 'good' : f.kind.startsWith('숏') ? f.kind.includes('정리') || f.kind.includes('줄임') ? 'good' : 'bad' : (f.to > 0 ? 'good' : 'bad');
      const from = f.from ? `${f.from > 0 ? '롱' : '숏'} ${sz(f.from)}` : '없음', to = f.to ? `${f.to > 0 ? '롱' : '숏'} ${sz(f.to)}` : '없음';
      const tracked = wallets.some(w => w.a === f.a);
      box.append(el('div', { class: 'ws-feed-row' },
        el('div', null, el('span', { class: 'm muted', text: fdt(f.t) + ' ' }),
          el('a', { href: `https://app.hyperliquid.xyz/explorer/address/${f.a}`, target: '_blank', rel: 'noopener', class: 'm', text: short(f.a) }),
          f.smart ? el('span', { class: 'chip good', style: 'margin-left:4px', text: '이달 수익 상위' }) : null,
          ` ${name(f.coin)} `, el('b', { class: up === 'good' ? 'up' : 'down', text: `${f.kind} ${from} → ${to}` }),
          el('span', { class: 'm muted', text: ` @${fp(f.px)}${f.lev ? ' ' + f.lev + 'x' : ''} · ${fusd(Math.abs(f.to - f.from) * f.px)}` }),
          el('button', { class: 'btn', type: 'button', style: 'margin-left:8px;padding:1px 7px;font-size:12px', disabled: tracked, text: tracked ? '추적 중' : '추적', onclick: e => { wallets.push({ a: f.a, label: '피드 ' + short(f.a) }); saveWallets(); e.target.disabled = true; e.target.textContent = '추적 중'; loadWallets(); } })),
        el('div', { class: 'note', text: `직전 조회 ${fdt(f.prevT)} 이후 변화` })));
    });
  }
  $('#wsCoin').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; WS.coin = b.dataset.v; store.set('wsCoin', WS.coin); renderWhaleCard(); renderFeed(); });
  $('#wsFeedAll').addEventListener('change', renderFeed);
  U.whaleScanTest = { WS, scanOne, renderFeed }; // 확인용
  // 리포트에서 쓸 수 있게: 이 코인의 고래 vs 개인 요약
  U.whaleVsRetail = async function (coin) {
    if (!WS.list.length || !WS.scanned) return null;
    let mark = null; try { const ctx = await TA.loadCtx(); mark = ctx[coin] ? +ctx[coin].markPx : null; } catch (e) {}
    const st = whaleStats(coin, mark), rt = await loadRetail(coin);
    const feed = WS.feed.filter(f => f.coin === coin).slice(0, 8);
    return `[고래 vs 개인] HL 계정가치 상위 500 + 이달 수익 상위 60 중 ${WS.scanned}/${WS.list.length} 조회: 롱 ${fcoin(st.long, coin)}(${st.L.length}계정, 평단 ${st.avgL ? fp(st.avgL) : '-'}) · 숏 ${fcoin(st.short, coin)}(${st.S.length}계정, 평단 ${st.avgS ? fp(st.avgS) : '-'}) · 헤지 추정 숏 ${fcoin(st.hedgeSize, coin)} · 이달 수익 상위 롱 ${st.sm.nL}명 ${fcoin(st.sm.long, coin)} / 숏 ${st.sm.nS}명 ${fcoin(st.sm.short, coin)}` +
      (rt.err ? '' : ` · 바이낸스 개인 롱 ${rt.long.toFixed(1)}% (4시간 전 ${rt.ago.toFixed(1)}%)`) +
      (feed.length ? '\n고래 움직임: ' + feed.map(f => `${fdt(f.t)} ${short(f.a)} ${f.kind} ${f.from.toFixed(2)}→${f.to.toFixed(2)} @${fp(f.px)}`).join(' · ') : '');
  };

  // ---------- 시작 ----------
  let started = false, tick = 0;
  function start() { if (started) return; started = true; loadWallets(); loadAgg(); renderWhaleCard(); renderFeed(); scanLoop(); }
  window.addEventListener('tabchange', e => { if (e.detail === 'whale') start(); });
  if (U.activeTab() === 'whale') start();
  setInterval(() => {
    if (!started || document.hidden || U.activeTab() !== 'whale') return;
    tick++; loadWallets();
    if (tick % 10 === 0) loadAgg();
  }, 30000);
})();
