/*
 * Survey Toolkit — UI helpers: editable grids, result tables, CSV export, plots.
 */
(function (root) {
  'use strict';
  const S = root.Survey;
  const UI = (S.UI = {});

  const esc = (s) => String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  UI.esc = esc;

  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  UI.cssVar = cssVar;

  // ---------- Editable grid ----------

  UI.createGrid = function (host, columns, opts = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'grid-wrap';
    const table = document.createElement('table');
    table.className = 'grid';
    const head = '<thead><tr><th></th>' + columns.map((c) => `<th data-key="${c.key}">${esc(c.label)}</th>`).join('') + '<th></th></tr></thead>';
    table.innerHTML = head + '<tbody></tbody>';
    const tbody = table.querySelector('tbody');
    wrap.appendChild(table);
    host.appendChild(wrap);
    let hidden = new Set();

    function renumber() {
      [...tbody.rows].forEach((tr, i) => { tr.cells[0].textContent = (opts.numberLabel || '') + (i + 1); });
    }

    function visibleKeys() { return columns.map((c) => c.key).filter((k) => !hidden.has(k)); }

    function onPaste(e) {
      const text = (e.clipboardData || window.clipboardData).getData('text');
      if (!/[\t\n]/.test(text.trim()) && !(text.includes(',') && !/[NSEW°'"]/i.test(text))) return;
      e.preventDefault();
      const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
      const startTr = e.target.closest('tr');
      let rowIdx = [...tbody.rows].indexOf(startTr);
      const keys = visibleKeys();
      const colIdx = keys.indexOf(e.target.dataset.key);
      lines.forEach((line) => {
        const cells = line.includes('\t') ? line.split('\t') : line.split(',');
        while (rowIdx >= tbody.rows.length) addRow();
        const tr = tbody.rows[rowIdx];
        cells.forEach((v, j) => {
          const k = keys[colIdx + j];
          if (!k) return;
          const inp = tr.querySelector(`input[data-key="${k}"]`);
          if (inp) inp.value = v.trim();
        });
        rowIdx++;
      });
    }

    function addRow(values = {}) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td class="num"></td>' + columns.map((c) =>
        `<td data-key="${c.key}" class="${hidden.has(c.key) ? 'col-hidden' : ''}"><input type="text" data-key="${c.key}" placeholder="${esc(c.placeholder || '')}" aria-label="${esc(c.label)}" spellcheck="false"></td>`).join('') +
        '<td><button class="del" title="Remove row" aria-label="Remove row">×</button></td>';
      columns.forEach((c) => {
        const inp = tr.querySelector(`input[data-key="${c.key}"]`);
        inp.value = values[c.key] !== undefined ? values[c.key] : '';
        inp.addEventListener('paste', onPaste);
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const rows = [...tbody.rows];
            const i = rows.indexOf(tr);
            if (i === rows.length - 1) addRow();
            const next = tbody.rows[i + 1].querySelector(`input[data-key="${c.key}"]`);
            next.focus();
          }
        });
      });
      tr.querySelector('.del').addEventListener('click', () => { tr.remove(); renumber(); });
      tbody.appendChild(tr);
      renumber();
      return tr;
    }

    function getRows() {
      return [...tbody.rows].map((tr) => {
        const o = {};
        tr.querySelectorAll('input').forEach((i) => { o[i.dataset.key] = i.value.trim(); });
        return o;
      }).filter((o) => visibleKeys().some((k) => o[k] !== ''));
    }

    function setRows(rows) {
      tbody.innerHTML = '';
      rows.forEach((r) => addRow(r));
      const min = opts.minRows || 0;
      while (tbody.rows.length < min) addRow();
    }

    function setHidden(keys) {
      hidden = new Set(keys);
      table.querySelectorAll('[data-key]').forEach((el) => {
        if (el.tagName === 'INPUT') return;
        el.classList.toggle('col-hidden', hidden.has(el.dataset.key));
      });
    }

    function setLabel(key, label) {
      const th = table.querySelector(`th[data-key="${key}"]`);
      if (th) th.textContent = label;
    }

    setRows([]);
    return { addRow, getRows, setRows, setHidden, setLabel, table };
  };

  // ---------- Output helpers ----------

  /** cells: string | { v, cls, title } */
  UI.table = function (headers, rows, opts = {}) {
    const th = headers.map((h) => `<th>${h}</th>`).join('');
    const body = rows.map((r) => {
      const cls = r.cls ? ` class="${r.cls}"` : '';
      const cells = (r.cells || r).map((c) => {
        if (c && typeof c === 'object') return `<td class="${c.cls || ''}"${c.title ? ` title="${esc(c.title)}"` : ''}>${c.raw ? c.v : esc(c.v)}</td>`;
        return `<td>${esc(c)}</td>`;
      }).join('');
      return `<tr${cls}>${cells}</tr>`;
    }).join('');
    return `<div class="table-wrap"><table class="out"${opts.id ? ` id="${opts.id}"` : ''}><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
  };

  UI.stat = function (k, v, s, cls) {
    return `<div class="stat ${cls || ''}"><div class="k">${k}</div><div class="v">${esc(v)}</div>${s ? `<div class="s">${esc(s)}</div>` : ''}</div>`;
  };

  UI.messages = function (errors, warnings, infos) {
    let h = '';
    if (errors && errors.length) h += `<div class="msg error"><strong>Please fix:</strong><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
    (warnings || []).forEach((w) => { h += `<div class="msg warn">${esc(w)}</div>`; });
    (infos || []).forEach((w) => { h += `<div class="msg info">${esc(w)}</div>`; });
    return h;
  };

  UI.block = function (title, inner, opts = {}) {
    const csv = opts.csv ? `<button class="btn small" data-csv="${opts.csv}">Download CSV</button>` : '';
    return `<div class="card result-card"><div class="block-head"><h2>${title}</h2>${csv}</div>${opts.legend || ''}${inner}</div>`;
  };

  UI.download = function (filename, content, type = 'text/plain') {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  UI.tableToCSV = function (table) {
    const q = (s) => {
      const t = s.replace(/\s+/g, ' ').trim();
      return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    };
    return [...table.rows].map((tr) => [...tr.cells].map((c) => q(c.textContent)).join(',')).join('\r\n');
  };

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-csv]');
    if (!b) return;
    const table = b.closest('.result-card').querySelector('table.out');
    if (table) UI.download(b.dataset.csv + '.csv', UI.tableToCSV(table), 'text/csv');
  });

  // ---------- Canvas helpers ----------

  UI.prepCanvas = function (canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 600, h = canvas.clientHeight || 380;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  };

  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / p;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  }
  UI.niceStep = niceStep;

  function drawNorthArrow(ctx, x, y) {
    ctx.save();
    ctx.fillStyle = cssVar('--plot-text');
    ctx.strokeStyle = cssVar('--plot-text');
    ctx.beginPath(); ctx.moveTo(x, y - 18); ctx.lineTo(x - 7, y + 6); ctx.lineTo(x, y + 1); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x, y - 18); ctx.lineTo(x + 7, y + 6); ctx.lineTo(x, y + 1); ctx.closePath(); ctx.stroke();
    ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('N', x, y - 22);
    ctx.restore();
  }

  function drawScaleBar(ctx, x, y, scale, units) {
    const target = 110 / scale;
    const step = niceStep(target);
    const px = step * scale;
    ctx.save();
    ctx.strokeStyle = cssVar('--plot-text'); ctx.fillStyle = cssVar('--plot-text'); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y); ctx.lineTo(x + px, y); ctx.lineTo(x + px, y - 4); ctx.stroke();
    ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`${step} ${units}`, x + px / 2, y - 6);
    ctx.restore();
  }
  UI.drawNorthArrow = drawNorthArrow;
  UI.drawScaleBar = drawScaleBar;

  /**
   * Plan-view plot of point lists.
   * layers: [{ pts:[{n,e,label}], closed, color, dash, width, fill, labels, dots, labelOffset }]
   * extras: [{ type:'text'|'arc', ... }]
   */
  UI.drawPlan = function (canvas, layers, opts = {}) {
    const { ctx, w, h } = UI.prepCanvas(canvas);
    const all = layers.flatMap((l) => l.pts).concat(opts.extentPts || []);
    if (!all.length) return;
    let minN = Infinity, maxN = -Infinity, minE = Infinity, maxE = -Infinity;
    all.forEach((p) => { minN = Math.min(minN, p.n); maxN = Math.max(maxN, p.n); minE = Math.min(minE, p.e); maxE = Math.max(maxE, p.e); });
    const pad = 46;
    const spanE = Math.max(maxE - minE, 1e-6), spanN = Math.max(maxN - minN, 1e-6);
    const scale = Math.min((w - 2 * pad) / spanE, (h - 2 * pad) / spanN);
    const cE = (minE + maxE) / 2, cN = (minN + maxN) / 2;
    const X = (e) => w / 2 + (e - cE) * scale;
    const Y = (n) => h / 2 - (n - cN) * scale;

    layers.forEach((l) => {
      if (l.pts.length < 1) return;
      ctx.save();
      ctx.strokeStyle = l.color || cssVar('--plot-line');
      ctx.lineWidth = l.width || 2;
      ctx.setLineDash(l.dash || []);
      if (l.pts.length > 1 && l.line !== false) {
        ctx.beginPath();
        l.pts.forEach((p, i) => (i ? ctx.lineTo(X(p.e), Y(p.n)) : ctx.moveTo(X(p.e), Y(p.n))));
        if (l.closed) ctx.closePath();
        if (l.fill) { ctx.fillStyle = l.fill; ctx.fill(); }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      if (l.dots !== false) {
        ctx.fillStyle = l.dotColor || l.color || cssVar('--plot-line');
        l.pts.forEach((p) => { ctx.beginPath(); ctx.arc(X(p.e), Y(p.n), l.dotSize || 3.5, 0, Math.PI * 2); ctx.fill(); });
      }
      if (l.labels) {
        ctx.fillStyle = cssVar('--plot-text');
        ctx.font = '600 12px system-ui, sans-serif';
        // Offset labels away from the centroid of the layer.
        const gN = l.pts.reduce((s, p) => s + p.n, 0) / l.pts.length;
        const gE = l.pts.reduce((s, p) => s + p.e, 0) / l.pts.length;
        l.pts.forEach((p) => {
          if (!p.label) return;
          let dx = p.e - gE, dy = p.n - gN;
          const m = Math.hypot(dx, dy) || 1;
          dx /= m; dy /= m;
          ctx.textAlign = dx > 0.3 ? 'left' : dx < -0.3 ? 'right' : 'center';
          ctx.textBaseline = dy > 0.3 ? 'bottom' : dy < -0.3 ? 'top' : 'middle';
          ctx.fillText(p.label, X(p.e) + dx * 9, Y(p.n) - dy * 9);
        });
      }
      ctx.restore();
    });

    if (opts.after) opts.after(ctx, X, Y, scale);
    drawNorthArrow(ctx, w - 24, 34);
    drawScaleBar(ctx, 14, h - 14, scale, opts.units || '');
  };

  /** Profile plot (station vs elevation) for vertical curves. */
  UI.drawProfile = function (canvas, series, opts = {}) {
    const { ctx, w, h } = UI.prepCanvas(canvas);
    const all = series.flatMap((s) => s.pts);
    if (!all.length) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    all.forEach((p) => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
    const padY = (maxY - minY) * 0.15 || 1;
    minY -= padY; maxY += padY;
    const L = 64, R = 18, T = 18, B = 40;
    const X = (x) => L + (x - minX) / (maxX - minX || 1) * (w - L - R);
    const Y = (y) => h - B - (y - minY) / (maxY - minY || 1) * (h - T - B);

    // Grid
    ctx.save();
    ctx.strokeStyle = cssVar('--plot-grid'); ctx.fillStyle = cssVar('--muted'); ctx.lineWidth = 1;
    ctx.font = '11px system-ui, sans-serif';
    const ys = niceStep((maxY - minY) / 6);
    for (let y = Math.ceil(minY / ys) * ys; y <= maxY; y += ys) {
      ctx.beginPath(); ctx.moveTo(L, Y(y)); ctx.lineTo(w - R, Y(y)); ctx.stroke();
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(y.toFixed(ys < 1 ? 1 : 0), L - 6, Y(y));
    }
    const xs = opts.xStep || niceStep((maxX - minX) / 8);
    for (let x = Math.ceil(minX / xs) * xs; x <= maxX + 1e-9; x += xs) {
      ctx.beginPath(); ctx.moveTo(X(x), T); ctx.lineTo(X(x), h - B); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(opts.xFmt ? opts.xFmt(x) : x, X(x), h - B + 6);
    }
    ctx.restore();

    series.forEach((s) => {
      ctx.save();
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2; ctx.setLineDash(s.dash || []);
      if (s.line !== false) {
        ctx.beginPath();
        s.pts.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
        ctx.stroke();
      }
      ctx.setLineDash([]);
      if (s.dots) {
        ctx.fillStyle = s.dotColor || s.color;
        s.pts.forEach((p) => { ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), s.dotSize || 3, 0, Math.PI * 2); ctx.fill(); });
      }
      if (s.labels) {
        ctx.fillStyle = cssVar('--plot-text'); ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center';
        s.pts.forEach((p) => { if (p.label) ctx.fillText(p.label, X(p.x), Y(p.y) - 10); });
      }
      ctx.restore();
    });
  };

  // ---------- Elevation colour ramp ----------

  const RAMP = [
    [0.0, [46, 125, 112]],
    [0.25, [110, 168, 96]],
    [0.5, [214, 198, 104]],
    [0.75, [190, 128, 70]],
    [1.0, [140, 82, 60]],
  ];
  UI.rampColor = function (t, alpha = 1) {
    t = Math.max(0, Math.min(1, t));
    for (let i = 1; i < RAMP.length; i++) {
      if (t <= RAMP[i][0]) {
        const [t0, c0] = RAMP[i - 1], [t1, c1] = RAMP[i];
        const f = (t - t0) / (t1 - t0);
        const c = c0.map((v, k) => Math.round(v + f * (c1[k] - v)));
        return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
      }
    }
    return 'rgb(0,0,0)';
  };
  UI.rampCSS = function () {
    return 'linear-gradient(90deg,' + RAMP.map(([t]) => `${UI.rampColor(t)} ${t * 100}%`).join(',') + ')';
  };

  // ---------- Interactive topo map ----------

  UI.TopoMap = function (canvas, tooltip) {
    const st = { scale: 1, cx: 0, cy: 0, data: null, layers: {}, units: 'ft' };
    let dragging = null;

    function fit() {
      const d = st.data; if (!d) return;
      const s = d.stats;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      st.scale = Math.min((w - 60) / Math.max(s.maxE - s.minE, 1e-6), (h - 60) / Math.max(s.maxN - s.minN, 1e-6));
      st.cx = (s.minE + s.maxE) / 2; st.cy = (s.minN + s.maxN) / 2;
    }
    const X = (e) => canvas.clientWidth / 2 + (e - st.cx) * st.scale;
    const Y = (n) => canvas.clientHeight / 2 - (n - st.cy) * st.scale;

    function draw() {
      const { ctx, w, h } = UI.prepCanvas(canvas);
      const d = st.data; if (!d) return;
      const L = st.layers;
      const pts = d.points, s = d.stats;
      const zr = s.maxZ - s.minZ || 1;

      if (L.shade) {
        d.tris.forEach(([a, b, c]) => {
          const A = pts[a], B = pts[b], C = pts[c];
          ctx.fillStyle = UI.rampColor(((A.z + B.z + C.z) / 3 - s.minZ) / zr, 0.55);
          ctx.beginPath(); ctx.moveTo(X(A.e), Y(A.n)); ctx.lineTo(X(B.e), Y(B.n)); ctx.lineTo(X(C.e), Y(C.n)); ctx.closePath(); ctx.fill();
        });
      }
      if (L.slope && d.slopes) {
        const maxS = Math.max(...d.slopes, 1);
        d.tris.forEach(([a, b, c], i) => {
          const A = pts[a], B = pts[b], C = pts[c];
          const t = Math.min(1, d.slopes[i] / Math.min(maxS, 50));
          ctx.fillStyle = `rgba(${Math.round(60 + 190 * t)},${Math.round(170 - 120 * t)},${Math.round(90 - 50 * t)},0.55)`;
          ctx.beginPath(); ctx.moveTo(X(A.e), Y(A.n)); ctx.lineTo(X(B.e), Y(B.n)); ctx.lineTo(X(C.e), Y(C.n)); ctx.closePath(); ctx.fill();
        });
      }
      if (L.tin) {
        ctx.strokeStyle = cssVar('--plot-tin'); ctx.lineWidth = 0.7;
        ctx.beginPath();
        d.tris.forEach(([a, b, c]) => {
          const A = pts[a], B = pts[b], C = pts[c];
          ctx.moveTo(X(A.e), Y(A.n)); ctx.lineTo(X(B.e), Y(B.n)); ctx.lineTo(X(C.e), Y(C.n)); ctx.closePath();
        });
        ctx.stroke();
      }
      if (L.contours && d.contourLines) {
        const minor = cssVar('--plot-contour'), major = cssVar('--plot-index');
        d.contourLines.forEach((c) => {
          ctx.strokeStyle = c.index ? major : minor;
          ctx.lineWidth = c.index ? 1.8 : 0.9;
          ctx.beginPath();
          c.pts.forEach((p, i) => (i ? ctx.lineTo(X(p.e), Y(p.n)) : ctx.moveTo(X(p.e), Y(p.n))));
          ctx.stroke();
        });
        // Labels on index contours.
        ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const bg = cssVar('--surface');
        d.contourLines.forEach((c) => {
          if (!c.index || c.pts.length < 4) return;
          let len = 0;
          for (let i = 1; i < c.pts.length; i++) len += Math.hypot(X(c.pts[i].e) - X(c.pts[i - 1].e), Y(c.pts[i].n) - Y(c.pts[i - 1].n));
          if (len < 120) return;
          const k = c.pts.length >> 1;
          const p = c.pts[k], q = c.pts[Math.min(k + 1, c.pts.length - 1)];
          let ang = Math.atan2(Y(q.n) - Y(p.n), X(q.e) - X(p.e));
          if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
          ctx.save();
          ctx.translate(X(p.e), Y(p.n)); ctx.rotate(ang);
          const txt = String(+c.level.toFixed(2));
          ctx.lineWidth = 4; ctx.strokeStyle = bg; ctx.strokeText(txt, 0, 0);
          ctx.fillStyle = major; ctx.fillText(txt, 0, 0);
          ctx.restore();
        });
      }
      if (L.points) {
        pts.forEach((p) => {
          ctx.fillStyle = p.spike ? '#d93025' : UI.rampColor((p.z - s.minZ) / zr);
          ctx.beginPath(); ctx.arc(X(p.e), Y(p.n), p.spike ? 5 : 2.6, 0, Math.PI * 2); ctx.fill();
          if (p.spike) { ctx.strokeStyle = '#d93025'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X(p.e), Y(p.n), 9, 0, Math.PI * 2); ctx.stroke(); }
        });
      }
      if (L.ids || L.elevs) {
        ctx.fillStyle = cssVar('--plot-text'); ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        pts.forEach((p) => {
          const x = X(p.e), y = Y(p.n);
          if (x < -20 || y < -20 || x > w + 20 || y > h + 20) return;
          const parts = [];
          if (L.ids) parts.push(p.id);
          if (L.elevs) parts.push(p.z.toFixed(2));
          ctx.fillText(parts.join(' '), x + 5, y - 5);
        });
      }
      drawNorthArrow(ctx, w - 24, 34);
      drawScaleBar(ctx, 14, h - 14, st.scale, st.units);
    }

    function nearest(mx, my) {
      const d = st.data; if (!d) return null;
      let best = null, bd = 100;
      d.points.forEach((p) => {
        const dx = X(p.e) - mx, dy = Y(p.n) - my, dd = dx * dx + dy * dy;
        if (dd < bd) { bd = dd; best = p; }
      });
      return best;
    }

    function surfaceZ(e, n) {
      const d = st.data; if (!d) return null;
      for (const [a, b, c] of d.tris) {
        const A = d.points[a], B = d.points[b], C = d.points[c];
        const det = (B.n - C.n) * (A.e - C.e) + (C.e - B.e) * (A.n - C.n);
        const l1 = ((B.n - C.n) * (e - C.e) + (C.e - B.e) * (n - C.n)) / det;
        const l2 = ((C.n - A.n) * (e - C.e) + (A.e - C.e) * (n - C.n)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) return l1 * A.z + l2 * B.z + l3 * C.z;
      }
      return null;
    }

    canvas.addEventListener('wheel', (e) => {
      if (!st.data) return;
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const we = st.cx + (mx - canvas.clientWidth / 2) / st.scale;
      const wn = st.cy - (my - canvas.clientHeight / 2) / st.scale;
      const f = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      st.scale *= f;
      st.cx = we - (mx - canvas.clientWidth / 2) / st.scale;
      st.cy = wn + (my - canvas.clientHeight / 2) / st.scale;
      draw();
    }, { passive: false });
    canvas.addEventListener('pointerdown', (e) => { dragging = { x: e.clientX, y: e.clientY, cx: st.cx, cy: st.cy }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointerup', () => { dragging = null; });
    canvas.addEventListener('pointerleave', () => { tooltip.hidden = true; });
    canvas.addEventListener('pointermove', (e) => {
      if (dragging) {
        st.cx = dragging.cx - (e.clientX - dragging.x) / st.scale;
        st.cy = dragging.cy + (e.clientY - dragging.y) / st.scale;
        draw();
        tooltip.hidden = true;
        return;
      }
      if (!st.data) return;
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const p = nearest(mx, my);
      let txt;
      if (p) {
        txt = `Pt ${p.id}${p.desc ? '  ' + p.desc : ''}\nN ${p.n.toFixed(3)}\nE ${p.e.toFixed(3)}\nZ ${p.z.toFixed(3)}${p.spike ? '\n⚠ possible spike' : ''}`;
      } else {
        const we = st.cx + (mx - canvas.clientWidth / 2) / st.scale;
        const wn = st.cy - (my - canvas.clientHeight / 2) / st.scale;
        const z = surfaceZ(we, wn);
        txt = `N ${wn.toFixed(2)}\nE ${we.toFixed(2)}` + (z !== null ? `\nSurface Z ${z.toFixed(2)}` : '');
      }
      tooltip.textContent = txt;
      tooltip.hidden = false;
      tooltip.style.left = e.clientX + 14 + 'px';
      tooltip.style.top = e.clientY + 14 + 'px';
    });
    canvas.addEventListener('dblclick', () => { fit(); draw(); });
    window.addEventListener('resize', () => { if (st.data && canvas.offsetParent) draw(); });

    return {
      setData(data, units) { st.data = data; st.units = units; fit(); draw(); },
      setLayers(l) { st.layers = l; draw(); },
      redraw: draw,
      fit() { fit(); draw(); },
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
