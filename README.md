# LunarNav V2 — lunar mission planning

A NASA Space Apps Challenge 2026 prototype by **Team 1st LunarNav**. Select a lunar site and UTC period to screen Sun/Earth visibility, local horizons and first-order engineering constraints. These are exploratory estimates, not landing certification, guaranteed power or an RF link budget. Not affiliated with or endorsed by NASA.

## Run locally

Use **Node 22.13+** (Node 24 also tested). Client code is native browser ES modules; the optional server-side assistant uses `@google/genai`.

```sh
npm ci
npm test
npm run build
npm run dev                 # http://localhost:4173
npx playwright install chromium
node scripts/browser-smoke.mjs # build first; desktop and mobile Chromium
```

The lockfile is committed. Both CI workflows install with `npm ci`; browser CI additionally installs Chromium's system dependencies. Production output is `dist/`; `vercel.json` preserves direct routes and data proxies. The preview server serves files and proxies assets; it does not run the Gemini function.

## Workspace

- **Explore** opens immediately: rotatable displaced globe, five study sites or a custom point selected on the globe, UTC inspection, visibility timeline, sky diagram and mission results.
- **Windows** ranks sites and dates with geometric or loaded-terrain horizons; includes a reference-duration Earth-to-Moon transit estimator.
- **Compare** shows site rankings, a shared metric table/timeline and two-date comparison. Sampling is labelled; different resolutions can produce different percentages.
- **Engineering** simulates a horizontal solar array, constant load and ideal battery; includes terrain refinement/import and a spherical surface-traverse estimate.
- **Methods** holds short help, data provenance, resolution and limitations. Every visit starts with a five-second loading screen, graphics choice, and the three-step tutorial; it can also be replayed from Methods.

Mission-timeline, Finder and engineering CSVs export distinct datasets. The mission briefing supports copying and print/save-PDF. Share URLs retain preset site, date and duration; custom coordinates are not encoded in share URLs.

## Data and models

**Sites.** Mons Mouton is the NASA PDS IM-2 landing coordinate; Malapert is a NASA reference coordinate; Shackleton Rim is an approximate historical candidate. Faustini and Nobile are illustrative study points, not surveyed landing sites. Source links and classifications remain in the interface.

**Geometry.** `src/astro.js` uses truncated lunar/solar series and IAU 2015 lunar rotation to compute Moon-fixed local azimuth/elevation. A body's centre must exceed the azimuth-dependent terrain horizon, or 0° when no terrain is available. Timeline, comparison, Finder, engineering and assistant tools share the visibility rule. The planner/comparison uses two-hour samples; rankings/Finder use four-hour samples; engineering adds a separate antenna elevation mask. Those sampling and model differences remain explicit. No eclipses, disc/limb corrections, light-time, spacecraft shadows or hazard model.

**Relief and custom horizons.** The committed **8192 × 4096** global grid is approximately **1.33 km/pixel at the equator**, combining SLDEM2015 mid-latitudes with numerical polar DEMs. North and south polar grids are approximately **480 m/pixel**. These are real elevation grids, not heights inferred from imagery; sources, datum and 12-bit vertical quantisation are in `data/relief.json`. Custom points derive a coarse horizon from the appropriate bundled grid. That is different from a native-resolution patch.

The globe uses elevation-dependent ray intersection and surface normals. Graphics presets are **Low ×2**, **Medium ×5** (default), and **High realistic ×10**. These names select visual relief exaggeration only; ×10 is exaggerated rather than physical-scale geometry, and scientific calculations retain actual elevations. GPU uploads are capped at 4096 pixels on desktop and 2048 on small screens, subject to the device limit; nearest sampling preserves packed height codes. Scientific window sampling uses the original assets. Canvas readback covers only the requested window, one decoded grid is retained, custom profile storage is bounded, and unchanged patches are not reuploaded. This bounds resources but does not establish performance on every laptop or phone.

**Native terrain.** Archived `data/lola-horizons.json` profiles cover the five study sites (20 km, 72 bins at 5°). Optional runtime refinement derives 360 bins at 1°:

- 80°S–90°S: NASA LOLA `LDEM_80S_80MPP_ADJ.TIF`, 80 m/pixel.
- 60°S–80°S: NASA LOLA `LDEM_60S_60MPP_ADJ.TIF`, 60 m/pixel.
- Between 60°S and 60°N: SLDEM2015, 128 pixels/degree (~237 m at the equator), pixel-registered little-endian float32 kilometres above R = 1737.4 km. Reads require exact, bounded, uncompressed HTTP 206 ranges; longitude seam spans are split. Invalid or oversized data is rejected before decoding.
- Northern polar sites retain the bundled 480 m grid; a native north-polar runtime loader is not implemented.

Runtime patches preserve Float32 metres, NoData masks and georeferencing for horizons and the globe. Site changes cancel/invalidate old requests, and all derived mission samples refresh when terrain changes. Failed refinements explicitly retain an existing grid/profile or the labelled geometric fallback. External requests have timeouts. Local 60–100 m compatible MOON_ME south-polar GeoTIFF imports remain available, with unverified provenance.

Horizons include spherical curvature over a 20 km radius with radial steps matched to source resolution. Far-field terrain, unresolved hazards and narrow occlusions remain limitations. `src/surface.js` implements local frames, terrain-height cameras and visibility foundations; **a surface-view renderer is not implemented**. Colour-map ingestion remains available only with a documented legend/georeference; USGS SIM 3316 shaded topography was rejected as a numerical DEM and is a cartographic reference only.

**Engineering and travel.** Power assumes a fixed horizontal array, 1361 W/m², constant load, battery initially full and ideal storage; no thermal or chemistry model. Earth access is geometric with an antenna mask. Traverse uses great-circle distance on a 1737.4 km spherical Moon and samples visibility at the origin, not along a slope/obstacle-aware route. Transit uses reference durations (~3.5 days direct, ~7.5 days extended, or custom); coordinates identify the target without changing duration. It is not trajectory propagation or a delta-v solution.

## Optional Gemini assistant

Configure `GEMINI_API_KEY` on the server. Optional `GEMINI_MODEL` (default `gemini-3.8-flash`) and `GEMINI_FALLBACK_MODELS` select models. See `.env.example`. The key is never shipped to the client. `api/chat.js` imports the real SDK and runs bounded function calls through `src/tools.js`; tools use the planner's calculations and matching terrain profiles. Full azimuth arrays retain their angular sampling through sanitisation. Conversation history remains in browser memory/sessionStorage. Missing configuration is shown explicitly. SDK import/API shape and handler behaviour were tested; no live keyed Gemini response was verified in this cleanup.

## Verification

`npm test`: **186 passing, zero skipped** after a clean install. Coverage includes archived JPL fixtures, terrain projections/units, safe range handling, stale-request protection, DOM boot, mission calculations, assistant consistency and handler contracts. Onboarding tests cover the five-second delay, all three graphics mappings, tutorial navigation/skip/replay and preservation of mission inputs; scientific tests were retained.

Chromium smoke checks desktop (1440 × 900), mobile (390 × 844), navigation/deep links, camera/time controls, custom waypoint terrain, comparisons/Finder, engineering, traverse/transit, CSV downloads, briefing generation, assistant-unavailable feedback, texture upload errors/limits and horizontal overflow. Native browser patch and stale-response tests use **explicit synthetic range fixtures**. Screenshots and upload records go to `smoke-artifacts/`. Headless SwiftShader results are not physical-device frame-rate or total-memory benchmarks.

On **7 November 2026**, a live independent JPL Horizons audit returned 90 Sun/Earth observations (three sites × three seasons), reproducing the archived benchmark:

| Angular comparison | Max error | Mean error | RMSE |
| --- | ---: | ---: | ---: |
| Azimuth, circular | 0.47998° | 0.42715° | 0.42867° |
| Elevation | 0.28492° | 0.14149° | 0.18812° |

These samples do not give universal accuracy bounds or validate terrain, power or mission safety. Regression fixtures remain in `tests/fixtures/`.

Live access checks returned 206 for the polar COG and exact 32-byte SLDEM responses; the SLDEM PDS label confirmed dimensions, registration and units. A real Mons Mouton 80 m LOLA patch loaded with 100% coverage to 20 km. A full 20 km SLDEM refinement **timed out**, despite successful small probes; native mid-latitude loading therefore remains network-dependent. Its decoder/projection and browser integration passed fixture tests. Neither a deployed Vercel proxy nor a physical mobile device was verified.

```sh
npm run validate:horizons -- references.csv 1 # compare externally supplied CSV
npm run validate:jpl                        # independent live Horizons audit
npm run check:lola                          # NASA range/CDN availability
```

Remote resources include NASA/MIT terrain endpoints and the pinned GeoTIFF.js CDN reader for runtime COGs; optional imagery proxies provide NASA LROC and Blue Marble. Bundled relief, imagery and archived horizons remain usable offline. NASA data/API access can fail independently of the static application.

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
