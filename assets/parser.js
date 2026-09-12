/* IPI Profile Sheet — TOA5 / CSV reader for in-place inclinometer strings.
 *
 * Produces a flat, structured-clone friendly dataset:
 *   { n, count, t:Float64Array(count), a:Float64Array(count*n), b:…, temp:… }
 * Sensor s of reading r lives at index r * n + s.
 */
(function (root) {
  'use strict';
  var IPI = (root.IPI = root.IPI || {});

  /* ---------------------------------------------------------------- CSV --- */

  /* Slice-based scanner: fast enough for multi-megabyte logger dumps. */
  function parseDelimited(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); /* strip BOM */
    var rows = [], row = [], i = 0, n = text.length;

    while (i < n) {
      var value;
      if (text.charCodeAt(i) === 34) {
        var out = '', s = ++i;
        for (;;) {
          var q = text.indexOf('"', i);
          if (q < 0) { out += text.slice(s); i = n; break; }
          if (text.charCodeAt(q + 1) === 34) { out += text.slice(s, q + 1); i = s = q + 2; continue; }
          out += text.slice(s, q); i = q + 1; break;
        }
        value = out;
      } else {
        var f = i;
        while (i < n) { var c = text.charCodeAt(i); if (c === 44 || c === 10 || c === 13) break; i++; }
        value = text.slice(f, i);
      }
      row.push(value);

      var d = text.charCodeAt(i);
      if (d === 44) { i++; continue; }
      if (d === 13) { i++; if (text.charCodeAt(i) === 10) i++; }
      else if (d === 10) { i++; }
      else if (i < n) { i++; continue; }
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    }
    if (row.length && (row.length > 1 || row[0] !== '')) rows.push(row);
    return rows;
  }

  /* Local-time parse — never let the browser reinterpret a logger clock as UTC. */
  function parseTimestamp(s) {
    if (!s) return NaN;
    var m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
    m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
    if (m) return new Date(+m[3], +m[1] - 1, +m[2], +m[4], +m[5], +(m[6] || 0)).getTime();
    var d = Date.parse(s);
    return isNaN(d) ? NaN : d;
  }

  function num(v) {
    if (v === '' || v == null) return NaN;
    var x = +v;
    return x === x ? x : NaN;
  }

  /* Map "Tilt_A(1,7)" / "Tilt_A(7)" onto { base:"Tilt_A", index:6 }. */
  function arrayColumns(header) {
    var groups = Object.create(null);
    for (var c = 0; c < header.length; c++) {
      var name = (header[c] || '').trim();
      var m = /^(.+?)\(\s*\d+\s*,\s*(\d+)\s*\)$/.exec(name) || /^(.+?)\(\s*(\d+)\s*\)$/.exec(name);
      if (!m) continue;
      var g = groups[m[1]] || (groups[m[1]] = []);
      g[+m[2] - 1] = c;
    }
    return groups;
  }

  function scalarColumn(header, names) {
    for (var i = 0; i < header.length; i++) {
      var h = (header[i] || '').trim().toLowerCase();
      for (var j = 0; j < names.length; j++) if (h === names[j]) return i;
    }
    return -1;
  }

  /* ------------------------------------------------------------ dataset --- */

  /**
   * Read one logger file.
   * @returns dataset — see module header. Throws Error (Indonesian message) on bad input.
   */
  IPI.parse = function (text, fileName) {
    var rows = parseDelimited(text);
    if (rows.length < 2) throw new Error('File tidak berisi data yang bisa dibaca.');

    var toa5 = (rows[0][0] || '').toUpperCase() === 'TOA5';
    var meta = toa5
      ? { station: rows[0][1] || '', logger: rows[0][2] || '', serial: rows[0][3] || '',
          os: rows[0][4] || '', program: rows[0][5] || '', table: rows[0][7] || '' }
      : { station: '', logger: '', serial: '', os: '', program: '', table: '' };

    var header = toa5 ? rows[1] : rows[0];
    var units = toa5 ? (rows[2] || []) : [];

    /* First row whose first cell is a real timestamp starts the data block. */
    var start = -1;
    for (var r = toa5 ? 4 : 1; r < rows.length; r++) {
      if (!isNaN(parseTimestamp(rows[r][0]))) { start = r; break; }
    }
    if (start < 0) throw new Error('Tidak ditemukan baris data dengan kolom TIMESTAMP yang valid.');

    var groups = arrayColumns(header);
    var warnings = [];

    /* Reading source, in order of preference. Tilt_* is sin(theta) straight from
     * the sensor; the others are derived quantities we have to undo. */
    var colsA, colsB, kind, scale = 1, loggerGauge = null;
    if (groups.Tilt_A) {
      colsA = groups.Tilt_A; colsB = groups.Tilt_B; kind = 'Tilt (sin θ)';
      if (groups.IPI_Def_A) loggerGauge = null; /* derived below from the data */
    } else if (groups.IPI_Def_A) {
      colsA = groups.IPI_Def_A; colsB = groups.IPI_Def_B; kind = 'IPI_Def (mm)';
      loggerGauge = 3000; scale = 1 / 3000;
      warnings.push('Kolom Tilt tidak ada — dipakai IPI_Def dengan asumsi gauge logger 3000 mm.');
    } else if (groups.ArcDeg_A) {
      colsA = groups.ArcDeg_A; colsB = groups.ArcDeg_B; kind = 'ArcDeg (rad)';
      warnings.push('Kolom Tilt tidak ada — dipakai ArcDeg dan dianggap satuan radian.');
    } else {
      throw new Error('Kolom sensor tidak dikenali. Dibutuhkan Tilt_A(1,n), IPI_Def_A(1,n), atau ArcDeg_A(1,n).');
    }

    var n = colsA.length;
    if (!n) throw new Error('Jumlah sensor terbaca nol.');
    if (!colsB) { colsB = []; warnings.push('Sumbu B tidak ditemukan di file ini.'); }

    var tempCols = groups.IPI_Temp || null;
    var battCol = scalarColumn(header, ['batt_volt', 'battvolt', 'batt']);

    var count = rows.length - start;
    var t = new Float64Array(count);
    var A = new Float64Array(count * n);
    var B = new Float64Array(count * n);
    var T = tempCols ? new Float64Array(count * n) : null;
    var batt = new Float64Array(count);

    var w = 0, sumRatio = 0, nRatio = 0;
    for (var i = 0; i < count; i++) {
      var row = rows[start + i];
      var ts = parseTimestamp(row[0]);
      if (isNaN(ts)) continue;
      t[w] = ts;
      batt[w] = battCol >= 0 ? num(row[battCol]) : NaN;
      var off = w * n;
      for (var s = 0; s < n; s++) {
        var va = colsA[s] == null ? NaN : num(row[colsA[s]]);
        var vb = colsB[s] == null ? NaN : num(row[colsB[s]]);
        if (kind === 'ArcDeg (rad)') { va = Math.sin(va); vb = Math.sin(vb); }
        else { va *= scale; vb *= scale; }
        A[off + s] = va;
        B[off + s] = vb;
        if (T) T[off + s] = tempCols[s] == null ? NaN : num(row[tempCols[s]]);
        /* Recover the gauge length the logger itself assumed, for reference. */
        if (groups.Tilt_A && groups.IPI_Def_A && nRatio < 64 && va && groups.IPI_Def_A[s] != null) {
          var def = num(row[groups.IPI_Def_A[s]]);
          if (def === def && Math.abs(va) > 1e-4) { sumRatio += def / va; nRatio++; }
        }
      }
      w++;
    }
    if (w < count) {
      t = t.slice(0, w); A = A.slice(0, w * n); B = B.slice(0, w * n);
      if (T) T = T.slice(0, w * n);
      batt = batt.slice(0, w);
      count = w;
    }
    if (!count) throw new Error('Tidak ada baris data yang valid.');
    if (nRatio) loggerGauge = Math.round(sumRatio / nRatio);

    var ds = {
      n: n, count: count, t: t, a: A, b: B, temp: T, batt: batt,
      meta: meta, kind: kind, units: (units[colsA[0]] || '').trim(),
      loggerGauge: loggerGauge, files: fileName ? [fileName] : [], warnings: warnings,
      demo: false
    };
    return IPI.sort(ds);
  };

  /* Sort by time and drop duplicate timestamps, keeping the last occurrence. */
  IPI.sort = function (ds) {
    var order = new Array(ds.count);
    for (var i = 0; i < ds.count; i++) order[i] = i;
    order.sort(function (x, y) { return ds.t[x] - ds.t[y] || x - y; });

    var keep = [];
    for (var k = 0; k < order.length; k++) {
      if (k + 1 < order.length && ds.t[order[k]] === ds.t[order[k + 1]]) continue;
      keep.push(order[k]);
    }
    if (keep.length === ds.count) {
      var sorted = true;
      for (var j = 0; j < keep.length; j++) if (keep[j] !== j) { sorted = false; break; }
      if (sorted) return ds;
    }
    return pick(ds, keep);
  };

  function pick(ds, idx) {
    var n = ds.n, m = idx.length;
    var out = {
      n: n, count: m, t: new Float64Array(m),
      a: new Float64Array(m * n), b: new Float64Array(m * n),
      temp: ds.temp ? new Float64Array(m * n) : null,
      batt: new Float64Array(m),
      meta: ds.meta, kind: ds.kind, units: ds.units, loggerGauge: ds.loggerGauge,
      files: ds.files.slice(), warnings: ds.warnings.slice(), demo: ds.demo
    };
    for (var i = 0; i < m; i++) {
      var src = idx[i] * n, dst = i * n;
      out.t[i] = ds.t[idx[i]];
      out.batt[i] = ds.batt[idx[i]];
      for (var s = 0; s < n; s++) {
        out.a[dst + s] = ds.a[src + s];
        out.b[dst + s] = ds.b[src + s];
        if (out.temp) out.temp[dst + s] = ds.temp[src + s];
      }
    }
    return out;
  }

  /**
   * Union two datasets on timestamp. Readings present in both are taken from
   * `next`, so re-uploading a grown file corrects any revised rows.
   */
  IPI.merge = function (prev, next) {
    if (!prev) return next;
    if (prev.n !== next.n) {
      var e = new Error('Jumlah sensor berbeda (' + prev.n + ' vs ' + next.n + '). Data lama diganti.');
      e.replace = true;
      throw e;
    }
    var n = prev.n, seen = Object.create(null), rowsOut = [];
    for (var j = 0; j < next.count; j++) { seen[next.t[j]] = 1; rowsOut.push({ ds: next, i: j, t: next.t[j] }); }
    for (var i = 0; i < prev.count; i++) if (!seen[prev.t[i]]) rowsOut.push({ ds: prev, i: i, t: prev.t[i] });
    rowsOut.sort(function (x, y) { return x.t - y.t; });

    var m = rowsOut.length;
    var out = {
      n: n, count: m, t: new Float64Array(m),
      a: new Float64Array(m * n), b: new Float64Array(m * n),
      temp: (prev.temp || next.temp) ? new Float64Array(m * n) : null,
      batt: new Float64Array(m),
      meta: next.meta.station ? next.meta : prev.meta,
      kind: next.kind, units: next.units,
      loggerGauge: next.loggerGauge || prev.loggerGauge,
      files: prev.files.concat(next.files.filter(function (f) { return prev.files.indexOf(f) < 0; })),
      warnings: next.warnings.slice(), demo: false
    };
    for (var k = 0; k < m; k++) {
      var rec = rowsOut[k], src = rec.i * n, dst = k * n;
      out.t[k] = rec.t;
      out.batt[k] = rec.ds.batt[rec.i];
      for (var s2 = 0; s2 < n; s2++) {
        out.a[dst + s2] = rec.ds.a[src + s2];
        out.b[dst + s2] = rec.ds.b[src + s2];
        if (out.temp) out.temp[dst + s2] = rec.ds.temp ? rec.ds.temp[src + s2] : NaN;
      }
    }
    return out;
  };

  /* ---------------------------------------------------- demo dataset ------ */

  /* Deterministic synthetic string so the page opens on a working plot sheet.
   * 22 sensors, 3 m gauge, a shear zone developing around 45 m depth. */
  IPI.demo = function () {
    var n = 22, count = 120, shear = 14.2, width = 1.9;
    var t = new Float64Array(count), A = new Float64Array(count * n), B = new Float64Array(count * n);
    var T = new Float64Array(count * n);
    var seed = 20250727;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; }

    var base = new Float64Array(n), baseB = new Float64Array(n);
    for (var s = 0; s < n; s++) { base[s] = rnd() * 0.06; baseB[s] = rnd() * 0.05; }

    var end = new Date(); end.setMinutes(0, 0, 0);
    for (var i = 0; i < count; i++) {
      /* one reading every 12 h across the last sixty days */
      t[i] = end.getTime() - (count - 1 - i) * 12 * 3600e3;
      var age = i / (count - 1);
      var growth = Math.pow(age, 1.45);
      for (var k = 0; k < n; k++) {
        var g = Math.exp(-Math.pow((k - shear) / width, 2));
        var drift = 0.0011 * growth * g + 0.00007 * growth * (1 - k / n);
        A[i * n + k] = base[k] + drift + rnd() * 0.00004;
        B[i * n + k] = baseB[k] - 0.0007 * growth * g + rnd() * 0.00004;
        T[i * n + k] = 32.8 - k * 0.27 + rnd() * 0.3;
      }
    }
    return {
      n: n, count: count, t: t, a: A, b: B, temp: T, batt: new Float64Array(count).fill(13.4),
      meta: { station: 'DEMO_Stn00', logger: 'CR300', serial: '—', os: '—', program: 'contoh', table: 'IPI_Data' },
      kind: 'Tilt (sin θ)', units: 'SIN_Angle', loggerGauge: 3000,
      files: ['data contoh'], warnings: [], demo: true
    };
  };
})(this);
