/*
 * Survey Toolkit — route curves
 *  - computeHCurve: simple circular horizontal curve + stakeout (deflection) table
 *  - computeVCurve: equal-tangent parabolic vertical curve + elevation table
 */
(function (root) {
  'use strict';
  const S = root.Survey;
  const RAD = S.RAD;

  /**
   * @param {object} inp
   *  delta: intersection angle Δ (DMS or decimal)
   *  defineBy: 'D' | 'R'
   *  D: degree of curvature, R: radius
   *  dDef: 'arc' | 'chord'   (degree-of-curvature definition)
   *  baseLen: length D is measured over (100 ft, or e.g. 20 / 100 m)
   *  staType: 'PI' | 'PC', sta: station of that point
   *  interval: stakeout interval (25 / 50 / 100 …)
   *  turn: 'right' | 'left'
   *  piN, piE, backAz: optional coordinates of the PI and back-tangent direction
   *  units: 'ft' | 'm'
   */
  function computeHCurve(inp) {
    const errors = [];
    const units = inp.units || 'ft';
    const delta = S.parseAngle(inp.delta);
    if (!(delta > 0 && delta < 180)) errors.push('Intersection angle Δ must be between 0° and 180°.');
    const base = S.parseNumber(inp.baseLen) || 100;
    const dDef = inp.dDef === 'chord' ? 'chord' : 'arc';
    let R, D;
    if (inp.defineBy === 'R') {
      R = S.parseNumber(inp.R);
      if (!(R > 0)) errors.push('Radius must be a positive number.');
      if (dDef === 'chord' && R <= base / 2) errors.push('For the chord definition the radius must exceed half the base length.');
      D = dDef === 'arc' ? (base / R) / RAD : 2 * Math.asin(base / (2 * R)) / RAD;
    } else {
      D = S.parseAngle(inp.D);
      if (!(D > 0 && D < 180)) errors.push('Degree of curvature must be a positive angle.');
      R = dDef === 'arc' ? base / (D * RAD) : (base / 2) / Math.sin(D * RAD / 2);
    }
    const sta = S.parseStation(inp.sta);
    if (!isFinite(sta)) errors.push('Enter a valid station (e.g. 12+34.56).');
    const interval = S.parseNumber(inp.interval) || 50;
    if (!(interval > 0)) errors.push('Station interval must be positive.');
    if (errors.length) return { errors };

    const half = delta * RAD / 2;
    const T = R * Math.tan(half);
    const L = base * delta / D; // arc def: equals R·Δ(rad); chord def: length along base-length chords
    const Larc = R * delta * RAD;
    const LC = 2 * R * Math.sin(half);
    const E = R * (1 / Math.cos(half) - 1);
    const M = R * (1 - Math.cos(half));
    const PI = inp.staType === 'PC' ? sta + T : sta;
    const PC = PI - T;
    const PT = PC + L;
    const sign = inp.turn === 'left' ? -1 : 1;

    // Optional coordinates.
    const piN = S.parseNumber(inp.piN), piE = S.parseNumber(inp.piE);
    const backAzIn = S.parseDirection(inp.backAz);
    const hasCoords = isFinite(piN) && isFinite(piE) && isFinite(backAzIn);
    const backAz = isFinite(backAzIn) ? backAzIn : 90;
    const pi = { n: hasCoords ? piN : 0, e: hasCoords ? piE : 0 };
    const back = S.latDep(T, backAz);
    const pc = { n: pi.n - back.lat, e: pi.e - back.dep };
    const aheadAz = S.normAz(backAz + sign * delta);
    const ahead = S.latDep(T, aheadAz);
    const pt = { n: pi.n + ahead.lat, e: pi.e + ahead.dep };
    const toCenter = S.latDep(R, S.normAz(backAz + sign * 90));
    const center = { n: pc.n + toCenter.lat, e: pc.e + toCenter.dep };

    // Stakeout stations.
    const stations = [{ sta: PC, label: 'PC' }];
    let s = Math.floor(PC / interval + 1e-9) * interval + interval;
    if (Math.abs(s - interval - PC) < 1e-6) s = PC + interval; // PC already on an even station
    for (; s < PT - 1e-6; s += interval) stations.push({ sta: s, label: '' });
    stations.push({ sta: PT, label: 'PT' });

    let prevDefl = 0, prevSta = PC;
    const points = stations.map((p) => {
      const along = p.sta - PC;
      const defl = along * D / (2 * base); // degrees
      const chordPC = 2 * R * Math.sin(defl * RAD);
      const incChord = 2 * R * Math.sin((defl - prevDefl) * RAD);
      const incArc = p.sta - prevSta;
      const theta = 2 * defl; // central angle from PC
      const tanX = R * Math.sin(theta * RAD);
      const tanY = R * (1 - Math.cos(theta * RAD));
      const az = S.normAz(backAz + sign * defl);
      const ld = S.latDep(chordPC, az);
      const row = {
        sta: p.sta, label: p.label, along, defl, chordPC, incChord, incArc, theta, tanX, tanY,
        az, n: pc.n + ld.lat, e: pc.e + ld.dep,
      };
      prevDefl = defl; prevSta = p.sta;
      return row;
    });

    return {
      errors: [], units, delta, R, D, dDef, base, T, L, Larc, LC, E, M,
      PI, PC, PT, interval, turn: sign > 0 ? 'right' : 'left',
      hasCoords, backAz, aheadAz, pi, pc, pt, center, points,
    };
  }

  /**
   * @param {object} inp
   *  pviSta, pviElev, L (curve length), g1, g2 (percent), interval
   *  lookupSta: optional station to evaluate
   */
  function computeVCurve(inp) {
    const errors = [];
    const units = inp.units || 'ft';
    const pvi = S.parseStation(inp.pviSta);
    const pviElev = S.parseNumber(inp.pviElev);
    const L = S.parseNumber(inp.L);
    const g1 = S.parseNumber(inp.g1);
    const g2 = S.parseNumber(inp.g2);
    const interval = S.parseNumber(inp.interval) || 50;
    if (!isFinite(pvi)) errors.push('Enter a valid PVI station (e.g. 50+00).');
    if (!isFinite(pviElev)) errors.push('Enter the PVI elevation.');
    if (!(L > 0)) errors.push('Curve length must be positive.');
    if (!isFinite(g1) || !isFinite(g2)) errors.push('Enter both tangent grades in percent (e.g. +3.0 and -2.0).');
    if (errors.length) return { errors };

    const A = g2 - g1;
    const bvc = pvi - L / 2, evc = pvi + L / 2;
    const bvcElev = pviElev - g1 / 100 * L / 2;
    const evcElev = pviElev + g2 / 100 * L / 2;
    const r = A / L; // % per unit length
    const K = Math.abs(A) > 1e-12 ? L / Math.abs(A) : Infinity;
    const type = A < 0 ? 'Crest' : A > 0 ? 'Sag' : 'No curve (equal grades)';

    const elevAt = (x) => bvcElev + g1 / 100 * x + A / (200 * L) * x * x;
    const gradeAt = (x) => g1 + r * x;
    const tangentAt = (x) => (x <= L / 2 ? bvcElev + g1 / 100 * x : pviElev + g2 / 100 * (x - L / 2));

    let turning = null;
    if (Math.abs(A) > 1e-12) {
      const xt = -g1 * L / A;
      if (xt > 1e-9 && xt < L - 1e-9) {
        turning = { x: xt, sta: bvc + xt, elev: elevAt(xt), kind: A < 0 ? 'High point' : 'Low point' };
      }
    }

    const list = [{ sta: bvc, label: 'BVC' }];
    let s = Math.floor(bvc / interval + 1e-9) * interval + interval;
    if (Math.abs(s - interval - bvc) < 1e-6) s = bvc + interval;
    for (; s < evc - 1e-6; s += interval) list.push({ sta: s, label: '' });
    list.push({ sta: evc, label: 'EVC' });
    const addSpecial = (sta, label) => {
      const hit = list.find((p) => Math.abs(p.sta - sta) < 1e-6);
      if (hit) hit.label = hit.label ? hit.label + ' / ' + label : label;
      else list.push({ sta, label });
    };
    addSpecial(pvi, 'PVI');
    if (turning) addSpecial(turning.sta, turning.kind);
    list.sort((a, b) => a.sta - b.sta);

    const points = list.map((p) => {
      const x = p.sta - bvc;
      const tan = tangentAt(x);
      const elev = elevAt(x);
      return { sta: p.sta, label: p.label, x, tangent: tan, offset: elev - tan, elev, grade: gradeAt(x) };
    });
    // First and second differences of elevation for equally spaced stations (check column).
    for (let i = 1; i < points.length; i++) points[i].d1 = points[i].elev - points[i - 1].elev;

    let lookup = null;
    const ls = S.parseStation(inp.lookupSta);
    if (isFinite(ls)) {
      const x = ls - bvc;
      if (x < 0) lookup = { sta: ls, elev: bvcElev + g1 / 100 * x, grade: g1, where: 'on back tangent' };
      else if (x > L) lookup = { sta: ls, elev: evcElev + g2 / 100 * (x - L), grade: g2, where: 'on forward tangent' };
      else lookup = { sta: ls, elev: elevAt(x), grade: gradeAt(x), where: 'on curve', x };
    }

    return {
      errors: [], units, pvi, pviElev, L, g1, g2, A, r, K, type, interval,
      bvc, evc, bvcElev, evcElev, turning, points, lookup,
      elevAt, tangentAt,
    };
  }

  Object.assign(S, { computeHCurve, computeVCurve });
})(typeof window !== 'undefined' ? window : globalThis);
