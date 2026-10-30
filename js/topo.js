/*
 * Survey Toolkit — topographic data
 *  - parseTopo: delimited text (PNEZD, PENZD, PNEZ, PENZ, NEZ, ENZ/XYZ, headed CSV),
 *    LandXML (CgPoints / surface Pnts) and GeoJSON points
 *  - triangulate: Delaunay TIN (Bowyer–Watson with sweep)
 *  - analyzeTopo: statistics, duplicates, spikes, slopes, surface area, volumes
 *  - contours: contour polylines from a TIN
 */
(function (root) {
  'use strict';
  const S = root.Survey;

  const FORMATS = {
    PNEZD: ['p', 'n', 'e', 'z', 'd'],
    PENZD: ['p', 'e', 'n', 'z', 'd'],
    PNEZ: ['p', 'n', 'e', 'z'],
    PENZ: ['p', 'e', 'n', 'z'],
    NEZ: ['n', 'e', 'z'],
    ENZ: ['e', 'n', 'z'],
    XYZ: ['e', 'n', 'z'],
  };

  const HEADER_ALIASES = {
    p: ['p', 'pt', 'pnt', 'point', 'pointno', 'pointnumber', 'pointid', 'id', 'name', 'number', 'no'],
    n: ['n', 'north', 'northing', 'y', 'lat', 'latitude'],
    e: ['e', 'east', 'easting', 'x', 'lon', 'long', 'longitude'],
    z: ['z', 'elev', 'elevation', 'el', 'height', 'h', 'rl', 'ht'],
    d: ['d', 'desc', 'description', 'code', 'feature', 'remarks', 'note', 'notes'],
  };

  function splitLine(line, delim) {
    if (delim === 'ws') return line.trim().split(/\s+/);
    // Simple CSV with quoted fields.
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  function detectDelimiter(lines) {
    const sample = lines.slice(0, 20).join('\n');
    const counts = { ',': (sample.match(/,/g) || []).length, '\t': (sample.match(/\t/g) || []).length, ';': (sample.match(/;/g) || []).length };
    const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    return counts[best] > 0 ? best : 'ws';
  }

  function headerMap(cells) {
    const map = {};
    cells.forEach((c, i) => {
      const k = c.toLowerCase().replace(/[^a-z]/g, '');
      Object.keys(HEADER_ALIASES).forEach((f) => {
        if (map[f] === undefined && HEADER_ALIASES[f].includes(k)) map[f] = i;
      });
    });
    return map.n !== undefined && map.e !== undefined && map.z !== undefined ? map : null;
  }

  function parseDelimited(text, format) {
    const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim() && !/^\s*(#|\/\/)/.test(l));
    const delim = detectDelimiter(lines);
    const warnings = [];
    let cols = null;
    let start = 0;
    let used = format;

    const first = lines.length ? splitLine(lines[0], delim) : [];
    const hm = headerMap(first);
    if (hm) {
      cols = hm; start = 1; used = 'columns from header row';
    } else {
      if (!format || format === 'auto') {
        const nCols = first.length;
        const firstIsNum = first.every((c, i) => i >= 4 || isFinite(Number(c)));
        if (nCols >= 5 || (nCols === 4 && firstIsNum)) used = nCols >= 5 ? 'PNEZD' : 'PNEZ';
        else used = 'XYZ';
        if (nCols >= 4 && !isFinite(Number(first[1]))) start = 1; // skip a non-matching header
      }
      const order = FORMATS[used] || FORMATS.PNEZD;
      cols = {};
      order.forEach((f, i) => { cols[f] = i; });
    }

    const points = [];
    let skipped = 0;
    for (let li = start; li < lines.length; li++) {
      const c = splitLine(lines[li], delim);
      const n = Number(c[cols.n]), e = Number(c[cols.e]), z = Number(c[cols.z]);
      if (!isFinite(n) || !isFinite(e) || !isFinite(z) || c[cols.n] === '' || c[cols.e] === '') { skipped++; continue; }
      let desc = '';
      if (cols.d !== undefined) {
        desc = c.slice(cols.d, cols.d + 1).join('');
        // Whitespace-delimited descriptions may contain spaces — join the remainder.
        if (delim === 'ws' && cols.d === Math.max(...Object.values(cols))) desc = c.slice(cols.d).join(' ');
      }
      points.push({
        id: cols.p !== undefined ? String(c[cols.p]) : String(points.length + 1),
        n, e, z, desc: (desc || '').trim(),
      });
    }
    if (skipped) warnings.push(`${skipped} line(s) were skipped because they did not contain valid coordinates.`);
    return { points, warnings, format: used, delimiter: { ws: 'whitespace', '\t': 'tab', ',': 'comma', ';': 'semicolon' }[delim] };
  }

  function parseLandXML(text) {
    const warnings = [];
    const points = [];
    if (typeof DOMParser === 'undefined') return { points, warnings: ['LandXML parsing requires a browser.'], format: 'LandXML' };
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) return { points, warnings: ['The XML file could not be parsed.'], format: 'LandXML' };
    const byLocal = (name) => Array.from(doc.getElementsByTagName('*')).filter((n) => n.localName === name);
    byLocal('CgPoint').forEach((el, i) => {
      const v = el.textContent.trim().split(/\s+/).map(Number);
      if (v.length >= 3 && v.every(isFinite)) {
        points.push({ id: el.getAttribute('name') || el.getAttribute('oID') || String(i + 1), n: v[0], e: v[1], z: v[2], desc: el.getAttribute('code') || el.getAttribute('desc') || '' });
      } else if (v.length === 2) warnings.push(`CgPoint ${el.getAttribute('name') || i + 1} has no elevation and was skipped.`);
    });
    if (!points.length) {
      byLocal('P').forEach((el, i) => {
        const v = el.textContent.trim().split(/\s+/).map(Number);
        if (v.length >= 3 && v.every(isFinite)) points.push({ id: el.getAttribute('id') || String(i + 1), n: v[0], e: v[1], z: v[2], desc: 'TIN' });
      });
    }
    return { points, warnings, format: 'LandXML' };
  }

  function parseGeoJSON(text) {
    const warnings = [];
    const points = [];
    let gj;
    try { gj = JSON.parse(text); } catch (err) { return { points, warnings: ['Invalid JSON: ' + err.message], format: 'GeoJSON' }; }
    const feats = gj.type === 'FeatureCollection' ? gj.features : gj.type === 'Feature' ? [gj] : [{ geometry: gj, properties: {} }];
    let noZ = 0;
    const add = (c, props, i) => {
      if (c.length < 3 || !isFinite(c[2])) { noZ++; return; }
      const p = props || {};
      points.push({ id: String(p.name || p.id || p.point || points.length + 1), e: +c[0], n: +c[1], z: +c[2], desc: String(p.desc || p.description || p.code || '') });
    };
    (feats || []).forEach((f, i) => {
      const g = f && f.geometry;
      if (!g) return;
      if (g.type === 'Point') add(g.coordinates, f.properties, i);
      else if (g.type === 'MultiPoint' || g.type === 'LineString') g.coordinates.forEach((c) => add(c, f.properties, i));
      else if (g.type === 'MultiLineString' || g.type === 'Polygon') g.coordinates.forEach((r) => r.forEach((c) => add(c, f.properties, i)));
    });
    if (noZ) warnings.push(`${noZ} coordinate(s) without elevation were skipped.`);
    return { points, warnings, format: 'GeoJSON' };
  }

  function parseTopo(text, format) {
    const t = String(text || '').trim();
    if (!t) return { points: [], warnings: ['No data.'], format: '' };
    if (format === 'landxml' || ((!format || format === 'auto') && t[0] === '<')) return parseLandXML(t);
    if (format === 'geojson' || ((!format || format === 'auto') && t[0] === '{')) return parseGeoJSON(t);
    return parseDelimited(t, format);
  }

  // ---------- Delaunay triangulation ----------

  function circum(ax, ay, bx, by, cx, cy) {
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-12) return null;
    const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
    const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
    const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
    const dx = ax - ux, dy = ay - uy;
    return { x: ux, y: uy, r2: dx * dx + dy * dy };
  }

  /** xs, ys arrays → array of [i, j, k] triangles (counter-clockwise). */
  function triangulate(xs, ys) {
    const n = xs.length;
    if (n < 3) return [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      if (xs[i] < minX) minX = xs[i]; if (xs[i] > maxX) maxX = xs[i];
      if (ys[i] < minY) minY = ys[i]; if (ys[i] > maxY) maxY = ys[i];
    }
    const span = Math.max(maxX - minX, maxY - minY) || 1;
    // Normalise to [0, 1] for numerical stability with large grid coordinates.
    const X = new Float64Array(n + 3), Y = new Float64Array(n + 3);
    for (let i = 0; i < n; i++) { X[i] = (xs[i] - minX) / span; Y[i] = (ys[i] - minY) / span; }
    X[n] = -20; Y[n] = -10; X[n + 1] = 0.5; Y[n + 1] = 30; X[n + 2] = 21; Y[n + 2] = -10;

    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => X[a] - X[b]);
    const mk = (a, b, c) => {
      const cc = circum(X[a], Y[a], X[b], Y[b], X[c], Y[c]);
      return cc ? { a, b, c, x: cc.x, y: cc.y, r2: cc.r2 } : null;
    };
    let open = [mk(n, n + 1, n + 2)];
    const closed = [];
    const EPS = 1e-12;

    for (const p of order) {
      const px = X[p], py = Y[p];
      const edges = [];
      for (let j = open.length - 1; j >= 0; j--) {
        const t = open[j];
        const dx = px - t.x;
        if (dx > 0 && dx * dx > t.r2) { closed.push(t); open[j] = open[open.length - 1]; open.pop(); continue; }
        const dy = py - t.y;
        if (dx * dx + dy * dy - t.r2 > EPS) continue;
        edges.push(t.a, t.b, t.b, t.c, t.c, t.a);
        open[j] = open[open.length - 1]; open.pop();
      }
      // Remove duplicate (shared) edges.
      const m = edges.length;
      const dead = new Uint8Array(m / 2);
      for (let i = 0; i < m; i += 2) {
        if (dead[i / 2]) continue;
        for (let k = i + 2; k < m; k += 2) {
          if ((edges[i] === edges[k] && edges[i + 1] === edges[k + 1]) || (edges[i] === edges[k + 1] && edges[i + 1] === edges[k])) {
            dead[i / 2] = 1; dead[k / 2] = 1; break;
          }
        }
      }
      for (let i = 0; i < m; i += 2) {
        if (dead[i / 2]) continue;
        const t = mk(edges[i], edges[i + 1], p);
        if (t) open.push(t);
      }
    }
    const all = closed.concat(open);
    const tris = [];
    for (const t of all) {
      if (t.a >= n || t.b >= n || t.c >= n) continue;
      // Orient counter-clockwise.
      const cross = (X[t.b] - X[t.a]) * (Y[t.c] - Y[t.a]) - (Y[t.b] - Y[t.a]) * (X[t.c] - X[t.a]);
      if (Math.abs(cross) < 1e-14) continue;
      tris.push(cross > 0 ? [t.a, t.b, t.c] : [t.a, t.c, t.b]);
    }
    return tris;
  }

  // ---------- Analysis ----------

  function median(arr) {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /**
   * @param {Array} rawPoints [{id, n, e, z, desc}]
   * @param {object} opt { maxEdge, refElev, spikeZ }
   */
  function analyzeTopo(rawPoints, opt = {}) {
    const warnings = [];
    // Duplicate point numbers and coincident positions.
    const ids = new Map();
    const dupIds = [];
    rawPoints.forEach((p) => {
      if (ids.has(p.id)) dupIds.push(p.id); else ids.set(p.id, p);
    });
    const posKey = (p) => `${Math.round(p.n * 1000)}|${Math.round(p.e * 1000)}`;
    const seen = new Map();
    const coincident = [];
    const points = [];
    rawPoints.forEach((p) => {
      const k = posKey(p);
      if (seen.has(k)) {
        const q = seen.get(k);
        coincident.push({ keep: q, drop: p, dz: p.z - q.z });
        p.excluded = true;
      } else {
        seen.set(k, p);
        p.excluded = false;
        points.push(p);
      }
    });

    const n = points.length;
    const stats = { count: rawPoints.length, used: n };
    if (!n) return { points, tris: [], stats, warnings: ['No points to analyse.'], dupIds, coincident, spikes: [] };

    let minN = Infinity, maxN = -Infinity, minE = Infinity, maxE = -Infinity, minZ = Infinity, maxZ = -Infinity, sumZ = 0;
    points.forEach((p) => {
      minN = Math.min(minN, p.n); maxN = Math.max(maxN, p.n);
      minE = Math.min(minE, p.e); maxE = Math.max(maxE, p.e);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      sumZ += p.z;
    });
    const meanZ = sumZ / n;
    const sdZ = Math.sqrt(points.reduce((s, p) => s + (p.z - meanZ) * (p.z - meanZ), 0) / n);
    Object.assign(stats, { minN, maxN, minE, maxE, minZ, maxZ, meanZ, sdZ, relief: maxZ - minZ });
    const lowPt = points.find((p) => p.z === minZ), highPt = points.find((p) => p.z === maxZ);
    stats.lowPt = lowPt; stats.highPt = highPt;

    // Description / code summary.
    const codes = {};
    rawPoints.forEach((p) => { const c = (p.desc || '(none)').split(/\s+/)[0].toUpperCase() || '(none)'; codes[c] = (codes[c] || 0) + 1; });
    stats.codes = Object.entries(codes).sort((a, b) => b[1] - a[1]);

    let tris = n >= 3 ? triangulate(points.map((p) => p.e), points.map((p) => p.n)) : [];
    if (n >= 3 && !tris.length) warnings.push('All points are collinear — no surface can be built.');

    const maxEdge = Number(opt.maxEdge);
    if (maxEdge > 0) {
      const before = tris.length;
      tris = tris.filter(([a, b, c]) => {
        const A = points[a], B = points[b], C = points[c];
        return S.dist(A, B) <= maxEdge && S.dist(B, C) <= maxEdge && S.dist(C, A) <= maxEdge;
      });
      if (before - tris.length) stats.trimmed = before - tris.length;
    }

    // Neighbours, spikes (robust z-score of the residual from a plane fitted to the TIN neighbours).
    const nbr = Array.from({ length: n }, () => new Set());
    tris.forEach(([a, b, c]) => { nbr[a].add(b).add(c); nbr[b].add(a).add(c); nbr[c].add(a).add(b); });
    const resid = points.map((p, i) => {
      if (nbr[i].size < 3) return null;
      const pred = planePredict(p, [...nbr[i]].map((j) => points[j]));
      return p.z - pred;
    });
    const valid = resid.filter((r) => r !== null);
    const med = median(valid);
    const mad = median(valid.map((r) => Math.abs(r - med))) || 1e-9;
    const spikeZ = Number(opt.spikeZ) || 3.5;
    const spikes = [];
    points.forEach((p, i) => {
      p.spike = false;
      if (resid[i] === null) return;
      const rz = 0.6745 * (resid[i] - med) / mad;
      if (Math.abs(rz) <= spikeZ || Math.abs(resid[i]) <= 0.5 * Math.max(sdZ * 0.1, 0.01)) return;
      // A bust stands out from its own neighbourhood: it is the largest residual locally and
      // much larger than the neighbours' residuals (smooth terrain curvature affects all of them).
      const nr = [...nbr[i]].map((j) => (resid[j] === null ? 0 : Math.abs(resid[j])));
      const localMax = nr.every((r) => Math.abs(resid[i]) >= r);
      if (localMax && Math.abs(resid[i]) > 3 * median(nr)) {
        p.spike = true;
        spikes.push({ p, resid: resid[i], rz });
      }
    });
    spikes.sort((a, b) => Math.abs(b.rz) - Math.abs(a.rz));

    // Areas, slopes, volumes.
    const ref = S.parseNumber(opt.refElev);
    let area2d = 0, area3d = 0, slopeSum = 0, slopeMax = 0, cut = 0, fill = 0;
    const slopes = new Float64Array(tris.length);
    tris.forEach(([a, b, c], ti) => {
      const A = points[a], B = points[b], C = points[c];
      const ux = B.e - A.e, uy = B.n - A.n, uz = B.z - A.z;
      const vx = C.e - A.e, vy = C.n - A.n, vz = C.z - A.z;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const a2 = Math.abs(nz) / 2;
      const a3 = Math.hypot(nx, ny, nz) / 2;
      area2d += a2; area3d += a3;
      const slope = Math.abs(nz) > 1e-12 ? Math.hypot(nx, ny) / Math.abs(nz) * 100 : 0;
      slopes[ti] = slope;
      slopeSum += slope * a2;
      slopeMax = Math.max(slopeMax, slope);
      if (isFinite(ref)) {
        const v = prismAboveBelow(a2, A.z - ref, B.z - ref, C.z - ref);
        cut += v.above; fill += v.below;
      }
    });
    // 95th-percentile slope by plan area (robust against sliver triangles on the hull).
    const byArea = tris.map(([a, b, c], ti) => {
      const A = points[a], B = points[b], C = points[c];
      return [slopes[ti], Math.abs((B.e - A.e) * (C.n - A.n) - (C.e - A.e) * (B.n - A.n)) / 2];
    }).sort((x, y) => x[0] - y[0]);
    let acc = 0, slopeP95 = 0;
    for (const [s, a] of byArea) { acc += a; slopeP95 = s; if (acc >= 0.95 * area2d) break; }
    Object.assign(stats, {
      triangles: tris.length, area2d, area3d,
      slopeMean: area2d ? slopeSum / area2d : 0, slopeMax, slopeP95,
    });
    const volume = isFinite(ref) ? { ref, above: cut, below: fill, net: cut - fill } : null;

    return { points, tris, slopes, stats, warnings, dupIds, coincident, spikes, volume };
  }

  /** Least-squares plane through the neighbours, evaluated at p (falls back to the mean). */
  function planePredict(p, nb) {
    let s1 = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0, sz = 0, sxz = 0, syz = 0;
    nb.forEach((q) => {
      const x = q.e - p.e, y = q.n - p.n, z = q.z;
      s1++; sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y; sz += z; sxz += x * z; syz += y * z;
    });
    const det3 = (a, b, c, d, e, f, g, h, i) => a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    const D = det3(s1, sx, sy, sx, sxx, sxy, sy, sxy, syy);
    const scale = Math.max(sxx, syy, 1e-12);
    if (Math.abs(D) < 1e-9 * s1 * scale * scale) return sz / s1;
    return det3(sz, sx, sy, sxz, sxx, sxy, syz, sxy, syy) / D;
  }

  /** Volume of a linear triangular prism above and below 0, given vertex heights. */
  function prismAboveBelow(A, h1, h2, h3) {
    const net = A * (h1 + h2 + h3) / 3;
    const pos = [h1, h2, h3].filter((h) => h > 0).length;
    const neg = [h1, h2, h3].filter((h) => h < 0).length;
    if (neg === 0) return { above: net, below: 0 };
    if (pos === 0) return { above: 0, below: -net };
    const hs = [h1, h2, h3];
    if (pos + neg < 3) {
      // One vertex exactly on the plane: the remaining two have opposite signs.
      const p = hs.find((h) => h > 0), q = hs.find((h) => h < 0);
      const iso = A * p * p / (3 * (p - q));
      return { above: iso, below: iso - net };
    }
    // The isolated vertex has the sign shared by no other vertex.
    const k = pos === 1 ? hs.findIndex((h) => h > 0) : hs.findIndex((h) => h < 0);
    const hk = hs[k], hj = hs[(k + 1) % 3], hl = hs[(k + 2) % 3];
    const iso = A * hk * hk * hk / (3 * (hk - hj) * (hk - hl));
    const rest = net - iso;
    return hk > 0 ? { above: iso, below: -rest } : { above: rest, below: -iso };
  }

  // ---------- Contours ----------

  /**
   * Contour polylines for the given TIN.
   * Returns [{ level, index, pts: [{e, n}] }].
   */
  function contours(points, tris, interval, indexEvery = 5, minZ, maxZ) {
    if (!(interval > 0) || !tris.length) return [];
    const lo = Math.ceil(minZ / interval) * interval;
    const out = [];
    const maxLevels = 2000;
    let count = 0;
    for (let lev = lo; lev <= maxZ + 1e-9 && count < maxLevels; lev += interval, count++) {
      const level = Math.round(lev / interval) * interval;
      // Each crossed edge gets a node; each triangle contributes one segment linking two nodes.
      const nodes = new Map();
      const link = (key, other) => { if (!nodes.has(key)) nodes.set(key, []); nodes.get(key).push(other); };
      const pos = new Map();
      const edgeKey = (a, b) => (a < b ? a + '_' + b : b + '_' + a);
      const cross = (a, b) => {
        const A = points[a], B = points[b];
        const ia = A.z >= level, ib = B.z >= level;
        if (ia === ib) return null;
        const key = edgeKey(a, b);
        if (!pos.has(key)) {
          const t = (level - A.z) / (B.z - A.z);
          pos.set(key, { e: A.e + t * (B.e - A.e), n: A.n + t * (B.n - A.n) });
        }
        return key;
      };
      for (const [a, b, c] of tris) {
        const ks = [cross(a, b), cross(b, c), cross(c, a)].filter(Boolean);
        if (ks.length === 2) { link(ks[0], ks[1]); link(ks[1], ks[0]); }
      }
      // Walk chains — start from ends (degree 1) first, then closed loops.
      const used = new Set();
      const walk = (start) => {
        const line = [pos.get(start)];
        used.add(start);
        let prev = null, cur = start;
        for (;;) {
          const nx = (nodes.get(cur) || []).find((k) => k !== prev && !used.has(k));
          if (nx === undefined) {
            // close loops
            const nb = nodes.get(cur) || [];
            if (line.length > 2 && nb.includes(start) && prev !== start) line.push(pos.get(start));
            break;
          }
          line.push(pos.get(nx));
          used.add(nx);
          prev = cur; cur = nx;
        }
        return line;
      };
      const isIndex = indexEvery > 0 && Math.abs(Math.round(level / interval) % indexEvery) === 0;
      for (const [k, nb] of nodes) if (nb.length === 1 && !used.has(k)) out.push({ level, index: isIndex, pts: walk(k) });
      for (const [k] of nodes) if (!used.has(k)) out.push({ level, index: isIndex, pts: walk(k) });
    }
    return out;
  }

  /** Simple R12 DXF with 3D polylines (as LINE segments) for contours and POINT entities for shots. */
  function toDXF(points, contourLines) {
    const L = ['0', 'SECTION', '2', 'ENTITIES'];
    contourLines.forEach((c) => {
      const layer = c.index ? 'CONTOUR-INDEX' : 'CONTOUR';
      for (let i = 1; i < c.pts.length; i++) {
        const a = c.pts[i - 1], b = c.pts[i];
        L.push('0', 'LINE', '8', layer, '10', a.e.toFixed(4), '20', a.n.toFixed(4), '30', c.level.toFixed(4),
          '11', b.e.toFixed(4), '21', b.n.toFixed(4), '31', c.level.toFixed(4));
      }
    });
    points.forEach((p) => {
      L.push('0', 'POINT', '8', 'TOPO-PNTS', '10', p.e.toFixed(4), '20', p.n.toFixed(4), '30', p.z.toFixed(4));
    });
    L.push('0', 'ENDSEC', '0', 'EOF');
    return L.join('\r\n');
  }

  Object.assign(S, { parseTopo, triangulate, analyzeTopo, contours, prismAboveBelow, toDXF, TOPO_FORMATS: Object.keys(FORMATS) });
})(typeof window !== 'undefined' ? window : globalThis);
