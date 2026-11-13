# LunarNav: Lunar Mission Planning

A NASA Space Apps Challenge 2026 prototype by **Team 1st LunarNav**. Screen lunar sites and UTC periods for Sun/Earth visibility, local horizons, and first-order engineering constraints. Outputs are exploratory estimates, not landing certification, guaranteed power, or RF link budgets. Not affiliated with or endorsed by NASA.

## Run locally

Requires **Node 22.13+** (Node 24 tested). Client uses native browser ES modules; optional server-side AI assistant uses `@google/genai`.

```sh
npm ci                         # Lockfile committed; CI installs Chromium system deps
npm test
npm run build                  # Outputs to dist/ (vercel.json preserves routes/proxies)
npm run dev                    # http://localhost:4173 (serves files/proxies; no Gemini function)
npx playwright install chromium
node scripts/browser-smoke.mjs # Run after build; tests desktop and mobile Chromium

```

## Workspace

* **Explore (default):** Rotatable displaced globe, 5 study sites or custom globe point, UTC inspection, visibility timeline, sky diagram, and mission results.
* **Plan Mission (`/planning`, legacy `/windows` & `/compare` work):** Unified date/time/duration/horizon controls driving a 6-metric site table, Sun/Earth timelines, and 3 recommended windows (clickable to open in Explore). Tracks illumination, longest darkness, Earth visibility/gaps, simultaneous access, and reference solar energy, with expandable date calendar, two-date comparison, and reference Earth-to-Moon timing.
* *Sampling & Terrain:* Search uses 4-hr samples; comparison uses 2-hr samples. Loaded-terrain comparisons include covered sites only; flat mode is explicit. Exports retain all search windows, terrain provenance, and matched baseline deltas.


* **Engineering:** Simulates horizontal solar array, constant load, and ideal battery; includes terrain refinement/import and spherical surface-traverse estimates.
* **Methods:** Help, data provenance, resolution, and limitations.
* **Onboarding & Exports:** Visits open with a 10s logo screen, 10s browser memory notice, graphics preset choice, and a replayable 12-step spotlight tutorial (covers site, period, globe, time, outlook, timeline, comparison, recommended dates, terrain refinement, power/battery, surface panorama, and AI assistant; highlights active UI in green, adapts to viewport, and restores initial state on exit). Exports distinct CSVs (timeline, Finder, engineering), copyable/printable PDF mission briefings, and share URLs (retains preset site, date, duration; excludes custom coordinates).

## Data and models

* **Globe & Surface Panorama:** Uses NASA SVS LROC color mosaic (`lroc_color_2k.jpg`) and NASA Blue Marble (`bluemarble-1024.png`) via same-origin Vercel rewrites/local proxies. Height grids are baked by `scripts/build-relief.mjs` from NASA elevation data (never color maps). *View panorama of location* flies to any selected waypoint and renders a drag-to-look 360° horizon panorama ray-marched from DEM heights (native waypoint patch near-field, baked grid far-field) with real Sun/Earth positions and silhouette obstruction.
* **Sites:** Mons Mouton (NASA PDS IM-2 coordinate), Malapert (NASA reference), Shackleton Rim (approximate historical candidate), and Faustini/Nobile (illustrative study points); classifications/links remain in the UI.
* **Geometry (`src/astro.js`):** Truncated lunar/solar series and IAU 2015 lunar rotation compute Moon-fixed azimuth/elevation. Visibility requires a body's center to exceed the local terrain horizon (or 0° fallback), shared across timeline, comparison, Finder, engineering, and AI tools. Planner/comparison samples at 2 hrs; rankings/Finder at 4 hrs; engineering adds an antenna elevation mask. Excludes eclipses, disc/limb corrections, light-time, spacecraft shadows, and hazard models.
* **Relief & Rendering:** Committed **8192 × 4096** global grid (~1.33 km/px at equator, combining SLDEM2015 mid-latitudes and polar DEMs) plus ~480 m/px north/south polar grids (datum/12-bit vertical quantization in `data/relief.json`). Custom points derive coarse horizons from bundled grids.
* *Graphics:* Uses elevation-dependent ray intersection and surface normals. Presets (**Low ×2**, **Medium ×5** [default], **High realistic ×10**) apply visual relief exaggeration only; scientific calculations use true elevations. GPU uploads cap at 4096 px (desktop) / 2048 px (mobile/small screens) with nearest sampling; canvas readbacks cover requested windows only, retaining one decoded grid, bounded custom storage, and cached patch uploads (bounds resources, does not guarantee device performance).


* **Native Terrain & Horizons:** Archived `data/lola-horizons.json` covers the 5 study sites (20 km radius, 72 bins at 5°). Optional runtime refinement derives 360 bins at 1° via bounded, exact HTTP 206 uncompressed range requests (splitting longitude seams, rejecting invalid/oversized payloads, enforcing timeouts, canceling stale site requests, and falling back cleanly on error):
* **80°S–90°S:** NASA LOLA `LDEM_80S_80MPP_ADJ.TIF` (80 m/px).
* **60°S–80°S:** NASA LOLA `LDEM_60S_60MPP_ADJ.TIF` (60 m/px).
* **60°S–60°N:** SLDEM2015 (128 px/deg, ~237 m/px at equator, little-endian float32 km above R = 1737.4 km).
* **North Pole:** Retains bundled 480 m grid (no native runtime loader).
* Runtime patches preserve Float32 meters, NoData masks, and georeferencing, refreshing all mission samples on update. Local 60–100 m `MOON_ME` south-polar GeoTIFF imports are supported (unverified provenance). Horizons model spherical curvature over 20 km with source-matched radial steps (far-field terrain, unresolved hazards, and narrow occlusions remain limitations). `src/surface.js` provides local frames/cameras/visibility foundations (**no surface-view renderer implemented**). Color-map ingestion requires documented legends/georeferencing; USGS SIM 3316 shaded topography is cartographic reference only.


* **Engineering & Travel:** Power assumes a fixed horizontal array (1361 W/m²), constant load, and an initially full ideal battery (no thermal/chemistry models). Earth access is geometric plus antenna mask. Traverse computes great-circle distance on a 1737.4 km spherical Moon using origin visibility only (no slope/obstacle routing). Transit uses reference durations (~3.5 days direct, ~7.5 days extended, or custom; coordinates identify target without trajectory propagation or delta-v calculation).

## Optional Gemini assistant

Set `GEMINI_API_KEY` on the server (never exposed to client); optional `GEMINI_MODEL` (default `gemini-3.8-flash`) and `GEMINI_FALLBACK_MODELS` configure models (see `.env.example`). `api/chat.js` runs bounded function calls via `src/tools.js` using planner math, matching terrain profiles, and full-resolution azimuth arrays. Conversation history stays in browser memory/sessionStorage, and missing config is flagged in the UI. SDK import/API shape and handler behavior are tested (live keyed Gemini responses not verified in this cleanup).
## References

- [NASA Space Apps : Team 1st LunarNav](https://www.spaceappschallenge.org/2026/find-a-team/1st-lunarnav/)
- [NASA PDS : IM-2 Athena](https://pds.nasa.gov/ds-view/pds/viewContext.jsp?identifier=urn%3Anasa%3Apds%3Acontext%3Ainstrument_host%3Aspacecraft.clps_to_prime1_athena&version=1.0)
- [NASA : Malapert region](https://science.nasa.gov/image-detail/20100618/)
- [NASA : South-pole illumination map](https://science.nasa.gov/resource/illumination-map-of-the-moons-south-pole/)
- [NASA PGDA : LOLA south-polar DEM](https://pgda.gsfc.nasa.gov/products/90) ([data DOI](https://doi.org/10.60903/gsfcpgda-lola-spole))
- [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/manual.html) ([API](https://ssd-api.jpl.nasa.gov/doc/horizons.html))
- [NAIF SPICE](https://naif.jpl.nasa.gov/naif/)
- [IAU WGCCRE 2015 report](https://doi.org/10.1007/s10569-017-9805-5)

