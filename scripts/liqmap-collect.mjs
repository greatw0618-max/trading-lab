// 청산맵 자료 모으기: 바이낸스·바이빗·OKX·비트겟·하이퍼리퀴드의 15분 OI(미결제약정)와 시장가 매수 비율, 바이낸스 15분봉.
// 예약 작업 "MaemaeLab LiqMap Collect"가 15분마다 실행합니다. 결과는 liqmap/<코인>.json (최근 60일).
// 과거 OI를 주는 거래소(바이낸스 30일, 바이빗 60일, OKX 최근 일부)는 처음 실행 때 채우고, 현재값만 주는 곳(비트겟·하이퍼리퀴드)은 실행할 때마다 쌓습니다.
// 사용: node scripts/liqmap-collect.mjs [--push | --auto]   (--push 이면 liqmap/ 을 GitHub에 올림, --auto 는 3시간마다만)
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'liqmap');
const COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'HYPE'];
const M15 = 15 * 60e3, KEEP = 60 * 864e5;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, opt) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url, opt); if (r.ok) return await r.json(); if (r.status !== 429) throw new Error(r.status + ' ' + url); } catch (e) { if (i === 2) throw e; }
    await sleep(1500 * (i + 1));
  }
}
const slot = t => Math.floor(t / M15) * M15;

function load(coin) {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, coin + '.json'), 'utf8')); } catch (e) { return { coin, bars: [], oi: {}, buy: {} }; }
}
const EX = ['binance', 'bybit', 'okx', 'bitget', 'hl'];

// ---------- 거래소별 ----------
async function binanceBars(coin, from) { // [t,o,h,l,c,시장가 매수 비율]
  const out = [];
  for (let s = from; s < Date.now(); s += 1500 * M15) {
    const k = await get(`https://fapi.binance.com/fapi/v1/klines?symbol=${coin}USDT&interval=15m&limit=1500&startTime=${s}`);
    k.forEach(x => out.push([x[0], +x[1], +x[2], +x[3], +x[4], +x[5] ? +x[9] / +x[5] : 0.5]));
    if (k.length < 1500) break;
  }
  return out;
}
async function binanceOi(coin, from) {
  const out = {}, start = Math.max(from, Date.now() - 29.5 * 864e5);
  for (let s = start; s < Date.now(); s += 500 * M15) {
    const a = await get(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${coin}USDT&period=15m&limit=500&startTime=${s}&endTime=${Math.min(Date.now(), s + 500 * M15)}`);
    a.forEach(x => { out[slot(x.timestamp)] = +x.sumOpenInterest; });
  }
  return out;
}
async function bybitOi(coin, from) {
  const out = {};
  let end = Date.now();
  while (end > from) {
    const r = await get(`https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${coin}USDT&intervalTime=15min&limit=200&endTime=${end}`);
    const l = r.result.list; if (!l.length) break;
    l.forEach(x => { out[slot(+x.timestamp)] = +x.openInterest; });
    const oldest = Math.min(...l.map(x => +x.timestamp)); if (oldest >= end) break; end = oldest - 1;
  }
  return out;
}
async function okx(coin, from) {
  const oi = {}, buy = {}, inst = `${coin}-USDT-SWAP`;
  let end = Date.now();
  for (let i = 0; i < 60 && end > from; i++) {
    const r = await get(`https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-history?instId=${inst}&period=15m&limit=100&end=${end}`);
    if (!r.data || !r.data.length) break;
    r.data.forEach(x => { oi[slot(+x[0])] = +x[2]; });
    end = Math.min(...r.data.map(x => +x[0])) - 1;
  }
  end = Date.now();
  for (let i = 0; i < 60 && end > from; i++) {
    const r = await get(`https://www.okx.com/api/v5/rubik/stat/taker-volume-contract?instId=${inst}&period=15m&limit=100&end=${end}`);
    if (!r.data || !r.data.length) break;
    r.data.forEach(x => { const s = +x[1], b = +x[2]; if (s + b > 0) buy[slot(+x[0])] = b / (s + b); });
    end = Math.min(...r.data.map(x => +x[0])) - 1;
  }
  return { oi, buy };
}
async function bitget(coin) {
  const oi = {}, buy = {};
  const r = await get(`https://api.bitget.com/api/v2/mix/market/open-interest?symbol=${coin}USDT&productType=USDT-FUTURES`);
  const x = r.data && r.data.openInterestList && r.data.openInterestList[0];
  if (x) oi[slot(Date.now())] = +x.size; // 현재값만 줌 → 이번 15분 칸에 기록
  const t = await get(`https://api.bitget.com/api/v2/mix/market/taker-buy-sell?symbol=${coin}USDT&productType=USDT-FUTURES&period=15m&limit=1000`).catch(() => null);
  ((t && t.data) || []).forEach(y => { const s = +y.sellVolume, b = +y.buyVolume; if (s + b > 0) buy[slot(+y.ts)] = b / (s + b); });
  return { oi, buy };
}
let hlCtx = null;
async function hl(coin) {
  if (!hlCtx) hlCtx = await get('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'metaAndAssetCtxs' }) });
  const i = hlCtx[0].universe.findIndex(u => u.name === coin);
  return i >= 0 ? { [slot(Date.now())]: +hlCtx[1][i].openInterest } : {};
}

// ---------- 코인 하나 갱신 ----------
async function update(coin) {
  const d = load(coin), now = Date.now(), cut = now - KEEP;
  const lastBar = d.bars.length ? d.bars[d.bars.length - 1][0] : 0;
  const fresh = !d.bars.length;
  const from = fresh ? cut : now - 864e5; // 처음엔 60일, 그다음엔 최근 하루만 다시 받음
  const log = [];
  const step = async (name, f) => { try { await f(); } catch (e) { log.push(`${name} 실패: ${e.message}`); } };
  await step('바이낸스 봉', async () => {
    const bars = await binanceBars(coin, fresh ? cut : Math.min(lastBar, now - 864e5));
    const m = new Map(d.bars.map(b => [b[0], b])); bars.forEach(b => m.set(b[0], b));
    d.bars = [...m.values()].sort((a, b) => a[0] - b[0]);
  });
  EX.forEach(e => { d.oi[e] = d.oi[e] || {}; d.buy[e] = d.buy[e] || {}; });
  await step('바이낸스 OI', async () => Object.assign(d.oi.binance, await binanceOi(coin, from)));
  await step('바이빗 OI', async () => Object.assign(d.oi.bybit, await bybitOi(coin, from)));
  await step('OKX', async () => { const x = await okx(coin, from); Object.assign(d.oi.okx, x.oi); Object.assign(d.buy.okx, x.buy); });
  await step('비트겟', async () => { const x = await bitget(coin); Object.assign(d.oi.bitget, x.oi); Object.assign(d.buy.bitget, x.buy); });
  await step('하이퍼리퀴드', async () => Object.assign(d.oi.hl, await hl(coin)));
  // 60일 넘은 자료 지우기
  d.bars = d.bars.filter(b => b[0] >= cut);
  EX.forEach(e => { for (const k of Object.keys(d.oi[e])) if (+k < cut) delete d.oi[e][k]; for (const k of Object.keys(d.buy[e])) if (+k < cut) delete d.buy[e][k]; });
  d.updated = now;
  d.first = Object.fromEntries(EX.map(e => [e, Object.keys(d.oi[e]).length ? Math.min(...Object.keys(d.oi[e]).map(Number)) : null]));
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, coin + '.json'), JSON.stringify(d));
  return `${coin}: 봉 ${d.bars.length} · OI ` + EX.map(e => `${e} ${Object.keys(d.oi[e]).length}`).join(' ') + (log.length ? ' · ' + log.join(' / ') : '');
}

const lines = [];
for (const c of COINS) { lines.push(await update(c).catch(e => `${c}: 실패 ${e.message}`)); }
fs.writeFileSync(path.join(DIR, 'index.json'), JSON.stringify({ coins: COINS, updated: Date.now() }));
console.log(lines.join('\n'));
fs.appendFileSync(path.join(DIR, 'collect.log'), new Date().toISOString() + '\n' + lines.join('\n') + '\n');

// --auto: 예약 작업용. 3시간마다(0·3·6…시 첫 15분) 한 번만 GitHub에 올림
const hr = new Date();
if (process.argv.includes('--push') || (process.argv.includes('--auto') && hr.getHours() % 3 === 0 && hr.getMinutes() < 15)) {
  try {
    const g = (...a) => execFileSync('git', ['-C', ROOT, ...a], { stdio: 'pipe' }).toString();
    g('add', '--', 'liqmap/*.json');
    try { g('commit', '-q', '-m', 'Save liqmap data', '--', 'liqmap'); } catch (e) {}
    g('pull', '--rebase', '--autostash', '-q', 'origin', 'main'); g('push', '-q', 'origin', 'main');
    console.log('GitHub 업로드 완료');
  } catch (e) { console.log('GitHub 업로드 실패: ' + e.message); }
}
