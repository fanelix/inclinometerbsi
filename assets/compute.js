/* IPI Profile Sheet — displacement mathematics.
 *
 * A sensor reports sin(theta) from vertical. Over a gauge length L the segment
 * deflects by  d = L · sin(theta).  Everything below is that identity, differenced
 * against a base reading and integrated from the fixed end of the string.
 *
 *   incremental[p] = L · ( sin(theta)_now − sin(theta)_base )      per segment
 *   cumulative[p]  = Σ incremental over every segment between p and the fixed end
 *
 * Display position p = 0 is always the SHALLOWEST segment, whichever end of the
 * string the manufacturer numbered as sensor 1.
 */
(function (root) {
  'use strict';
  var IPI = (root.IPI = root.IPI || {});

  /* Display position -> column in the dataset. */
  function slotOf(p, n, topFirst) { return topFirst ? p : n - 1 - p; }

  IPI.sensorLabel = function (p, n, topFirst) { return topFirst ? p + 1 : n - p; };

  /**
   * One displacement profile.
   * @param ds dataset from IPI.parse
   * @param o  { baseIndex, readingIndex, axis:'a'|'b', gauge (m), topDepth (m),
   *             fixedEnd:'bottom'|'top', sign:1|-1, topFirst:bool }
   * @returns  { inc, incDepth, cum, cumDepth, sensor, gaps }
   */
  IPI.profile = function (ds, o) {
    var n = ds.n, L = o.gauge * 1000, sign = o.sign || 1;
    var src = o.axis === 'b' ? ds.b : ds.a;
    var bo = o.baseIndex * n, ro = o.readingIndex * n;
    var topFirst = o.topFirst !== false;

    var inc = new Array(n), incDepth = new Array(n), sensor = new Array(n), gaps = [];
    for (var p = 0; p < n; p++) {
      var s = slotOf(p, n, topFirst);
      var v = (src[ro + s] - src[bo + s]) * L * sign;
      if (v !== v) gaps.push(IPI.sensorLabel(p, n, topFirst));
      inc[p] = v;
      incDepth[p] = o.topDepth + (p + 0.5) * o.gauge;
      sensor[p] = IPI.sensorLabel(p, n, topFirst);
    }

    /* n+1 nodes: every segment boundary, from the collar down to the shoe. */
    var cum = new Array(n + 1), cumDepth = new Array(n + 1);
    for (var q = 0; q <= n; q++) cumDepth[q] = o.topDepth + q * o.gauge;

    if (o.fixedEnd === 'top') {
      cum[0] = 0;
      for (var i = 1; i <= n; i++) cum[i] = cum[i - 1] - (inc[i - 1] === inc[i - 1] ? inc[i - 1] : 0);
    } else {
      cum[n] = 0;
      for (var j = n - 1; j >= 0; j--) cum[j] = cum[j + 1] + (inc[j] === inc[j] ? inc[j] : 0);
    }
    return { inc: inc, incDepth: incDepth, cum: cum, cumDepth: cumDepth, sensor: sensor, gaps: gaps };
  };

  /**
   * Cumulative displacement at one node, for every reading in the file.
   * Node q sits at depth topDepth + q · gauge; q = 0 is the collar.
   */
  IPI.history = function (ds, o, node) {
    var n = ds.n, L = o.gauge * 1000, sign = o.sign || 1;
    var src = o.axis === 'b' ? ds.b : ds.a;
    var bo = o.baseIndex * n, topFirst = o.topFirst !== false;
    var out = new Float64Array(ds.count);
    var fromTop = o.fixedEnd === 'top';
    var lo = fromTop ? 0 : node, hi = fromTop ? node : n; /* half-open [lo, hi) */

    for (var r = 0; r < ds.count; r++) {
      var ro = r * n, sum = 0;
      for (var p = lo; p < hi; p++) {
        var s = slotOf(p, n, topFirst);
        var v = (src[ro + s] - src[bo + s]) * L * sign;
        if (v === v) sum += v;
      }
      out[r] = fromTop ? -sum : sum;
    }
    return out;
  };

  /** Index of the reading nearest a timestamp. */
  IPI.nearest = function (ds, ms) {
    var lo = 0, hi = ds.count - 1;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (ds.t[mid] < ms) lo = mid + 1; else hi = mid;
    }
    if (lo > 0 && Math.abs(ds.t[lo - 1] - ms) <= Math.abs(ds.t[lo] - ms)) return lo - 1;
    return lo;
  };

  /**
   * Pick the history profiles drawn behind the current reading.
   * `spacing` is 'even' (equal steps through the record) or a period in days.
   */
  IPI.historyPicks = function (ds, baseIndex, currentIndex, howMany, spacing) {
    var picks = [], lo = Math.min(baseIndex, currentIndex), hi = Math.max(baseIndex, currentIndex);
    if (howMany <= 0 || hi - lo < 2) return picks;

    if (spacing === 'even') {
      for (var k = 1; k <= howMany; k++) {
        var idx = Math.round(lo + ((hi - lo) * k) / (howMany + 1));
        if (idx > lo && idx < hi && picks.indexOf(idx) < 0) picks.push(idx);
      }
    } else {
      var step = spacing * 86400e3;
      for (var j = 1; j <= howMany; j++) {
        var want = ds.t[hi] - j * step;
        if (want <= ds.t[lo]) break;
        var i = IPI.nearest(ds, want);
        if (i > lo && i < hi && picks.indexOf(i) < 0) picks.push(i);
      }
      picks.reverse();
    }
    return picks.sort(function (x, y) { return x - y; });
  };

  /** Displacement per day across the trailing `days` window of a history series. */
  IPI.rate = function (ds, series, days) {
    if (ds.count < 2) return NaN;
    var last = ds.count - 1, want = ds.t[last] - days * 86400e3;
    if (ds.t[0] > want) want = ds.t[0];
    var first = IPI.nearest(ds, want);
    var span = (ds.t[last] - ds.t[first]) / 86400e3;
    if (span <= 0) return NaN;
    return (series[last] - series[first]) / span;
  };

  /** Largest |value| in a profile, with the depth it occurs at. */
  IPI.peak = function (values, depths) {
    var best = 0, at = NaN;
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (v === v && Math.abs(v) > Math.abs(best)) { best = v; at = depths[i]; }
    }
    return { value: best, depth: at };
  };
})(this);
