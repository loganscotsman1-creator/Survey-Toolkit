/*
 * Survey Toolkit — traverse computations
 *  - computeTraverse: closed-loop traverse with angle balancing, closure,
 *    Compass (Bowditch) / Transit adjustment, coordinates, area (coordinates + DMD).
 *  - computeMissing: solve up to two unknown quantities (lengths / directions).
 *  - computeRadiation: points located by direction + distance from one station.
 */
(function (root) {
  'use strict';
  const S = root.Survey;
  const RAD = S.RAD;

  /** Default station letters: A, B, … Z, then 27, 28, … */
  function stationLetter(i) {
    return i < 26 ? String.fromCharCode(65 + i) : String(i + 1);
  }

  /** Suggested course label for row i of n, e.g. "A-B", with the last course closing back to A. */
  function courseLabel(i, n) {
    return `${stationLetter(i)}-${stationLetter(n > 0 ? (i + 1) % n : i + 1)}`;
  }

  /** Course label "A-B", "1–2", "A to B" or just "A" (the station the course leaves). */
  function parseCourse(c, i) {
    const s = c.station ? String(c.station).trim() : '';
    const m = s.match(/^(.+?)\s*(?:\s+to\s+|[-–—→>]+)\s*(.+)$/i);
    if (m) return { from: m[1].trim(), to: m[2].trim() };
    return { from: s || stationLetter(i), to: '' };
  }

  /** Station names for each course, with the "to" station defaulting to the next course's "from". */
  function courseStations(courses, warnings) {
    const n = courses.length;
    const parsed = courses.map(parseCourse);
    return parsed.map((p, i) => {
      const next = parsed[(i + 1) % n].from;
      if (p.to && n > 1 && p.to !== next) {
        warnings.push(`Course ${p.from}-${p.to} ends at ${p.to}, but the next course starts at ${next}. Courses should run in order around the figure (A-B, B-C, …).`);
      }
      return { station: p.from, to: p.to || next };
    });
  }

  /**
   * @param {object} inp
   *  mode: 'distdir' | 'latdep'
   *  dirType: 'direction' (bearing or azimuth per course) | 'angles' (interior angles)
   *  turn: 'cw' | 'ccw'   traverse numbering direction (angles mode only)
   *  startDir: azimuth/bearing of the first course (angles mode only)
   *  method: 'compass' | 'transit' | 'none'
   *  courses: [{ station, dist, dir, angle, lat, dep }]
   *  startN, startE, requiredPrecision
   */
  function computeTraverse(inp) {
    const errors = [];
    const warnings = [];
    const courses = (inp.courses || []).slice();
    const n = courses.length;
    if (n < 3) errors.push('A closed traverse needs at least 3 courses.');

    const rows = courseStations(courses, warnings).map((s, i) => ({ station: s.station, to: s.to, index: i }));

    let angleInfo = null;

    if (inp.mode === 'latdep') {
      courses.forEach((c, i) => {
        const lat = S.parseNumber(c.lat), dep = S.parseNumber(c.dep);
        if (!isFinite(lat) || !isFinite(dep)) errors.push(`Course ${rows[i].station}-${rows[i].to}: latitude and departure are required numbers.`);
        rows[i].lat = lat; rows[i].dep = dep;
        rows[i].dist = Math.hypot(lat, dep);
        rows[i].az = S.azOf(lat, dep);
      });
    } else {
      courses.forEach((c, i) => {
        const d = S.parseNumber(c.dist);
        if (!(d > 0)) errors.push(`Course ${rows[i].station}-${rows[i].to}: distance must be a positive number.`);
        rows[i].dist = d;
      });

      if (inp.dirType === 'angles') {
        const startAz = S.parseDirection(inp.startDir);
        if (!isFinite(startAz)) errors.push('Enter the azimuth or bearing of the first course (reference direction).');
        const obs = courses.map((c, i) => {
          const a = S.parseAngle(c.angle);
          if (!(a > 0 && a < 360)) errors.push(`Station ${rows[i].station}: interior angle is missing or invalid.`);
          return a;
        });
        const sum = obs.reduce((s, a) => s + a, 0);
        const expected = (n - 2) * 180;
        const misclosure = sum - expected;
        const corr = -misclosure / n;
        if (Math.abs(misclosure) > 1 / 60 * Math.max(1, Math.sqrt(n))) {
          warnings.push(`Angular misclosure of ${S.formatSeconds(misclosure, 0)} is large — check for a blunder in the angles (or confirm they are interior angles).`);
        }
        const ccw = inp.turn === 'ccw';
        const adj = obs.map((a) => a + corr);
        const az = [startAz];
        for (let i = 1; i < n; i++) az[i] = S.normAz(az[i - 1] + 180 + (ccw ? adj[i] : -adj[i]));
        const closingAz = S.normAz(az[n - 1] + 180 + (ccw ? adj[0] : -adj[0]));
        rows.forEach((r, i) => {
          r.angleObs = obs[i];
          r.angleCorr = corr;
          r.angleAdj = adj[i];
          r.az = az[i];
        });
        angleInfo = { sum, expected, misclosure, corrPerAngle: corr, closingAz, startAz };
      } else {
        courses.forEach((c, i) => {
          const az = S.parseDirection(c.dir);
          if (!isFinite(az)) errors.push(`Course ${rows[i].station}-${rows[i].to}: direction "${c.dir || ''}" is not a valid bearing or azimuth.`);
          rows[i].az = az;
        });
      }
      rows.forEach((r) => {
        const ld = S.latDep(r.dist, r.az);
        r.lat = ld.lat; r.dep = ld.dep;
      });
    }

    const startN = isFinite(S.parseNumber(inp.startN)) ? S.parseNumber(inp.startN) : 5000;
    const startE = isFinite(S.parseNumber(inp.startE)) ? S.parseNumber(inp.startE) : 5000;
    if (errors.length) return { errors, warnings };

    const sumLat = rows.reduce((s, r) => s + r.lat, 0);
    const sumDep = rows.reduce((s, r) => s + r.dep, 0);
    const perimeter = rows.reduce((s, r) => s + r.dist, 0);
    const sumAbsLat = rows.reduce((s, r) => s + Math.abs(r.lat), 0);
    const sumAbsDep = rows.reduce((s, r) => s + Math.abs(r.dep), 0);
    const linear = Math.hypot(sumLat, sumDep);
    const misAz = S.azOf(sumLat, sumDep); // direction of the error vector (start point → computed end point)
    const precision = linear > 1e-12 ? perimeter / linear : Infinity;

    const method = inp.method || 'compass';
    rows.forEach((r) => {
      if (method === 'compass') {
        r.cLat = -sumLat * r.dist / perimeter;
        r.cDep = -sumDep * r.dist / perimeter;
      } else if (method === 'transit') {
        r.cLat = sumAbsLat > 0 ? -sumLat * Math.abs(r.lat) / sumAbsLat : 0;
        r.cDep = sumAbsDep > 0 ? -sumDep * Math.abs(r.dep) / sumAbsDep : 0;
      } else {
        r.cLat = 0; r.cDep = 0;
      }
      r.adjLat = r.lat + r.cLat;
      r.adjDep = r.dep + r.cDep;
      r.adjDist = Math.hypot(r.adjLat, r.adjDep);
      r.adjAz = S.azOf(r.adjLat, r.adjDep);
      r.dDist = r.adjDist - r.dist;
      r.dAz = ((r.adjAz - r.az + 540) % 360) - 180;
    });

    // Coordinates — raw (shows the misclosure gap) and adjusted.
    const rawPts = [{ n: startN, e: startE, label: rows[0].station }];
    const adjPts = [{ n: startN, e: startE, label: rows[0].station }];
    rows.forEach((r, i) => {
      const pr = rawPts[i], pa = adjPts[i];
      rawPts.push({ n: pr.n + r.lat, e: pr.e + r.dep, label: r.to });
      adjPts.push({ n: pa.n + r.adjLat, e: pa.e + r.adjDep, label: r.to });
    });
    rows.forEach((r, i) => { r.N = adjPts[i].n; r.E = adjPts[i].e; });

    // DMD area (on adjusted lat/dep).
    let dbl = 0;
    rows.forEach((r, i) => {
      r.dmd = i === 0 ? r.adjDep : rows[i - 1].dmd + rows[i - 1].adjDep + r.adjDep;
      r.dblArea = r.dmd * r.adjLat;
      dbl += r.dblArea;
    });
    const dmdArea = Math.abs(dbl) / 2;

    const poly = S.polygonInfo(adjPts.slice(0, n));
    rows.forEach((r, i) => { r.interior = poly.interior[i]; });

    // Blunder hint: a distance blunder tends to be parallel to the misclosure.
    let blunderHint = null;
    const required = S.parseNumber(inp.requiredPrecision) || 5000;
    if (linear > 0 && precision < required) {
      let best = null;
      rows.forEach((r) => {
        const d = Math.min(S.azDiff(r.az, misAz), S.azDiff(r.az, misAz + 180));
        if (!best || d < best.d) best = { d, r };
      });
      if (best && best.d < 10) {
        blunderHint = `Course ${best.r.station}-${best.r.to} runs nearly parallel to the misclosure (within ${best.d.toFixed(1)}°). If there is a distance blunder, check that course first.`;
      }
    }

    return {
      errors, warnings, rows, angleInfo, method,
      sumLat, sumDep, perimeter, linear, misAz, precision, required,
      meetsPrecision: precision >= required,
      rawPts, adjPts, area: poly.area, dmdArea, ccw: poly.ccw, blunderHint,
    };
  }

  /**
   * Missing-data traverse. Blank or "?" marks an unknown.
   * Allowed: one course missing both length and direction, or two unknowns
   * in different courses (two lengths, two directions, or one of each).
   */
  function computeMissing(inp) {
    const errors = [];
    const courses = inp.courses || [];
    const n = courses.length;
    if (n < 3) errors.push('Enter at least 3 courses.');

    const warnings = [];
    const stations = courseStations(courses, warnings);
    const items = courses.map((c, i) => {
      const unkDist = S.isUnknown(c.dist);
      const unkDir = S.isUnknown(c.dir);
      const dist = unkDist ? NaN : S.parseNumber(c.dist);
      const az = unkDir ? NaN : S.parseDirection(c.dir);
      const label = `${stations[i].station}-${stations[i].to}`;
      if (!unkDist && !(dist > 0)) errors.push(`Course ${label}: distance "${c.dist}" is invalid.`);
      if (!unkDir && !isFinite(az)) errors.push(`Course ${label}: direction "${c.dir}" is invalid.`);
      return { station: stations[i].station, to: stations[i].to, unkDist, unkDir, dist, az };
    });

    const unknowns = [];
    items.forEach((it, i) => {
      if (it.unkDist) unknowns.push({ i, kind: 'dist' });
      if (it.unkDir) unknowns.push({ i, kind: 'dir' });
    });
    if (unknowns.length === 0) errors.push('Mark the unknown values by leaving them blank or entering "?".');
    if (unknowns.length > 2) errors.push(`There are ${unknowns.length} unknowns. A closed traverse can solve at most 2 (closure gives two equations: ΣLat = 0 and ΣDep = 0).`);
    if (errors.length) return { errors };

    // Closing vector the unknown course(s) must supply.
    let sLat = 0, sDep = 0;
    items.forEach((it) => {
      if (!it.unkDist && !it.unkDir) {
        const ld = S.latDep(it.dist, it.az);
        sLat += ld.lat; sDep += ld.dep;
      }
    });
    const R = [-sLat, -sDep];
    const Rlen = Math.hypot(R[0], R[1]);
    const unit = (az) => [Math.cos(az * RAD), Math.sin(az * RAD)];

    const solutions = []; // each: map index -> {dist, az}
    let caseName = '';

    if (unknowns.length === 1) {
      return { errors: ['Only one unknown: a single unknown is over-determined by closure. Mark both the length and direction of one course, or two quantities in total, as unknown.'] };
    }

    const [u1, u2] = unknowns;
    if (u1.i === u2.i) {
      caseName = 'Case 1 — length and direction of one course unknown';
      if (Rlen < 1e-9) return { errors: ['The known courses already close; the missing course would have zero length.'] };
      solutions.push({ [u1.i]: { dist: Rlen, az: S.azOf(R[0], R[1]) } });
    } else if (u1.kind === 'dist' && u2.kind === 'dist') {
      caseName = 'Case 2 — lengths of two courses unknown';
      const a = unit(items[u1.i].az), b = unit(items[u2.i].az);
      const det = a[0] * b[1] - a[1] * b[0];
      if (Math.abs(det) < 1e-9) return { errors: ['The two courses with unknown lengths are parallel; the lengths cannot be determined.'] };
      const x = (R[0] * b[1] - R[1] * b[0]) / det;
      const y = (a[0] * R[1] - a[1] * R[0]) / det;
      if (!(x > 0 && y > 0)) return { errors: [`No valid solution: the computed lengths are ${x.toFixed(3)} and ${y.toFixed(3)}. A negative length means the given directions are inconsistent with the rest of the traverse.`] };
      solutions.push({ [u1.i]: { dist: x, az: items[u1.i].az }, [u2.i]: { dist: y, az: items[u2.i].az } });
    } else if (u1.kind === 'dir' && u2.kind === 'dir') {
      caseName = 'Case 3 — directions of two courses unknown';
      const L1 = items[u1.i].dist, L2 = items[u2.i].dist;
      if (Rlen > L1 + L2 + 1e-9 || Rlen < Math.abs(L1 - L2) - 1e-9 || Rlen < 1e-9) {
        return { errors: [`No solution: the closing distance (${Rlen.toFixed(3)}) cannot be spanned by lengths ${L1} and ${L2}.`] };
      }
      const cosA = Math.max(-1, Math.min(1, (L1 * L1 + Rlen * Rlen - L2 * L2) / (2 * L1 * Rlen)));
      const alpha = Math.acos(cosA) / RAD;
      const rAz = S.azOf(R[0], R[1]);
      const signs = alpha < 1e-9 ? [1] : [1, -1];
      signs.forEach((sg) => {
        const az1 = S.normAz(rAz + sg * alpha);
        const v1 = S.latDep(L1, az1);
        const az2 = S.azOf(R[0] - v1.lat, R[1] - v1.dep);
        solutions.push({ [u1.i]: { dist: L1, az: az1 }, [u2.i]: { dist: L2, az: az2 } });
      });
    } else {
      caseName = 'Case 4 — length of one course and direction of another unknown';
      const dU = u1.kind === 'dist' ? u1 : u2; // known direction, unknown length
      const aU = u1.kind === 'dir' ? u1 : u2;  // known length, unknown direction
      const u = unit(items[dU.i].az);
      const L = items[aU.i].dist;
      const proj = R[0] * u[0] + R[1] * u[1];
      const disc = proj * proj - Rlen * Rlen + L * L;
      if (disc < -1e-9) return { errors: [`No solution: a course of length ${L} cannot close the traverse along the given direction.`] };
      const root = Math.sqrt(Math.max(0, disc));
      const cands = root < 1e-9 ? [proj] : [proj + root, proj - root];
      cands.filter((a) => a > 1e-9).forEach((a) => {
        const rem = [R[0] - a * u[0], R[1] - a * u[1]];
        solutions.push({ [dU.i]: { dist: a, az: items[dU.i].az }, [aU.i]: { dist: L, az: S.azOf(rem[0], rem[1]) } });
      });
      if (!solutions.length) return { errors: ['No valid solution: the only solutions require a negative length.'] };
    }

    const startN = isFinite(S.parseNumber(inp.startN)) ? S.parseNumber(inp.startN) : 5000;
    const startE = isFinite(S.parseNumber(inp.startE)) ? S.parseNumber(inp.startE) : 5000;

    const results = solutions.map((sol) => {
      const rows = items.map((it, i) => {
        const s = sol[i];
        const dist = s ? s.dist : it.dist;
        const az = s ? s.az : it.az;
        const ld = S.latDep(dist, az);
        return {
          station: it.station, to: it.to, dist, az, lat: ld.lat, dep: ld.dep,
          solvedDist: it.unkDist, solvedDir: it.unkDir,
        };
      });
      const pts = [{ n: startN, e: startE, label: rows[0].station }];
      rows.forEach((r, i) => pts.push({ n: pts[i].n + r.lat, e: pts[i].e + r.dep, label: r.to }));
      rows.forEach((r, i) => { r.N = pts[i].n; r.E = pts[i].e; });
      const poly = S.polygonInfo(pts.slice(0, n));
      rows.forEach((r, i) => { r.interior = poly.interior[i]; });
      const perimeter = rows.reduce((s, r) => s + r.dist, 0);
      const crosses = selfIntersects(pts.slice(0, n));
      return { rows, pts, area: poly.area, perimeter, crosses };
    });

    return { errors: [], warnings, caseName, closing: { lat: R[0], dep: R[1], dist: Rlen, az: S.azOf(R[0], R[1]) }, solutions: results };
  }

  function segIntersect(a, b, c, d) {
    const o = (p, q, r) => (q.e - p.e) * (r.n - p.n) - (q.n - p.n) * (r.e - p.e);
    const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
  }

  function selfIntersects(pts) {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        if (segIntersect(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
      }
    }
    return false;
  }

  /**
   * Radiation survey.
   *  refMode: 'direction' (azimuth/bearing to each point) | 'angle' (horizontal angle right from backsight)
   *  backsightDir: azimuth/bearing of the backsight line (angle mode)
   *  points: [{ name, dir, dist }]
   *  includeStation: insert the occupied station as the first vertex of the parcel
   */
  function computeRadiation(inp) {
    const errors = [];
    const N0 = S.parseNumber(inp.N), E0 = S.parseNumber(inp.E);
    if (!isFinite(N0) || !isFinite(E0)) errors.push('Enter the northing and easting of the occupied station.');
    let bs = 0;
    if (inp.refMode === 'angle') {
      bs = S.parseDirection(inp.backsightDir);
      if (!isFinite(bs)) errors.push('Enter the backsight azimuth or bearing.');
    }
    const pts = (inp.points || []).map((p, i) => {
      const name = (p.name && String(p.name).trim()) || 'P' + (i + 1);
      const d = S.parseNumber(p.dist);
      let az;
      if (inp.refMode === 'angle') {
        const a = S.parseAngle(p.dir);
        if (!isFinite(a)) errors.push(`Point ${name}: angle "${p.dir || ''}" is invalid.`);
        az = S.normAz(bs + a);
      } else {
        az = S.parseDirection(p.dir);
        if (!isFinite(az)) errors.push(`Point ${name}: direction "${p.dir || ''}" is invalid.`);
      }
      if (!(d > 0)) errors.push(`Point ${name}: distance must be a positive number.`);
      const ld = S.latDep(d, az);
      return { name, angle: inp.refMode === 'angle' ? S.parseAngle(p.dir) : null, az, dist: d, lat: ld.lat, dep: ld.dep, n: N0 + ld.lat, e: E0 + ld.dep };
    });
    if (pts.length < 2) errors.push('Enter at least 2 radiated points (3 or more to compute an area).');
    if (errors.length) return { errors };

    const station = { name: (inp.stationName || 'STA').trim() || 'STA', n: N0, e: E0 };
    const verts = (inp.includeStation ? [{ name: station.name, n: N0, e: E0 }] : []).concat(pts.map((p) => ({ name: p.name, n: p.n, e: p.e })));

    const courses = verts.map((v, i) => {
      const w = verts[(i + 1) % verts.length];
      const lat = w.n - v.n, dep = w.e - v.e;
      return { from: v.name, to: w.name, lat, dep, dist: Math.hypot(lat, dep), az: S.azOf(lat, dep) };
    });
    const poly = verts.length >= 3 ? S.polygonInfo(verts) : null;
    if (poly) verts.forEach((v, i) => { v.interior = poly.interior[i]; });

    // Radial triangle (wedge) areas between successive rays.
    let wedges = null;
    if (!inp.includeStation && pts.length >= 3) {
      wedges = pts.map((p, i) => {
        const q = pts[(i + 1) % pts.length];
        const theta = ((q.az - p.az + 540) % 360) - 180;
        return { from: p.name, to: q.name, theta, area: 0.5 * p.dist * q.dist * Math.sin(theta * RAD) };
      });
    }

    return { errors: [], station, pts, verts, courses, poly, wedges, perimeter: poly ? poly.perimeter : null };
  }

  Object.assign(S, { computeTraverse, computeMissing, computeRadiation, selfIntersects, courseLabel, stationLetter });
})(typeof window !== 'undefined' ? window : globalThis);
