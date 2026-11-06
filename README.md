# LunarNav V2 — lunar south-pole mission planning

An independently built, transparent lunar south-pole mission-planning prototype for **NASA Space Apps Challenge 2026**, Team **1st LunarNav**. It screens candidate landing sites and mission dates for Sun and Earth visibility, first-order power feasibility and local terrain horizons. Everything is an exploratory estimate — the tool does not certify landing safety, continuous power or radio contact, and is not affiliated with or endorsed by NASA.

## What it does

- Interactive lunar south-pole globe (WebGL, NASA LROC texture when available, schematic fallback) with five study coordinates plus custom map-selected waypoints
- UTC start date/time and 3/7/14/28-day mission windows; analytical Sun and Earth azimuth/elevation in a Moon-fixed frame, updated as time moves
- Visibility timeline (sunlight / geometric Earth view / both), draggable inspection clock, next-horizon-event search, local sky-dome plot
- Same-window comparison of the five study points plus a side-by-side comparison table (illumination, darkness, longest darkness, solar elevation, geometric Earth view, estimated solar energy), a shared per-site timeline, computed difference summaries, and a two-date mission-date comparison
- Every results panel states which horizon model produced its numbers (NASA LOLA terrain horizon or an explicitly labelled flat 0° approximation)
- Mission Window Finder: 30/60 candidate start dates × sites heatmap, ranked windows, geometric or terrain-aware horizon modes (terrain is the default when profiles are available), terrain-effect comparison, CSV export
- Engineering screening: fixed solar array + battery simulation, Earth antenna elevation mask, state-of-charge chart, engineering CSV export
- NASA LOLA terrain: bundled 20 km derived horizon profiles for all five study sites, on-demand GeoTIFF byte-range loading, local `.tif` import
- Surface traverse estimator (geodesic distance, drive time, sampled visibility en route) and Earth-to-Moon transit estimator (reference-duration scheduling, not a trajectory solver)
- Mission briefing (copy/print), shareable URLs, Gemini-powered mission assistant (optional)
- Six-page workspace (overview / explore / mission windows / compare / engineering / science) with a small History API router

## Running locally

Node 18+ for tests; the browser app itself has no runtime dependencies (the serverless assistant uses `@google/genai`).

```sh
npm install     # only needed for tests and the assistant function
npm test        # unit + DOM-contract tests
npm run build   # static production build into dist/
npm run dev     # preview at http://localhost:4173
```

Deploy with Vercel (`vercel.json` builds to `dist/`). All client code is native ES modules.

## Data and models

**Study coordinates.** Mons Mouton from NASA PDS (IM-2 landing coordinate), Malapert from a NASA image page, Shackleton Rim from a historic NASA candidate listing (approximate). Faustini and Nobile are illustrative study points, not surveyed landing sites.

**Ephemeris.** `src/astro.js` implements a truncated lunar/solar geocentric series (Meeus/NOAA style) with the IAU 2015 lunar rotation model, converted to local azimuth/elevation over a spherical Moon with a level 0° geometric horizon. Sun/Earth visibility counts the body's *center* above the horizon, sampled every two hours (four hours in the Finder and comparator). No eclipses, limb corrections, light-time, spacecraft shadows or surface hazards are modelled.

**Horizon models.** One visibility rule runs everywhere: a body counts as visible when its center is above the terrain horizon in that azimuth, where a NASA LOLA profile exists (20 km radius, 1° azimuth bins at DEM-resolution radial steps), and above the 0° geometric horizon otherwise — in which case every panel labels the result as a simplified flat-horizon approximation. Timeline, live readouts, comparison, engineering and the Finder all sample through this rule, so no two sections can disagree. Percentages from different horizon models are labelled and should not be compared as if identical.

**Globe surface.** The Moon's texture is the NASA SVS LROC color global mosaic (`lroc_color_2k.jpg`) and Earth uses the NASA Blue Marble (`bluemarble-1024.png`), both served same-origin through Vercel rewrites and local proxies. Height grids are baked by `scripts/build-relief.mjs` from NASA elevation data (never from rendered colour maps); see *3D surface and relief* above.

**Custom waypoint terrain.** Clicking any point on the globe loads its real NASA LOLA patch (60°S–90°S coverage; 80°S–90°S uses the lighter LDEM_80S product) over HTTP byte ranges and derives the same 72-bin local horizon profile used by the study sites — feeding the sky diagram, terrain-aware visibility and the power model. Points outside the DEM coverage are explicitly labelled as flat-horizon approximations. Profiles cache per coordinate for the session.

**Power model.** First-order only: horizontal fixed array, 1361 W/m², constant load, ideal battery, no thermal or RF link budget. Earth "access" is a geometric antenna mask, not a communications guarantee.

### Independent JPL Horizons benchmark

The analytical Sun/Earth geometry was compared against **90 independently queried JPL Horizons observations** (three lunar sites × three seasons, November 2026 – July 2027), run on 10 October 2026 ([CI run 38064420213](https://github.com/adamjamiesimson/LunarNav-V2/actions/runs/38064420213)):

| Angular comparison | Max absolute error | Mean absolute error | RMSE |
| --- | ---: | ---: | ---: |
| Azimuth (circular difference) | 0.47998° | 0.42715° | 0.42867° |
| Elevation | 0.28492° | 0.14149° | 0.18812° |

Reference observations are archived in [`tests/fixtures/`](tests/fixtures/) and regression-checked at a 1° tolerance. That tolerance is a test threshold for these samples only — it is not a universal accuracy bound, and decisions near the horizon are especially sensitive to model error.

### Validation tooling

```sh
npm run validate:horizons -- references.csv [max_error_deg]  # compare a reference CSV
npm run validate:jpl                                        # live Horizons audit
HORIZONS_MAX_ERROR_DEG=1 npm run validate:jpl               # strict gating
npm run check:lola                                          # NASA DEM availability probe
```

`validate:horizons` compares an independently obtained CSV (`utc,latitude_deg,longitude_deg_east,sun_azimuth_deg,sun_elevation_deg,earth_azimuth_deg,earth_elevation_deg`) and reports max/mean/RMSE errors; it cannot authenticate the reference data. `validate:jpl` queries the Horizons API itself and prints a JSON error report.

## Terrain data (NASA LOLA)

- **Dataset selection** (`src/terrain.js`): coordinates in 80°S–90°S use `LDEM_80S_80MPP_ADJ.TIF` (80 m/px), 60°S–80°S uses `LDEM_60S_60MPP_ADJ.TIF` (60 m/px) — both cloud-optimised GeoTIFFs read through HTTP byte ranges. Coverage is therefore **60°S–90°S**; points outside are explicitly labelled flat-horizon.
- [`data/lola-horizons.json`](data/lola-horizons.json) ships archived 72-bin (5°) horizon profiles for the five study sites, exported by CI from the 80 m COG. Profiles derived at runtime use **360 azimuth bins (1°) with radial steps matched to the native pixel size**, and report coverage, max reliable range and source resolution.
- The full Float32 elevation patch is retained per waypoint (bounded LRU cache, stale-request cancellation) so horizon maths, the 3D surface and future surface views share one source. NoData is masked, never extrapolated.
- Assumptions and limits: MOON_ME south-polar stereographic, 0° central meridian, spherical curvature correction, 80% minimum pixel coverage. 60–80 m pixels miss small hazards; far-field terrain beyond 20 km, slopes and limb effects are not modelled.
- **Colour-map ingestion** (`src/color-dem.js`): colour-coded elevation maps can be decoded into heights *only* with a documented legend ramp and geographic reference; off-ramp pixels are masked. Native numerical DEMs always take precedence; hillshade images are not elevation sources.

## 3D surface and relief

- The globe's Moon uses **genuine elevation-dependent geometry** (terrain-aware ray intersection in `src/globe.js`, mirrored by the tested CPU reference in `src/relief.js`): ridges and crater walls change the silhouette and occlude the Sun/Earth spheres, with normals reconstructed from the displaced height field. LROC imagery remains the only surface colour — the terrain is never colour-coded.
- Multi-resolution heights: a global SLDEM2015 grid (LOLA+Kaguya, 90°S–60°N, ~5.3 km/px at the equator) plus a finer south-polar LOLA grid (~480 m/px) plus the native waypoint patch (60–80 m). Textures carry 12-bit heights; `data/relief.json` reports horizontal ground sample and vertical quantisation separately. The north polar cap (60°N–90°N) has no merged NASA product and is labelled uncovered.
- The **RELIEF ×N** control exaggerates displacement visually (default ×1 = physical scale) and never affects the scientific calculations. The selected-site marker rides the displaced surface at its terrain height.
- **Panoramic foundations** (`src/surface.js`): local east-north-up frames, a surface camera at the actual terrain height, and ephemeris directions transformed into the local frame with terrain obstruction (tested against the shared visibility rule). The surface renderer itself is the next step.

## Surface traverse and transit estimators

- **Traverse** (Engineering page): haversine distance on a sphere of R = 1737.4 km, driving time = distance / speed, sampled Sun/Earth visibility at the origin (loaded terrain horizon applied there only). No obstacle or slope-aware routing.
- **Transit** (Mission Windows page): scheduling estimate from reference transfer durations — `direct` (~3.5 days, 3–4 day family), `extended` (~7.5 days, low-energy family) or `custom` hours — anchored on either an Earth departure or a desired landing time, with a departure → cruise → LOI → descent → touchdown phase breakdown. No dV budget or trajectory propagation; destination coordinates identify the landing target but do not change the transit duration.

## Mission assistant (Gemini)

A floating **Ask AI** button (bottom-right corner) opens a chat panel that receives a compact snapshot of the live mission state and answers questions through Gemini function calling. `api/chat.js` (Vercel function) holds the API key (`GEMINI_API_KEY`, optional `GEMINI_MODEL`, default `gemini-3.8-flash`, optional `GEMINI_FALLBACK_MODELS`), sanitises all context, and runs a bounded tool loop (25 s per-call timeout, fallback model chain, per-model circuit breaker) against `src/tools.js` — the same calculation modules the planner uses (`src/tool-executor.js` is a thin browser-side entry point to that same implementation). The assistant can only call the ten declared tools; it cannot execute arbitrary code. Without a key it opens and shows a configuration message. History stays in browser memory/sessionStorage.

## Onboarding

A skippable six-second loading screen (once per tab session) and an optional three-step tour of the core workflow — select a location, select a mission date, explore mission conditions (once per browser profile, replayable from the **Take the tour** buttons or the footer). Both can be skipped without losing access to any tool.

## Tests and CI

- `npm test`: 129 unit tests covering the ephemeris, mission-window math, finder scoring, terrain horizon derivation, traverse/transit estimators, DOM contracts and the API handler (with a mocked Gemini SDK).
- `.github/workflows/ci.yml` runs tests and the build; `browser-smoke.yml` drives a headless Chromium through the main flows at desktop and mobile sizes without external network access (screenshots are saved as artifacts). A green pipeline proves program correctness, not scientific validity or appearance on every device.

## Roadmap

1. Broader JPL Horizons / NAIF SPICE validation, then a cached kernel-based ephemeris backend.
2. Disc radii, light-time and limb corrections; adaptive sampling at rise/set transitions.
3. Hardware-constrained power and direct-to-Earth link budgets with uncertainty bounds.
4. Terrain-aware routing and shadow analysis along traverse paths.
5. Published-reference geometry tests and usability studies.

## References

- [NASA Space Apps — Team 1st LunarNav](https://www.spaceappschallenge.org/2026/find-a-team/1st-lunarnav/)
- [NASA PDS — IM-2 Athena](https://pds.nasa.gov/ds-view/pds/viewContext.jsp?identifier=urn%3Anasa%3Apds%3Acontext%3Ainstrument_host%3Aspacecraft.clps_to_prime1_athena&version=1.0)
- [NASA — Malapert region](https://science.nasa.gov/image-detail/20100618/)
- [NASA — South-pole illumination map](https://science.nasa.gov/resource/illumination-map-of-the-moons-south-pole/)
- [NASA PGDA — LOLA south-polar DEM](https://pgda.gsfc.nasa.gov/products/90) ([data DOI](https://doi.org/10.60903/gsfcpgda-lola-spole))
- [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/manual.html) ([API](https://ssd-api.jpl.nasa.gov/doc/horizons.html))
- [NAIF SPICE](https://naif.jpl.nasa.gov/naif/)
- [IAU WGCCRE 2015 report](https://doi.org/10.1007/s10569-017-9805-5)

## Contribution policy

Only this repository is modified; Ankush's LunaSight repository remains untouched. Integration should go through small, reviewable PRs.
