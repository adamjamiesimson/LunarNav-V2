# LunarNav: Lunar Mission Planning

A NASA Space Apps Challenge 2026 prototype built by **Team 1st LunarNav**. Pick a lunar site and a UTC timeframe to screen Sun and Earth visibility, local terrain horizons, and first-order engineering constraints. Keep in mind that these are exploratory estimates rather than landing certification, guaranteed power, or an RF link budget. This project is not affiliated with or endorsed by NASA.

## Run locally

You will need **Node 22.13+** (Node 24 is also tested). The client runs on native browser ES modules, while the optional server-side assistant uses `@google/genai`.

```sh
npm ci                         # Lockfile is committed; CI installs Chromium system deps
npm test
npm run build                  # Outputs to dist/ (vercel.json preserves routes and proxies)
npm run dev                    # Starts http://localhost:4173 (serves files/proxies; no Gemini function)
npx playwright install chromium
node scripts/browser-smoke.mjs # Run after building; tests desktop and mobile Chromium

```

## Workspace

* **Explore (default):** A rotatable displaced globe with 5 study sites (or any custom point you click), UTC time inspection, a visibility timeline, a sky diagram, and mission results.
* **Plan Mission (`/planning`, with legacy `/windows` and `/compare` links still supported):** Set one date, time, duration, and horizon to drive a 6-metric site table, Sun/Earth timelines, and 3 recommended windows that open straight into Explore. It tracks illumination, longest darkness, Earth visibility and gaps, simultaneous access, and reference solar energy, with expandable views for a date calendar, two-date comparisons, and reference Earth-to-Moon transit timing.
* *Sampling and terrain:* Window searches sample every 4 hours, while comparisons sample every 2 hours. Loaded-terrain comparisons only include covered sites, and flat mode is clearly labeled. Exports preserve all search windows, terrain provenance, and matched baseline deltas.


* **Engineering:** Simulates a horizontal solar array, constant load, and an ideal battery, alongside terrain refinement/import and spherical surface-traverse estimates.
* **Methods:** Quick help, data provenance, resolution details, and known limitations.
* **Onboarding and exports:** Every visit opens with a 10-second logo screen, a 10-second browser memory notice, a graphics preset selector, and a 12-step spotlight tour (replayable from Methods). The tour walks through site selection, mission period, the globe, time inspection, site outlook, the visibility timeline, site comparison, recommended dates, terrain refinement, power/battery assumptions, the surface panorama, and the AI assistant. It highlights active features in green, adapts to your screen size, and restores your starting page and inputs when finished or skipped. You can export distinct CSVs (timeline, Finder, engineering), copy or print/save PDF mission briefings, and generate share URLs (which keep preset sites, dates, and durations, though custom coordinates are left out).

## Data and models

* **Globe and surface panorama:** Uses the NASA SVS LROC color mosaic (`lroc_color_2k.jpg`) and NASA Blue Marble (`bluemarble-1024.png`), served same-origin via Vercel rewrites and local proxies. Elevation grids are baked from real NASA height data using `scripts/build-relief.mjs` (never from color maps). Clicking *View panorama of location* flies the globe down to your selected waypoint and renders a drag-to-look 360° horizon panorama ray-marched directly from the DEM heights (using the native waypoint patch nearby and the baked grid farther out), plotting the Sun and Earth at their actual azimuth/elevation with silhouette terrain obstruction.
* **Sites:** Mons Mouton uses the NASA PDS IM-2 landing coordinate, Malapert uses a NASA reference coordinate, and Shackleton Rim is an approximate historical candidate. Faustini and Nobile are illustrative study points rather than surveyed landing sites. Full classifications and source links live inside the UI.
* **Geometry (`src/astro.js`):** Computes Moon-fixed local azimuth and elevation using truncated lunar/solar series and IAU 2015 lunar rotation. A body counts as visible when its center clears the local azimuth-dependent terrain horizon (or 0° if no terrain is loaded). This rule is shared across the timeline, comparison, Finder, engineering, and AI tools, though sampling rates differ explicitly (2 hours for planner/comparison, 4 hours for rankings/Finder, plus a separate antenna elevation mask in engineering). Eclipses, disc/limb corrections, light-time, spacecraft shadows, and hazard models are not included.
* **Relief and rendering:** Ships with an **8192 × 4096** global grid (~1.33 km/px at the equator, blending SLDEM2015 mid-latitudes with polar DEMs) and ~480 m/px north and south polar grids (datum and 12-bit vertical quantization are documented in `data/relief.json`). Custom globe clicks derive a coarse horizon from these bundled grids.
* *Graphics:* Uses elevation-dependent ray intersection and surface normals. The **Low ×2**, **Medium ×5** (default), and **High realistic ×10** presets control visual relief exaggeration only, while scientific calculations always use true elevations. GPU uploads cap at 4096 px on desktop and 2048 px on small screens using nearest sampling. Canvas readbacks only cover the requested window, retaining a single decoded grid, bounded custom profile storage, and cached patch uploads to keep resource usage bounded (though performance still varies by device).


* **Native terrain and horizons:** Pre-archived profiles in `data/lola-horizons.json` cover the 5 study sites (20 km radius, 72 bins at 5°). Optional runtime refinement calculates 360 bins at 1° using exact, bounded HTTP 206 uncompressed range requests (splitting longitude seams, rejecting oversized/invalid data, enforcing timeouts, canceling stale site requests, and safely falling back on errors):
* **80°S to 90°S:** NASA LOLA `LDEM_80S_80MPP_ADJ.TIF` (80 m/px).
* **60°S to 80°S:** NASA LOLA `LDEM_60S_60MPP_ADJ.TIF` (60 m/px).
* **60°S to 60°N:** SLDEM2015 (128 px/deg, ~237 m/px at the equator, pixel-registered little-endian float32 km above R = 1737.4 km).
* **North Pole:** Keeps the bundled 480 m grid, as a native runtime loader is not implemented.
* Runtime patches preserve Float32 meters, NoData masks, and georeferencing, automatically refreshing all derived mission samples. You can also import local 60–100 m `MOON_ME` south-polar GeoTIFFs (provenance unverified). Horizons account for spherical curvature across a 20 km radius with radial steps matched to source resolution, leaving far-field terrain, unresolved hazards, and narrow occlusions as known limitations. While `src/surface.js` sets up local frames, terrain-height cameras, and visibility foundations, a full surface-view renderer is not yet implemented. Color-map ingestion requires a documented legend and georeference, and USGS SIM 3316 shaded topography is strictly a cartographic reference.


* **Engineering and travel:** Power modeling assumes a fixed horizontal array (1361 W/m²), constant load, and a full ideal battery without thermal or chemistry models. Earth access is purely geometric plus your antenna mask. Traverse estimates great-circle distance on a 1737.4 km spherical Moon and checks visibility only at the origin rather than along a slope- or obstacle-aware path. Transit timing uses reference durations (~3.5 days direct, ~7.5 days extended, or custom), using target coordinates for identification without trajectory propagation or delta-v math.

## Optional Gemini assistant

Set `GEMINI_API_KEY` on the server so it is never exposed to the browser; you can also configure `GEMINI_MODEL` (defaults to `gemini-3.8-flash`) and `GEMINI_FALLBACK_MODELS` (see `.env.example`). `api/chat.js` imports the official SDK and runs bounded function calls through `src/tools.js`, sharing the planner's math, terrain profiles, and full-resolution azimuth arrays. Chat history lives in browser memory/sessionStorage, and missing API configuration is surfaced clearly in the UI. Both the SDK shape and handler behavior are tested, though no live keyed Gemini response was verified during this cleanup.

## References

- [NASA Space Apps : Team 1st LunarNav](https://www.spaceappschallenge.org/2026/find-a-team/1st-lunarnav/)
- [NASA PDS : IM-2 Athena](https://pds.nasa.gov/ds-view/pds/viewContext.jsp?identifier=urn%3Anasa%3Apds%3Acontext%3Ainstrument_host%3Aspacecraft.clps_to_prime1_athena&version=1.0)
- [NASA : Malapert region](https://science.nasa.gov/image-detail/20100618/)
- [NASA : South-pole illumination map](https://science.nasa.gov/resource/illumination-map-of-the-moons-south-pole/)
- [NASA PGDA : LOLA south-polar DEM](https://pgda.gsfc.nasa.gov/products/90) ([data DOI](https://doi.org/10.60903/gsfcpgda-lola-spole))
- [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/manual.html) ([API](https://ssd-api.jpl.nasa.gov/doc/horizons.html))
- [NAIF SPICE](https://naif.jpl.nasa.gov/naif/)
- [IAU WGCCRE 2015 report](https://doi.org/10.1007/s10569-017-9805-5)

