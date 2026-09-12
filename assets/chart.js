/* IPI Profile Sheet — hand-drawn SVG plots. No chart library, no animation.
 *
 * Two forms:
 *   drawProfile  depth down the page, displacement across the top — the way an
 *                inclinometer sheet has always been printed.
 *   drawHistory  displacement against time at one node.
 */
(function (root) {
  'use strict';
  var IPI = (root.IPI = root.IPI || {});

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  var SVGNS = 'http://www.w3.org/2000/svg';

  function pad(v) { return v < 10 ? '0' + v : '' + v; }

  IPI.formatDateTime = function (ms) {
    var d = new Date(ms);
    return pad(d.getDate()) + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  };
  IPI.formatDate = function (ms) {
    var d = new Date(ms);
    return pad(d.getDate()) + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  };
  IPI.formatShort = function (ms) {
    var d = new Date(ms);
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(2) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  };
  IPI.toInputValue = function (ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }
  IPI.esc = esc;

  /* ------------------------------------------------------------- scales --- */

  function niceStep(raw) {
    if (!(raw > 0) || !isFinite(raw)) return 1;
    var exp = Math.floor(Math.log10(raw)), f = raw / Math.pow(10, exp);
    var nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return nf * Math.pow(10, exp);
  }

  /* Symmetric about zero — the convention for displacement profiles. */
  IPI.symScale = function (maxAbs, target) {
    if (!(maxAbs > 0) || !isFinite(maxAbs)) maxAbs = 1;
    var step = niceStep((maxAbs * 2) / Math.max(2, target));
    var lim = Math.ceil(maxAbs / step) * step;
    if (!(lim > 0)) lim = step;
    return { min: -lim, max: lim, step: step };
  };

  IPI.niceScale = function (min, max, target) {
    if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
    if (max - min < 1e-9) { max = min + 1; }
    var step = niceStep((max - min) / Math.max(2, target));
    return { min: Math.floor(min / step) * step, max: Math.ceil(max / step) * step, step: step };
  };

  function ticksOf(sc, cap) {
    var out = [], count = Math.round((sc.max - sc.min) / sc.step);
    if (!(count > 0) || count > (cap || 200)) return [sc.min, sc.max];
    for (var i = 0; i <= count; i++) {
      var v = sc.min + i * sc.step;
      out.push(Math.abs(v) < sc.step * 1e-9 ? 0 : v);
    }
    return out;
  }
  IPI.ticksOf = ticksOf;

  function decimalsFor(step) {
    var d = Math.ceil(-Math.log10(step));
    return Math.min(3, Math.max(0, isFinite(d) ? d : 0));
  }
  IPI.decimalsFor = decimalsFor;

  function fmtNum(v, dp) {
    if (v !== v) return '—';
    var s = v.toFixed(dp);
    return s === '-' + (0).toFixed(dp) ? (0).toFixed(dp) : s;
  }
  IPI.fmtNum = fmtNum;

  function timeTicks(t0, t1, target) {
    var span = Math.max(1, t1 - t0), want = span / Math.max(2, target), out = [], d;
    if (want > 20 * 86400e3) {
      var stepMo = want > 300 * 86400e3 ? 12 : want > 150 * 86400e3 ? 6 : want > 70 * 86400e3 ? 3 : 1;
      d = new Date(t0); d.setDate(1); d.setHours(0, 0, 0, 0);
      while (d.getTime() < t0) d.setMonth(d.getMonth() + 1);
      while (d.getTime() <= t1 && out.length < 60) { out.push(d.getTime()); d.setMonth(d.getMonth() + stepMo); }
      return { ticks: out, unit: 'month' };
    }
    var ladder = [3600e3, 2 * 3600e3, 3 * 3600e3, 6 * 3600e3, 12 * 3600e3,
                  86400e3, 2 * 86400e3, 7 * 86400e3, 14 * 86400e3];
    var step = ladder[ladder.length - 1];
    for (var i = 0; i < ladder.length; i++) if (ladder[i] >= want) { step = ladder[i]; break; }
    d = new Date(t0); d.setMinutes(0, 0, 0);
    if (step >= 86400e3) d.setHours(0, 0, 0, 0);
    var s = d.getTime();
    while (s < t0) s += step;
    for (var v = s; v <= t1 && out.length < 60; v += step) out.push(v);
    return { ticks: out, unit: step >= 86400e3 ? 'day' : 'hour' };
  }

  function timeLabel(ms, unit) {
    var d = new Date(ms);
    if (unit === 'month') return MONTHS[d.getMonth()] + ' ' + String(d.getFullYear()).slice(2);
    if (unit === 'day') return pad(d.getDate()) + ' ' + MONTHS[d.getMonth()];
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /* ---------------------------------------------------------- utilities --- */

  function sizeOf(host, minH) {
    var r = host.getBoundingClientRect();
    return { w: Math.max(240, Math.round(r.width)), h: Math.max(minH, Math.round(r.height)) };
  }

  function ensureSvg(host) {
    var svg = host.querySelector('svg');
    if (!svg) {
      svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('class', 'plot-svg');
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      svg.setAttribute('tabindex', '0');
      svg.setAttribute('role', 'img');
      host.appendChild(svg);
    }
    var tip = host.querySelector('.tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'tip';
      tip.hidden = true;
      host.appendChild(tip);
    }
    return { svg: svg, tip: tip };
  }

  /* Colors arrive as CSS custom properties so a theme swap repaints without a
   * re-render. Presentation attributes cannot resolve var(), so they are written
   * into a style attribute — hence the strict whitelist. */
  function safeColor(c) {
    return /^(var\(--[a-zA-Z0-9_-]+\)|#[0-9a-fA-F]{3,8}|currentColor)$/.test(String(c)) ? String(c) : 'currentColor';
  }

  function line(x1, y1, x2, y2, cls) {
    return '<line class="' + cls + '" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/>';
  }
  function text(x, y, cls, anchor, str) {
    return '<text class="' + cls + '" x="' + x + '" y="' + y + '" text-anchor="' + anchor + '">' + esc(str) + '</text>';
  }

  /* Rounded on the data end, square on the baseline. */
  function barPath(x0, x1, yTop, h, r) {
    var w = Math.abs(x1 - x0);
    if (w < 0.6) return '';
    var dir = x1 >= x0 ? 1 : -1;
    r = Math.max(0, Math.min(r, w, h / 2));
    var yb = yTop + h, sweep = dir > 0 ? 1 : 0, corner = x1 - dir * r;
    if (r < 0.6) return 'M' + x0 + ',' + yTop + 'H' + x1 + 'V' + yb + 'H' + x0 + 'Z';
    return 'M' + x0 + ',' + yTop + 'H' + corner +
      'A' + r + ',' + r + ' 0 0 ' + sweep + ' ' + x1 + ',' + (yTop + r) +
      'V' + (yb - r) +
      'A' + r + ',' + r + ' 0 0 ' + sweep + ' ' + corner + ',' + yb +
      'H' + x0 + 'Z';
  }

  /* ------------------------------------------------------ profile plot ---- */

  /**
   * @param host  the .plot element
   * @param spec  { nodes:[{depth,sensor}], series:[{key,label,color,emphasis,values:[]}],
   *                x:{min,max,step}, y:{min,max}, mode:'line'|'bar',
   *                unit, markers:bool, title }
   */
  IPI.drawProfile = function (host, spec) {
    var g = ensureSvg(host), svg = g.svg;
    var box = sizeOf(host, 320), W = box.w, H = box.h;
    var m = { top: 34, right: 30, bottom: 12, left: 52 };
    var pw = W - m.left - m.right, ph = H - m.top - m.bottom;
    if (pw < 40 || ph < 40) { svg.innerHTML = ''; return; }

    var x = spec.x, y = spec.y;
    var sx = function (v) { return m.left + ((v - x.min) / (x.max - x.min)) * pw; };
    var sy = function (d) { return m.top + ((d - y.min) / (y.max - y.min)) * ph; };
    var xdp = decimalsFor(x.step), ydp = decimalsFor(y.step);

    var parts = ['<g class="chrome">'];

    /* grid */
    var xt = spec.xTicks || ticksOf(x), i, v, px;
    for (i = 0; i < xt.length; i++) {
      px = sx(xt[i]);
      parts.push(line(px, m.top, px, m.top + ph, 'grid'));
    }
    if (x.min <= 0 && x.max >= 0) {
      px = sx(0);
      parts.push(line(px, m.top, px, m.top + ph, 'zero'));
    }
    var yt = spec.yTicks || ticksOf(y);
    for (i = 0; i < yt.length; i++) {
      var py = sy(yt[i]);
      if (py < m.top - 0.5 || py > m.top + ph + 0.5) continue;
      parts.push(line(m.left, py, m.left + pw, py, 'grid'));
      parts.push(text(m.left - 8, py + 3.5, 'tick', 'end', fmtNum(yt[i], ydp)));
    }

    /* frame — displacement axis across the top, depth axis down the left */
    parts.push(line(m.left, m.top, m.left + pw, m.top, 'axis'));
    parts.push(line(m.left, m.top, m.left, m.top + ph, 'axis'));
    for (i = 0; i < xt.length; i++) {
      px = sx(xt[i]);
      parts.push(line(px, m.top - 4, px, m.top, 'axis'));
      /* End labels turn inward so neither overhangs the plot's corners. */
      var anchor = i === 0 ? 'start' : i === xt.length - 1 ? 'end' : 'middle';
      parts.push(text(px, m.top - 9, 'tick', anchor, fmtNum(xt[i], xdp)));
    }
    parts.push(text(m.left - 8, m.top - 9, 'unit', 'end', spec.depthUnit || 'm'));

    /* sensor register down the right edge */
    var nodes = spec.nodes, band = ph / Math.max(1, nodes.length);
    var every = Math.max(1, Math.ceil(13 / band));
    for (i = 0; i < nodes.length; i++) {
      if (nodes[i].sensor == null) continue;
      var ny = sy(nodes[i].depth);
      if (ny < m.top || ny > m.top + ph) continue;
      parts.push(line(m.left + pw, ny, m.left + pw + 3, ny, 'axis'));
      if (i % every === 0 || i === nodes.length - 1) {
        parts.push(text(m.left + pw + 6, ny + 3.2, 'sensor', 'start', nodes[i].sensor));
      }
    }
    parts.push('</g>');

    /* ----- marks ----- */
    var series = spec.series, pts = [], si, k;
    var showMarkers = spec.markers !== false &&
      series.length * nodes.length <= 420 && band >= 7;

    if (spec.mode === 'bar' && series.length === 1) {
      var sBar = series[0], bh = Math.min(24, Math.max(3, band - 2));
      var bars = [];
      for (k = 0; k < nodes.length; k++) {
        v = sBar.values[k];
        if (v !== v) continue;
        var yTop = sy(nodes[k].depth) - bh / 2;
        var d = barPath(sx(0), sx(v), yTop, bh, 4);
        if (d) bars.push('<path d="' + d + '"/>');
      }
      parts.push('<g style="fill:' + safeColor(sBar.color) + '" stroke="none">' + bars.join('') + '</g>');
      for (k = 0; k < nodes.length; k++) {
        pts.push([{ x: sx(sBar.values[k]), y: sy(nodes[k].depth), v: sBar.values[k] }]);
      }
    } else {
      for (si = 0; si < series.length; si++) {
        var s = series[si], dstr = '', open = false;
        for (k = 0; k < nodes.length; k++) {
          v = s.values[k];
          if (v !== v) { open = false; continue; }
          dstr += (open ? 'L' : 'M') + sx(v).toFixed(2) + ',' + sy(nodes[k].depth).toFixed(2);
          open = true;
        }
        if (dstr) {
          parts.push('<path class="series" d="' + dstr + '" fill="none" style="stroke:' + safeColor(s.color) +
            '" stroke-width="' + (s.emphasis ? 2.5 : 2) + '"/>');
        }
      }
      if (showMarkers) {
        for (si = 0; si < series.length; si++) {
          var s2 = series[si], dots = '';
          for (k = 0; k < nodes.length; k++) {
            v = s2.values[k];
            if (v !== v) continue;
            dots += '<circle cx="' + sx(v).toFixed(2) + '" cy="' + sy(nodes[k].depth).toFixed(2) +
              '" r="' + (s2.emphasis ? 4 : 3.4) + '"/>';
          }
          if (dots) parts.push('<g class="dots" style="fill:' + safeColor(s2.color) + '">' + dots + '</g>');
        }
      }
      for (k = 0; k < nodes.length; k++) {
        var col = [];
        for (si = 0; si < series.length; si++) {
          col.push({ x: sx(series[si].values[k]), y: sy(nodes[k].depth), v: series[si].values[k] });
        }
        pts.push(col);
      }
    }

    /* ----- sparing direct labels on the emphasised profile ----- */
    var emph = null;
    for (si = 0; si < series.length; si++) if (series[si].emphasis) emph = series[si];
    if (emph) {
      var peakK = -1, peakV = 0;
      for (k = 0; k < nodes.length; k++) {
        v = emph.values[k];
        if (v === v && Math.abs(v) >= Math.abs(peakV)) { peakV = v; peakK = k; }
      }
      var labels = [];
      if (peakK >= 0 && Math.abs(peakV) > x.step * 0.15) {
        labels.push({ k: peakK, v: peakV });
      }
      var topK = -1;
      for (k = 0; k < nodes.length; k++) if (emph.values[k] === emph.values[k]) { topK = k; break; }
      if (topK >= 0 && topK !== peakK &&
          Math.abs(sy(nodes[topK].depth) - sy(nodes[peakK] ? nodes[peakK].depth : -1e9)) > 26 &&
          Math.abs(emph.values[topK]) > x.step * 0.15) {
        labels.push({ k: topK, v: emph.values[topK] });
      }
      for (i = 0; i < labels.length; i++) {
        var L = labels[i], lx = sx(L.v), ly = sy(nodes[L.k].depth);
        var right = lx < m.left + pw - 62;
        /* Keep the label clear of the tick row above the plot. */
        var ly2 = ly - 7;
        if (ly2 < m.top + 12) ly2 = ly + 15;
        if (ly2 > m.top + ph - 3) ly2 = ly - 7;
        parts.push('<text class="direct" x="' + (lx + (right ? 9 : -9)) + '" y="' + ly2 +
          '" text-anchor="' + (right ? 'start' : 'end') + '">' + esc(fmtNum(L.v, 2) + ' mm') + '</text>');
      }
    }

    /* ----- crosshair + hit layer ----- */
    parts.push('<g class="cross" visibility="hidden">' +
      line(m.left, m.top, m.left + pw, m.top, 'cross-line') +
      '</g>');
    parts.push('<rect class="hit" x="' + m.left + '" y="' + m.top + '" width="' + pw +
      '" height="' + ph + '" fill="transparent"/>');

    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('aria-label', spec.aria || spec.title || 'Grafik profil');
    svg.innerHTML = parts.join('');

    bindHover(host, svg, g.tip, {
      orientation: 'y',
      geom: { left: m.left, top: m.top, w: pw, h: ph },
      positions: nodes.map(function (nd) { return sy(nd.depth); }),
      nodes: nodes, series: series, pts: pts, unit: spec.unit || 'mm',
      headline: function (idx) {
        var nd = nodes[idx];
        return fmtNum(nd.depth, 1) + ' m' + (nd.sensor != null ? '  ·  S' + nd.sensor : '');
      }
    });
  };

  /* ------------------------------------------------------ history plot ---- */

  IPI.drawHistory = function (host, spec) {
    var g = ensureSvg(host), svg = g.svg;
    var box = sizeOf(host, 180), W = box.w, H = box.h;
    var m = { top: 16, right: 16, bottom: 30, left: 54 };
    var pw = W - m.left - m.right, ph = H - m.top - m.bottom;
    if (pw < 40 || ph < 40) { svg.innerHTML = ''; return; }

    var t0 = spec.times[0], t1 = spec.times[spec.times.length - 1];
    if (t1 <= t0) t1 = t0 + 3600e3;
    var y = spec.y;
    var sx = function (ms) { return m.left + ((ms - t0) / (t1 - t0)) * pw; };
    var sy = function (v) { return m.top + ((y.max - v) / (y.max - y.min)) * ph; };
    var ydp = decimalsFor(y.step);

    var parts = ['<g class="chrome">'], i, k, v;
    var yt = ticksOf(y);
    for (i = 0; i < yt.length; i++) {
      var py = sy(yt[i]);
      parts.push(line(m.left, py, m.left + pw, py, 'grid'));
      parts.push(text(m.left - 8, py + 3.5, 'tick', 'end', fmtNum(yt[i], ydp)));
    }
    if (y.min <= 0 && y.max >= 0) parts.push(line(m.left, sy(0), m.left + pw, sy(0), 'zero'));
    var tt = timeTicks(t0, t1, Math.max(2, Math.round(pw / 88)));
    for (i = 0; i < tt.ticks.length; i++) {
      var px = sx(tt.ticks[i]);
      parts.push(line(px, m.top, px, m.top + ph, 'grid'));
      parts.push(line(px, m.top + ph, px, m.top + ph + 4, 'axis'));
      parts.push(text(px, m.top + ph + 17, 'tick', 'middle', timeLabel(tt.ticks[i], tt.unit)));
    }
    parts.push(line(m.left, m.top + ph, m.left + pw, m.top + ph, 'axis'));
    parts.push(line(m.left, m.top, m.left, m.top + ph, 'axis'));
    parts.push(text(m.left - 8, m.top - 4, 'unit', 'end', 'mm'));
    parts.push('</g>');

    var xs = new Float64Array(spec.times.length);
    for (i = 0; i < spec.times.length; i++) xs[i] = sx(spec.times[i]);

    for (k = 0; k < spec.series.length; k++) {
      var s = spec.series[k], d = '', open = false;
      for (i = 0; i < spec.times.length; i++) {
        v = s.values[i];
        if (v !== v) { open = false; continue; }
        d += (open ? 'L' : 'M') + xs[i].toFixed(2) + ',' + sy(v).toFixed(2);
        open = true;
      }
      if (d) parts.push('<path class="series" d="' + d + '" fill="none" style="stroke:' + safeColor(s.color) + '" stroke-width="2"/>');
    }
    /* one end-dot per series — the current value is what the reader looks for */
    for (k = 0; k < spec.series.length; k++) {
      var s2 = spec.series[k], last = spec.times.length - 1;
      while (last >= 0 && s2.values[last] !== s2.values[last]) last--;
      if (last < 0) continue;
      parts.push('<g class="dots" style="fill:' + safeColor(s2.color) + '"><circle cx="' + xs[last].toFixed(2) +
        '" cy="' + sy(s2.values[last]).toFixed(2) + '" r="4"/></g>');
    }

    parts.push('<g class="cross" visibility="hidden">' +
      line(m.left, m.top, m.left, m.top + ph, 'cross-line') + '</g>');
    parts.push('<rect class="hit" x="' + m.left + '" y="' + m.top + '" width="' + pw +
      '" height="' + ph + '" fill="transparent"/>');

    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('aria-label', spec.aria || 'Grafik riwayat waktu');
    svg.innerHTML = parts.join('');

    var pts = [];
    for (i = 0; i < spec.times.length; i++) {
      var col = [];
      for (k = 0; k < spec.series.length; k++) col.push({ x: xs[i], y: sy(spec.series[k].values[i]), v: spec.series[k].values[i] });
      pts.push(col);
    }
    bindHover(host, svg, g.tip, {
      orientation: 'x',
      geom: { left: m.left, top: m.top, w: pw, h: ph },
      positions: Array.prototype.slice.call(xs),
      nodes: spec.times.map(function (ms) { return { t: ms }; }),
      series: spec.series, pts: pts, unit: 'mm',
      headline: function (idx) { return IPI.formatDateTime(spec.times[idx]); }
    });
  };

  /* ------------------------------------------------------------- hover --- */

  function bindHover(host, svg, tip, state) {
    host._state = state;
    state.index = -1;
    state.cross = svg.querySelector('.cross');
    state.crossLine = svg.querySelector('.cross-line');

    if (host._bound) { show(host, -1); return; }
    host._bound = true;

    function locate(ev) {
      var box = svg.getBoundingClientRect();
      var st = host._state;
      if (!st || !box.width || !box.height) return -1;
      var vb = svg.viewBox.baseVal;
      var px = ((ev.clientX - box.left) / box.width) * (vb.width || box.width);
      var py = ((ev.clientY - box.top) / box.height) * (vb.height || box.height);
      var target = st.orientation === 'y' ? py : px;
      var other = st.orientation === 'y' ? px : py;
      var g = st.geom;
      var lo = st.orientation === 'y' ? g.left : g.top;
      var hi = lo + (st.orientation === 'y' ? g.w : g.h);
      if (other < lo - 8 || other > hi + 8) return -1;
      var best = -1, bestD = Infinity;
      for (var i = 0; i < st.positions.length; i++) {
        var d = Math.abs(st.positions[i] - target);
        if (d < bestD) { bestD = d; best = i; }
      }
      return bestD <= 40 ? best : -1;
    }

    host.addEventListener('pointermove', function (ev) { show(host, locate(ev)); });
    host.addEventListener('pointerdown', function (ev) { show(host, locate(ev)); });
    host.addEventListener('pointerleave', function () { show(host, -1); });
    svg.addEventListener('blur', function () { show(host, -1); });
    svg.addEventListener('focus', function () {
      var st = host._state;
      if (st && st.index < 0) show(host, Math.floor(st.positions.length / 2));
    });
    svg.addEventListener('keydown', function (ev) {
      var st = host._state;
      if (!st) return;
      var back = st.orientation === 'y' ? 'ArrowUp' : 'ArrowLeft';
      var fwd = st.orientation === 'y' ? 'ArrowDown' : 'ArrowRight';
      if (ev.key === back || ev.key === fwd) {
        ev.preventDefault();
        var i = st.index < 0 ? 0 : st.index + (ev.key === fwd ? 1 : -1);
        show(host, Math.max(0, Math.min(st.positions.length - 1, i)));
      } else if (ev.key === 'Escape') { show(host, -1); }
    });
    show(host, -1);
  }

  function show(host, idx) {
    var st = host._state, tip = host.querySelector('.tip');
    if (!st || !tip) return;
    st.index = idx;
    if (idx < 0 || !st.pts[idx]) {
      if (st.cross) st.cross.setAttribute('visibility', 'hidden');
      tip.hidden = true;
      return;
    }
    var pos = st.positions[idx], g = st.geom;
    if (st.cross && st.crossLine) {
      if (st.orientation === 'y') {
        st.crossLine.setAttribute('x1', g.left); st.crossLine.setAttribute('x2', g.left + g.w);
        st.crossLine.setAttribute('y1', pos); st.crossLine.setAttribute('y2', pos);
      } else {
        st.crossLine.setAttribute('y1', g.top); st.crossLine.setAttribute('y2', g.top + g.h);
        st.crossLine.setAttribute('x1', pos); st.crossLine.setAttribute('x2', pos);
      }
      st.cross.setAttribute('visibility', 'visible');
    }

    /* values lead, labels follow */
    while (tip.firstChild) tip.removeChild(tip.firstChild);
    var head = document.createElement('div');
    head.className = 'tip-head';
    head.textContent = st.headline(idx);
    tip.appendChild(head);
    for (var i = 0; i < st.series.length; i++) {
      var s = st.series[i], row = document.createElement('div');
      row.className = 'tip-row';
      var key = document.createElement('span');
      key.className = 'tip-key';
      key.style.background = s.color;
      var val = document.createElement('span');
      val.className = 'tip-val';
      val.textContent = fmtNum(s.values[idx], 2) + ' ' + st.unit;
      var lab = document.createElement('span');
      lab.className = 'tip-lab';
      lab.textContent = s.label;
      row.appendChild(key); row.appendChild(val); row.appendChild(lab);
      tip.appendChild(row);
    }

    tip.hidden = false;
    var box = host.getBoundingClientRect();
    var svg = host.querySelector('svg'), vb = svg.viewBox.baseVal;
    var kx = box.width / (vb.width || box.width), ky = box.height / (vb.height || box.height);
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    var ax, ay;
    if (st.orientation === 'y') {
      ay = pos * ky - th / 2;
      ax = (g.left + g.w) * kx - tw - 8;
      var mid = st.pts[idx][0] ? st.pts[idx][0].x * kx : 0;
      if (mid > box.width / 2) ax = g.left * kx + 8;
    } else {
      ax = pos * kx + 12;
      if (ax + tw > box.width - 4) ax = pos * kx - tw - 12;
      ay = g.top * ky + 8;
    }
    tip.style.left = Math.max(4, Math.min(box.width - tw - 4, ax)) + 'px';
    tip.style.top = Math.max(4, Math.min(box.height - th - 4, ay)) + 'px';
  }
})(this);
