/*
 * Survey Toolkit — application wiring.
 */
(function () {
  'use strict';
  const S = window.Survey;
  const UI = S.UI;
  const $ = (id) => document.getElementById(id);
  const esc = UI.esc;

  const units = () => $('units').value;
  const sd = () => Number($('secDec').value);
  const U = () => S.UNITS[units()];
  const ld = () => U().dec; // linear decimals
  const brg = (az) => S.formatBearing(az, sd());
  const azs = (az) => S.formatAzimuth(az, sd());
  const dms = (a) => S.formatDMS(a, sd());
  const L = (v) => S.fmt(v, ld());
  const Ls = (v) => S.fmtSigned(v, ld());
  const sta = (v) => S.formatStation(v, units());

  const redraw = {};   // tab -> fn that redraws canvases
  const rerun = {};    // tab -> fn that recomputes (when results are showing)

  // ---------- Tabs ----------
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + b.dataset.tab));
      try { history.replaceState(null, '', '#' + b.dataset.tab); } catch (e) { /* ignore */ }
      if (redraw[b.dataset.tab]) requestAnimationFrame(redraw[b.dataset.tab]);
    });
  });
  const initial = location.hash.slice(1);
  if (initial) { const b = document.querySelector(`.tabs button[data-tab="${initial}"]`); if (b) b.click(); }

  $('units').addEventListener('change', () => { updateLabels(); Object.values(rerun).forEach((f) => f && f()); });
  $('secDec').addEventListener('change', () => Object.values(rerun).forEach((f) => f && f()));
  window.addEventListener('resize', () => {
    const active = document.querySelector('.tabs button.active');
    if (active && redraw[active.dataset.tab]) redraw[active.dataset.tab]();
  });

  // ---------- Grids ----------
  const grids = {
    tr: UI.createGrid($('tr-grid'), [
      { key: 'station', label: 'Station', placeholder: 'A' },
      { key: 'dist', label: 'Distance', placeholder: '492.36' },
      { key: 'dir', label: 'Bearing or azimuth', placeholder: 'N 63-24-05 E' },
      { key: 'angle', label: 'Interior angle', placeholder: '142-25-55' },
      { key: 'lat', label: 'Latitude (+N / −S)', placeholder: '220.46' },
      { key: 'dep', label: 'Departure (+E / −W)', placeholder: '440.18' },
    ], { minRows: 4 }),
    ms: UI.createGrid($('ms-grid'), [
      { key: 'station', label: 'Station', placeholder: 'A' },
      { key: 'dist', label: 'Distance (blank or ? if unknown)', placeholder: '492.36 or ?' },
      { key: 'dir', label: 'Bearing / azimuth (blank or ? if unknown)', placeholder: 'N 63-24-05 E or ?' },
    ], { minRows: 4 }),
    rd: UI.createGrid($('rd-grid'), [
      { key: 'name', label: 'Point', placeholder: '101' },
      { key: 'dir', label: 'Angle right', placeholder: '32-15-20' },
      { key: 'dist', label: 'Horizontal distance', placeholder: '245.62' },
    ], { minRows: 4 }),
  };
  document.querySelectorAll('[data-act="add-row"]').forEach((b) => b.addEventListener('click', () => grids[b.dataset.grid].addRow()));

  function updateLabels() {
    const u = U().len;
    grids.tr.setLabel('dist', `Distance (${u})`);
    grids.tr.setLabel('lat', `Latitude (${u}, +N / −S)`);
    grids.tr.setLabel('dep', `Departure (${u}, +E / −W)`);
    grids.ms.setLabel('dist', `Distance (${u}) — blank or ? if unknown`);
    grids.rd.setLabel('dist', `Horizontal distance (${u})`);
  }

  // =====================================================================
  // TRAVERSE
  // =====================================================================
  function trModeChanged() {
    const mode = $('tr-mode').value, dt = $('tr-dirtype').value;
    document.querySelectorAll('#tab-traverse .dist-only').forEach((el) => { el.style.display = mode === 'distdir' ? '' : 'none'; });
    document.querySelectorAll('#tab-traverse .angles-only').forEach((el) => { el.style.display = mode === 'distdir' && dt === 'angles' ? '' : 'none'; });
    if (mode === 'latdep') grids.tr.setHidden(['dist', 'dir', 'angle']);
    else if (dt === 'angles') grids.tr.setHidden(['dir', 'lat', 'dep']);
    else grids.tr.setHidden(['angle', 'lat', 'dep']);
    $('tr-hint').textContent = mode === 'latdep'
      ? 'Enter the latitude (north +, south −) and departure (east +, west −) of each course. Distances and bearings are computed.'
      : dt === 'angles'
        ? 'Each row is a station and the course leaving it. Enter the interior angle measured at that station and the distance to the next station. The first course direction orients the traverse.'
        : 'Each row is the course from that station to the next one (the last course closes back to the first station). Directions may be bearings (N 45-30-00 E) or azimuths (45-30-00).';
  }
  $('tr-mode').addEventListener('change', trModeChanged);
  $('tr-dirtype').addEventListener('change', trModeChanged);

  function runTraverse() {
    const res = S.computeTraverse({
      mode: $('tr-mode').value,
      dirType: $('tr-dirtype').value,
      turn: $('tr-turn').value,
      startDir: $('tr-startdir').value,
      method: $('tr-method').value,
      startN: $('tr-n').value, startE: $('tr-e').value,
      requiredPrecision: $('tr-req').value,
      courses: grids.tr.getRows(),
    });
    const out = $('tr-out');
    rerun.traverse = runTraverse;
    if (res.errors.length) { out.innerHTML = UI.messages(res.errors); redraw.traverse = null; return; }
    const u = U();
    const latdep = $('tr-mode').value === 'latdep';
    const computed = latdep ? 'solved' : '';
    let h = '';

    const warns = res.warnings.slice();
    if (res.blunderHint) warns.push(res.blunderHint);
    if (!res.meetsPrecision && res.angleInfo && res.precision < 500) warns.push('Very poor closure — confirm the traverse direction (clockwise / counter-clockwise) and that the angles are interior angles.');
    h += UI.messages([], warns);

    h += '<div class="summary">' +
      UI.stat('Perimeter', `${S.fmtGroup(res.perimeter, ld())} ${u.len}`) +
      UI.stat('Σ Latitude', `${Ls(res.sumLat)} ${u.len}`) +
      UI.stat('Σ Departure', `${Ls(res.sumDep)} ${u.len}`) +
      UI.stat('Linear misclosure', `${L(res.linear)} ${u.len}`, res.linear > 0 ? `direction ${brg(res.misAz)}` : '') +
      UI.stat('Precision', S.precisionText(res.precision), `required 1:${Math.round(res.required).toLocaleString()} — ${res.meetsPrecision ? 'meets' : 'does NOT meet'}`, res.meetsPrecision ? 'good' : 'bad') +
      UI.stat('Area (coordinates)', `${S.fmtGroup(res.area, 2)} ${u.area}`, `${S.fmtGroup(res.area / u.bigFactor, 4)} ${u.bigName}`) +
      UI.stat('Area (DMD check)', `${S.fmtGroup(res.dmdArea, 2)} ${u.area}`) +
      UI.stat('Adjustment', { compass: 'Compass rule', transit: 'Transit rule', none: 'None' }[res.method], res.ccw ? 'figure runs counter-clockwise' : 'figure runs clockwise') +
      '</div>';

    const legend = '<div class="legend"><span><span class="swatch corr"></span>Correction applied</span>' + (latdep ? '<span><span class="swatch solved"></span>Computed from lat/dep</span>' : '') + '</div>';

    if (res.angleInfo) {
      const ai = res.angleInfo;
      const rows = res.rows.map((r) => [
        { v: r.station, cls: 'txt' }, dms(r.angleObs), { v: S.formatSeconds(r.angleCorr, 1), cls: 'corr' }, S.formatDMS(r.angleAdj, 1), azs(r.az), brg(r.az), `${r.station}–${r.to}`,
      ]);
      rows.push({ cls: 'total', cells: [{ v: 'Σ', cls: 'txt' }, S.formatDMS(ai.sum, 1), { v: S.formatSeconds(-ai.misclosure, 1), cls: 'corr' }, S.formatDMS(ai.expected, 1), '', '', ''] });
      h += UI.block('Angle balance', UI.messages([], [], [
        `Sum of interior angles = ${S.formatDMS(ai.sum, 1)}; required (n − 2)·180° = ${ai.expected}°00'00". Angular misclosure ${S.formatSeconds(ai.misclosure, 1)} → correction ${S.formatSeconds(ai.corrPerAngle, 2)} per angle. Closing check on the first course: ${azs(ai.closingAz)} vs ${azs(ai.startAz)}.`,
      ]) + UI.table(['Station', 'Observed ∠', 'Correction', 'Balanced ∠', 'Azimuth of course', 'Bearing of course', 'Course'], rows), { csv: 'angle-balance', legend });
    }

    const tRows = res.rows.map((r) => [
      { v: `${r.station}–${r.to}`, cls: 'txt' },
      { v: brg(r.az), cls: computed }, { v: azs(r.az), cls: computed }, { v: L(r.dist), cls: computed },
      { v: Ls(r.lat), cls: latdep ? '' : '' }, Ls(r.dep),
      { v: Ls(r.cLat), cls: 'corr' }, { v: Ls(r.cDep), cls: 'corr' },
      Ls(r.adjLat), Ls(r.adjDep),
    ]);
    tRows.push({ cls: 'total', cells: [{ v: 'Σ', cls: 'txt' }, '', '', L(res.perimeter), Ls(res.sumLat), Ls(res.sumDep),
      { v: Ls(-res.sumLat), cls: 'corr' }, { v: Ls(-res.sumDep), cls: 'corr' },
      Ls(res.rows.reduce((s, r) => s + r.adjLat, 0)), Ls(res.rows.reduce((s, r) => s + r.adjDep, 0))] });
    h += UI.block('Latitudes, departures &amp; corrections', UI.table(
      ['Course', 'Bearing', 'Azimuth', `Distance (${u.len})`, 'Latitude', 'Departure', 'Corr. Lat', 'Corr. Dep', 'Adj. Lat', 'Adj. Dep'], tRows), { csv: 'traverse-latdep', legend });

    const cRows = res.rows.map((r) => [
      { v: `${r.station}–${r.to}`, cls: 'txt' }, brg(r.adjAz), azs(r.adjAz), L(r.adjDist),
      { v: Ls(r.dDist), cls: Math.abs(r.dDist) > 0.5 * Math.pow(10, -ld()) ? 'corr' : '' },
      { v: S.formatSeconds(r.dAz, 1), cls: Math.abs(r.dAz * 3600) >= 0.05 ? 'corr' : '' },
      { v: r.station, cls: 'txt' }, S.fmt(r.N, ld()), S.fmt(r.E, ld()), dms(r.interior),
    ]);
    h += UI.block('Adjusted courses &amp; coordinates', UI.table(
      ['Course', 'Adj. bearing', 'Adj. azimuth', `Adj. distance (${u.len})`, 'Δ Dist', 'Δ Dir', 'Station', 'Northing', 'Easting', 'Interior ∠ (adjusted)'], cRows), { csv: 'traverse-coordinates', legend });

    const dRows = res.rows.map((r) => [{ v: `${r.station}–${r.to}`, cls: 'txt' }, Ls(r.adjLat), Ls(r.adjDep), Ls(r.dmd), S.fmtGroup(r.dblArea, 2)]);
    const dbl = res.rows.reduce((s, r) => s + r.dblArea, 0);
    dRows.push({ cls: 'total', cells: [{ v: 'Σ', cls: 'txt' }, '', '', '', S.fmtGroup(dbl, 2)] });
    h += '<div class="two-col">' +
      UI.block('Area by DMD', UI.table(['Course', 'Adj. Lat', 'Adj. Dep', 'DMD', 'Double area'], dRows) +
        `<p class="hint">Area = |Σ double area| ÷ 2 = <strong>${S.areaText(res.dmdArea, units())}</strong></p>`, { csv: 'traverse-dmd' }) +
      UI.block('Sketch', '<div class="legend"><span><span class="swatch" style="background:var(--plot-raw)"></span>Unadjusted (shows misclosure)</span><span><span class="swatch" style="background:var(--plot-line)"></span>Adjusted</span></div><canvas class="plot" id="tr-canvas"></canvas>') +
      '</div>';
    out.innerHTML = h;

    redraw.traverse = () => UI.drawPlan($('tr-canvas'), [
      { pts: res.rawPts, color: UI.cssVar('--plot-raw'), dash: [6, 4], width: 1.5, dotSize: 2.5 },
      { pts: res.adjPts.slice(0, -1), closed: true, labels: true, fill: 'rgba(31,111,92,0.08)' },
    ], { units: u.len });
    redraw.traverse();
  }
  $('tr-run').addEventListener('click', runTraverse);
  $('tr-example').addEventListener('click', () => {
    const mode = $('tr-mode').value, dt = $('tr-dirtype').value;
    if (mode === 'latdep') grids.tr.setRows(S.samples.traverseLatDep);
    else if (dt === 'angles') {
      grids.tr.setRows(S.samples.traverseAngles.courses);
      $('tr-startdir').value = S.samples.traverseAngles.startDir;
      $('tr-turn').value = 'cw';
    } else grids.tr.setRows(S.samples.traverseDirections);
    runTraverse();
  });
  $('tr-clear').addEventListener('click', () => { grids.tr.setRows([]); $('tr-out').innerHTML = ''; rerun.traverse = null; });

  // =====================================================================
  // MISSING DATA
  // =====================================================================
  function runMissing() {
    const res = S.computeMissing({ courses: grids.ms.getRows(), startN: $('ms-n').value, startE: $('ms-e').value });
    const out = $('ms-out');
    rerun.missing = runMissing;
    if (res.errors.length) { out.innerHTML = UI.messages(res.errors); redraw.missing = null; return; }
    const u = U();
    let h = UI.messages([], [], [
      `${res.caseName}. The known courses leave a closing vector of ${L(res.closing.dist)} ${u.len} at ${brg(res.closing.az)} (Lat ${Ls(res.closing.lat)}, Dep ${Ls(res.closing.dep)}).` +
      (res.solutions.length > 1 ? ' Two geometric solutions exist — choose the one that matches the field sketch.' : ''),
    ]);
    const legend = '<div class="legend"><span><span class="swatch solved"></span>Solved value</span></div>';
    res.solutions.forEach((sol, k) => {
      const title = res.solutions.length > 1 ? `Solution ${k + 1}` : 'Solution';
      const rows = sol.rows.map((r) => [
        { v: `${r.station}–${r.to}`, cls: 'txt' },
        { v: brg(r.az), cls: r.solvedDir ? 'solved' : '' }, { v: azs(r.az), cls: r.solvedDir ? 'solved' : '' },
        { v: L(r.dist), cls: r.solvedDist ? 'solved' : '' },
        Ls(r.lat), Ls(r.dep), { v: r.station, cls: 'txt' }, S.fmt(r.N, ld()), S.fmt(r.E, ld()), dms(r.interior),
      ]);
      rows.push({ cls: 'total', cells: [{ v: 'Σ', cls: 'txt' }, '', '', L(sol.perimeter), Ls(sol.rows.reduce((s, r) => s + r.lat, 0)), Ls(sol.rows.reduce((s, r) => s + r.dep, 0)), '', '', '', ''] });
      h += UI.block(title,
        '<div class="summary">' + UI.stat('Area', `${S.fmtGroup(sol.area, 2)} ${u.area}`, `${S.fmtGroup(sol.area / u.bigFactor, 4)} ${u.bigName}`) + UI.stat('Perimeter', `${S.fmtGroup(sol.perimeter, ld())} ${u.len}`) + '</div>' +
        (sol.area < 1e-6 * sol.perimeter * sol.perimeter ? UI.messages([], ['This solution folds back on itself (zero area) — it is not a valid parcel.'])
          : sol.crosses ? UI.messages([], ['This solution makes the boundary cross itself — it is probably not the intended figure.']) : '') +
        '<div class="two-col"><div>' + UI.table(['Course', 'Bearing', 'Azimuth', `Distance (${u.len})`, 'Latitude', 'Departure', 'Station', 'Northing', 'Easting', 'Interior ∠'], rows) +
        `</div><canvas class="plot" id="ms-canvas-${k}"></canvas></div>`, { csv: `missing-solution-${k + 1}`, legend });
    });
    out.innerHTML = h;
    redraw.missing = () => res.solutions.forEach((sol, k) => {
      const solvedIdx = sol.rows.map((r, i) => (r.solvedDist || r.solvedDir ? i : -1)).filter((i) => i >= 0);
      UI.drawPlan($(`ms-canvas-${k}`), [
        { pts: sol.pts.slice(0, -1), closed: true, labels: true, fill: 'rgba(31,111,92,0.08)' },
        ...solvedIdx.map((i) => ({ pts: [sol.pts[i], sol.pts[i + 1]], color: '#2f7fd8', width: 4, dots: false })),
      ], { units: u.len });
    });
    redraw.missing();
  }
  $('ms-run').addEventListener('click', runMissing);
  $('ms-example').addEventListener('click', () => { grids.ms.setRows(S.samples.missing); runMissing(); });
  $('ms-clear').addEventListener('click', () => { grids.ms.setRows([]); $('ms-out').innerHTML = ''; rerun.missing = null; });

  // =====================================================================
  // RADIATION
  // =====================================================================
  function rdRefChanged() {
    const angle = $('rd-ref').value === 'angle';
    document.querySelector('#tab-radiation .rd-bs').style.display = angle ? '' : 'none';
    grids.rd.setLabel('dir', angle ? 'Angle right from backsight' : 'Azimuth or bearing');
  }
  $('rd-ref').addEventListener('change', rdRefChanged);

  function runRadiation() {
    const res = S.computeRadiation({
      stationName: $('rd-name').value, N: $('rd-n').value, E: $('rd-e').value,
      refMode: $('rd-ref').value, backsightDir: $('rd-bs').value,
      includeStation: $('rd-incl').checked,
      points: grids.rd.getRows(),
    });
    const out = $('rd-out');
    rerun.radiation = runRadiation;
    if (res.errors.length) { out.innerHTML = UI.messages(res.errors); redraw.radiation = null; return; }
    const u = U();
    const angle = $('rd-ref').value === 'angle';
    let h = '';
    if (res.poly) {
      h += '<div class="summary">' +
        UI.stat('Area', `${S.fmtGroup(res.poly.area, 2)} ${u.area}`, `${S.fmtGroup(res.poly.area / u.bigFactor, 4)} ${u.bigName}`) +
        UI.stat('Perimeter', `${S.fmtGroup(res.poly.perimeter, ld())} ${u.len}`) +
        UI.stat('Corners', String(res.verts.length)) +
        UI.stat('Occupied station', res.station.name, `N ${S.fmt(res.station.n, ld())}  E ${S.fmt(res.station.e, ld())}`) +
        '</div>';
    }
    const pRows = res.pts.map((p) => [{ v: p.name, cls: 'txt' }, angle ? dms(p.angle) : '—', azs(p.az), brg(p.az), L(p.dist), Ls(p.lat), Ls(p.dep), S.fmt(p.n, ld()), S.fmt(p.e, ld())]);
    h += UI.block('Radiated points', UI.table(['Point', 'Angle right', 'Azimuth', 'Bearing', `Distance (${u.len})`, 'Latitude', 'Departure', 'Northing', 'Easting'], pRows), { csv: 'radiation-points' });
    const cRows = res.courses.map((c, i) => [{ v: `${c.from}–${c.to}`, cls: 'txt' }, { v: brg(c.az), cls: 'solved' }, { v: azs(c.az), cls: 'solved' }, { v: L(c.dist), cls: 'solved' }, Ls(c.lat), Ls(c.dep), res.verts[i].interior !== undefined ? dms(res.verts[i].interior) : '—']);
    cRows.push({ cls: 'total', cells: [{ v: 'Σ', cls: 'txt' }, '', '', L(res.courses.reduce((s, c) => s + c.dist, 0)), Ls(res.courses.reduce((s, c) => s + c.lat, 0)), Ls(res.courses.reduce((s, c) => s + c.dep, 0)), res.poly ? dms(res.poly.interior.reduce((s, a) => s + a, 0)) : ''] });
    h += '<div class="two-col">' + UI.block('Boundary courses (computed between radiated points)', UI.table(['Course', 'Bearing', 'Azimuth', `Distance (${u.len})`, 'Latitude', 'Departure', 'Interior ∠ at start'], cRows), { csv: 'radiation-courses', legend: '<div class="legend"><span><span class="swatch solved"></span>Computed (inversed) value</span></div>' }) +
      UI.block('Sketch', '<canvas class="plot" id="rd-canvas"></canvas>') + '</div>';
    if (res.wedges) {
      const wRows = res.wedges.map((w) => [{ v: `${res.station.name} / ${w.from}–${w.to}`, cls: 'txt' }, S.formatDMS(w.theta, sd()), S.fmtGroup(w.area, 2)]);
      wRows.push({ cls: 'total', cells: [{ v: 'Σ', cls: 'txt' }, '', S.fmtGroup(res.wedges.reduce((s, w) => s + w.area, 0), 2)] });
      h += UI.block('Area by radial triangles (½·d₁·d₂·sin θ)', UI.table(['Triangle', 'Angle θ', `Area (${u.area})`], wRows) + '<p class="hint">Signed sum — equals the coordinate area when the rays are entered in order around the station.</p>', { csv: 'radiation-triangles' });
    }
    out.innerHTML = h;
    redraw.radiation = () => {
      const stPt = { n: res.station.n, e: res.station.e, label: res.station.name };
      UI.drawPlan($('rd-canvas'), [
        ...res.pts.map((p) => ({ pts: [stPt, { n: p.n, e: p.e }], color: UI.cssVar('--muted'), dash: [4, 4], width: 1, dots: false })),
        { pts: res.verts.map((v) => ({ n: v.n, e: v.e, label: v.name })), closed: res.verts.length >= 3, labels: true, fill: 'rgba(31,111,92,0.08)' },
        { pts: [stPt], color: UI.cssVar('--plot-raw'), dotSize: 5, labels: !$('rd-incl').checked, line: false },
      ], { units: u.len });
    };
    redraw.radiation();
  }
  $('rd-run').addEventListener('click', runRadiation);
  $('rd-example').addEventListener('click', () => {
    const s = S.samples.radiation;
    $('rd-name').value = s.stationName; $('rd-n').value = s.N; $('rd-e').value = s.E; $('rd-bs').value = s.backsightDir;
    $('rd-ref').value = 'angle'; rdRefChanged();
    grids.rd.setRows(s.points);
    runRadiation();
  });
  $('rd-clear').addEventListener('click', () => { grids.rd.setRows([]); $('rd-out').innerHTML = ''; rerun.radiation = null; });

  // =====================================================================
  // HORIZONTAL CURVE
  // =====================================================================
  function hcByChanged() {
    const byR = $('hc-by').value === 'R';
    document.querySelector('#tab-hcurve .hc-D').style.display = byR ? 'none' : '';
    document.querySelector('#tab-hcurve .hc-R').style.display = byR ? '' : 'none';
  }
  $('hc-by').addEventListener('change', hcByChanged);

  function runHCurve() {
    const res = S.computeHCurve({
      units: units(),
      delta: $('hc-delta').value, defineBy: $('hc-by').value, D: $('hc-D').value, R: $('hc-R').value,
      dDef: $('hc-ddef').value, baseLen: $('hc-base').value,
      staType: $('hc-statype').value, sta: $('hc-sta').value, interval: $('hc-int').value,
      turn: $('hc-turn').value, piN: $('hc-pin').value, piE: $('hc-pie').value, backAz: $('hc-baz').value,
    });
    const out = $('hc-out');
    rerun.hcurve = runHCurve;
    if (res.errors.length) { out.innerHTML = UI.messages(res.errors); redraw.hcurve = null; return; }
    const u = U();
    let h = '<div class="summary">' +
      UI.stat('Intersection angle Δ', dms(res.delta), `curve to the ${res.turn}`) +
      UI.stat('Radius R', `${L(res.R)} ${u.len}`) +
      UI.stat(`Degree of curvature (${res.dDef})`, S.formatDMS(res.D, 2), `per ${res.base} ${u.len}`) +
      UI.stat('Tangent T', `${L(res.T)} ${u.len}`) +
      UI.stat('Length of curve L', `${L(res.L)} ${u.len}`, res.dDef === 'chord' ? `true arc ${L(res.Larc)}` : '') +
      UI.stat('Long chord LC', `${L(res.LC)} ${u.len}`) +
      UI.stat('External E', `${L(res.E)} ${u.len}`) +
      UI.stat('Middle ordinate M', `${L(res.M)} ${u.len}`) +
      UI.stat('PC station', sta(res.PC)) +
      UI.stat('PI station', sta(res.PI)) +
      UI.stat('PT station', sta(res.PT)) +
      (res.hasCoords ? UI.stat('Ahead tangent', brg(res.aheadAz), `PT N ${S.fmt(res.pt.n, ld())} E ${S.fmt(res.pt.e, ld())}`) : '') +
      '</div>';
    const head = ['Station', 'Point', `Arc from PC (${u.len})`, 'Deflection from PC', `Chord from PC (${u.len})`, `Incr. arc`, `Incr. chord`, 'Central ∠ θ', `Tangent x`, `Tangent offset y`];
    if (res.hasCoords) head.push('Northing', 'Easting');
    const rows = res.points.map((p) => {
      const r = [{ v: sta(p.sta), cls: 'txt' }, { v: p.label, cls: 'txt' }, L(p.along), S.formatDMS(p.defl, Math.max(1, sd())), L(p.chordPC), L(p.incArc), L(p.incChord), dms(p.theta), L(p.tanX), L(p.tanY)];
      if (res.hasCoords) r.push(S.fmt(p.n, ld()), S.fmt(p.e, ld()));
      return p.label ? { cls: 'key', cells: r } : r;
    });
    h += UI.block(`Stakeout table — every ${res.interval} ${u.len}`, UI.table(head, rows) +
      `<p class="hint">Deflection angles are turned from the back tangent at the PC (toward the ${res.turn}); total deflection at the PT = Δ/2 = ${S.formatDMS(res.delta / 2, 1)}. Tangent offsets are measured along (x) and perpendicular to (y) the back tangent from the PC.</p>`, { csv: 'horizontal-curve' });
    h += UI.block('Sketch', '<canvas class="plot" id="hc-canvas"></canvas>' + (res.hasCoords ? '' : '<p class="hint">No PI coordinates given — sketch drawn in a local frame with the back tangent running east.</p>'));
    out.innerHTML = h;

    redraw.hcurve = () => {
      const sign = res.turn === 'right' ? 1 : -1;
      const azCtoPC = S.normAz(res.backAz - sign * 90);
      const arc = [];
      for (let i = 0; i <= 120; i++) {
        const a = S.normAz(azCtoPC + sign * res.delta * i / 120);
        const v = S.latDep(res.R, a);
        arc.push({ n: res.center.n + v.lat, e: res.center.e + v.dep });
      }
      const tan = [{ ...res.pc, label: 'PC' }, { ...res.pi, label: 'PI' }, { ...res.pt, label: 'PT' }];
      const stakes = res.points.filter((p) => !p.label).map((p) => ({ n: p.n, e: p.e }));
      const ext = res.T * 0.35;
      const b = S.latDep(ext, res.backAz), f = S.latDep(ext, res.aheadAz);
      const tanLine = [{ n: res.pc.n - b.lat, e: res.pc.e - b.dep }, res.pi, { n: res.pt.n + f.lat, e: res.pt.e + f.dep }];
      UI.drawPlan($('hc-canvas'), [
        { pts: tanLine, color: UI.cssVar('--muted'), dash: [6, 4], width: 1.2, dots: false },
        { pts: [res.pc, res.pt], color: UI.cssVar('--muted'), width: 1, dash: [2, 3], dots: false },
        { pts: arc, width: 2.5, dots: false },
        { pts: stakes, line: false, dotSize: 3, dotColor: UI.cssVar('--plot-raw') },
        { pts: tan, line: false, labels: true, dotSize: 4 },
      ], { units: u.len });
    };
    redraw.hcurve();
  }
  $('hc-run').addEventListener('click', runHCurve);
  $('hc-example').addEventListener('click', () => {
    const s = S.samples.hcurve;
    $('hc-delta').value = s.delta; $('hc-by').value = s.defineBy; $('hc-D').value = s.D; $('hc-R').value = s.R;
    $('hc-ddef').value = s.dDef; $('hc-base').value = s.baseLen; $('hc-statype').value = s.staType; $('hc-sta').value = s.sta;
    $('hc-int').value = s.interval; $('hc-turn').value = s.turn; $('hc-pin').value = s.piN; $('hc-pie').value = s.piE; $('hc-baz').value = s.backAz;
    hcByChanged();
    runHCurve();
  });

  // =====================================================================
  // VERTICAL CURVE
  // =====================================================================
  function runVCurve() {
    const res = S.computeVCurve({
      units: units(), pviSta: $('vc-sta').value, pviElev: $('vc-elev').value, L: $('vc-L').value,
      g1: $('vc-g1').value, g2: $('vc-g2').value, interval: $('vc-int').value, lookupSta: $('vc-look').value,
    });
    const out = $('vc-out');
    rerun.vcurve = runVCurve;
    if (res.errors.length) { out.innerHTML = UI.messages(res.errors); redraw.vcurve = null; return; }
    const u = U();
    const e3 = (v) => S.fmt(v, 3);
    let h = '';
    if (res.lookup) {
      h += UI.messages([], [], [`Station ${sta(res.lookup.sta)} is ${res.lookup.where}: elevation ${e3(res.lookup.elev)}, grade ${S.fmtSigned(res.lookup.grade, 3)}%.`]);
    }
    h += '<div class="summary">' +
      UI.stat('Curve type', res.type, `A = ${S.fmtSigned(res.A, 3)}%`) +
      UI.stat('BVC', sta(res.bvc), `elev ${e3(res.bvcElev)}`) +
      UI.stat('PVI', sta(res.pvi), `elev ${e3(res.pviElev)}`) +
      UI.stat('EVC', sta(res.evc), `elev ${e3(res.evcElev)}`) +
      UI.stat('K value', isFinite(res.K) ? S.fmt(res.K, 2) : '—', `${u.len} per % of A`) +
      UI.stat('Rate of grade change r', `${S.fmtSigned(res.r * 100, 4)} %/sta`, units() === 'm' ? '(per 100 m)' : '(per 100 ft)') +
      UI.stat('Middle offset e', `${S.fmtSigned(res.A * res.L / 800, 3)} ${u.len}`, 'curve − PVI at PVI') +
      (res.turning ? UI.stat(res.turning.kind, sta(res.turning.sta), `elev ${e3(res.turning.elev)}, x = ${L(res.turning.x)}`) : UI.stat('High / low point', 'Not on curve', 'grades have the same sign')) +
      '</div>';
    const rows = res.points.map((p) => {
      const r = [{ v: sta(p.sta), cls: 'txt' }, { v: p.label, cls: 'txt' }, L(p.x), e3(p.tangent), { v: S.fmtSigned(p.offset, 3), cls: 'corr' }, e3(p.elev), S.fmtSigned(p.grade, 3), p.d1 === undefined ? '' : S.fmtSigned(p.d1, 3)];
      return p.label ? { cls: 'key', cells: r } : r;
    });
    h += UI.block(`Vertical curve elevations — every ${res.interval} ${u.len}`,
      UI.table(['Station', 'Point', `x from BVC (${u.len})`, 'Tangent elev.', 'Tangent offset', 'Curve elev.', 'Grade (%)', 'Δ elev.'], rows) +
      '<p class="hint">Tangent elevation is on the back tangent before the PVI and on the forward tangent after it. Offsets are curve − tangent: A·x² / 200L measured from the BVC before the PVI, and A·(L − x)² / 200L measured from the EVC after it.</p>',
      { csv: 'vertical-curve', legend: '<div class="legend"><span><span class="swatch corr"></span>Tangent offset (correction from tangent to curve)</span></div>' });
    h += UI.block('Profile', '<canvas class="plot" id="vc-canvas"></canvas>');
    out.innerHTML = h;

    redraw.vcurve = () => {
      const ext = res.L * 0.15;
      const tangents = [
        { x: res.bvc - ext, y: res.bvcElev - res.g1 / 100 * ext },
        { x: res.pvi, y: res.pviElev },
        { x: res.evc + ext, y: res.evcElev + res.g2 / 100 * ext },
      ];
      const curve = [];
      for (let i = 0; i <= 100; i++) { const x = res.L * i / 100; curve.push({ x: res.bvc + x, y: res.elevAt(x) }); }
      const marks = res.points.map((p) => ({ x: p.sta, y: p.elev, label: p.label ? p.label.split(' / ')[0] : '' }));
      UI.drawProfile($('vc-canvas'), [
        { pts: tangents, color: UI.cssVar('--muted'), dash: [6, 4], width: 1.2 },
        { pts: curve, color: UI.cssVar('--plot-line'), width: 2.5 },
        { pts: marks, color: UI.cssVar('--plot-raw'), line: false, dots: true, labels: true },
        { pts: [{ x: res.pvi, y: res.pviElev, label: 'PVI' }], color: UI.cssVar('--muted'), line: false, dots: true, labels: true },
      ], { xFmt: (x) => sta(x).replace(/\.0+$/, ''), xStep: UI.niceStep(res.L / 4) });
    };
    redraw.vcurve();
  }
  $('vc-run').addEventListener('click', runVCurve);
  $('vc-example').addEventListener('click', () => {
    const s = S.samples.vcurve;
    $('vc-sta').value = s.pviSta; $('vc-elev').value = s.pviElev; $('vc-L').value = s.L;
    $('vc-g1').value = s.g1; $('vc-g2').value = s.g2; $('vc-int').value = s.interval; $('vc-look').value = s.lookupSta;
    runVCurve();
  });

  // =====================================================================
  // TOPO
  // =====================================================================
  let topoMap = null;
  let topoData = null;
  const layerState = { shade: true, slope: false, tin: false, contours: true, points: true, ids: false, elevs: false };

  $('tp-file').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      $('tp-text').value = reader.result;
      const ext = f.name.toLowerCase().split('.').pop();
      if (ext === 'xml' || ext === 'landxml') $('tp-format').value = 'landxml';
      else if (ext === 'json' || ext === 'geojson') $('tp-format').value = 'geojson';
      runTopo();
    };
    reader.readAsText(f);
  });

  function runTopo() {
    const out = $('tp-out');
    rerun.topo = runTopo;
    const parsed = S.parseTopo($('tp-text').value, $('tp-format').value);
    if (!parsed.points.length) { out.innerHTML = UI.messages(['No points could be read. ' + parsed.warnings.join(' ')]); redraw.topo = null; return; }
    const an = S.analyzeTopo(parsed.points, { maxEdge: $('tp-maxedge').value, refElev: $('tp-ref').value });
    const ci = S.parseNumber($('tp-ci').value);
    const idx = S.parseNumber($('tp-idx').value) || 0;
    an.contourLines = ci > 0 && an.tris.length ? S.contours(an.points, an.tris, ci, idx, an.stats.minZ, an.stats.maxZ) : [];
    if (ci > 0 && (an.stats.relief / ci) > 1500) an.warnings.push(`Contour interval ${ci} gives ${Math.round(an.stats.relief / ci)} levels — only the first 2000 are drawn. Use a larger interval.`);
    topoData = an;
    const u = U(), s = an.stats;

    const warns = parsed.warnings.concat(an.warnings);
    if (an.dupIds.length) warns.push(`Duplicate point numbers: ${[...new Set(an.dupIds)].slice(0, 20).join(', ')}${an.dupIds.length > 20 ? '…' : ''}.`);
    if (an.coincident.length) warns.push(`${an.coincident.length} point(s) share N/E with an earlier point and were left out of the surface (e.g. ${an.coincident.slice(0, 5).map((c) => `${c.drop.id} = ${c.keep.id}, ΔZ ${S.fmtSigned(c.dz, 2)}`).join('; ')}).`);
    if (an.spikes.length) warns.push(`${an.spikes.length} possible spike(s) / bust(s) found — highlighted in red on the map and listed below.`);

    let h = UI.messages([], warns, [`Read ${s.count} points as ${parsed.format}${parsed.delimiter ? ` (${parsed.delimiter} delimited)` : ''}. ${s.triangles} triangles in the surface${s.trimmed ? ` (${s.trimmed} long triangles removed)` : ''}.`]);
    h += '<div class="summary">' +
      UI.stat('Points', String(s.count), `${s.used} used in surface`) +
      UI.stat('Elevation range', `${S.fmt(s.minZ, 2)} – ${S.fmt(s.maxZ, 2)}`, `relief ${S.fmt(s.relief, 2)} ${u.len}`) +
      UI.stat('Mean elevation', S.fmt(s.meanZ, 2), `σ ${S.fmt(s.sdZ, 2)}`) +
      UI.stat('High point', s.highPt ? `Pt ${s.highPt.id}` : '—', s.highPt ? `Z ${S.fmt(s.highPt.z, 2)}` : '') +
      UI.stat('Low point', s.lowPt ? `Pt ${s.lowPt.id}` : '—', s.lowPt ? `Z ${S.fmt(s.lowPt.z, 2)}` : '') +
      UI.stat('Extents', `${S.fmt(s.maxE - s.minE, 1)} × ${S.fmt(s.maxN - s.minN, 1)}`, `E × N ${u.len}`) +
      UI.stat('Plan area (TIN)', `${S.fmtGroup(s.area2d, 0)} ${u.area}`, `${S.fmtGroup(s.area2d / u.bigFactor, 3)} ${u.bigName}`) +
      UI.stat('Surface area (3D)', `${S.fmtGroup(s.area3d, 0)} ${u.area}`) +
      UI.stat('Slope', `${S.fmt(s.slopeMean, 1)}% avg`, `95% of area ≤ ${S.fmt(s.slopeP95, 1)}%`) +
      '</div>';

    const toggles = [
      ['shade', 'Elevation shading'], ['slope', 'Slope shading'], ['tin', 'TIN'], ['contours', 'Contours'],
      ['points', 'Points'], ['ids', 'Point numbers'], ['elevs', 'Elevations'],
    ].map(([k, label]) => `<label><input type="checkbox" data-layer="${k}" ${layerState[k] ? 'checked' : ''}> ${label}</label>`).join('');
    h += UI.block('Map',
      `<div class="layer-toggles">${toggles}</div>` +
      '<canvas class="plot tall" id="tp-canvas"></canvas>' +
      `<div class="colorbar"><span>${S.fmt(s.minZ, 1)}</span><span class="bar" style="background:${UI.rampCSS()}"></span><span>${S.fmt(s.maxZ, 1)}</span><span style="margin-left:auto">Scroll to zoom · drag to pan · double-click to fit · hover for values</span></div>` +
      '<div class="btn-row"><button class="btn small" id="tp-png">Export map PNG</button><button class="btn small" id="tp-dxf">Export contours + points DXF</button><button class="btn small" id="tp-csv">Export cleaned points CSV</button></div>');

    if (an.volume) {
      const v = an.volume;
      const cy = (x) => (u.vol2 ? ` (${S.fmtGroup(x / u.vol2Factor, 1)} ${u.vol2})` : '');
      h += UI.block(`Volumes relative to elevation ${S.fmt(v.ref, 2)}`, '<div class="summary">' +
        UI.stat('Above reference (cut)', `${S.fmtGroup(v.above, 1)} ${u.vol}`, cy(v.above)) +
        UI.stat('Below reference (fill)', `${S.fmtGroup(v.below, 1)} ${u.vol}`, cy(v.below)) +
        UI.stat('Net', `${S.fmtGroup(v.net, 1)} ${u.vol}`, cy(v.net)) + '</div><p class="hint">Computed from TIN prisms within the surface boundary; triangles crossing the reference elevation are split exactly.</p>');
    }

    let side = '';
    if (an.spikes.length) {
      side += UI.block('Possible spikes / busts', UI.table(['Point', 'Desc', 'Elev.', 'Predicted from neighbours', 'Residual', 'Robust z'],
        an.spikes.slice(0, 50).map((sp) => [{ v: sp.p.id, cls: 'txt' }, { v: sp.p.desc, cls: 'txt' }, S.fmt(sp.p.z, 2), S.fmt(sp.p.z - sp.resid, 2), { v: S.fmtSigned(sp.resid, 2), cls: 'flag' }, S.fmt(sp.rz, 1)])) +
        '<p class="hint">Check rod heights, descriptions and field notes for these shots before using the surface.</p>', { csv: 'topo-spikes' });
    }
    side += UI.block('Description codes', UI.table(['Code', 'Count'], s.codes.slice(0, 40).map(([c, n]) => [{ v: c, cls: 'txt' }, String(n)])), { csv: 'topo-codes' });
    const bins = slopeBins(an);
    side += UI.block('Slope distribution (by plan area)', UI.table(['Slope', `Area (${u.area})`, '% of site'], bins.map((b) => [{ v: b.label, cls: 'txt' }, S.fmtGroup(b.area, 0), S.fmt(b.pct, 1)])), { csv: 'topo-slopes' });
    h += `<div class="two-col"><div>${side}</div><div>` +
      UI.block('Points (first 500)', UI.table(['Point', 'Northing', 'Easting', 'Elev.', 'Desc'],
        parsed.points.slice(0, 500).map((p) => {
          const cls = p.spike ? 'flag' : p.excluded ? 'corr' : '';
          return [{ v: p.id, cls: 'txt ' + cls }, S.fmt(p.n, 3), S.fmt(p.e, 3), { v: S.fmt(p.z, 3), cls }, { v: p.desc, cls: 'txt' }];
        })), { csv: 'topo-points', legend: '<div class="legend"><span><span class="swatch flag"></span>Possible spike</span><span><span class="swatch corr"></span>Coincident (not in surface)</span></div>' }) +
      '</div></div>';
    out.innerHTML = h;

    topoMap = UI.TopoMap($('tp-canvas'), $('tooltip'));
    out.querySelectorAll('[data-layer]').forEach((cb) => cb.addEventListener('change', () => {
      layerState[cb.dataset.layer] = cb.checked;
      topoMap.setLayers({ ...layerState });
    }));
    $('tp-png').addEventListener('click', () => $('tp-canvas').toBlob((b) => UI.download('topo-map.png', b)));
    $('tp-dxf').addEventListener('click', () => UI.download('topo-contours.dxf', S.toDXF(an.points, an.contourLines), 'application/dxf'));
    $('tp-csv').addEventListener('click', () => {
      const lines = ['P,N,E,Z,D'].concat(an.points.filter((p) => !p.spike).map((p) => `${p.id},${p.n.toFixed(3)},${p.e.toFixed(3)},${p.z.toFixed(3)},${/[,"]/.test(p.desc) ? '"' + p.desc.replace(/"/g, '""') + '"' : p.desc}`));
      UI.download('topo-points-clean.csv', lines.join('\r\n'), 'text/csv');
    });
    redraw.topo = () => { if (!$('tp-canvas')) return; topoMap.setLayers({ ...layerState }); topoMap.setData(topoData, u.len); };
    redraw.topo();
  }

  function slopeBins(an) {
    const edges = [0, 2, 5, 10, 15, 25, 33.3, 50, Infinity];
    const labels = ['0–2%', '2–5%', '5–10%', '10–15%', '15–25%', '25–33% (3:1)', '33–50% (2:1)', '> 50%'];
    const area = new Array(labels.length).fill(0);
    let total = 0;
    an.tris.forEach(([a, b, c], i) => {
      const A = an.points[a], B = an.points[b], C = an.points[c];
      const ar = Math.abs((B.e - A.e) * (C.n - A.n) - (C.e - A.e) * (B.n - A.n)) / 2;
      const k = edges.findIndex((e, j) => an.slopes[i] >= e && an.slopes[i] < edges[j + 1]);
      if (k >= 0) area[k] += ar;
      total += ar;
    });
    return labels.map((label, i) => ({ label, area: area[i], pct: total ? area[i] / total * 100 : 0 })).filter((b) => b.area > 0);
  }

  $('tp-run').addEventListener('click', runTopo);
  $('tp-example').addEventListener('click', () => { $('tp-text').value = S.samples.topoText(); $('tp-format').value = 'auto'; $('tp-ref').value = '745'; runTopo(); });

  // ---------- init ----------
  trModeChanged();
  rdRefChanged();
  hcByChanged();
  updateLabels();
})();
