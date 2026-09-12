/* IPI Profile Sheet — controls, state and rendering. */
(function (root) {
  'use strict';
  var IPI = root.IPI;
  var $ = function (id) { return document.getElementById(id); };

  var RAMP = ['var(--h1)', 'var(--h2)', 'var(--h3)', 'var(--h4)', 'var(--h5)'];
  var ACCENT = 'var(--accent)';
  var SETTINGS_KEY = 'ipi.sheet.settings.v1';
  var DB_NAME = 'ipi-sheet', STORE = 'dataset', DB_KEY = 'current';

  var ds = null;
  var view = null;               /* last computed profiles, for table + export */
  var hiddenSeries = {};

  var S = {
    gauge: 3, topDepth: 0, order: 'top', fixedEnd: 'bottom',
    baseTime: null, curTime: null,
    histCount: 3, histSpacing: 'even',
    axis: 'a', flipA: false, flipB: false,
    cumAuto: true, cumMin: -10, cumMax: 10, cumStep: 2,
    incAuto: true, incMin: -2, incMax: 2, incStep: 0.5,
    depthAuto: true, depthFrom: 0, depthTo: 66,
    incMode: 'line', markers: true, histNode: 0
  };

  /* ------------------------------------------------------------ storage --- */

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S)); } catch (e) { /* private mode */ }
  }
  function loadSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      for (var k in S) if (Object.prototype.hasOwnProperty.call(o, k) && o[k] != null) S[k] = o[k];
    } catch (e) { /* ignore unreadable settings */ }
  }

  function openDB() {
    return new Promise(function (res, rej) {
      if (!root.indexedDB) return rej(new Error('no idb'));
      var rq = indexedDB.open(DB_NAME, 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore(STORE); };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    });
  }
  function storeDataset(data) {
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(STORE, 'readwrite');
        if (data) tx.objectStore(STORE).put(data, DB_KEY); else tx.objectStore(STORE).delete(DB_KEY);
        tx.oncomplete = function () { res(); };
        tx.onerror = function () { rej(tx.error); };
      });
    }).catch(function () { /* storage is a convenience, never a requirement */ });
  }
  function readDataset() {
    return openDB().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction(STORE, 'readonly');
        var rq = tx.objectStore(STORE).get(DB_KEY);
        rq.onsuccess = function () { res(rq.result || null); };
        rq.onerror = function () { res(null); };
      });
    }).catch(function () { return null; });
  }

  /* ----------------------------------------------------------- messages --- */

  function message(text, kind) {
    var box = $('messages');
    box.innerHTML = '';
    if (!text) return;
    var d = document.createElement('p');
    d.className = 'msg' + (kind === 'error' ? ' is-error' : '');
    d.textContent = text;
    box.appendChild(d);
  }

  /* ------------------------------------------------------------- inputs --- */

  function segment(id, get, set) {
    var el = $(id);
    el.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-v]');
      if (!b) return;
      set(b.getAttribute('data-v'));
      syncSegment(id, get());
      saveSettings();
      render();
    });
  }
  function syncSegment(id, value) {
    var btns = $(id).querySelectorAll('button[data-v]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-pressed', btns[i].getAttribute('data-v') === String(value) ? 'true' : 'false');
    }
  }

  function bindNumber(id, key, onChange) {
    var el = $(id);
    el.addEventListener('change', function () {
      var v = parseFloat(el.value);
      if (isFinite(v)) { S[key] = v; if (onChange) onChange(v); }
      else el.value = S[key];
      saveSettings();
      render();
    });
  }
  function bindCheck(id, key) {
    var el = $(id);
    el.addEventListener('change', function () { S[key] = el.checked; saveSettings(); render(); });
  }
  function bindSelect(id, key, cast) {
    var el = $(id);
    el.addEventListener('change', function () { S[key] = cast ? cast(el.value) : el.value; saveSettings(); render(); });
  }

  /* -------------------------------------------------------------- ticks --- */

  function alignedTicks(min, max, step) {
    if (!(step > 0) || !isFinite(step)) step = (max - min) / 8;
    if (!(step > 0)) return [min, max];
    var out = [], start = Math.ceil(min / step - 1e-9) * step;
    for (var v = start, i = 0; v <= max + step * 1e-9 && i < 240; v += step, i++) {
      out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    }
    return out.length ? out : [min, max];
  }

  function manualScale(min, max, step) {
    if (!(max > min)) { var t = min; min = Math.min(t, max) - 1; max = Math.max(t, max) + 1; }
    if (!(step > 0) || !isFinite(step)) step = (max - min) / 8;
    return { min: min, max: max, step: step };
  }

  function spanOf(seriesList) {
    var maxAbs = 0;
    for (var i = 0; i < seriesList.length; i++) {
      var v = seriesList[i].values;
      for (var k = 0; k < v.length; k++) if (v[k] === v[k]) maxAbs = Math.max(maxAbs, Math.abs(v[k]));
    }
    return maxAbs;
  }

  /* ------------------------------------------------------------ dataset --- */

  function indexOfTime(ms, fallback) {
    if (!ds) return 0;
    if (ms == null) return fallback;
    return IPI.nearest(ds, ms);
  }

  function currentIndices() {
    var base = indexOfTime(S.baseTime, 0);
    var cur = indexOfTime(S.curTime, ds.count - 1);
    base = Math.max(0, Math.min(ds.count - 1, base));
    cur = Math.max(0, Math.min(ds.count - 1, cur));
    return { base: base, cur: cur };
  }

  function fillReadingSelect(el, selected) {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < ds.count; i++) {
      var o = document.createElement('option');
      o.value = String(i);
      o.textContent = IPI.formatDateTime(ds.t[i]);
      frag.appendChild(o);
    }
    el.innerHTML = '';
    el.appendChild(frag);
    el.value = String(selected);
  }

  function setDataset(next, note) {
    ds = next;
    hiddenSeries = {};
    var idx = currentIndices();
    S.baseTime = ds.t[Math.min(idx.base, ds.count - 1)];
    S.curTime = ds.t[ds.count - 1];
    fillReadingSelect($('base-select'), IPI.nearest(ds, S.baseTime));
    fillReadingSelect($('cur-select'), ds.count - 1);
    buildNodeSelect();
    message(note || (ds.warnings.length ? ds.warnings.join(' ') : ''), null);
    saveSettings();
    render();
  }

  function buildNodeSelect() {
    var el = $('hist-node'), frag = document.createDocumentFragment();
    for (var q = 0; q <= ds.n; q++) {
      var o = document.createElement('option');
      o.value = String(q);
      o.textContent = IPI.fmtNum(S.topDepth + q * S.gauge, 1) + ' m' +
        (q === 0 ? ' (kepala)' : q === ds.n ? ' (dasar)' : '');
      frag.appendChild(o);
    }
    el.innerHTML = '';
    el.appendChild(frag);
    if (!(S.histNode >= 0 && S.histNode <= ds.n)) S.histNode = S.fixedEnd === 'top' ? ds.n : 0;
    el.value = String(S.histNode);
  }

  /* -------------------------------------------------------------- files --- */

  function readFiles(fileList) {
    var files = Array.prototype.slice.call(fileList);
    if (!files.length) return;
    message('Membaca ' + files.length + ' file…', null);

    var jobs = files.map(function (f) {
      return new Promise(function (res, rej) {
        var fr = new FileReader();
        fr.onload = function () { res({ name: f.name, text: String(fr.result) }); };
        fr.onerror = function () { rej(new Error('Gagal membaca ' + f.name)); };
        fr.readAsText(f);
      });
    });

    Promise.all(jobs).then(function (parts) {
      var merged = ds && !ds.demo ? ds : null, notes = [];
      parts.sort(function (a, b) { return a.name.localeCompare(b.name); });
      for (var i = 0; i < parts.length; i++) {
        var one = IPI.parse(parts[i].text, parts[i].name);
        if (!merged) { merged = one; continue; }
        try { merged = IPI.merge(merged, one); }
        catch (e) { if (e.replace) { merged = one; notes.push(e.message); } else throw e; }
      }
      var added = merged.count - (ds && !ds.demo ? ds.count : 0);
      notes.unshift(merged.count + ' pembacaan tersedia' +
        (added > 0 && ds && !ds.demo ? ' (+' + added + ' baru)' : '') + '.');
      if (merged.warnings.length) notes = notes.concat(merged.warnings);
      setDataset(merged, notes.join(' '));
      storeDataset(merged);
    }).catch(function (err) {
      message(err && err.message ? err.message : 'File tidak bisa dibaca.', 'error');
    });
  }

  /* -------------------------------------------------------------- series -- */

  function optionsFor(axis, base, cur) {
    return {
      baseIndex: base, readingIndex: cur, axis: axis,
      gauge: S.gauge, topDepth: S.topDepth,
      fixedEnd: S.fixedEnd, topFirst: S.order === 'top',
      sign: (axis === 'b' ? S.flipB : S.flipA) ? -1 : 1
    };
  }

  function buildPlan(base, cur) {
    var picks = IPI.historyPicks(ds, base, cur, S.histCount,
      S.histSpacing === 'even' ? 'even' : parseFloat(S.histSpacing));
    var plan = [];
    for (var i = 0; i < picks.length; i++) {
      var pos = picks.length === 1 ? 2 : Math.round((i * (RAMP.length - 1)) / (picks.length - 1));
      plan.push({ index: picks[i], color: RAMP[pos], emphasis: false, key: 'r' + picks[i] });
    }
    plan.push({ index: cur, color: ACCENT, emphasis: true, key: 'r' + cur });
    return plan;
  }

  /* ------------------------------------------------------------- render --- */

  function render() {
    if (!ds) return;
    var idx = currentIndices(), base = idx.base, cur = idx.cur;
    $('base-select').value = String(base);
    $('cur-select').value = String(cur);

    var plan = buildPlan(base, cur);
    var visible = plan.filter(function (p) { return !hiddenSeries[p.key]; });

    /* Depth nodes are shared by every chart of this profile set. */
    var n = ds.n;
    var cumNodes = [], incNodes = [];
    for (var q = 0; q <= n; q++) {
      cumNodes.push({ depth: S.topDepth + q * S.gauge, sensor: q < n ? IPI.sensorLabel(q, n, S.order === 'top') : null });
    }
    for (var p = 0; p < n; p++) {
      incNodes.push({ depth: S.topDepth + (p + 0.5) * S.gauge, sensor: IPI.sensorLabel(p, n, S.order === 'top') });
    }

    var axes = S.axis === 'ab' ? ['a', 'b'] : [S.axis];
    var profiles = {}, gaps = [];
    ['a', 'b'].forEach(function (ax) {
      profiles[ax] = plan.map(function (item) {
        var pr = IPI.profile(ds, optionsFor(ax, base, item.index));
        if (item.emphasis && pr.gaps.length) gaps = pr.gaps;
        return pr;
      });
    });

    view = { base: base, cur: cur, plan: plan, profiles: profiles, cumNodes: cumNodes, incNodes: incNodes };

    /* ---- shared scales, so A and B stay comparable ---- */
    var cumSeriesAll = [], incSeriesAll = [];
    axes.forEach(function (ax) {
      plan.forEach(function (item, i) {
        if (hiddenSeries[item.key]) return;
        cumSeriesAll.push({ values: profiles[ax][i].cum });
        incSeriesAll.push({ values: profiles[ax][i].inc });
      });
    });

    var cumScale = S.cumAuto
      ? IPI.symScale(spanOf(cumSeriesAll) * 1.08, 8)
      : manualScale(S.cumMin, S.cumMax, S.cumStep);
    var incScale = S.incAuto
      ? IPI.symScale(spanOf(incSeriesAll) * 1.12, 6)
      : manualScale(S.incMin, S.incMax, S.incStep);

    if (S.cumAuto) { S.cumMin = cumScale.min; S.cumMax = cumScale.max; S.cumStep = cumScale.step; }
    if (S.incAuto) { S.incMin = incScale.min; S.incMax = incScale.max; S.incStep = incScale.step; }
    syncScaleInputs();

    var dTop = S.topDepth, dBot = S.topDepth + n * S.gauge;
    var depth = S.depthAuto ? { min: dTop, max: dBot } : { min: Math.min(S.depthFrom, S.depthTo), max: Math.max(S.depthFrom, S.depthTo) };
    if (depth.max - depth.min < 1e-6) depth.max = depth.min + 1;
    if (S.depthAuto) { S.depthFrom = depth.min; S.depthTo = depth.max; $('depth-from').value = IPI.fmtNum(depth.min, 2); $('depth-to').value = IPI.fmtNum(depth.max, 2); }
    depth.step = Math.max(1e-6, niceDepthStep(depth.max - depth.min));
    var depthTicks = alignedTicks(depth.min, depth.max, depth.step);

    /* ---- draw ---- */
    ['a', 'b'].forEach(function (ax) {
      var on = axes.indexOf(ax) >= 0;
      $('card-cum-' + ax).hidden = !on;
      $('card-inc-' + ax).hidden = !on;
      if (!on) return;

      var cumSeries = [], incSeries = [];
      plan.forEach(function (item, i) {
        if (hiddenSeries[item.key]) return;
        var label = IPI.formatShort(ds.t[item.index]);
        cumSeries.push({ key: item.key, label: label, color: item.color, emphasis: item.emphasis, values: profiles[ax][i].cum });
        incSeries.push({ key: item.key, label: label, color: item.color, emphasis: item.emphasis, values: profiles[ax][i].inc });
      });

      IPI.drawProfile($('plot-cum-' + ax), {
        nodes: cumNodes, series: cumSeries, x: cumScale, y: depth,
        xTicks: alignedTicks(cumScale.min, cumScale.max, cumScale.step), yTicks: depthTicks,
        mode: 'line', markers: S.markers, unit: 'mm', depthUnit: 'm',
        aria: 'Cumulative displacement sumbu ' + ax.toUpperCase() + ', kedalaman ' +
          IPI.fmtNum(depth.min, 1) + ' sampai ' + IPI.fmtNum(depth.max, 1) + ' meter, ' +
          cumSeries.length + ' profil.'
      });

      IPI.drawProfile($('plot-inc-' + ax), {
        nodes: incNodes, series: incSeries, x: incScale, y: depth,
        xTicks: alignedTicks(incScale.min, incScale.max, incScale.step), yTicks: depthTicks,
        mode: S.incMode === 'bar' && incSeries.length === 1 ? 'bar' : 'line',
        markers: S.markers, unit: 'mm', depthUnit: 'm',
        aria: 'Incremental displacement sumbu ' + ax.toUpperCase() + ', ' + incSeries.length + ' profil.'
      });
    });

    renderLegend(plan, base);
    renderReadouts(profiles, plan, base, cur, gaps);
    renderHistory(base, cur);
    renderTable(profiles, plan, cumNodes);
    renderStation();
  }

  function niceDepthStep(range) {
    var raw = range / 9, exp = Math.floor(Math.log10(raw)), f = raw / Math.pow(10, exp);
    var nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * Math.pow(10, exp);
  }

  function syncScaleInputs() {
    $('cum-min').value = IPI.fmtNum(S.cumMin, 2);
    $('cum-max').value = IPI.fmtNum(S.cumMax, 2);
    $('cum-step').value = IPI.fmtNum(S.cumStep, 3).replace(/0+$/, '').replace(/\.$/, '');
    $('inc-min').value = IPI.fmtNum(S.incMin, 2);
    $('inc-max').value = IPI.fmtNum(S.incMax, 2);
    $('inc-step').value = IPI.fmtNum(S.incStep, 3).replace(/0+$/, '').replace(/\.$/, '');
  }

  /* ------------------------------------------------------------- legend --- */

  function renderLegend(plan, base) {
    var el = $('legend');
    el.innerHTML = '';
    var title = document.createElement('span');
    title.className = 'legend-title';
    title.textContent = 'Profil';
    el.appendChild(title);

    plan.forEach(function (item) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.setAttribute('aria-pressed', hiddenSeries[item.key] ? 'false' : 'true');
      b.style.color = item.color;
      var key = document.createElement('span');
      key.className = 'chip-key';
      var lab = document.createElement('span');
      lab.style.color = 'var(--ink-2)';
      lab.textContent = IPI.formatShort(ds.t[item.index]);
      b.appendChild(key);
      b.appendChild(lab);
      if (item.emphasis) {
        var tag = document.createElement('span');
        tag.className = 'chip-tag';
        tag.textContent = 'saat ini';
        b.appendChild(tag);
      }
      b.addEventListener('click', function () {
        var vis = plan.filter(function (p) { return !hiddenSeries[p.key]; });
        if (!hiddenSeries[item.key] && vis.length <= 1) return; /* keep one profile on screen */
        hiddenSeries[item.key] = !hiddenSeries[item.key];
        render();
      });
      el.appendChild(b);
    });

    var zero = document.createElement('span');
    zero.className = 'chip static';
    var zk = document.createElement('span');
    zk.className = 'chip-key dashed';
    var zl = document.createElement('span');
    zl.textContent = 'base ' + IPI.formatShort(ds.t[base]);
    zero.appendChild(zk);
    zero.appendChild(zl);
    var zt = document.createElement('span');
    zt.className = 'chip-tag';
    zt.textContent = 'garis nol';
    zero.appendChild(zt);
    el.appendChild(zero);
  }

  /* ----------------------------------------------------------- readouts --- */

  function tile(dl, label, value, sub) {
    var d = document.createElement('div');
    d.className = 'tile';
    var dt = document.createElement('dt');
    dt.textContent = label;
    var dd = document.createElement('dd');
    dd.textContent = value;
    d.appendChild(dt);
    d.appendChild(dd);
    if (sub) {
      var s = document.createElement('small');
      s.textContent = sub;
      d.appendChild(s);
    }
    dl.appendChild(d);
  }

  function renderReadouts(profiles, plan, base, cur, gaps) {
    var el = $('readouts');
    el.innerHTML = '';
    var li = plan.length - 1;

    ['a', 'b'].forEach(function (ax) {
      if (S.axis !== 'ab' && S.axis !== ax) return;
      var pr = profiles[ax][li];
      var pk = IPI.peak(pr.cum, pr.cumDepth);
      tile(el, 'Cumulative maks · ' + ax.toUpperCase(),
        IPI.fmtNum(pk.value, 2) + ' mm',
        pk.depth === pk.depth ? 'pada ' + IPI.fmtNum(pk.depth, 1) + ' m' : '—');
    });

    var axis = S.axis === 'b' ? 'b' : 'a';
    var series = IPI.history(ds, optionsFor(axis, base, cur), S.histNode);
    var r7 = IPI.rate(ds, series, 7);
    tile(el, 'Laju 7 hari · ' + axis.toUpperCase(),
      (r7 === r7 ? (r7 >= 0 ? '+' : '') + IPI.fmtNum(r7, 3) : '—') + ' mm/hari',
      'di ' + IPI.fmtNum(S.topDepth + S.histNode * S.gauge, 1) + ' m');

    tile(el, 'Pembacaan', String(ds.count),
      IPI.formatDate(ds.t[0]) + ' – ' + IPI.formatDate(ds.t[ds.count - 1]));

    if (gaps && gaps.length) {
      tile(el, 'Sensor rumpang', String(gaps.length), 'S' + gaps.slice(0, 6).join(', S') + (gaps.length > 6 ? '…' : ''));
    }
  }

  function renderStation() {
    var el = $('station');
    el.innerHTML = '';
    var add = function (label, value) {
      var d = document.createElement('div');
      var s = document.createElement('span');
      s.textContent = label;
      var b = document.createElement('b');
      b.textContent = value;
      d.appendChild(s);
      d.appendChild(b);
      el.appendChild(d);
    };
    add('Stasiun', ds.meta.station || '—');
    add('Logger', ds.meta.logger || '—');
    add('String', ds.n + ' sensor × ' + IPI.fmtNum(S.gauge, 1) + ' m = ' + IPI.fmtNum(ds.n * S.gauge, 1) + ' m');
    if (ds.demo) {
      var badge = document.createElement('span');
      badge.className = 'badge is-demo';
      badge.textContent = 'Data contoh';
      el.appendChild(badge);
    }

    var meta = $('meta');
    meta.innerHTML = '';
    var rows = [
      ['File', ds.files.join(', ') || '—'],
      ['Kolom sumber', ds.kind],
      ['Sensor', String(ds.n)],
      ['Pembacaan', String(ds.count)],
      ['Program', ds.meta.program || '—']
    ];
    if (ds.loggerGauge) rows.push(['Gauge di logger', ds.loggerGauge + ' mm']);
    rows.forEach(function (r) {
      var dt = document.createElement('dt');
      dt.textContent = r[0];
      var dd = document.createElement('dd');
      dd.textContent = r[1];
      meta.appendChild(dt);
      meta.appendChild(dd);
    });

    $('order-hint').textContent = 'Sensor teratas: S' + IPI.sensorLabel(0, ds.n, S.order === 'top') +
      ' · terbawah: S' + IPI.sensorLabel(ds.n - 1, ds.n, S.order === 'top') + '.';
  }

  /* ------------------------------------------------------- time history --- */

  function renderHistory(base, cur) {
    var host = $('plot-hist');
    if (!$('panel-history').open) return;

    var node = S.histNode;
    var sa = IPI.history(ds, optionsFor('a', base, cur), node);
    var sb = IPI.history(ds, optionsFor('b', base, cur), node);

    var lo = 0, hi = 0, i;
    for (i = 0; i < ds.count; i++) {
      if (sa[i] === sa[i]) { lo = Math.min(lo, sa[i]); hi = Math.max(hi, sa[i]); }
      if (sb[i] === sb[i]) { lo = Math.min(lo, sb[i]); hi = Math.max(hi, sb[i]); }
    }
    var pad = Math.max(0.05, (hi - lo) * 0.08);
    var y = IPI.niceScale(lo - pad, hi + pad, 5);

    var list = [];
    if (S.axis !== 'b') list.push({ label: 'Sumbu A', color: 'var(--axis-a)', values: sa });
    if (S.axis !== 'a') list.push({ label: 'Sumbu B', color: 'var(--axis-b)', values: sb });
    if (!list.length) list.push({ label: 'Sumbu A', color: 'var(--axis-a)', values: sa });

    IPI.drawHistory(host, {
      times: Array.prototype.slice.call(ds.t), series: list, y: y,
      aria: 'Cumulative displacement terhadap waktu pada kedalaman ' +
        IPI.fmtNum(S.topDepth + node * S.gauge, 1) + ' meter.'
    });

    $('hist-note').textContent = 'Cumulative displacement pada kedalaman ' +
      IPI.fmtNum(S.topDepth + node * S.gauge, 1) + ' m, seluruh ' + ds.count +
      ' pembacaan, relatif terhadap base reading.';
    view.history = { node: node, a: sa, b: sb };
  }

  /* -------------------------------------------------------------- table --- */

  function renderTable(profiles, plan, cumNodes) {
    if (!$('panel-table').open) return;
    var li = plan.length - 1, n = ds.n;
    var pa = profiles.a[li], pb = profiles.b[li];
    var thead = $('table').tHead, tbody = $('table').tBodies[0];

    thead.innerHTML = '';
    var hr = thead.insertRow();
    ['Kedalaman (m)', 'Sensor', 'Cum A (mm)', 'Inc A (mm)', 'Cum B (mm)', 'Inc B (mm)', 'Suhu (°C)'].forEach(function (h) {
      var th = document.createElement('th');
      th.scope = 'col';
      th.textContent = h;
      hr.appendChild(th);
    });

    var rows = document.createDocumentFragment();
    var tempOff = (view.cur) * n;
    for (var q = 0; q <= n; q++) {
      var tr = document.createElement('tr');
      var cells = [
        IPI.fmtNum(cumNodes[q].depth, 2),
        q < n ? 'S' + cumNodes[q].sensor : '—',
        IPI.fmtNum(pa.cum[q], 2),
        q < n ? IPI.fmtNum(pa.inc[q], 2) : '—',
        IPI.fmtNum(pb.cum[q], 2),
        q < n ? IPI.fmtNum(pb.inc[q], 2) : '—',
        q < n && ds.temp ? IPI.fmtNum(ds.temp[tempOff + (S.order === 'top' ? q : n - 1 - q)], 1) : '—'
      ];
      for (var c = 0; c < cells.length; c++) {
        var td = document.createElement('td');
        td.textContent = cells[c];
        tr.appendChild(td);
      }
      rows.appendChild(tr);
    }
    tbody.innerHTML = '';
    tbody.appendChild(rows);

    $('table-note').textContent = 'Pembacaan ' + IPI.formatDateTime(ds.t[view.cur]) +
      ' terhadap base ' + IPI.formatDateTime(ds.t[view.base]) +
      '. Kolom Inc adalah segmen di bawah kedalaman tersebut.';
  }

  /* ------------------------------------------------------------- export --- */

  var downloads = null, downloadsAsked = false;
  function getDownloads() {
    if (downloadsAsked) return Promise.resolve(downloads);
    downloadsAsked = true;
    if (!root.claude || typeof root.claude.use !== 'function') return Promise.resolve(null);
    return root.claude.use('downloads').then(function (d) { downloads = d; return d; })
      .catch(function () { return null; });
  }

  function saveFile(filename, text) {
    getDownloads().then(function (d) {
      if (d && typeof d.save === 'function') {
        return d.save({ filename: filename, data: text });
      }
      var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }).catch(function () {
      message('Unduhan ditolak atau tidak tersedia di tampilan ini.', 'error');
    });
  }

  function csvEscape(v) {
    var s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(rows) {
    return rows.map(function (r) { return r.map(csvEscape).join(','); }).join('\r\n') + '\r\n';
  }

  function exportProfile() {
    if (!view) return;
    var n = ds.n, pa = view.profiles.a[view.plan.length - 1], pb = view.profiles.b[view.plan.length - 1];
    var rows = [
      ['Stasiun', ds.meta.station || ''],
      ['Base reading', IPI.formatDateTime(ds.t[view.base])],
      ['Pembacaan', IPI.formatDateTime(ds.t[view.cur])],
      ['Gauge length (m)', S.gauge],
      ['Kedalaman sensor teratas (m)', S.topDepth],
      ['Titik jepit', S.fixedEnd === 'top' ? 'kepala lubang' : 'dasar lubang'],
      [],
      ['Kedalaman (m)', 'Sensor', 'Cum A (mm)', 'Inc A (mm)', 'Cum B (mm)', 'Inc B (mm)']
    ];
    for (var q = 0; q <= n; q++) {
      rows.push([
        IPI.fmtNum(view.cumNodes[q].depth, 3),
        q < n ? 'S' + view.cumNodes[q].sensor : '',
        IPI.fmtNum(pa.cum[q], 4),
        q < n ? IPI.fmtNum(pa.inc[q], 4) : '',
        IPI.fmtNum(pb.cum[q], 4),
        q < n ? IPI.fmtNum(pb.inc[q], 4) : ''
      ]);
    }
    saveFile('ipi-profil-' + (ds.meta.station || 'data') + '.csv', toCSV(rows));
  }

  function exportHistory() {
    if (!view) return;
    var h = view.history;
    if (!h || h.node !== S.histNode) {
      h = {
        node: S.histNode,
        a: IPI.history(ds, optionsFor('a', view.base, view.cur), S.histNode),
        b: IPI.history(ds, optionsFor('b', view.base, view.cur), S.histNode)
      };
    }
    var rows = [
      ['Stasiun', ds.meta.station || ''],
      ['Kedalaman (m)', IPI.fmtNum(S.topDepth + h.node * S.gauge, 2)],
      ['Base reading', IPI.formatDateTime(ds.t[view.base])],
      [],
      ['Timestamp', 'Cum A (mm)', 'Cum B (mm)']
    ];
    for (var i = 0; i < ds.count; i++) {
      rows.push([IPI.formatDateTime(ds.t[i]), IPI.fmtNum(h.a[i], 4), IPI.fmtNum(h.b[i], 4)]);
    }
    saveFile('ipi-riwayat-' + (ds.meta.station || 'data') + '.csv', toCSV(rows));
  }

  /* --------------------------------------------------------------- wire --- */

  function wire() {
    /* files */
    $('file').addEventListener('change', function (ev) { readFiles(ev.target.files); ev.target.value = ''; });
    var drop = $('drop');
    ['dragenter', 'dragover'].forEach(function (t) {
      drop.addEventListener(t, function (ev) { ev.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      drop.addEventListener(t, function (ev) { ev.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (ev) {
      if (ev.dataTransfer && ev.dataTransfer.files) readFiles(ev.dataTransfer.files);
    });

    $('clear-data').addEventListener('click', function () {
      storeDataset(null);
      setDataset(IPI.demo(), 'Data dihapus. Yang tampil sekarang adalah data contoh.');
    });
    $('load-demo').addEventListener('click', function () {
      setDataset(IPI.demo(), 'Data contoh dimuat.');
    });

    /* geometry */
    segment('seg-gauge', function () { return S.gauge; }, function (v) {
      S.gauge = parseFloat(v);
      $('gauge-custom').value = S.gauge;
      buildNodeSelect();
    });
    $('gauge-custom').addEventListener('change', function () {
      var v = parseFloat(this.value);
      if (!(v > 0)) { this.value = S.gauge; return; }
      S.gauge = v;
      syncSegment('seg-gauge', S.gauge);
      buildNodeSelect();
      saveSettings();
      render();
    });
    bindNumber('top-depth', 'topDepth', buildNodeSelect);
    segment('seg-order', function () { return S.order; }, function (v) { S.order = v; });
    segment('seg-fixed', function () { return S.fixedEnd; }, function (v) { S.fixedEnd = v; });

    /* readings */
    $('base-select').addEventListener('change', function () {
      S.baseTime = ds.t[parseInt(this.value, 10)];
      saveSettings();
      render();
    });
    $('cur-select').addEventListener('change', function () {
      S.curTime = ds.t[parseInt(this.value, 10)];
      saveSettings();
      render();
    });
    var nudge = function (which, delta) {
      var idx = currentIndices();
      var i = Math.max(0, Math.min(ds.count - 1, (which === 'base' ? idx.base : idx.cur) + delta));
      if (which === 'base') S.baseTime = ds.t[i]; else S.curTime = ds.t[i];
      saveSettings();
      render();
    };
    $('base-first').addEventListener('click', function () { S.baseTime = ds.t[0]; saveSettings(); render(); });
    $('base-prev').addEventListener('click', function () { nudge('base', -1); });
    $('base-next').addEventListener('click', function () { nudge('base', 1); });
    $('cur-last').addEventListener('click', function () { S.curTime = ds.t[ds.count - 1]; saveSettings(); render(); });
    $('cur-prev').addEventListener('click', function () { nudge('cur', -1); });
    $('cur-next').addEventListener('click', function () { nudge('cur', 1); });
    bindSelect('hist-count', 'histCount', function (v) { return parseInt(v, 10); });
    bindSelect('hist-spacing', 'histSpacing');

    /* axes */
    segment('seg-axis', function () { return S.axis; }, function (v) { S.axis = v; });
    segment('seg-incmode', function () { return S.incMode; }, function (v) { S.incMode = v; });
    bindCheck('flip-a', 'flipA');
    bindCheck('flip-b', 'flipB');
    bindCheck('markers', 'markers');
    bindCheck('cum-auto', 'cumAuto');
    bindCheck('inc-auto', 'incAuto');
    bindCheck('depth-auto', 'depthAuto');
    [['cum-min', 'cumMin'], ['cum-max', 'cumMax'], ['cum-step', 'cumStep'],
     ['inc-min', 'incMin'], ['inc-max', 'incMax'], ['inc-step', 'incStep'],
     ['depth-from', 'depthFrom'], ['depth-to', 'depthTo']].forEach(function (pair) {
      var auto = pair[0].indexOf('cum') === 0 ? 'cumAuto' : pair[0].indexOf('inc') === 0 ? 'incAuto' : 'depthAuto';
      $(pair[0]).addEventListener('change', function () {
        var v = parseFloat(this.value);
        if (!isFinite(v)) { this.value = S[pair[1]]; return; }
        S[pair[1]] = v;
        if (S[auto]) { S[auto] = false; $(auto === 'cumAuto' ? 'cum-auto' : auto === 'incAuto' ? 'inc-auto' : 'depth-auto').checked = false; }
        saveSettings();
        render();
      });
    });

    /* panels */
    $('hist-node').addEventListener('change', function () {
      S.histNode = parseInt(this.value, 10);
      saveSettings();
      render();
    });
    $('panel-history').addEventListener('toggle', render);
    $('panel-table').addEventListener('toggle', render);
    $('export-profile').addEventListener('click', exportProfile);
    $('export-history').addEventListener('click', exportHistory);

    /* Redraw only when the drawing area really changed — re-rendering must never
     * feed the observer that triggered it. */
    var pending = false, lastW = 0, lastH = 0;
    var stage = document.querySelector('.stage');
    var redraw = function () {
      var w = Math.round(stage.getBoundingClientRect().width), h = root.innerHeight;
      if (w === lastW && h === lastH) return;
      lastW = w; lastH = h;
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; render(); });
    };
    if (root.ResizeObserver) new ResizeObserver(redraw).observe(stage);
    root.addEventListener('resize', redraw);
  }

  function syncAllControls() {
    syncSegment('seg-gauge', S.gauge);
    syncSegment('seg-order', S.order);
    syncSegment('seg-fixed', S.fixedEnd);
    syncSegment('seg-axis', S.axis);
    syncSegment('seg-incmode', S.incMode);
    $('gauge-custom').value = S.gauge;
    $('top-depth').value = S.topDepth;
    $('hist-count').value = String(S.histCount);
    $('hist-spacing').value = String(S.histSpacing);
    $('flip-a').checked = !!S.flipA;
    $('flip-b').checked = !!S.flipB;
    $('markers').checked = !!S.markers;
    $('cum-auto').checked = !!S.cumAuto;
    $('inc-auto').checked = !!S.incAuto;
    $('depth-auto').checked = !!S.depthAuto;
    $('depth-from').value = S.depthFrom;
    $('depth-to').value = S.depthTo;
    syncScaleInputs();
  }

  /* --------------------------------------------------------------- boot --- */

  function boot() {
    loadSettings();
    wire();
    syncAllControls();
    getDownloads();

    var guard = new Promise(function (res) { setTimeout(function () { res(null); }, 1500); });
    Promise.race([readDataset(), guard]).then(function (stored) {
      if (stored && stored.n && stored.count) {
        try {
          setDataset(IPI.sort(stored), 'Data tersimpan dimuat ulang dari peramban ini.');
          return;
        } catch (e) { /* fall through to the demo string */ }
      }
      setDataset(IPI.demo(), 'Belum ada data. Yang tampil adalah data contoh — unggah file .dat Anda untuk menggantinya.');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(this);
