/*
 * Survey Toolkit — core helpers
 * Angle parsing/formatting, stationing, vectors and polygon geometry.
 * Azimuths are decimal degrees measured clockwise from north (0–360).
 * Vectors are { n, e } (northing / easting) or [lat, dep].
 */
(function (root) {
  'use strict';
  const S = (root.Survey = root.Survey || {});
  const RAD = Math.PI / 180;

  function normAz(a) {
    a = a % 360;
    if (a < 0) a += 360;
    if (a >= 360 - 1e-12) a = 0;
    return a;
  }

  /** Parse an angle: "45.5", "45-30-00", "45°30'00\"", "45 30 0", "45d30m0s". Returns decimal degrees or NaN. */
  function parseAngle(input) {
    if (input === null || input === undefined) return NaN;
    let s = String(input).trim();
    if (!s) return NaN;
    let sign = 1;
    if (s[0] === '-') { sign = -1; s = s.slice(1).trim(); }
    else if (s[0] === '+') { s = s.slice(1).trim(); }
    if (/[^0-9.\s°'"’”′″:dms-]/i.test(s)) return NaN;
    const parts = s.split(/[^0-9.]+/).filter((p) => p.length);
    if (!parts.length || parts.length > 3) return NaN;
    const nums = parts.map(Number);
    if (nums.some((x) => !isFinite(x))) return NaN;
    const [d, m = 0, sec = 0] = nums;
    if (parts.length > 1 && (m >= 60 || sec >= 60)) return NaN;
    return sign * (d + m / 60 + sec / 3600);
  }

  /** Parse a quadrant bearing such as "N 45-30-15 E" or "S12.5W". Returns azimuth or NaN. */
  function parseBearing(input) {
    const m = String(input || '').trim().toUpperCase().match(/^([NS])\s*(.+?)\s*([EW])$/);
    if (!m) return NaN;
    const a = parseAngle(m[2]);
    if (!(a >= 0 && a <= 90)) return NaN;
    const q = m[1] + m[3];
    if (q === 'NE') return normAz(a);
    if (q === 'SE') return normAz(180 - a);
    if (q === 'SW') return normAz(180 + a);
    return normAz(360 - a);
  }

  /** Parse a direction that is either a bearing (starts with N/S) or an azimuth. */
  function parseDirection(input) {
    const s = String(input || '').trim();
    if (!s) return NaN;
    if (/^[NS]/i.test(s)) return parseBearing(s);
    const a = parseAngle(s);
    return isFinite(a) ? normAz(a) : NaN;
  }

  function parseNumber(input) {
    if (input === null || input === undefined) return NaN;
    const s = String(input).trim().replace(/,/g, '');
    if (!s) return NaN;
    const v = Number(s);
    return isFinite(v) ? v : NaN;
  }

  function isUnknown(input) {
    const s = String(input === undefined || input === null ? '' : input).trim();
    return s === '' || s === '?';
  }

  /** Format decimal degrees as D°MM'SS". */
  function formatDMS(deg, secDec = 0, padDeg = 0, wrap360 = false) {
    if (!isFinite(deg)) return '—';
    const f = Math.pow(10, secDec);
    let units = Math.round(Math.abs(deg) * 3600 * f);
    if (wrap360) units = units % (360 * 3600 * f);
    const sign = deg < 0 && units > 0 ? '-' : '';
    const d = Math.floor(units / (3600 * f));
    const rem = units - d * 3600 * f;
    const m = Math.floor(rem / (60 * f));
    const s = (rem - m * 60 * f) / f;
    const sStr = s.toFixed(secDec).padStart(secDec ? 3 + secDec : 2, '0');
    return `${sign}${String(d).padStart(padDeg, '0')}°${String(m).padStart(2, '0')}'${sStr}"`;
  }

  function formatAzimuth(az, secDec = 0) {
    return formatDMS(normAz(az), secDec, 0, true);
  }

  function formatBearing(az, secDec = 0) {
    if (!isFinite(az)) return '—';
    az = normAz(az);
    let ns, ew, a;
    if (az <= 90) { ns = 'N'; ew = 'E'; a = az; }
    else if (az <= 180) { ns = 'S'; ew = 'E'; a = 180 - az; }
    else if (az <= 270) { ns = 'S'; ew = 'W'; a = az - 180; }
    else { ns = 'N'; ew = 'W'; a = 360 - az; }
    return `${ns} ${formatDMS(a, secDec, 2)} ${ew}`;
  }

  /** Signed angle in seconds, e.g. +12.5" */
  function formatSeconds(deg, dec = 1) {
    if (!isFinite(deg)) return '—';
    const s = deg * 3600;
    return (s > 0 ? '+' : '') + s.toFixed(dec) + '"';
  }

  /** Station strings: "12+34.56" (feet, 100 per station) or "1+234.567" (metres, 1000 per station). */
  function parseStation(input) {
    const s = String(input || '').trim().replace(/[\s+]/g, '');
    if (!s) return NaN;
    return parseNumber(s);
  }

  function formatStation(v, units = 'ft', dec = 2) {
    if (!isFinite(v)) return '—';
    const base = units === 'm' ? 1000 : 100;
    const f = Math.pow(10, dec);
    const r = Math.round(Math.abs(v) * f) / f;
    const major = Math.floor(r / base + 1e-9);
    const minor = Math.max(0, r - major * base);
    const width = (units === 'm' ? 3 : 2) + (dec ? dec + 1 : 0);
    return (v < 0 ? '-' : '') + major + '+' + minor.toFixed(dec).padStart(width, '0');
  }

  function fmt(v, dec = 2) {
    return isFinite(v) ? v.toFixed(dec) : '—';
  }

  function fmtSigned(v, dec = 2) {
    if (!isFinite(v)) return '—';
    const s = v.toFixed(dec);
    if (Number(s) === 0) return (0).toFixed(dec);
    return (v > 0 ? '+' : '') + s;
  }

  function fmtGroup(v, dec = 2) {
    if (!isFinite(v)) return '—';
    return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  function azOf(lat, dep) {
    if (Math.abs(lat) < 1e-15 && Math.abs(dep) < 1e-15) return 0;
    return normAz(Math.atan2(dep, lat) / RAD);
  }

  function azBetween(p1, p2) {
    return azOf(p2.n - p1.n, p2.e - p1.e);
  }

  function dist(p1, p2) {
    return Math.hypot(p2.n - p1.n, p2.e - p1.e);
  }

  function latDep(distance, az) {
    return { lat: distance * Math.cos(az * RAD), dep: distance * Math.sin(az * RAD) };
  }

  /** Smallest difference between two azimuths, 0–180. */
  function azDiff(a, b) {
    const d = Math.abs(normAz(a) - normAz(b)) % 360;
    return d > 180 ? 360 - d : d;
  }

  /**
   * Area, orientation and interior angles of a closed polygon given as [{n, e}].
   * Interior angle i is at vertex i.
   */
  function polygonInfo(pts) {
    const n = pts.length;
    let twice = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      twice += a.e * b.n - b.e * a.n;
    }
    const ccw = twice > 0;
    const interior = [];
    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n], cur = pts[i], next = pts[(i + 1) % n];
      const back = normAz(azBetween(prev, cur) + 180);
      const out = azBetween(cur, next);
      interior.push(ccw ? normAz(out - back) : normAz(back - out));
    }
    let perimeter = 0;
    for (let i = 0; i < n; i++) perimeter += dist(pts[i], pts[(i + 1) % n]);
    return { area: Math.abs(twice) / 2, signedArea: twice / 2, ccw, interior, perimeter };
  }

  const UNITS = {
    ft: { len: 'ft', area: 'sq ft', big: 'ac', bigFactor: 43560, bigName: 'acres', vol: 'cu ft', vol2: 'cu yd', vol2Factor: 27, dec: 2 },
    m: { len: 'm', area: 'sq m', big: 'ha', bigFactor: 10000, bigName: 'hectares', vol: 'cu m', vol2: null, vol2Factor: 1, dec: 3 },
  };

  function areaText(area, units) {
    const u = UNITS[units] || UNITS.ft;
    return `${fmtGroup(area, 2)} ${u.area} (${fmtGroup(area / u.bigFactor, 4)} ${u.big})`;
  }

  /** Precision ratio text, e.g. 1:12,345 */
  function precisionText(ratio) {
    if (!isFinite(ratio)) return 'Perfect closure';
    return '1:' + Math.round(ratio).toLocaleString('en-US');
  }

  Object.assign(S, {
    RAD, UNITS,
    normAz, parseAngle, parseBearing, parseDirection, parseNumber, isUnknown,
    formatDMS, formatAzimuth, formatBearing, formatSeconds,
    parseStation, formatStation,
    fmt, fmtSigned, fmtGroup,
    azOf, azBetween, dist, latDep, azDiff, polygonInfo,
    areaText, precisionText,
  });
})(typeof window !== 'undefined' ? window : globalThis);
