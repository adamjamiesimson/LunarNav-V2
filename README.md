# LunarNav V2 — lunar south-pole mission planning

An independently built, transparent lunar south-pole mission-planning prototype for **NASA Space Apps Challenge 2026**, Team **1st LunarNav**. It screens candidate landing sites and mission dates for Sun and Earth visibility, first-order power feasibility and local terrain horizons. Everything is an exploratory estimate — the tool does not certify landing safety, continuous power or radio contact, and is not affiliated with or endorsed by NASA.

## What it does

- Interactive lunar south-pole globe (WebGL, NASA LROC texture when available, schematic fallback) with five study coordinates plus custom map-selected waypoints
- UTC start date/time and 3/7/14/28-day mission windows; analytical Sun and Earth azimuth/elevation in a Moon-fixed frame, updated as time moves
- Visibility timeline (sunlight / Earth link / both), draggable inspection clock, next-horizon-event search, local sky-dome plot
- Same-window comparison of the five study points; simultaneous access %, solar access %, Earth visibility %, longest dual-access period, longest sampled Earth blackout
- Mission Window Finder: 30/60 candidate start dates × sites heatmap, ranked windows, geometric or terrain-aware horizon modes, terrain-effect comparison, CSV export
- Engineering screening: fixed solar array + battery simulation, Earth antenna elevation mask, state-of-charge chart, engineering CSV export
- NASA LOLA terrain: bundled 20 km derived horizon profiles for all five study sites, on-demand GeoTIFF byte-range loading, local `.tif` import
- Surface traverse estimator (geodesic distance, drive time, sampled visibility en route) and Earth-to-Moon transit estimator (reference-duration scheduling, not a trajectory solver)
- Mission briefing (copy/print), shareable URLs, Gemini-powered mission assistant (optional)
- Six-page workspace (overview / explore / windows / engineering / compare / science) with a small History API router

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

**Horizon models.** The timeline, site cards and comparison use the flat 0° horizon. Live site readouts, the sky plot, engineering screening and the Finder's terrain mode can use azimuth-dependent horizons derived from NASA LOLA 80 m DEM (20 km radius, 5° bins). Percentages from different horizon models are labelled and should not be compared as if identical.

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

- [`data/lola-horizons.json`](data/lola-horizons.json) ships 72-sample local horizon profiles (5° azimuth bins, 20 km radius, 200 m ray steps) for all five study sites, extracted from the NASA GSFC PGDA 80 m south-polar COG ([Barker et al. 2023](https://doi.org/10.3847/PSJ/acf3e1)) by GitHub Actions jobs ([`.github/workflows/prepare-lola.yml`](.github/workflows/prepare-lola.yml), run manually). Raw rasters are not packaged. The Finder's terrain mode compares only sites with valid loaded profiles and never mixes flat-horizon results in.
- On-demand loading reads only a ~40 km patch of `LDEM_80S_80MPP_ADJ.TIF` over HTTP byte ranges (a 206-response preflight prevents accidental full downloads); a Vercel same-origin rewrite and a local `.tif` import cover CORS failures. User-imported files are labelled unverified.
- Assumptions and limits: MOON_ME south-polar stereographic, 0° central meridian, spherical curvature correction, 80% minimum pixel coverage. Coarse 80 m pixels miss small hazards and narrow occlusions; far-field terrain beyond 20 km, slopes and limb effects are not modelled. The globe texture is imagery, not elevation.

## Surface traverse and transit estimators

- **Traverse** (Engineering page): haversine distance on a sphere of R = 1737.4 km, driving time = distance / speed, sampled Sun/Earth visibility at the origin (loaded terrain horizon applied there only). No obstacle or slope-aware routing.
- **Transit** (Mission Windows page): scheduling estimate from reference transfer durations — `direct` (~3.5 days, 3–4 day family), `extended` (~7.5 days, low-energy family) or `custom` hours — anchored on either an Earth departure or a desired landing time, with a departure → cruise → LOI → descent → touchdown phase breakdown. No dV budget or trajectory propagation; destination coordinates identify the landing target but do not change the transit duration.

## Mission assistant (Gemini)

A floating chat panel receives a compact snapshot of the live mission state and answers questions through Gemini function calling. `api/chat.js` (Vercel function) holds the API key (`GEMINI_API_KEY`, optional `GEMINI_MODEL`, default `gemini-3.8-flash`, optional `GEMINI_FALLBACK_MODELS`), sanitises all context, and runs a bounded tool loop (25 s per-call timeout, fallback model chain, per-model circuit breaker) against `src/tools.js` — the same calculation modules the planner uses (`src/tool-executor.js` is a thin browser-side entry point to that same implementation). The assistant can only call the ten declared tools; it cannot execute arbitrary code. Without a key it opens and shows a configuration message. History stays in browser memory/sessionStorage.

## Onboarding

A skippable six-second loading screen (once per tab session) and an optional ten-step tour across the six pages (once per browser profile, replayable from the **Take a tour** buttons in the header and on the overview page, or from the footer). Both can be skipped without losing access to any tool.

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
