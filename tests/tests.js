/*
 * Survey Toolkit — calculation tests. Open tests/index.html in a browser.
 */
(function () {
  'use strict';
  const S = window.Survey;
  const results = [];
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  function test(name, fn) {
    try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, msg: e.message }); }
  }
  function eq(actual, expected, tol, label) {
    if (typeof expected === 'number') {
      if (!near(actual, expected, tol === undefined ? 1e-9 : tol)) throw new Error(`${label || ''} expected ${expected}, got ${actual}`);
    } else if (actual !== expected) throw new Error(`${label || ''} expected "${expected}", got "${actual}"`);
  }
  const sec = 1 / 3600;

  // ---------- core ----------
  test('parseAngle formats', () => {
    eq(S.parseAngle('45-30-15'), 45.50416666666667, 1e-12);
    eq(S.parseAngle('45°30\'15"'), 45.50416666666667, 1e-12);
    eq(S.parseAngle('45 30 15'), 45.50416666666667, 1e-12);
    eq(S.parseAngle('45d30m15s'), 45.50416666666667, 1e-12);
    eq(S.parseAngle('12.5'), 12.5);
    eq(S.parseAngle('-0-30-00'), -0.5);
    if (!isNaN(S.parseAngle('45-75-00'))) throw new Error('minutes ≥ 60 should be invalid');
    if (!isNaN(S.parseAngle('abc'))) throw new Error('text should be invalid');
  });
  test('bearings ↔ azimuths', () => {
    eq(S.parseBearing('N 45-00-00 E'), 45);
    eq(S.parseBearing('S 45-00-00 E'), 135);
    eq(S.parseBearing('S45W'), 225);
    eq(S.parseBearing('N 45 W'), 315);
    eq(S.parseDirection('N 0 E'), 0);
    eq(S.parseDirection('270'), 270);
    eq(S.formatBearing(225), 'S 45°00\'00" W');
    eq(S.formatBearing(S.parseBearing('N 63-24-05 E')), 'N 63°24\'05" E');
    eq(S.formatAzimuth(359.99999999), '0°00\'00"');
    eq(S.formatDMS(10.999999999), '11°00\'00"');
  });
  test('stations', () => {
    eq(S.parseStation('12+34.56'), 1234.56, 1e-9);
    eq(S.parseStation('1+234.567'), 1234.567, 1e-9);
    eq(S.formatStation(1234.56), '12+34.56');
    eq(S.formatStation(1205), '12+05.00');
    eq(S.formatStation(1234.567, 'm'), '1+234.57');
    eq(S.formatStation(99.999), '1+00.00');
  });
  test('polygon area and interior angles (square)', () => {
    const p = S.polygonInfo([{ n: 0, e: 0 }, { n: 100, e: 0 }, { n: 100, e: 100 }, { n: 0, e: 100 }]);
    eq(p.area, 10000);
    eq(p.ccw, false);
    p.interior.forEach((a) => eq(a, 90, 1e-9));
  });

  // ---------- traverse ----------
  test('square traverse closes exactly', () => {
    const r = S.computeTraverse({
      mode: 'distdir', dirType: 'direction', method: 'compass', startN: 0, startE: 0,
      courses: [{ dist: '100', dir: 'N 0 E' }, { dist: '100', dir: 'N 90 E' }, { dist: '100', dir: 'S 0 E' }, { dist: '100', dir: '270' }],
    });
    eq(r.errors.length, 0);
    eq(r.linear, 0, 1e-9);
    eq(r.area, 10000, 1e-6);
    eq(r.dmdArea, 10000, 1e-6);
  });
  test('compass rule removes misclosure and is proportional to length', () => {
    const r = S.computeTraverse({ mode: 'distdir', dirType: 'direction', method: 'compass', courses: S.samples.traverseDirections });
    eq(r.errors.length, 0);
    eq(r.rows.reduce((s, x) => s + x.adjLat, 0), 0, 1e-9, 'ΣadjLat');
    eq(r.rows.reduce((s, x) => s + x.adjDep, 0), 0, 1e-9, 'ΣadjDep');
    r.rows.forEach((x) => eq(x.cLat / x.dist, r.rows[0].cLat / r.rows[0].dist, 1e-12, 'proportional'));
    const last = r.adjPts[r.adjPts.length - 1];
    eq(last.n, r.adjPts[0].n, 1e-9); eq(last.e, r.adjPts[0].e, 1e-9);
    eq(r.area, r.dmdArea, 1e-6, 'coordinate area = DMD area');
    if (!(r.precision > 5000)) throw new Error('sample should close better than 1:5000, got ' + r.precision);
  });
  test('transit rule closes', () => {
    const r = S.computeTraverse({ mode: 'distdir', dirType: 'direction', method: 'transit', courses: S.samples.traverseDirections });
    eq(r.rows.reduce((s, x) => s + x.adjLat, 0), 0, 1e-9);
    eq(r.rows.reduce((s, x) => s + x.adjDep, 0), 0, 1e-9);
  });
  test('interior angles: balancing and azimuth propagation (clockwise)', () => {
    const s = S.samples.traverseAngles;
    const r = S.computeTraverse({ mode: 'distdir', dirType: 'angles', turn: 'cw', startDir: s.startDir, courses: s.courses, method: 'compass' });
    eq(r.errors.length, 0);
    eq(r.angleInfo.misclosure * 3600, 20, 1e-6, 'misclosure"');
    eq(r.rows.reduce((t, x) => t + x.angleAdj, 0), 540, 1e-9);
    eq(r.angleInfo.closingAz, r.angleInfo.startAz, 1e-9, 'closing azimuth');
    // Second course should be close to the bearing-entry sample S 27°55'55" E.
    if (S.azDiff(r.rows[1].az, S.parseBearing('S 27-55-55 E')) > 10 * sec) throw new Error('azimuth 2 off');
    if (!(r.precision > 3000)) throw new Error('angle sample closes poorly: ' + r.precision);
  });
  test('interior angles counter-clockwise square', () => {
    const r = S.computeTraverse({
      mode: 'distdir', dirType: 'angles', turn: 'ccw', startDir: '0',
      courses: [{ dist: 100, angle: 90 }, { dist: 100, angle: 90 }, { dist: 100, angle: 90 }, { dist: 100, angle: 90 }],
    });
    eq(r.rows[1].az, 270, 1e-9);
    eq(r.linear, 0, 1e-9);
    eq(r.area, 10000, 1e-6);
  });
  test('lat/dep entry gives distances and bearings', () => {
    const r = S.computeTraverse({ mode: 'latdep', method: 'none', courses: [{ lat: 100, dep: 0 }, { lat: 0, dep: 100 }, { lat: -100, dep: -100 }] });
    eq(r.rows[0].az, 0); eq(r.rows[1].az, 90); eq(r.rows[2].az, 225, 1e-9);
    eq(r.rows[2].dist, Math.SQRT2 * 100, 1e-9);
    eq(r.area, 5000, 1e-9);
  });

  test('course labels A-B / 1-2 and suggested labels', () => {
    const r = S.computeTraverse({ mode: 'distdir', dirType: 'direction', courses: [
      { station: 'A-B', dist: 100, dir: '0' }, { station: 'B-C', dist: 100, dir: '90' }, { station: 'C-D', dist: 100, dir: '180' }, { station: 'D-A', dist: 100, dir: '270' }] });
    eq(r.rows[0].station, 'A'); eq(r.rows[0].to, 'B'); eq(r.rows[3].to, 'A');
    eq(r.warnings.length, 0, 0, 'no chain warnings');
    const bad = S.computeTraverse({ mode: 'distdir', dirType: 'direction', courses: [
      { station: '1-2', dist: 100, dir: '0' }, { station: '3-4', dist: 100, dir: '90' }, { station: '4-1', dist: 141.42, dir: '225' }] });
    if (!bad.warnings.some((w) => /ends at 2/.test(w))) throw new Error('expected a broken-chain warning');
    const blank = S.computeTraverse({ mode: 'latdep', courses: [{ lat: 1, dep: 0 }, { lat: 0, dep: 1 }, { lat: -1, dep: -1 }] });
    eq(blank.rows[0].station, 'A'); eq(blank.rows[2].to, 'A');
    eq(S.courseLabel(0, 4), 'A-B'); eq(S.courseLabel(3, 4), 'D-A');
  });

  // ---------- missing data ----------
  const square = (d1, a1, d2, a2, d3, a3, d4, a4) => [{ dist: d1, dir: a1 }, { dist: d2, dir: a2 }, { dist: d3, dir: a3 }, { dist: d4, dir: a4 }];
  test('missing: one full course', () => {
    const r = S.computeMissing({ courses: square('100', '0', '100', '90', '100', '180', '?', '?') });
    eq(r.errors.length, 0);
    eq(r.solutions[0].rows[3].dist, 100, 1e-9);
    eq(r.solutions[0].rows[3].az, 270, 1e-9);
  });
  test('missing: two lengths', () => {
    const r = S.computeMissing({ courses: square('?', '0', '', '90', '100', '180', '100', '270') });
    if (r.errors.length) throw new Error(r.errors[0]);
    eq(r.solutions[0].rows[0].dist, 100, 1e-9);
    eq(r.solutions[0].rows[1].dist, 100, 1e-9);
    const p = S.computeMissing({ courses: square('100', '0', '?', '90', '100', '180', '?', '270') });
    if (!p.errors.length) throw new Error('parallel unknown-length courses should be rejected');
  });
  test('missing: two directions (two solutions)', () => {
    const r = S.computeMissing({ courses: square('100', '0', '100', '90', '100', '?', '100', '?') });
    if (r.errors.length) throw new Error(r.errors[0]);
    eq(r.solutions.length, 2, 0, 'solutions');
    const ok = r.solutions.some((s) => near(s.rows[2].az, 180, 1e-6) && near(s.rows[3].az, 270, 1e-6));
    if (!ok) throw new Error('expected az 180 / 270 among solutions');
  });
  test('missing: length + direction', () => {
    const r = S.computeMissing({ courses: square('?', '0', '100', '90', '100', '180', '100', '?') });
    if (r.errors.length) throw new Error(r.errors[0]);
    const ok = r.solutions.some((s) => near(s.rows[0].dist, 100, 1e-6) && near(s.rows[3].az, 270, 1e-6));
    if (!ok) throw new Error('expected 100 / 270 among solutions');
  });
  test('missing: sample matches the full traverse', () => {
    const r = S.computeMissing({ courses: S.samples.missing });
    const d = r.solutions[0].rows[3];
    if (!near(d.dist, 366.59, 0.3)) throw new Error('distance ' + d.dist);
    if (S.azDiff(d.az, S.parseBearing('N 54-57-50 W')) > 0.05) throw new Error('direction ' + S.formatBearing(d.az));
  });
  test('missing: too many unknowns rejected', () => {
    const r = S.computeMissing({ courses: square('?', '0', '?', '90', '100', '?', '100', '270') });
    if (!r.errors.length) throw new Error('should be rejected');
  });

  // ---------- radiation ----------
  test('radiation: square around the station', () => {
    const d = 100 * Math.SQRT2;
    const r = S.computeRadiation({
      N: 0, E: 0, refMode: 'direction',
      points: [{ dir: '45', dist: d }, { dir: '135', dist: d }, { dir: '225', dist: d }, { dir: '315', dist: d }],
    });
    eq(r.poly.area, 40000, 1e-6);
    eq(r.courses[0].dist, 200, 1e-9);
    eq(r.courses[0].az, 180, 1e-9);
    eq(r.wedges.reduce((s, w) => s + w.area, 0), 40000, 1e-6);
  });
  test('radiation: angle right from backsight', () => {
    const r = S.computeRadiation({ N: 0, E: 0, refMode: 'angle', backsightDir: 'N 90 E', points: [{ dir: '90', dist: 10 }, { dir: '180', dist: 10 }] });
    eq(r.pts[0].az, 180, 1e-9);
    eq(r.pts[0].n, -10, 1e-9);
    eq(r.pts[1].e, -10, 1e-9);
  });

  // ---------- horizontal curve ----------
  test('horizontal curve Δ=24°, D=4° (arc)', () => {
    const r = S.computeHCurve({ delta: '24', defineBy: 'D', D: '4', dDef: 'arc', baseLen: 100, staType: 'PI', sta: '64+27.30', interval: 50 });
    eq(r.R, 1432.394, 1e-3, 'R');
    eq(r.T, 304.465, 1e-3, 'T');
    eq(r.L, 600, 1e-9, 'L');
    eq(r.LC, 595.623, 1e-3, 'LC');
    eq(r.E, 32.001, 1e-3, 'E');
    eq(r.M, 31.301, 1e-3, 'M');
    eq(r.PC, 6427.30 - 304.465, 1e-3, 'PC');
    eq(r.PT, r.PC + 600, 1e-9, 'PT');
    const last = r.points[r.points.length - 1];
    eq(last.defl, 12, 1e-9, 'deflection at PT = Δ/2');
    eq(last.chordPC, r.LC, 1e-9, 'chord to PT = LC');
    eq(r.points[1].sta, 6150, 1e-9, 'first even station');
  });
  test('horizontal curve coordinates reach the PT', () => {
    const r = S.computeHCurve({ delta: '30', defineBy: 'R', R: '1000', dDef: 'arc', staType: 'PI', sta: '10+00', interval: 50, turn: 'left', piN: 5000, piE: 5000, backAz: '45' });
    const last = r.points[r.points.length - 1];
    eq(last.n, r.pt.n, 1e-6); eq(last.e, r.pt.e, 1e-6);
    eq(Math.hypot(last.n - r.center.n, last.e - r.center.e), 1000, 1e-6);
    eq(r.aheadAz, 15, 1e-9);
  });
  test('chord definition radius', () => {
    const r = S.computeHCurve({ delta: '20', defineBy: 'D', D: '5', dDef: 'chord', baseLen: 100, staType: 'PC', sta: '0+00', interval: 100 });
    eq(r.R, 50 / Math.sin(2.5 * S.RAD), 1e-9);
    eq(r.points[1].chordPC, 100, 1e-9, '100-ft chord at first full station');
  });

  // ---------- vertical curve ----------
  test('vertical curve crest +3% / −2%, L = 400', () => {
    const r = S.computeVCurve({ pviSta: '50+00', pviElev: 500, L: 400, g1: 3, g2: -2, interval: 50 });
    eq(r.bvc, 4800); eq(r.evc, 5200);
    eq(r.bvcElev, 494, 1e-9); eq(r.evcElev, 496, 1e-9);
    eq(r.turning.sta, 5040, 1e-9); eq(r.turning.elev, 497.6, 1e-9);
    const pvi = r.points.find((p) => near(p.sta, 5000, 1e-9));
    eq(pvi.elev, 500 - 5 * 400 / 800, 1e-9, 'curve elev at PVI');
    eq(r.K, 80, 1e-9);
    eq(r.points.length, 10, 0, 'BVC + 7 stations + high point + EVC');
  });
  test('vertical curve lookup on tangent', () => {
    const r = S.computeVCurve({ pviSta: '10+00', pviElev: 100, L: 200, g1: -1, g2: 2, interval: 25, lookupSta: '13+00' });
    eq(r.lookup.elev, 100 + 0.02 * 300, 1e-9);
    eq(r.turning.kind, 'Low point');
  });

  // ---------- topo ----------
  test('parse PNEZD, header CSV, XYZ and GeoJSON', () => {
    let p = S.parseTopo('1,100,200,10,GS\n2,110,200,11,GS\n3,100,210,12,TOE');
    eq(p.points.length, 3); eq(p.points[2].e, 210); eq(p.points[2].desc, 'TOE');
    p = S.parseTopo('Easting,Northing,Elevation\n200,100,10\n210,100,12\n200,110,11');
    eq(p.points[0].n, 100); eq(p.points[0].e, 200);
    p = S.parseTopo('200 100 10\n210 100 12\n200 110 11', 'XYZ');
    eq(p.points[1].e, 210);
    p = S.parseTopo(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'A' }, geometry: { type: 'Point', coordinates: [1, 2, 3] } }] }));
    eq(p.points[0].e, 1); eq(p.points[0].n, 2); eq(p.points[0].z, 3);
  });
  test('parse LandXML CgPoints', () => {
    const xml = '<?xml version="1.0"?><LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2"><CgPoints><CgPoint name="1" code="GS">100 200 10</CgPoint><CgPoint name="2">110 200 11</CgPoint></CgPoints></LandXML>';
    const p = S.parseTopo(xml);
    eq(p.points.length, 2); eq(p.points[0].n, 100); eq(p.points[0].e, 200); eq(p.points[0].desc, 'GS');
  });
  test('Delaunay grid triangulation', () => {
    const xs = [], ys = [];
    for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) { xs.push(i * 10 + (j % 2) * 0.01); ys.push(j * 10 + 2_000_000); }
    const t = S.triangulate(xs, ys);
    eq(t.length, 2 * 9 * 9, 0, 'triangles in a 10×10 grid');
  });
  test('plane surface: areas, slope, volumes and contours', () => {
    const pts = [];
    let id = 1;
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) pts.push({ id: String(id++), e: i * 10, n: j * 10, z: 100 + i * 1, desc: 'GS' }); // 10% slope east
    const a = S.analyzeTopo(pts, { refElev: 105 });
    eq(a.stats.area2d, 10000, 1e-6);
    eq(a.stats.area3d, 10000 * Math.sqrt(1.01), 1e-6);
    eq(a.stats.slopeMax, 10, 1e-6);
    eq(a.volume.above, 2.5 * 5000, 1e-6, 'above');  // wedge: avg height 2.5 over half the area
    eq(a.volume.below, 2.5 * 5000, 1e-6, 'below');
    eq(a.spikes.length, 0, 0, 'no spikes on a plane');
    const c = S.contours(a.points, a.tris, 1, 5, a.stats.minZ, a.stats.maxZ);
    const c103 = c.filter((x) => x.level === 103);
    eq(c103.length, 1, 0, 'one polyline at 103');
    c103[0].pts.forEach((p) => eq(p.e, 30, 1e-9, 'contour 103 at e=30'));
  });
  test('spike detection finds a busted shot', () => {
    const pts = [];
    let id = 1;
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) pts.push({ id: String(id++), e: i * 10 + (j % 3), n: j * 10, z: 50 + 0.02 * i * 10 + 0.01 * ((i * 7 + j * 3) % 5) });
    pts[40].z += 6;
    const a = S.analyzeTopo(pts, {});
    if (!a.spikes.length || a.spikes[0].p.id !== pts[40].id) throw new Error('spike not found');
  });
  test('prism split above/below', () => {
    const v = S.prismAboveBelow(1, 1, -1, -1);
    eq(v.above, 1 / 12, 1e-12); eq(v.below, 1 / 3 + 1 / 12, 1e-12);
    const w = S.prismAboveBelow(1, 0, 1, -1);
    eq(w.above - w.below, 0, 1e-12);
  });
  test('sample topo data loads with spike and duplicate', () => {
    const p = S.parseTopo(S.samples.topoText());
    const a = S.analyzeTopo(p.points, {});
    if (!a.spikes.some((s) => /bad/.test(s.p.desc))) throw new Error('sample spike not detected');
    if (!a.dupIds.includes('1005')) throw new Error('duplicate id not detected');
  });

  // ---------- report ----------
  const pass = results.filter((r) => r.ok).length;
  const el = document.getElementById('results');
  el.innerHTML = `<h2>${pass} / ${results.length} passed</h2><ul>` +
    results.map((r) => `<li class="${r.ok ? 'ok' : 'fail'}">${r.ok ? '✔' : '✘'} ${r.name}${r.ok ? '' : ' — ' + r.msg}</li>`).join('') + '</ul>';
  document.title = `${pass}/${results.length} tests passed`;
  window.__testResults = results;
})();
