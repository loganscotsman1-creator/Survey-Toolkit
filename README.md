# Survey Toolkit

A browser-based engineering surveying calculator. It has no dependencies and no build step and runs fully offline: open `index.html` and it works.

**Open the app:** https://loganscotsman1-creator.github.io/Survey-Toolkit/

**Tools**

| Tool | What it does |
|---|---|
| **Closed Traverse** | Any number of courses. Input can be distances with bearings/azimuths, distances with interior angles, or latitudes and departures, and whichever you don't enter is computed. It balances angles, computes ΣLat/ΣDep, linear misclosure and precision, then adjusts by the Compass (Bowditch) or Transit rule. Every correction is highlighted. It also gives adjusted bearings and distances, coordinates, interior angles, and area by coordinates with a DMD check, plus a sketch. |
| **Missing Data** | Solves up to two unknowns from closure: one whole course, two lengths, two directions, or one length plus one direction. When there are two geometric solutions it shows both, and it flags solutions that cross themselves or collapse to zero area. |
| **Radiation** | Points shot from a single station, either as angles right from a backsight or as azimuths/bearings. Gives point coordinates, inversed boundary courses, interior angles, area by coordinates and by radial triangles, and a sketch. |
| **Horizontal Curve** | Δ with either D (arc or chord definition) or R, and the PI or PC station. Gives T, L, LC, E, M and the PC/PI/PT stations. The stakeout table at 25/50/100 (or any) intervals has deflections, chords, incremental chords and tangent offsets. Optional PI coordinates add N/E for every stake. |
| **Vertical Curve** | Equal-tangent parabola from the PVI station and elevation, L, g₁ and g₂. Lists elevations at the BVC, EVC, PVI, high/low point and every 25/50/100 interval. Also gives tangent elevations, offsets, grades, K and r, an elevation lookup at any station, and a profile plot. |
| **Topo Survey** | Imports CSV/TXT (PNEZD, PENZD, PNEZ, PENZ, NEZ, XYZ or any file with a header row), LandXML and GeoJSON. Reports statistics, duplicate and coincident points, spike/bust detection, slope distribution, and plan and 3D surface area. Computes cut/fill volumes against a reference elevation. Builds a Delaunay TIN with contours and draws an interactive map (zoom, pan, hover for elevation). Exports PNG, DXF (contours + points) and cleaned CSV. |

Feet or meters can be chosen for all tools. Every result table has a **Download CSV** button.

## Running it

- **Locally:** double-click `index.html`, or serve the folder:
  ```bash
  python -m http.server 8000
  ```
  then open <http://localhost:8000>.
- **GitHub Pages:** `.github/workflows/pages.yml` publishes the site on every push to `main` (set **Settings → Pages → Source: GitHub Actions** once).

## Input formats

| Value | Examples |
|---|---|
| Angle | `45-30-15`, `45°30'15"`, `45 30 15`, `45d30m15s`, `45.504167` |
| Bearing | `N 45-30-15 E`, `S12.5W`, `N 45°30'15" W` |
| Azimuth | any angle, clockwise from north |
| Station | `12+34.56` (ft, 100/sta), `1+234.567` (m, 1000/sta), or a plain number |
| Unknown (Missing Data tab) | leave blank or type `?` |

Input tables accept pasting from Excel or Google Sheets (tab or comma separated). Press Enter to move down a column.

## Formulas

**Traverse**

- Lat = L·cos Az, Dep = L·sin Az
- Interior angle sum = (n − 2)·180°; the misclosure is spread equally over the angles
- Azimuth propagation: Az₂ = Az₁ + 180° − ∠ (clockwise) or + ∠ (counter-clockwise)
- Precision = 1 : P / √(ΣLat² + ΣDep²)
- Compass rule: c = −Σ · L / P. Transit rule: c = −Σ · |Lat| / Σ|Lat| (and the same form for Dep)
- Area = ½|Σ(Eᵢ·Nᵢ₊₁ − Eᵢ₊₁·Nᵢ)|, checked with DMD: area = ½|Σ DMD·Lat|

**Horizontal curve**

- Arc definition: R = 180·base / (π·D). Chord definition: R = (base/2) / sin(D/2)
- T = R tan(Δ/2), L = base·Δ/D, LC = 2R sin(Δ/2), E = R(sec(Δ/2) − 1), M = R(1 − cos(Δ/2))
- Deflection at arc distance l from the PC = l·D / (2·base); chord = 2R sin(deflection)

**Vertical curve**

- y = y_BVC + g₁x/100 + (g₂ − g₁)x² / (200L)
- High/low point at x = −g₁L / (g₂ − g₁); K = L / |A|

**Topo**

- Bowyer–Watson Delaunay triangulation, with coordinates normalised so large state-plane values stay stable
- Spike test: each shot is compared with a least-squares plane through its TIN neighbours. It is flagged when the residual is a robust outlier (MAD z > 3.5), is the largest residual in its neighbourhood, and is more than 3× its neighbours' median residual.
- Volumes: exact split of each linear triangular prism at the reference plane

## Tests

Open `tests/index.html` in a browser (or go to `/tests/` when serving the folder). It runs 30 checks against hand-computed and textbook values.

## Project layout

```
index.html        app shell (tabs and forms)
css/styles.css    styling (light and dark)
js/core.js        angle/bearing/station parsing and formatting, polygon geometry
js/traverse.js    traverse adjustment, missing data, radiation
js/curves.js      horizontal and vertical curves
js/topo.js        file parsers, Delaunay TIN, analysis, contours, DXF export
js/ui.js          input grids, tables, plots, interactive topo map
js/app.js         wiring between the forms and the calculations
js/samples.js     example data sets
tests/            browser test runner
```

## Disclaimer

This is an educational and productivity tool. Check results independently before using them for design, construction, boundary work or legal descriptions.

## License

MIT. See [LICENSE](LICENSE).
