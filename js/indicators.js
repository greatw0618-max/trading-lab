// 기본 지표와 고점·저점 탐지. 시계열은 { t:[초], o:[], h:[], l:[], c:[], v:[] } 형태의 배열 묶음입니다.
window.TA = window.TA || {};
(function (TA) {
  TA.ema = function (src, n) {
    const out = new Array(src.length).fill(null), k = 2 / (n + 1);
    let prev = null, sum = 0, cnt = 0;
    for (let i = 0; i < src.length; i++) {
      const v = src[i]; if (v == null) continue;
      if (prev == null) { sum += v; if (++cnt === n) out[i] = prev = sum / n; }
      else out[i] = prev = v * k + prev * (1 - k);
    }
    return out;
  };

  TA.sma = function (src, n) {
    const out = new Array(src.length).fill(null); let s = 0;
    for (let i = 0; i < src.length; i++) {
      s += src[i]; if (i >= n) s -= src[i - n];
      if (i >= n - 1) out[i] = s / n;
    }
    return out;
  };

  TA.rsi = function (c, n) {
    const out = new Array(c.length).fill(null); if (c.length <= n) return out;
    let g = 0, l = 0;
    for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
    g /= n; l /= n; out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    for (let i = n + 1; i < c.length; i++) {
      const d = c[i] - c[i - 1];
      g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n;
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return out;
  };

  TA.atr = function (h, l, c, n) {
    const out = new Array(c.length).fill(null); let a = 0;
    for (let i = 0; i < c.length; i++) {
      const tr = i === 0 ? h[i] - l[i] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
      if (i < n) { a += tr; if (i === n - 1) out[i] = a = a / n; }
      else out[i] = a = (a * (n - 1) + tr) / n;
    }
    return out;
  };

  TA.median = function (arr) {
    const a = arr.filter(v => v != null && isFinite(v)).sort((x, y) => x - y);
    return a.length ? a[Math.floor(a.length / 2)] : null;
  };
  TA.percentile = function (arr, q) {
    const a = arr.filter(v => v != null && isFinite(v)).sort((x, y) => x - y);
    return a.length ? a[Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))))] : null;
  };

  // 시계열 일부 자르기
  TA.slice = function (s, from, to) {
    const out = {};
    for (const k of ['t', 'o', 'h', 'l', 'c', 'v']) out[k] = s[k].slice(from, to);
    out.interval = s.interval; out.symbol = s.symbol;
    return out;
  };

  // 1시간봉 → 4시간봉: 뉴욕 정규장 기준 오전(9:30~13:30)과 오후(13:30~16:00) 두 개로 묶습니다.
  const nyFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false });
  TA.to4h = function (s) {
    const out = { t: [], o: [], h: [], l: [], c: [], v: [], interval: '4h', symbol: s.symbol };
    let key = null;
    for (let i = 0; i < s.t.length; i++) {
      const parts = nyFmt.formatToParts(new Date(s.t[i] * 1000));
      const get = ty => parts.find(p => p.type === ty).value;
      const hour = +get('hour') % 24;
      const k = get('year') + get('month') + get('day') + (hour < 13 ? 'a' : 'b');
      if (k !== key) {
        key = k;
        out.t.push(s.t[i]); out.o.push(s.o[i]); out.h.push(s.h[i]); out.l.push(s.l[i]); out.c.push(s.c[i]); out.v.push(s.v[i]);
      } else {
        const j = out.t.length - 1;
        out.h[j] = Math.max(out.h[j], s.h[i]); out.l[j] = Math.min(out.l[j], s.l[i]); out.c[j] = s.c[i]; out.v[j] += s.v[i];
      }
    }
    return out;
  };

  // 프랙탈 고점·저점: 좌우 k개 봉보다 높거나 낮은 봉. conf = 확정되는 봉 번호(i + k).
  TA.fractals = function (s, k) {
    const out = [], n = s.t.length;
    for (let i = k; i < n - k; i++) {
      let hi = true, lo = true;
      for (let j = 1; j <= k; j++) {
        if (s.h[i] <= s.h[i - j] || s.h[i] < s.h[i + j]) hi = false;
        if (s.l[i] >= s.l[i - j] || s.l[i] > s.l[i + j]) lo = false;
      }
      if (hi) out.push({ i, p: s.h[i], type: 'H', conf: i + k });
      if (lo) out.push({ i, p: s.l[i], type: 'L', conf: i + k });
    }
    return out;
  };

  // 지그재그: thr(비율) 이상 되돌림이 나와야 고점·저점으로 확정. 마지막 점은 아직 진행 중(provisional).
  TA.zigzag = function (s, thr) {
    const n = s.t.length, piv = [];
    if (n < 3) return piv;
    let trend = 0, maxI = 0, minI = 0, cand = null;
    for (let i = 1; i < n; i++) {
      if (trend === 0) {
        if (s.h[i] > s.h[maxI]) maxI = i;
        if (s.l[i] < s.l[minI]) minI = i;
        if (s.h[i] >= s.l[minI] * (1 + thr) && minI < i) { piv.push({ i: minI, p: s.l[minI], type: 'L', conf: i }); trend = 1; cand = { i, p: s.h[i] }; }
        else if (s.l[i] <= s.h[maxI] * (1 - thr) && maxI < i) { piv.push({ i: maxI, p: s.h[maxI], type: 'H', conf: i }); trend = -1; cand = { i, p: s.l[i] }; }
      } else if (trend === 1) {
        if (s.h[i] > cand.p) cand = { i, p: s.h[i] };
        else if (s.l[i] <= cand.p * (1 - thr)) { piv.push({ i: cand.i, p: cand.p, type: 'H', conf: i }); trend = -1; cand = { i, p: s.l[i] }; }
      } else {
        if (s.l[i] < cand.p) cand = { i, p: s.l[i] };
        else if (s.h[i] >= cand.p * (1 + thr)) { piv.push({ i: cand.i, p: cand.p, type: 'L', conf: i }); trend = 1; cand = { i, p: s.h[i] }; }
      }
    }
    if (cand) piv.push({ i: cand.i, p: cand.p, type: trend === 1 ? 'H' : 'L', conf: null, provisional: true });
    return piv;
  };

  // 봉 주기에 맞는 지그재그 기준: 최근 ATR%의 중앙값 × 배수
  TA.zigzagThreshold = function (s, mult) {
    const a = TA.atr(s.h, s.l, s.c, 14), n = s.c.length, pct = [];
    for (let i = Math.max(14, n - 300); i < n; i++) if (a[i] != null) pct.push(a[i] / s.c[i]);
    const m = TA.median(pct) || 0.01;
    return Math.min(0.5, Math.max(0.004, m * mult));
  };

  // 선형회귀 기울기(봉당)
  TA.slope = function (arr) {
    const n = arr.length; if (n < 2) return 0;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sx += i; sy += arr[i]; sxy += i * arr[i]; sxx += i * i; }
    return (n * sxy - sx * sy) / (n * sxx - sx * sx);
  };
})(window.TA);
