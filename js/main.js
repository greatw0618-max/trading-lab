// 매매 분석 탭: 신호 카드, 차트(엘리엇·ICT·와이코프 표시), 해설, 예상 투자 결과, 방향성 점검표
(() => {
  const TA = window.TA, LW = window.LightweightCharts;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];

  // ---------- 공용 도구 ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('slab.' + k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('slab.' + k, v); } catch (e) {} }
  };
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  }
  const dec = p => { p = Math.abs(p); return p >= 1000 ? 1 : p >= 10 ? 2 : p >= 1 ? 3 : p > 0 ? Math.min(8, 3 - Math.floor(Math.log10(p))) : 2; };
  const fp = (v, d) => v == null || !isFinite(v) ? '—' : (+v).toLocaleString('en-US', { minimumFractionDigits: d ?? dec(v), maximumFractionDigits: d ?? dec(v) });
  const fpct = (v, d = 2) => v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + v.toFixed(d) + '%';
  const fusd = v => { if (v == null || !isFinite(v)) return '—'; const a = Math.abs(v), s = v < 0 ? '-' : ''; return a >= 1e9 ? s + '$' + (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? s + '$' + (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? s + '$' + (a / 1e3).toFixed(1) + 'K' : s + '$' + a.toFixed(0); };
  const fdt = t => { const d = new Date(t * 1000); return (d.getFullYear() !== new Date().getFullYear() ? d.getFullYear() + '.' : '') + `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const fdate = t => { const d = new Date(t * 1000); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`; };
  const fdur = h => h < 1 ? Math.round(h * 60) + '분' : h < 48 ? h.toFixed(1) + '시간' : (h / 24).toFixed(1) + '일';
  const toneOf = v => v > 0 ? 'up' : v < 0 ? 'down' : '';
  const chip = (cls, text) => el('span', { class: 'chip ' + cls, text });
  const TF_LABEL = { '15m': '15분', '1h': '1시간', '4h': '4시간', '1d': '일봉' };
  const cv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const off = t => -new Date(t * 1000).getTimezoneOffset() * 60;
  const T = t => t + off(t);

  function setStatus(kind, msg) {
    $('#dot').className = 'dot ' + (kind === 'ok' ? 'ok' : kind === 'err' ? 'err' : '');
    $('#stxt').textContent = kind === 'ok' ? '실시간 · ' + new Date().toLocaleTimeString('ko-KR', { hour12: false }) + ' 갱신' : kind === 'err' ? '일부 데이터 오류' : '불러오는 중…';
    const b = $('#banner');
    if (kind === 'err' && msg) { b.textContent = msg; b.hidden = false; } else if (kind === 'ok') b.hidden = true;
  }
  TA.ui = { store, el, fp, fpct, fusd, fdt, fdur, chip, setStatus, toneOf };

  if (!LW) { setStatus('err', '차트 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 새로고침하세요.'); return; }

  // ---------- 상태 ----------
  const S = { sym: store.get('sym', 'SOXL'), tf: store.get('tf', '15m'), src: store.get('src', 'hl'), load: 0, key: null, series: null, an: null, bt: null };
  const show = { ew: true, ict: true, wy: true, div: true, tr: true, e10: true, e20: true, e60: true, e120: true };
  // 예전 버전에 저장된 설정 중 지금 없는 항목(예: ema)은 무시합니다.
  try { const saved = JSON.parse(store.get('show', '{}')); Object.keys(show).forEach(k => { if (typeof saved[k] === 'boolean') show[k] = saved[k]; }); } catch (e) {}
  const EMA_LEN = [10, 20, 60, 120];

  // ---------- 차트 ----------
  const base = () => ({
    autoSize: true,
    layout: { background: { type: 'solid', color: cv('--panel') }, textColor: cv('--muted'), fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 11 },
    grid: { vertLines: { color: cv('--grid') }, horzLines: { color: cv('--grid') } },
    rightPriceScale: { borderVisible: false, minimumWidth: 72 },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 8 },
    crosshair: { mode: LW.CrosshairMode.Normal },
    localization: { locale: 'ko-KR' }
  });
  const main = LW.createChart($('#cMain'), base());
  const rsiC = LW.createChart($('#cRsi'), base());
  main.applyOptions({ timeScale: { visible: false } });
  const nolab = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
  const candle = main.addCandlestickSeries({ borderVisible: false });
  candle.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.2 } });
  const vol = main.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, ...nolab });
  main.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
  // EMA 선: 길수록 조금 굵게 그려 큰 추세선이 눈에 띄게 합니다.
  const sEma = Object.fromEntries(EMA_LEN.map(n => [n, main.addLineSeries({ lineWidth: n >= 60 ? 2 : 1, ...nolab })]));
  const sZZ = main.addLineSeries({ lineWidth: 2, ...nolab });
  const sRsi = rsiC.addLineSeries({ lineWidth: 2, priceLineVisible: false, priceFormat: { type: 'price', precision: 1, minMove: 0.1 } });
  rsiC.priceScale('right').applyOptions({ scaleMargins: { top: 0.1, bottom: 0.08 }, autoScale: false });
  // 다이버전스 선: 가격 차트와 RSI 차트에 같은 두 점을 잇습니다 (강세 = 초록, 약세 = 빨강)
  const divSeries = { 1: [main.addLineSeries({ lineWidth: 2, ...nolab }), rsiC.addLineSeries({ lineWidth: 2, ...nolab })],
    '-1': [main.addLineSeries({ lineWidth: 2, ...nolab }), rsiC.addLineSeries({ lineWidth: 2, ...nolab })] };
  const rsiLines = [70, 30].map(p => sRsi.createPriceLine({ price: p, lineWidth: 1, lineStyle: LW.LineStyle.Dashed, axisLabelVisible: true, title: '' }));
  let plines = [];

  let syncing = false;
  [main, rsiC].forEach(c => c.timeScale().subscribeVisibleLogicalRangeChange(r => {
    if (syncing || !r) return; syncing = true;
    [main, rsiC].forEach(o => { if (o !== c) o.timeScale().setVisibleLogicalRange(r); });
    syncing = false; queueZones();
  }));

  function applyTheme() {
    [main, rsiC].forEach(c => c.applyOptions({
      layout: { background: { type: 'solid', color: cv('--panel') }, textColor: cv('--muted') },
      grid: { vertLines: { color: cv('--grid') }, horzLines: { color: cv('--grid') } },
      crosshair: { vertLine: { color: cv('--muted'), labelBackgroundColor: cv('--fg') }, horzLine: { color: cv('--muted'), labelBackgroundColor: cv('--fg') } }
    }));
    const up = cv('--up'), dn = cv('--down');
    candle.applyOptions({ upColor: up, downColor: dn, wickUpColor: up, wickDownColor: dn });
    EMA_LEN.forEach(n => sEma[n].applyOptions({ color: cv('--e' + n) }));
    sZZ.applyOptions({ color: cv('--wave') });
    sRsi.applyOptions({ color: cv('--accent') });
    rsiLines.forEach(l => l.applyOptions({ color: cv('--muted') }));
    divSeries[1].forEach(x => x.applyOptions({ color: cv('--up') })); divSeries['-1'].forEach(x => x.applyOptions({ color: cv('--down') }));
    if (S.series) drawChart(true);
  }

  // 차트 위 반투명 구간(FVG·오더블록·와이코프 박스·엘리엇 목표 구간)
  let zones = [], zq = false;
  const ov = $('#ov');
  function queueZones() { if (zq) return; zq = true; requestAnimationFrame(() => { zq = false; drawZones(); }); }
  new ResizeObserver(queueZones).observe($('#cMain'));
  function drawZones() {
    const box = $('#cMain').getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    ov.width = box.width * dpr; ov.height = box.height * dpr; ov.style.width = box.width + 'px'; ov.style.height = box.height + 'px';
    const g = ov.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, box.width, box.height);
    const plotW = box.width - main.priceScale('right').width();
    const ts = main.timeScale();
    g.save(); g.beginPath(); g.rect(0, 0, plotW, box.height); g.clip();
    g.font = '600 11px "Gothic A1", "Malgun Gothic", sans-serif';
    for (const z of zones) {
      const xa = ts.logicalToCoordinate(z.from); const xb = z.to == null ? plotW : ts.logicalToCoordinate(z.to);
      const ya = candle.priceToCoordinate(z.top), yb = candle.priceToCoordinate(z.bot);
      if (xa == null || ya == null || yb == null) continue;
      const x = Math.max(0, xa), w = (xb == null ? plotW : xb) - x, y = Math.min(ya, yb), h = Math.max(1, Math.abs(yb - ya));
      if (w <= 0) continue;
      g.fillStyle = z.fill; g.fillRect(x, y, w, h);
      if (z.stroke) { g.strokeStyle = z.stroke; g.setLineDash(z.dash || []); g.lineWidth = 1; g.strokeRect(x + .5, y + .5, w - 1, h - 1); g.setLineDash([]); }
      if (z.label && w > 40) { g.fillStyle = z.text || cv('--muted'); g.fillText(z.label, x + 4, y + 12 > y + h ? y - 3 : y + 12); }
    }
    g.restore();
  }

  function legend(p) {
    const s = S.series; if (!s) return;
    let i = s.t.length - 1;
    if (p && p.time != null) { const j = S.times.indexOf(p.time); if (j >= 0) i = j; }
    const ch = (s.c[i] - s.o[i]) / s.o[i] * 100;
    const L = $('#legend'); L.textContent = '';
    L.append(el('b', { text: `${TA.dispFull(s.symbol)} ·${TF_LABEL[s.interval]} · ${s.src === 'hl' ? '하이퍼리퀴드' : '정규장'}` }),
      el('span', null, '시 ', el('b', { text: fp(s.o[i]) })), el('span', null, '고 ', el('b', { text: fp(s.h[i]) })),
      el('span', null, '저 ', el('b', { text: fp(s.l[i]) })), el('span', null, '종 ', el('b', { class: toneOf(ch), text: fp(s.c[i]) })),
      el('span', { class: toneOf(ch), text: fpct(ch) }));
    if (S.emas) EMA_LEN.forEach(k => { const v = S.emas[k] && S.emas[k][i]; if (show['e' + k] && v != null) L.append(el('span', { style: `color:var(--e${k})` }, `EMA${k} `, el('b', { text: fp(v) }))); });
  }
  main.subscribeCrosshairMove(legend);

  function drawChart(keepRange) {
    const s = S.series, { ew, ict, wy, div } = S.an, n = s.t.length;
    const ts = main.timeScale(), range = ts.getVisibleLogicalRange(), prevLen = S.prevLen;
    const times = S.times = s.t.map(T);
    const d = dec(s.c[n - 1]), pf = { type: 'price', precision: d, minMove: 1 / 10 ** d };
    [candle, ...Object.values(sEma), sZZ].forEach(x => x.applyOptions({ priceFormat: pf }));
    main.applyOptions({ timeScale: { timeVisible: s.interval !== '1d' } });
    rsiC.applyOptions({ timeScale: { timeVisible: s.interval !== '1d' } });
    candle.setData(times.map((t, i) => ({ time: t, open: s.o[i], high: s.h[i], low: s.l[i], close: s.c[i] })));
    const vu = cv('--vol-up'), vd = cv('--vol-down');
    vol.setData(times.map((t, i) => ({ time: t, value: s.v[i], color: s.c[i] >= s.o[i] ? vu : vd })));
    const line = arr => arr.map((v, i) => v == null ? { time: times[i] } : { time: times[i], value: v });
    S.emas = {};
    EMA_LEN.forEach(n => { const e = S.emas[n] = TA.ema(s.c, n); sEma[n].setData(line(e)); sEma[n].applyOptions({ visible: show['e' + n] }); });
    const r = TA.rsi(s.c, 14); sRsi.setData(line(r));
    rsiC.priceScale('right').applyOptions({ autoScale: true });
    $('#lRsi').textContent = 'RSI 14  ' + (r[n - 1] == null ? '' : r[n - 1].toFixed(1));

    // 엘리엇 지그재그
    const top = ew.cands[0];
    if (show.ew && top) {
      const seq = top.seq;
      sZZ.setData(seq.map(p => ({ time: times[p.i], value: p.p })).filter((x, k, a) => k === 0 || x.time > a[k - 1].time));
      sZZ.applyOptions({ visible: true });
    } else sZZ.applyOptions({ visible: false });

    // 마커
    const mk = [];
    if (show.ew && top) top.seq.forEach((p, k) => { if (k > 0) mk.push({ time: times[p.i], position: p.type === 'H' ? 'aboveBar' : 'belowBar', color: cv('--wave'), shape: 'circle', size: 0.5, text: top.labels[k] }); });
    if (show.ict) ict.events.slice(-4).forEach(e => mk.push({ time: times[e.i], position: e.dir > 0 ? 'aboveBar' : 'belowBar', color: cv('--ema1'), shape: 'square', size: 0.3, text: e.kind + (e.dir > 0 ? '↑' : '↓') }));
    if (show.ict) ict.sweeps.slice(-2).forEach(w => mk.push({ time: times[w.i], position: w.dir > 0 ? 'belowBar' : 'aboveBar', color: cv('--ema1'), shape: w.dir > 0 ? 'arrowUp' : 'arrowDown', size: 0.6, text: '스윕' }));
    [1, -1].forEach(dir => {
      const d = show.div && div.find(x => x.dir === dir), [sp, sr] = divSeries[dir];
      if (!d) { sp.setData([]); sr.setData([]); return; }
      sp.setData([{ time: times[d.a.i], value: d.a.p }, { time: times[d.b.i], value: d.b.p }]);
      sr.setData([{ time: times[d.a.i], value: d.a.r }, { time: times[d.b.i], value: d.b.r }]);
      mk.push({ time: times[d.b.i], position: dir > 0 ? 'belowBar' : 'aboveBar', color: dir > 0 ? cv('--up') : cv('--down'), shape: 'circle', size: 0.4, text: (d.type === 'hidden' ? '히든 ' : '') + (dir > 0 ? '강세 다이버' : '약세 다이버') + (d.provisional ? '?' : '') });
    });
    if (show.wy && wy) wy.events.forEach(e => mk.push({ time: times[e.i], position: e.dir > 0 ? 'belowBar' : 'aboveBar', color: cv('--wave'), shape: e.dir > 0 ? 'arrowUp' : 'arrowDown', size: 0.7, text: e.code }));
    mk.sort((a, b) => a.time - b.time);
    candle.setMarkers(mk);

    // 가격선
    plines.forEach(pl => candle.removePriceLine(pl)); plines = [];
    const addLine = (price, title, color, style) => { if (price != null && isFinite(price)) plines.push(candle.createPriceLine({ price, title, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true })); };
    if (show.ew && top) { addLine(top.target, '엘리엇 목표', cv('--wave'), LW.LineStyle.Dashed); addLine(top.invalid, '카운트 무효화', cv('--muted'), LW.LineStyle.Dotted); }
    if (show.ict && ict.range) addLine(ict.range.eq, 'EQ 50%', cv('--muted'), LW.LineStyle.SparseDotted);

    // 구간
    zones = [];
    if (show.wy && wy && !wy.trending) zones.push({ from: wy.start, to: null, top: wy.hi, bot: wy.lo, fill: cv('--zone-wy'), stroke: cv('--wave'), dash: [4, 4], label: `와이코프 박스 · ${wy.schema}`, text: cv('--wave') });
    if (show.ict) {
      ict.fvgs.forEach(g => zones.push({ from: g.i, to: null, top: g.top, bot: g.bot, fill: g.dir > 0 ? cv('--zone-ict') : cv('--zone-ict-b'), label: g.dir > 0 ? '상승 FVG' : '하락 FVG' }));
      ict.obs.forEach(o => zones.push({ from: o.i, to: null, top: o.top, bot: o.bot, fill: 'transparent', stroke: o.dir > 0 ? cv('--up') : cv('--down'), label: o.dir > 0 ? '상승 OB' : '하락 OB' }));
    }
    if (show.ew && top && top.zone) { const lp = top.seq[top.seq.length - 2] || top.seq[0]; zones.push({ from: lp.i, to: null, top: top.zone[1], bot: top.zone[0], fill: cv('--accent-soft'), stroke: cv('--accent'), dash: [2, 3], label: top.type === 'abc' && top.wave === 'C' ? 'C파 목표 구간' : '되돌림 목표 구간', text: cv('--accent') }); }

    if (keepRange && range && prevLen) {
      const add = n - prevLen;
      ts.setVisibleLogicalRange(range.to >= prevLen - 3 ? { from: range.from + add, to: range.to + add } : range);
    } else { ts.applyOptions({ barSpacing: 7 }); ts.scrollToRealTime(); }
    S.prevLen = n;
    legend(null); queueZones(); drawPlanLines();
    const upd = s.updated ? new Date(s.updated) : null;
    $('#srcNote').textContent = s.src === 'hl'
      ? `하이퍼리퀴드 ${TA.hlCoin(s.symbol)} 무기한 선물 · 24시간 거래(주말 포함) · ${n.toLocaleString()}봉 (${fdate(s.t[0])}부터) · 15초마다 갱신`
      : `미국 정규장(야후 파이낸스) · ${n.toLocaleString()}봉 (${fdate(s.t[0])}부터) · 데이터 갱신 ${upd ? upd.toLocaleString('ko-KR', { hour12: false }) : '—'}`;
  }

  // ---------- 해설 ----------
  function explain() {
    const s = S.series, { ew, ict, wy, div } = S.an, n = s.t.length, c = s.c[n - 1];
    const box = $('#explain'); box.textContent = '';
    const r = TA.rsi(s.c, 14)[n - 1];
    const dip = TA.dipView(ict, ew, wy, div);
    const vcls = dip.verdict[0];
    box.append(el('div', { class: 'verdict' },
      el('div', { class: 'head' }, el('span', { class: 'muted', text: `종합 판독 · ${TA.dispFull(s.symbol)} ${TF_LABEL[s.interval]}` }), chip(vcls, dip.verdict[1])),
      el('ul', { class: 'vlist' }, dip.items.map(([t, txt]) => el('li', { class: t, text: txt })))));

    // 엘리엇
    const top = ew.cands[0];
    const ex1 = el('section', { class: 'ex' }, el('h3', null, '엘리엇 파동', top ? chip('flat', `가능성 ${top.pct}%`) : null));
    if (top) {
      ex1.append(el('p', null, el('b', { text: `${top.name} · ${top.now}` })), el('p', { text: top.dip[1] }));
      const kv = el('dl', { class: 'kv' });
      if (top.zone) kv.append(el('dt', { text: top.type === 'abc' && top.wave === 'C' ? 'C파 목표 구간' : '되돌림 목표 구간' }), el('dd', { text: `${fp(top.zone[0])} ~ ${fp(top.zone[1])}` }));
      if (top.target != null) kv.append(el('dt', { text: `${top.now.replace(' 진행 중', '')} 다음 목표가` }), el('dd', { text: `${fp(top.target)} (${fpct((top.target / c - 1) * 100)})` }));
      if (top.targetNote) kv.append(el('dt', { text: '목표 계산' }), el('dd', { style: 'font-family:var(--sans)', text: top.targetNote }));
      if (top.invalid != null) kv.append(el('dt', { text: '카운트 무효화' }), el('dd', { text: `${fp(top.invalid)} (${fpct((top.invalid / c - 1) * 100)})` }));
      ex1.append(kv);
      if (top.invalid != null) ex1.append(el('p', { class: 'note', text: `가격이 ${fp(top.invalid)}를 ${top.dir * (top.type === 'abc' ? -1 : 1) > 0 ? '아래로 깨면' : '위로 넘으면'} 이 카운트는 틀린 것으로 봅니다.` }));
      if (ew.cands.length > 1) ex1.append(el('ul', { class: 'alts' }, ew.cands.slice(1).map(x => el('li', { text: `대안: ${x.name} ${x.now} (${x.pct}%)` }))));
      ex1.append(el('p', { class: 'note', text: `${(ew.thr * 100).toFixed(1)}% 이상 되돌린 움직임만 파동 하나로 셉니다. 자동 카운트는 여러 해석 중 규칙에 가장 잘 맞는 것을 고른 추정입니다.` }));
    } else ex1.append(el('p', { class: 'note', text: '파동을 셀 만큼 뚜렷한 고점·저점이 아직 없습니다.' }));
    box.append(ex1);

    // ICT
    const tr = ict.trend;
    const ex2 = el('section', { class: 'ex' }, el('h3', null, 'ICT', chip(tr > 0 ? 'good' : tr < 0 ? 'bad' : 'flat', tr > 0 ? '상승 구조' : tr < 0 ? '하락 구조' : '구조 불분명')));
    const e = ict.lastEvent;
    if (e) ex2.append(el('p', { text: `${n - 1 - e.i}봉 전 ${e.kind === 'BOS' ? 'BOS(추세 지속)' : 'CHoCH(추세 전환)'}: 종가가 ${e.dir > 0 ? '직전 고점' : '직전 저점'} ${fp(e.level)}를 ${e.dir > 0 ? '위로' : '아래로'} 돌파했습니다.` }));
    const sw = ict.sweeps.slice(-1)[0];
    if (sw) ex2.append(el('p', { text: sw.dir > 0 ? `${n - 1 - sw.i}봉 전 저점 ${fp(sw.level)} 아래 손절 물량(매도 유동성)을 쓸고 종가가 다시 위로 올라왔습니다. ICT에서 반등 전조로 보는 패턴입니다.` : `${n - 1 - sw.i}봉 전 고점 ${fp(sw.level)} 위 매수 유동성을 쓸고 다시 내려왔습니다. 하락 전조로 보는 패턴입니다.` }));
    const kv2 = el('dl', { class: 'kv' });
    if (ict.bsl.length) kv2.append(el('dt', { text: '위쪽 유동성 (BSL)' }), el('dd', { text: ict.bsl.map(p => fp(p.p)).join(' · ') }));
    if (ict.ssl.length) kv2.append(el('dt', { text: '아래쪽 유동성 (SSL)' }), el('dd', { text: ict.ssl.map(p => fp(p.p)).join(' · ') }));
    ict.fvgs.slice(-3).forEach(g => kv2.append(el('dt', { text: g.dir > 0 ? '상승 FVG (미체결)' : '하락 FVG (미체결)' }), el('dd', { text: `${fp(g.bot)} ~ ${fp(g.top)}` })));
    ict.obs.slice(-2).forEach(o => kv2.append(el('dt', { text: o.dir > 0 ? '상승 오더블록' : '하락 오더블록' }), el('dd', { text: `${fp(o.bot)} ~ ${fp(o.top)}` })));
    if (ict.range) {
      kv2.append(el('dt', { text: '딜링 레인지' }), el('dd', { text: `${fp(ict.range.lo)} ~ ${fp(ict.range.hi)} · 현재 ${Math.round(ict.range.pos * 100)}% (${ict.range.pos < 0.5 ? '디스카운트' : '프리미엄'})` }));
      kv2.append(el('dt', { text: ict.range.legUp ? 'OTE 매수 구간' : 'OTE 매도 구간' }), el('dd', { text: `${fp(Math.min(...ict.range.ote))} ~ ${fp(Math.max(...ict.range.ote))}` }));
    }
    ex2.append(kv2, el('p', { class: 'note', text: '유동성은 아직 깨지지 않은 고점·저점(손절 물량이 몰린 곳), FVG는 급하게 움직이며 비워 둔 가격대, 디스카운트는 레인지 50% 아래(싸게 사는 쪽)입니다.' }));
    box.append(ex2);

    // 다이버전스
    const top2 = div[0];
    const exD = el('section', { class: 'ex' }, el('h3', null, '다이버전스 (가격 vs RSI)',
      top2 ? chip(top2.dir > 0 ? 'good' : 'bad', top2.dir > 0 ? '강세' : '약세') : chip('flat', '없음')));
    if (div.length) {
      div.forEach(d => {
        exD.append(el('p', null, el('b', { text: `${d.name}${d.provisional ? ' (진행 중, 미확정)' : ''}` }), ` · ${d.age}봉 전${d.strong ? (d.dir > 0 ? ' · RSI 과매도 구간에서 발생 (신호 강함)' : ' · RSI 과매수 구간에서 발생 (신호 강함)') : ''}`),
          el('p', { text: d.text }));
        exD.append(el('dl', { class: 'kv' },
          el('dt', { text: '가격' }), el('dd', { text: `${fp(d.a.p)} (${fdt(s.t[d.a.i])}) → ${fp(d.b.p)} (${fdt(s.t[d.b.i])})` }),
          el('dt', { text: 'RSI' }), el('dd', { text: `${d.a.r.toFixed(1)} → ${d.b.r.toFixed(1)}` })));
      });
      if (div.some(d => d.provisional)) exD.append(el('p', { class: 'note', text: '"진행 중"은 마지막 저점·고점이 아직 확정되지 않았다는 뜻입니다. 다음 몇 봉에서 가격이 더 밀리면 사라질 수 있습니다.' }));
    } else exD.append(el('p', { class: 'note', text: '최근 20봉 안에 뚜렷한 다이버전스가 없습니다.' }));
    exD.append(el('p', { class: 'note', text: '다이버전스는 힘이 약해진다는 경고이지 반전 확정이 아닙니다. ICT 구조 전환(CHoCH)이나 와이코프 스프링과 같이 나올 때 신뢰도가 올라갑니다.' }));
    box.append(exD);

    // 와이코프
    const ex3 = el('section', { class: 'ex' }, el('h3', null, '와이코프', wy ? chip(wy.tone, wy.schema) : null));
    if (wy) {
      ex3.append(el('p', null, el('b', { text: wy.phase })), el('p', { text: wy.text }));
      const kv3 = el('dl', { class: 'kv' });
      if (!wy.trending) kv3.append(el('dt', { text: '박스권' }), el('dd', { text: `${fp(wy.lo)} ~ ${fp(wy.hi)} (폭 ${(wy.width * 100).toFixed(1)}%)` }));
      wy.events.forEach(ev => kv3.append(el('dt', { text: ev.name }), el('dd', { text: fdt(s.t[ev.i]) })));
      kv3.append(el('dt', { text: '거래량' }), el('dd', { style: 'font-family:var(--sans)', text: wy.volNote }));
      ex3.append(kv3);
    } else ex3.append(el('p', { class: 'note', text: '판독에 필요한 봉 수가 부족합니다.' }));
    box.append(ex3);
  }

  // ---------- 차트 불러오기 ----------
  // 종목이 지원하는 데이터만 고릅니다 (코인은 하이퍼리퀴드만, SOXX는 정규장만).
  const effSrc = (sym, src) => !TA.hasHL(sym) ? 'yahoo' : !TA.hasYahoo(sym) ? 'hl' : src;
  function syncButtons() {
    $$('#symSeg button, #coinSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === S.sym));
    $$('#tfSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === S.tf));
    const src = effSrc(S.sym, S.src);
    $$('#srcSeg button').forEach(b => {
      b.setAttribute('aria-pressed', b.dataset.v === src);
      b.disabled = b.dataset.v === 'hl' ? !TA.hasHL(S.sym) : !TA.hasYahoo(S.sym);
    });
    $$('.card').forEach(c => c.setAttribute('aria-pressed', c.dataset.sym === S.sym));
    const inSeg = $$('#symSeg button, #coinSeg button').some(b => b.dataset.v === S.sym);
    if (document.activeElement !== $('#symIn')) $('#symIn').value = inSeg ? '' : TA.disp(S.sym);
  }
  async function loadChart(quiet) {
    const id = ++S.load;
    const src = effSrc(S.sym, S.src);
    const key = `${S.sym}|${S.tf}|${src}`;
    syncButtons();
    if (!quiet) setStatus('loading');
    try {
      const s = await TA.load(S.sym, S.tf, src);
      if (id !== S.load) return;
      if (s.t.length < 60) throw new Error(`${S.sym} ${TF_LABEL[S.tf]} 데이터가 부족합니다 (${s.t.length}봉)`);
            S.series = s; S.an = { ew: TA.elliott(s, TA.ewMult[S.tf]), ict: TA.ict(s), wy: TA.wyckoff(s), div: TA.divergence(s) };
      const keep = S.key === key; S.key = key;
      drawChart(keep); explain(); runPlan();
      setStatus('ok');
    } catch (e) { if (id === S.load) setStatus('err', e.message); }
  }

  // ---------- 방향성 점검표 ----------
  function trendOf(s) {
    const e20 = TA.ema(s.c, 20), e50 = TA.ema(s.c, 50), n = s.c.length, c = s.c[n - 1];
    const a = e20[n - 1], b = e50[n - 1];
    if (a == null || b == null) return ['flat', '데이터 부족'];
    if (c > a && a > b) return ['good', '상승 (가격 > EMA20 > EMA50)'];
    if (c < a && a < b) return ['bad', '하락 (가격 < EMA20 < EMA50)'];
    return ['warn', '혼조'];
  }
  // 점검표 묶음: SOXL·KORU 계열은 ETF + 기초지수, 그 밖의 종목은 자기 자신 + 시장 기준(BTC 또는 나스닥100)
  const mtfKey = sym => TA.hasYahoo(sym) ? TA.ETF_OF[sym] : sym;
  function mtfRows(sym) {
    if (TA.hasYahoo(sym)) {
      const etf = TA.ETF_OF[sym], pair = TA.PAIR[etf];
      const tag = pair === 'SOXX' ? '반도체 1배 (기초)' : '한국 1배 (기초)';
      return [[etf, '15m', 'hl'], [etf, '1h', 'yahoo'], [etf, '4h', 'yahoo'], [etf, '1d', 'yahoo'], [pair, '4h', 'yahoo', tag], [pair, '1d', 'yahoo', tag]];
    }
    const rows = ['15m', '1h', '4h', '1d'].map(tf => [sym, tf, 'hl']);
    const ref = sym.startsWith('xyz:') ? 'xyz:XYZ100' : 'BTC';
    const refTag = ref === 'BTC' ? '시장 기준' : '나스닥100 · 시장 기준';
    if (sym !== ref) rows.push([ref, '4h', 'hl', refTag], [ref, '1d', 'hl', refTag]);
    return rows;
  }
  async function loadMTF() {
    const rows = mtfRows(S.sym);
    const tb = $('#mtf tbody');
    const res = await Promise.all(rows.map(async ([sym, tf, src, tag]) => {
      try {
        const s = await TA.load(sym, tf, src);
        const ew = TA.elliott(s, TA.ewMult[tf]), ict = TA.ict(s), wy = TA.wyckoff(s), r = TA.rsi(s.c, 14);
        return { sym, tf, src, tag, s, ew, ict, wy, div: TA.divergence(s), rsi: r[r.length - 1], trend: trendOf(s) };
      } catch (e) { return { sym, tf, src, tag, err: e.message }; }
    }));
    tb.textContent = '';
    let good = 0, bad = 0;
    res.forEach(x => {
      const label = `${TA.dispFull(x.sym)} ${TF_LABEL[x.tf]}${x.src === 'hl' && TA.hasYahoo(x.sym) ? ' (하이퍼리퀴드)' : ''}${x.tag ? ' · ' + x.tag : ''}`;
      if (x.err) { tb.append(el('tr', null, el('td', { text: label }), el('td', { colspan: 6, class: 'muted', text: x.err }))); return; }
      const top = x.ew.cands[0], ict = x.ict, dv = x.div[0];
      if (dv) { if (dv.dir > 0) good++; else bad++; }
      const it = ict.trend > 0 ? ['good', '상승 구조'] : ict.trend < 0 ? ['bad', '하락 구조'] : ['flat', '불분명'];
      const ev = ict.lastEvent ? ` · ${ict.lastEvent.kind}` : '';
      [x.trend[0], it[0], top && top.dip[0], x.wy && x.wy.tone].forEach(t => { if (t === 'good') good++; if (t === 'bad') bad++; });
      const tr = el('tr', { class: 'click', title: '이 차트 보기', onclick: () => { selectSym(x.sym, x.tf, x.src); window.scrollTo({ top: $('.work').offsetTop - 70, behavior: 'smooth' }); } },
        el('td', null, el('b', { text: label })),
        el('td', null, chip(x.trend[0], x.trend[1])),
        el('td', null, chip(it[0], it[1] + ev)),
        el('td', null, top ? chip(top.dip[0], `${top.name} ${top.now} · ${top.pct}%`) : chip('flat', '판독 불가')),
        el('td', null, x.wy ? chip(x.wy.tone, `${x.wy.schema} · ${x.wy.phase}`) : chip('flat', '—')),
        el('td', null, dv ? chip(dv.dir > 0 ? 'good' : 'bad', `${dv.name.replace(' 다이버전스', '')}${dv.provisional ? '?' : ''} · ${dv.age}봉 전`) : chip('flat', '없음')),
        el('td', { class: 'r m ' + (x.rsi < 30 ? 'down' : x.rsi > 70 ? 'up' : ''), text: x.rsi == null ? '—' : x.rsi.toFixed(1) }));
      tb.append(tr);
    });
    // 질문하기 창에 보낼 요약
    S.mtfText = res.map(x => {
      const label = `${TA.dispFull(x.sym)} ${TF_LABEL[x.tf]}${x.tag ? ' (' + x.tag + ')' : ''}`;
      if (x.err) return `- ${label}: 데이터 오류`;
      const t = x.ew.cands[0], d = x.div[0];
      return `- ${label}: 추세 ${x.trend[1]} / ICT ${x.ict.trend > 0 ? '상승' : x.ict.trend < 0 ? '하락' : '불분명'} 구조${x.ict.lastEvent ? ' ' + x.ict.lastEvent.kind : ''} / 엘리엇 ${t ? `${t.name} ${t.now} ${t.pct}%` : '-'} / 와이코프 ${x.wy ? x.wy.schema + ' ' + x.wy.phase : '-'} / 다이버전스 ${d ? d.name : '없음'} / RSI ${x.rsi == null ? '-' : x.rsi.toFixed(1)}`;
    }).join('\n');
    $('#mtfNote').textContent = `초록(상승 쪽) ${good}개 · 빨강(하락 쪽) ${bad}개. 4시간·일봉·${TA.hasYahoo(S.sym) ? '기초지수' : '시장 기준'} 줄에 빨강이 많으면 짧은 봉에서 반등이 나와도 큰 흐름은 아직 하락 중이라는 뜻입니다. 행을 누르면 그 차트를 엽니다.`;
  }

  // ---------- 방향성 점수용 상위 봉 ----------
  // SOXL·KORU는 정규장 데이터(기간이 김), 그 밖의 종목은 하이퍼리퀴드
  async function contextFor(sym) {
    if (TA.hasYahoo(sym)) {
      const [h1, d1] = await Promise.all([TA.loadYahoo(sym, '1h'), TA.loadYahoo(sym, '1d')]);
      return TA.buildContext(h1, TA.to4h(h1), d1);
    }
    const [h1, h4, d1] = await Promise.all([TA.loadHL(sym, '1h'), TA.loadHL(sym, '4h'), TA.loadHL(sym, '1d')]);
    return TA.buildContext(h1, h4, d1);
  }

  // ---------- 예상 투자 결과 ----------
  // 방향: 1 = 롱, -1 = 숏, 0 = 아직 고르지 않음
  const PL = { side: ({ '1': 1, '-1': -1 })[store.get('pSide', '1')] || 0, key: null };
  ['pTp', 'pSl', 'pHold', 'pLev'].forEach(id => { const v = store.get(id, null); if (v != null) $('#' + id).value = v; });
  if (!$('#pHold').value) $('#pHold').value = '24';
  function syncDir() { $$('#pDir button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.v === PL.side))); }
  const roundPx = v => +(+v).toFixed(Math.min(8, dec(v) + 1));
  // 필수 입력(방향·진입가·목표)이 비어 있으면 계산하지 않고 무엇이 빠졌는지 돌려줍니다.
  function readPlan() {
    const entry = +$('#pEntry').value, tp = +$('#pTp').value, missing = [];
    if (!PL.side) missing.push('방향(롱/숏)');
    if (!(entry > 0)) missing.push('진입가');
    if (!(tp > 0)) missing.push('목표 수익');
    if (missing.length) return { missing };
    return { side: PL.side, entry, tp, sl: Math.max(0, +$('#pSl').value || 0),
      holdHours: +$('#pHold').value || 24, amt: Math.max(0, +$('#pAmt').value || 0), lev: Math.min(50, Math.max(1, +$('#pLev').value || 1)) };
  }
  function renderPlanEmpty(missing) {
    const out = $('#planOut'); out.textContent = '';
    out.append(el('div', { class: 'pb' }, el('p', { class: 'note', text: `${missing.join(', ')}을(를) 입력하면 계산합니다. 진입가는 [현재가] 버튼으로 바로 채울 수 있습니다.` })));
  }
  let planSeq = 0;
  async function runPlan() {
    if (!S.series) return;
    const s = S.series, an = S.an, id = ++planSeq, n = s.c.length, cur = s.c[n - 1];
    // 종목이 바뀌면 이전 종목의 진입가는 의미가 없으므로, 값이 있었을 때만 새 종목의 현재가로 바꿉니다.
    if (PL.key !== s.symbol) { if (PL.key !== null && $('#pEntry').value) $('#pEntry').value = roundPx(cur); PL.key = s.symbol; }
    $('#planCtx').textContent = `${TA.dispFull(s.symbol)} · ${TF_LABEL[s.interval]} 차트 · ${s.src === 'hl' ? '하이퍼리퀴드' : '미국 정규장'} 데이터 ${fdate(s.t[0])}~${fdate(s.t[n - 1])} 기준`;
    const plan = readPlan();
    if (plan.missing) { S.plan = null; drawPlanLines(); renderPlanEmpty(plan.missing); return; }
    let ctx = null;
    try { ctx = await contextFor(s.symbol); } catch (e) {}
    if (id !== planSeq) return;
    const r = TA.planEval(s, ctx, plan);
    const ctxNow = ctx ? ctx(s.t[n - 1] + 1) : null;
    const factors = TA.planFactors(s, an, ctxNow, plan, r);
    S.plan = { plan, r };
    renderPlan(plan, r, factors);
    drawPlanLines();
  }

  let planLines = [];
  TA.ui.planLineCount = () => planLines.length; // 확인용: 차트에 그려진 진입·목표·손절 선 수
  function drawPlanLines() {
    planLines.forEach(pl => candle.removePriceLine(pl)); planLines = [];
    if (!show.tr || !S.plan || !S.series) return;
    const { plan, r } = S.plan, L = plan.side > 0 ? '롱' : '숏';
    const add = (price, title, color, style, w) => planLines.push(candle.createPriceLine({ price, title, color, lineWidth: w || 1, lineStyle: style, axisLabelVisible: true }));
    add(plan.entry, `${L} 진입`, cv('--accent'), LW.LineStyle.Solid, 2);
    add(r.tpPx, `목표 ${plan.side > 0 ? '+' : '-'}${plan.tp}%`, plan.side > 0 ? cv('--up') : cv('--down'), LW.LineStyle.Dashed, 2);
    if (r.slPx != null) add(r.slPx, `손절 ${plan.sl}%`, cv('--muted'), LW.LineStyle.Dashed);
    if (r.liqRisk) add(plan.entry * (1 - plan.side * r.liqRisk.move), `청산 약 ${plan.lev}배`, cv('--down'), LW.LineStyle.Dotted);
  }

  function renderPlan(plan, r, factors) {
    const out = $('#planOut'); out.textContent = '';
    const st = r.st, L = plan.side > 0 ? '롱' : '숏';
    if (!st.samples) { out.append(el('div', { class: 'pb' }, el('p', { class: 'note', text: '비교할 과거 데이터가 부족합니다. 더 긴 봉 주기(1시간·4시간)를 골라 보세요.' }))); return; }
    const p = st.winRate * 100;
    const level = !st.filled ? ['flat', '판단 불가'] : p >= 70 ? ['good', '높음'] : p >= 50 ? ['warn', '보통'] : ['bad', '낮음'];
    const toneCls = level[0] === 'good' ? 'up' : level[0] === 'bad' ? 'down' : level[0] === 'warn' ? 'warn' : '';
    const w = k => st.filled ? (st[k] / st.filled * 100) : 0;
    out.append(el('div', { class: 'headline' },
      el('div', null, el('div', { class: 'muted', style: 'font-size:12px', text: `${L} ${plan.tp}% 목표 도달 가능성` }), el('div', { class: 'prob ' + toneCls, text: st.filled ? p.toFixed(0) + '%' : '—' })),
      chip(level[0], `가능성 ${level[1]}`),
      el('div', { class: 'planbar', title: `목표 도달 ${st.win} · 손절 ${st.sl} · 기간 내 미도달 ${st.timeout}` },
        el('i', { style: `width:${w('win')}%;background:var(--up)` }), el('i', { style: `width:${w('sl')}%;background:var(--down)` }), el('i', { style: `width:${w('timeout')}%;background:var(--muted);opacity:.45` })),
      el('div', { class: 'sub', text: `과거 비슷한 상황 ${st.filled}번 중 ${st.win}번 목표 도달${plan.sl ? `, ${st.sl}번은 손절가에 먼저 닿음` : ''}, ${st.timeout}번은 ${fdur(r.holdHours)} 안에 닿지 못함. 비교 기준: ${r.tier}. 조건 없이 아무 때나 같은 계획으로 들어갔다면 ${(r.bs.winRate * 100).toFixed(0)}%.` })));
    if (st.filled && st.filled < 12) out.append(el('div', { class: 'insight' }, el('div', { class: 'warn', text: `비슷한 상황이 ${st.filled}번뿐이라 확률의 신뢰도가 낮습니다. 봉 주기를 바꾸거나 보유 기간을 늘려 보세요.` })));
    if (Math.abs(r.rel) > 0.0005) {
      const below = r.rel < 0;
      out.append(el('div', { class: 'insight' }, el('div', null, `진입가 ${fp(plan.entry)}는 현재가보다 ${fpct(r.rel * 100)} ${below ? '낮은 지정가' : '높은 돌파 진입'}입니다. 과거 비슷한 상황에서 ${fdur(r.holdHours)} 안에 이 가격에 체결된 비율은 `, el('b', { text: (st.fillRate * 100).toFixed(0) + '%' }), '였고, 위 확률은 체결된 경우만 센 값입니다.')));
    }

    const tile = (k, v, sub, cls) => el('div', { class: 'tile' }, el('div', { class: 'k', text: k }), el('div', { class: 'v ' + (cls || ''), text: v }), el('div', { class: 's', text: sub }));
    const lev = plan.lev, amt = plan.amt;
    const money = v => (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) < 100 ? 2 : 0 });
    const tiles = [
      tile('진입가', fp(plan.entry), `현재가 ${fp(r.cur)} 대비 ${fpct(r.rel * 100)}`),
      tile('목표가', fp(r.tpPx), `${plan.side > 0 ? '+' : '-'}${plan.tp}%${lev > 1 ? ` · 레버리지 반영 ${fpct(plan.tp * lev, 1)}` : ''}`, plan.side > 0 ? 'up' : 'down'),
      tile('손절가', r.slPx != null ? fp(r.slPx) : '설정 안 함', r.slPx != null ? `-${plan.sl}%${lev > 1 ? ` · 레버리지 반영 ${fpct(-plan.sl * lev, 1)}` : ''}` : '손절 없이 기간 끝까지 보유한다고 가정'),
      tile('목표까지 걸린 시간', st.medHours != null ? fdur(st.medHours) : '—', '목표에 닿은 경우의 중앙값'),
      tile('그동안 반대로 밀린 폭', st.maeMed != null ? fpct(st.maeMed * 100, 1) : '—', st.maeWorst10 != null ? `나쁜 10%는 ${fpct(st.maeWorst10 * 100, 1)} 이상` : '', 'down')
    ];
    if (amt > 0) {
      const gain = amt * lev * plan.tp / 100, evAmt = r.ev != null ? amt * lev * r.ev : null;
      tiles.push(tile('예상 손익', money(gain), `목표 도달 시 · 과거 비율대로라면 1회 평균 ${evAmt != null ? money(evAmt) : '—'}`, 'up'));
    } else if (r.ev != null) tiles.push(tile('1회 평균 결과', fpct(r.ev * 100 * lev, 2), `과거 비슷한 상황의 평균 (레버리지 ${lev}배 반영) · 투자금을 넣으면 금액으로 보여줍니다`, r.ev >= 0 ? 'up' : 'down'));
    if (r.liqRisk) tiles.push(tile(`${lev}배 청산 위험`, (r.liqRisk.rate * 100).toFixed(0) + '%', `약 ${fpct(-r.liqRisk.move * 100, 1)} 역행 시 청산 · 과거 비슷한 상황에서 그만큼 밀린 비율`, r.liqRisk.rate > 0.1 ? 'down' : ''));
    out.append(el('div', { class: 'tiles' }, tiles));

    const good = factors.filter(f => f[0] === 'good'), rest = factors.filter(f => f[0] !== 'good');
    out.append(el('div', { class: 'cols' },
      el('div', null, el('h3', { text: `${L}에 유리한 점 (${good.length})` }), good.length ? el('ul', { class: 'vlist' }, good.map(([t, x]) => el('li', { class: t, text: x }))) : el('p', { class: 'note', text: '뚜렷하게 유리한 요인이 없습니다.' })),
      el('div', null, el('h3', { text: `불리하거나 주의할 점 (${rest.length})` }), rest.length ? el('ul', { class: 'vlist' }, rest.map(([t, x]) => el('li', { class: t, text: x }))) : el('p', { class: 'note', text: '뚜렷하게 불리한 요인이 없습니다.' }))));
    out.append(el('div', { class: 'pb' }, el('p', { class: 'note', text: `계산 방법: 이 차트의 과거 봉 중 지금과 RSI·방향성이 비슷했던 시점마다 같은 비율의 진입가·목표·손절로 들어갔다고 가정하고, ${fdur(r.holdHours)} 안에 무엇이 먼저 닿았는지 셌습니다. 한 봉 안에서 목표와 손절이 둘 다 닿으면 손절로 셉니다. 수수료·펀딩비·슬리피지는 빠져 있고, 과거 확률이 미래를 보장하지 않습니다. 투자 조언이 아닙니다.` })));
  }

  $('#pDir').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; PL.side = +b.dataset.v; store.set('pSide', PL.side); syncDir(); runPlan(); });
  $('#pNow').addEventListener('click', () => { if (S.series) { $('#pEntry').value = roundPx(S.series.c[S.series.c.length - 1]); runPlan(); } });
  let planTimer = null;
  $('#planForm').addEventListener('input', () => { ['pTp', 'pSl', 'pHold', 'pLev'].forEach(id => store.set(id, $('#' + id).value)); clearTimeout(planTimer); planTimer = setTimeout(runPlan, 350); });
  $('#planForm').addEventListener('submit', e => { e.preventDefault(); runPlan(); });
  // 초기화: 방향 선택과 모든 입력값을 지우고, 결과와 차트의 진입·목표·손절 선도 없앱니다.
  $('#pReset').addEventListener('click', () => {
    clearTimeout(planTimer); planSeq++;
    ['pEntry', 'pTp', 'pSl', 'pAmt', 'pLev'].forEach(id => { $('#' + id).value = ''; store.set(id, ''); });
    $('#pHold').value = '24'; store.set('pHold', '24');
    PL.side = 0; store.set('pSide', '0'); syncDir();
    S.plan = null; drawPlanLines();
    renderPlanEmpty(['방향(롱/숏)', '진입가', '목표 수익']);
  });
  syncDir();

  // ---------- 상단 시세 띠 ----------
  // [표시 이름, 하이퍼리퀴드 종목, 누르면 열 차트 종목]
  const TAPE = [['SOXL', 'xyz:SOXL', 'SOXL'], ['KORU', 'xyz:KORU', 'KORU'], ['EWY', 'xyz:EWY', 'EWY'], ['나스닥100', 'xyz:XYZ100', 'xyz:XYZ100'],
    ['BTC', 'BTC', 'BTC'], ['ETH', 'ETH', 'ETH'], ['SOL', 'SOL', 'SOL'], ['HYPE', 'HYPE', 'HYPE'], ['XRP', 'XRP', 'XRP']];
  async function loadTape() {
    let m; try { m = await TA.loadCtx(); } catch (e) { return; }
    const box = $('#tape'); box.textContent = '';
    TAPE.forEach(([label, coin, sym]) => {
      const x = m[coin]; if (!x) return;
      const px = +x.markPx, prev = +x.prevDayPx, ch = prev ? (px / prev - 1) * 100 : null;
      box.append(el('button', { class: 'tick', type: 'button', title: `${label} 차트 보기`, onclick: () => TA.ui.openChart(sym) },
        el('span', { class: 's', text: label }), el('span', { text: fp(px) }), el('span', { class: toneOf(ch), text: fpct(ch) })));
    });
  }

  // ---------- 신호 카드 ----------
  async function loadCards() {
    const box = $('#cards');
    let ctxMap = {};
    try { ctxMap = await TA.loadCtx(); } catch (e) {}
    // 기본 카드 SOXL·KORU + 지금 차트에서 보고 있는 종목
    const syms = ['SOXL', 'KORU'];
    const curEtf = TA.hasYahoo(S.sym) ? TA.ETF_OF[S.sym] : S.sym;
    if (!syms.includes(curEtf) && TA.hasHL(curEtf)) syms.push(curEtf);
    const cards = await Promise.all(syms.map(async sym => {
      try {
        const [s, ctx] = await Promise.all([TA.loadHL(sym, '15m'), contextFor(sym)]);
        const r = TA.rsi(s.c, 14), rsi = r[s.c.length - 1];
        return { sym, s, rsi, now: ctx(Date.now() / 1000), x: ctxMap[TA.hlCoin(sym)] || {} };
      } catch (e) { return { sym, err: e.message }; }
    }));
    box.textContent = '';
    cards.forEach(cd => {
      const btn = el('button', { class: 'card', type: 'button', 'data-sym': cd.sym, 'aria-pressed': String(cd.sym === S.sym), onclick: () => selectSym(cd.sym, '15m', 'hl') });
      if (cd.err) { btn.append(el('div', { class: 'card-h' }, el('b', { text: TA.dispFull(cd.sym) }), el('span', { class: 'down', text: cd.err }))); box.append(btn); return; }
      const mk = +cd.x.markPx || cd.s.c[cd.s.c.length - 1], prev = +cd.x.prevDayPx, ch = prev ? (mk / prev - 1) * 100 : null;
      const g = cd.now.group;
      btn.append(
        el('div', { class: 'card-h' }, el('span', null, el('b', { text: TA.dispFull(cd.sym) }), ' ', el('span', { class: 'muted', text: '하이퍼리퀴드 15분' })),
          el('span', null, el('span', { class: 'px', text: fp(mk) }), ' ', el('span', { class: toneOf(ch), text: fpct(ch) }))),
        el('div', { class: 'card-row' }, el('span', { class: 'muted', text: 'RSI 14' }), el('span', { class: 'rsi-big', text: cd.rsi == null ? '—' : cd.rsi.toFixed(1) }),
          el('div', { class: 'gauge', title: 'RSI 0~100 · 30 아래 과매도, 70 위 과매수' }, el('i', { style: `left:${Math.max(0, Math.min(100, cd.rsi || 0))}%` }))),
        el('div', { class: 'card-row' }, el('span', { class: 'muted', text: '방향성' }), chip(g === 'good' ? 'good' : g === 'bad' ? 'bad' : 'warn', `${TA.groupName[g]} ${cd.now.score > 0 ? '+' : ''}${cd.now.score}`),
          ...cd.now.f.map((v, i) => el('span', { class: 'stat-line ' + toneOf(v), text: `${TA.ctxLabels[i].split('(')[0].trim()} ${v > 0 ? '▲' : v < 0 ? '▼' : '–'}` }))));
      box.append(btn);
    });
    syncButtons();
  }

  // ---------- 이벤트 ----------
  function save() { store.set('sym', S.sym); store.set('tf', S.tf); store.set('src', S.src); }
  // 종목 바꾸기: 차트·해설·예상 투자 결과·점검표·카드가 모두 따라 바뀝니다.
  function selectSym(sym, tf, src) {
    const prevKey = mtfKey(S.sym), prevSym = S.sym, prevTf = S.tf, prevSrc = S.src;
    S.sym = sym; if (tf) S.tf = tf; if (src) S.src = src;
    if (S.sym === prevSym && S.tf === prevTf && S.src === prevSrc) return;
    save(); loadChart();
    if (mtfKey(S.sym) !== prevKey) { loadMTF(); loadCards(); }
  }
  const segPick = e => { const b = e.target.closest('button'); if (b) selectSym(b.dataset.v); };
  $('#symSeg').addEventListener('click', segPick);
  $('#coinSeg').addEventListener('click', segPick);
  $('#symForm').addEventListener('submit', async e => {
    e.preventDefault();
    const inp = $('#symIn'), sym = await TA.resolveSym(inp.value).catch(() => null);
    if (!sym) { inp.setCustomValidity(`"${inp.value}" 종목을 하이퍼리퀴드에서 찾지 못했습니다`); inp.reportValidity(); return; }
    inp.setCustomValidity(''); inp.blur(); selectSym(sym);
  });
  $('#symIn').addEventListener('input', () => $('#symIn').setCustomValidity(''));
  $('#symIn').addEventListener('change', () => { if ($('#symIn').value) $('#symForm').requestSubmit(); });
  // 검색 목록: 거래대금 순 하이퍼리퀴드 전 종목
  TA.loadUniverse().then(list => {
    const dl = $('#symList'); dl.textContent = '';
    ['SOXL', 'KORU', 'SOXX', 'EWY'].forEach(v => dl.append(el('option', { value: v })));
    list.forEach(x => { if (x.name !== 'xyz:SOXL' && x.name !== 'xyz:KORU') dl.append(el('option', { value: TA.disp(x.name) + (x.stock ? ' (주식)' : '') })); });
  }).catch(() => {});
  // 질문하기 창이 보낼 "지금 차트" 요약 (숫자는 화면과 같은 값)
  TA.ui.chartContext = function () {
    if (!S.series || !S.an) return null;
    const s = S.series, { ew, ict, wy, div } = S.an, n = s.c.length, c = s.c[n - 1];
    const r = TA.rsi(s.c, 14), L = [];
    L.push(`종목: ${TA.dispFull(s.symbol)} · 봉: ${TF_LABEL[s.interval]} · 데이터: ${s.src === 'hl' ? '하이퍼리퀴드 ' + TA.hlCoin(s.symbol) + ' 무기한(24시간)' : '미국 정규장(야후)'} · 기간 ${fdate(s.t[0])}~${fdt(s.t[n - 1])} (${n}봉)`);
    L.push(`현재가 ${fp(c)} · RSI14 ${r[n - 1] == null ? '-' : r[n - 1].toFixed(1)} · 시각은 한국 시간`);
    L.push('EMA: ' + EMA_LEN.map(k => { const v = TA.ema(s.c, k)[n - 1]; return `EMA${k} ${v == null ? '-' : fp(v)}${v == null ? '' : c > v ? '(가격 위)' : '(가격 아래)'}`; }).join(' · '));
    L.push('최근 30봉 (시각 시가/고가/저가/종가):');
    for (let i = Math.max(0, n - 30); i < n; i++) L.push(`${fdt(s.t[i])} ${fp(s.o[i])}/${fp(s.h[i])}/${fp(s.l[i])}/${fp(s.c[i])}`);
    L.push('', '[엘리엇] 지그재그 기준 ' + (ew.thr * 100).toFixed(1) + '%');
    L.push('최근 고점·저점: ' + ew.zz.slice(-8).map(p => `${p.type === 'H' ? '고' : '저'} ${fp(p.p)}(${fdt(s.t[p.i])}${p.provisional ? ', 진행 중' : ''})`).join(' → '));
    ew.cands.forEach((x, k) => L.push(`후보${k + 1}: ${x.name} ${x.now} 가능성 ${x.pct}% · 파동점 ${x.seq.map((p, j) => (x.labels[j] || '시작') + ' ' + fp(p.p)).join(', ')}` +
      `${x.target != null ? ' · 다음 목표 ' + fp(x.target) : ''}${x.targetNote ? ' (' + x.targetNote + ')' : ''}${x.zone ? ' · 구간 ' + fp(x.zone[0]) + '~' + fp(x.zone[1]) : ''}${x.invalid != null ? ' · 무효화 ' + fp(x.invalid) : ''} · 해석: ${x.dip[1]}`));
    L.push('', `[ICT] ${ict.trend > 0 ? '상승' : ict.trend < 0 ? '하락' : '불분명'} 구조`);
    ict.events.slice(-4).forEach(e => L.push(`- ${e.kind}${e.dir > 0 ? '↑' : '↓'} ${fdt(s.t[e.i])} 기준가 ${fp(e.level)}`));
    ict.sweeps.slice(-3).forEach(w => L.push(`- 유동성 스윕(${w.dir > 0 ? '저점 아래' : '고점 위'}) ${fdt(s.t[w.i])} 레벨 ${fp(w.level)}`));
    if (ict.bsl.length) L.push('- 위쪽 유동성(BSL): ' + ict.bsl.map(p => fp(p.p)).join(', '));
    if (ict.ssl.length) L.push('- 아래쪽 유동성(SSL): ' + ict.ssl.map(p => fp(p.p)).join(', '));
    ict.fvgs.forEach(g => L.push(`- ${g.dir > 0 ? '상승' : '하락'} FVG ${fp(g.bot)}~${fp(g.top)}`));
    ict.obs.forEach(o => L.push(`- ${o.dir > 0 ? '상승' : '하락'} 오더블록 ${fp(o.bot)}~${fp(o.top)}`));
    if (ict.range) L.push(`- 딜링 레인지 ${fp(ict.range.lo)}~${fp(ict.range.hi)}, 현재 ${Math.round(ict.range.pos * 100)}% (${ict.range.pos < 0.5 ? '디스카운트' : '프리미엄'}), OTE ${fp(Math.min(...ict.range.ote))}~${fp(Math.max(...ict.range.ote))}`);
    L.push('', '[와이코프] ' + (wy ? `${wy.schema} · ${wy.phase} · ${wy.text}${wy.trending ? '' : ` · 박스 ${fp(wy.lo)}~${fp(wy.hi)}`} · 이벤트: ${wy.events.map(e => e.name + ' ' + fdt(s.t[e.i])).join(', ') || '없음'} · ${wy.volNote}` : '판독 불가'));
    L.push('', '[다이버전스] ' + (div.length ? div.map(d => `${d.name}${d.provisional ? '(진행 중)' : ''}: 가격 ${fp(d.a.p)}→${fp(d.b.p)}, RSI ${d.a.r.toFixed(1)}→${d.b.r.toFixed(1)}, ${fdt(s.t[d.a.i])}→${fdt(s.t[d.b.i])}`).join(' / ') : '최근 20봉 안에 없음'));
    const dip = TA.dipView(ict, ew, wy, div);
    L.push('', `[종합 판독] ${dip.verdict[1]} (점수 ${dip.score})`);
    if (S.mtfText) L.push('', '[방향성 점검표]', S.mtfText);
    if (S.plan) {
      const { plan, r: pr } = S.plan;
      L.push('', `[예상 투자 결과 입력값] ${plan.side > 0 ? '롱' : '숏'} 진입 ${fp(plan.entry)}, 목표 ${plan.tp}% (${fp(pr.tpPx)}), 손절 ${plan.sl ? plan.sl + '%' : '없음'}, 보유 ${fdur(pr.holdHours)}, 레버리지 ${plan.lev}배 → 과거 비슷한 상황 ${pr.st.filled}번 중 목표 도달 ${(pr.st.winRate * 100).toFixed(0)}%`);
    }
    const fc = TA.ui.flowContext && TA.ui.flowContext();
    if (fc) L.push('', fc);
    return { sym: s.symbol, tf: s.interval, label: `${TA.dispFull(s.symbol)} ${TF_LABEL[s.interval]}`, text: L.join('\n') };
  };
  TA.ui.openChart = sym => { location.hash = '#trade'; selectSym(sym, '15m', 'hl'); setTimeout(() => window.scrollTo({ top: $('.work').offsetTop - 70, behavior: 'smooth' }), 50); };
  $('#tfSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.dataset.v === S.tf) return; S.tf = b.dataset.v; save(); loadChart(); });
  $('#srcSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.disabled || b.dataset.v === S.src) return; S.src = b.dataset.v; save(); loadChart(); });
  Object.keys(show).forEach(k => { const c = $('#t-' + k); c.checked = !!show[k]; c.addEventListener('change', () => { show[k] = c.checked; store.set('show', JSON.stringify(show)); if (S.series) drawChart(true); }); });

  const root = document.documentElement;
  const savedTheme = store.get('theme', ''); if (savedTheme) root.dataset.theme = savedTheme;
  const isDark = () => root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const themeLabel = () => { $('#theme').textContent = isDark() ? '라이트 모드' : '다크 모드'; };
  $('#theme').addEventListener('click', () => { root.dataset.theme = isDark() ? 'light' : 'dark'; store.set('theme', root.dataset.theme); themeLabel(); applyTheme(); window.dispatchEvent(new Event('themechange')); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { themeLabel(); applyTheme(); window.dispatchEvent(new Event('themechange')); });

  // 탭
  const TABS = ['trade', 'flow', 'whale'];
  TA.ui.activeTab = () => { const h = location.hash.slice(1); return TABS.includes(h) ? h : 'trade'; };
  function route() {
    const cur = TA.ui.activeTab();
    TABS.forEach(t => { $('#tab-' + t).hidden = t !== cur; $('#nav-' + t).setAttribute('aria-current', t === cur ? 'page' : 'false'); });
    window.dispatchEvent(new CustomEvent('tabchange', { detail: cur }));
    if (cur === 'trade') requestAnimationFrame(queueZones);
  }
  window.addEventListener('hashchange', route);

  // 대시보드 파일이 바뀌면(업데이트) 열려 있는 페이지가 스스로 새로고침합니다. 입력값은 저장돼 있어 그대로 남습니다.
  // start-local.bat 서버에서만 작동하고, GitHub Pages에서는 조용히 넘어갑니다.
  let pageVersion = null;
  async function checkVersion() {
    try {
      const r = await fetch('api/version', { headers: { 'X-Dashboard': '1' }, cache: 'no-store' });
      if (!r.ok) return;
      const { v } = await r.json();
      if (pageVersion == null) pageVersion = v;
      else if (v !== pageVersion && !window.TA_chatBusy) location.reload();
    } catch (e) {}
  }
  checkVersion(); setInterval(checkVersion, 20000);

  // ---------- 시작 ----------
  themeLabel(); applyTheme(); route();
  loadChart(); loadCards(); loadMTF(); loadTape();
  setInterval(() => { if (!document.hidden) loadTape(); }, 15000);
  let tick = 0;
  setInterval(() => {
    if (document.hidden || TA.ui.activeTab() !== 'trade') return;
    tick++;
    if (effSrc(S.sym, S.src) === 'hl') loadChart(true);
    if (tick % 2 === 0) loadCards();
    if (tick % 8 === 0) loadMTF();
  }, 15000);
})();
