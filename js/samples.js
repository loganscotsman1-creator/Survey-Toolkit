/*
 * Survey Toolkit — example data sets used by the "Load example" buttons.
 */
(function (root) {
  'use strict';
  const S = root.Survey;

  const samples = {
    traverseDirections: [
      { station: 'A', dist: '492.36', dir: `N 63°24'05" E` },
      { station: 'B', dist: '396.30', dir: `S 27°55'55" E` },
      { station: 'C', dist: '615.18', dir: `S 50°37'40" W` },
      { station: 'D', dist: '366.59', dir: `N 54°57'50" W` },
      { station: 'E', dist: '343.77', dir: `N 25°49'50" E` },
    ],
    traverseAngles: {
      startDir: 'N 63-24-05 E',
      courses: [
        { station: 'A', dist: '492.36', angle: '142-25-55' },
        { station: 'B', dist: '396.30', angle: '91-19-55' },
        { station: 'C', dist: '615.18', angle: '101-26-40' },
        { station: 'D', dist: '366.59', angle: '105-35-35' },
        { station: 'E', dist: '343.77', angle: '99-12-15' },
      ],
    },
    traverseLatDep: [
      { station: '1', lat: '220.46', dep: '440.18' },
      { station: '2', lat: '-350.13', dep: '185.64' },
      { station: '3', lat: '-390.18', dep: '-475.55' },
      { station: '4', lat: '210.46', dep: '-300.16' },
      { station: '5', lat: '309.42', dep: '149.78' },
    ],
    missing: [
      { station: 'A', dist: '492.36', dir: `N 63°24'05" E` },
      { station: 'B', dist: '396.30', dir: `S 27°55'55" E` },
      { station: 'C', dist: '615.18', dir: `S 50°37'40" W` },
      { station: 'D', dist: '?', dir: '?' },
      { station: 'E', dist: '343.77', dir: `N 25°49'50" E` },
    ],
    radiation: {
      stationName: 'STA 100', N: '10000.00', E: '5000.00', backsightDir: '0-00-00',
      points: [
        { name: '101', dir: '32-15-20', dist: '245.62' },
        { name: '102', dir: '97-40-05', dist: '310.18' },
        { name: '103', dir: '161-05-40', dist: '228.44' },
        { name: '104', dir: '218-30-10', dist: '276.90' },
        { name: '105', dir: '290-48-35', dist: '198.73' },
      ],
    },
    hcurve: { delta: '24-00-00', defineBy: 'D', D: '4-00-00', R: '', dDef: 'arc', baseLen: '100', staType: 'PI', sta: '64+27.30', interval: '50', turn: 'right', piN: '5000', piE: '5000', backAz: 'N 75-00-00 E' },
    vcurve: { pviSta: '50+00', pviElev: '500.00', L: '400', g1: '3.0', g2: '-2.0', interval: '50', lookupSta: '50+40' },
  };

  /** Synthetic topo survey: a hill and a drainage swale, with a few deliberate problems. */
  samples.topoText = function () {
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const lines = ['PNT,NORTHING,EASTING,ELEV,DESC'];
    let id = 1000;
    const z = (n, e) => {
      const x = e - 5000, y = n - 10000;
      const hill = 18 * Math.exp(-((x - 120) ** 2 + (y - 60) ** 2) / (2 * 140 ** 2));
      const swale = -4 * Math.exp(-((x + y * 0.4 + 120) ** 2) / (2 * 75 ** 2));
      return 742 + hill + swale + 0.012 * x - 0.008 * y;
    };
    for (let i = 0; i < 260; i++) {
      const e = 5000 - 250 + rnd() * 560;
      const n = 10000 - 200 + rnd() * 420;
      const code = rnd() < 0.85 ? 'GS' : rnd() < 0.5 ? 'TOE' : 'TOP';
      lines.push(`${id++},${n.toFixed(3)},${e.toFixed(3)},${(z(n, e) + (rnd() - 0.5) * 0.15).toFixed(2)},${code}`);
    }
    // Edge of pavement along the south edge.
    for (let e = 4760; e <= 5300; e += 30) {
      const n = 9810 + (e - 4760) * 0.05;
      lines.push(`${id++},${n.toFixed(3)},${e.toFixed(3)},${(z(n, e) + 0.3).toFixed(2)},EP`);
    }
    // Deliberate problems: a busted rod height (spike) and a duplicate shot.
    lines.push(`${id++},10035.000,5090.000,${(z(10035, 5090) + 9.5).toFixed(2)},GS bad HR?`);
    lines.push('1005,10010.000,4950.000,744.10,GS');
    return lines.join('\n');
  };

  S.samples = samples;
})(typeof window !== 'undefined' ? window : globalThis);
