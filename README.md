# LunarNav V2 — Lunar Mission Intelligence

An independently built, transparent lunar south-pole mission-planning experience for **NASA Space Apps Challenge 2026**, Team **1st LunarNav**. This is an experimental alternative to Ankush's LunaSight, intended to explore design and functionality before both teams integrate their best ideas.

## What works in this version

- Schematic, interactive lunar south-pole projection with selectable reference coordinates and custom map-selected waypoints
- UTC date/time and 3-, 7-, 14- or 28-day mission windows
- Analytical Moon-fixed **Sun and Earth azimuth/elevation**, recalculated as the UTC timeline moves
- Local sky-dome plot and replayable illumination / Earth-link / overlap timelines
- Same-window ranked comparison of five study points (with individual coordinate provenance)
- Simultaneous availability %, solar access %, Earth visibility %, longest continuous dual-access period, and longest sampled Earth blackout
- Export sampled observations as CSV; generate/copy/print mission briefing; share URL state
- Responsive, high-contrast UI without build-time client dependencies
- Explicit scientific disclaimers and linked primary references

## Run locally

Requires Node 18+ for tests. The app itself requires only a modern browser.

```sh
npm test
npm run build
npm run dev
```

Open http://localhost:4173. Deploy with Vercel; `vercel.json` defines a static build to `dist/`. All JS is native ES modules; no npm dependencies are required.

## Data + physics

- South pole points: NASA PDS (IM-2 landing coordinate), NASA Malapert image page (regional coordinate), NASA ESAS candidate Shackleton Rim (approximate); Faustini and Nobile are explicitly labeled illustrative study coordinates, **not surveyed landing sites**.
- Analytical ephemeris: truncated lunar/solar geocentric ecliptic series and IAU 2015 lunar axis/rotation orientation, converted to local Moon-fixed azimuth/elevation. Moon modeled as a sphere with level geometric horizon.
- Visibility: Sun or Earth **center** elevation > 0°, sampled at **two-hour UTC intervals**. Results are estimates for exploration, **not** verified Horizons or SPICE values. No terrain model, local crater horizon, limb treatment, solar eclipse, rover/lander shadow, surface hazards, power-budget calculation or communication link-budget prediction.
- Comparator uses four-hour samples for responsive ranking. The report uses two-hour samples. Window values are sample-based estimates, not exact time integration.
- Terrain map is procedurally drawn **illustration**, not a NASA LRO/LOLA elevation product.

### Upgrade roadmap (for the final competition entry)

1. **Validate against NASA JPL Horizons** lunar-topocentric positions across many epochs and locations; document position errors and correct them.
2. **Switch to JPL Horizons / NAIF SPICE** ephemeris in a backend with data caching and reproducible kernel versions.
3. Use **LRO/LOLA DEM** to construct a local azimuth-dependent horizon, handle solar/terrestrial apparent disc radii, and detect occlusion by terrain.
4. Calculate achievable energy, shadow time and actual direct-to-Earth link availability with hardware constraints and uncertainty bounds.
5. Add site/mission geometry tests with published NASA reference solutions and accessibility / usability studies.

### Reference material

- [NASA Space Apps — Team 1st LunarNav](https://www.spaceappschallenge.org/2026/find-a-team/1st-lunarnav/)
- [NASA PDS — IM-2 Athena](https://pds.nasa.gov/ds-view/pds/viewContext.jsp?identifier=urn%3Anasa%3Apds%3Acontext%3Ainstrument_host%3Aspacecraft.clps_to_prime1_athena&version=1.0)
- [NASA — Malapert region](https://science.nasa.gov/image-detail/20100618/)
- [NASA — South-pole illumination map](https://science.nasa.gov/resource/illumination-map-of-the-moons-south-pole/)
- [JPL Horizons manual](https://ssd.jpl.nasa.gov/horizons/manual.html)
- [NAIF SPICE](https://naif.jpl.nasa.gov/naif/)
- [IAU WGCCRE 2015 report](https://doi.org/10.1007/s10569-017-9805-5)

## Contribution policy

Only this repository is modified. Ankush's LunaSight code/repository remains untouched. Future integration should go through small, reviewable PRs after selecting the best components of each project.


## Engineering + terrain screening (phase 2)

LunarNav V2 now offers an **experimental first-order surface-system budget** next to the original flat-horizon visibility comparison. Enter solar panel area, cell efficiency, derating, continuous load, usable battery energy and a minimum Earth elevation angle for a **geometric antenna mask**. The simulation integrates two-hour ephemeris steps under a horizontal, fixed solar-panel approximation using 1361 W/m² solar irradiance. The battery starts fully charged; it is clamped to the specified capacity. Battery-charge plot, model energy deficit, generation and geometric Earth-access percentages are shown alongside the assumptions.

This simulation does **not** model a real spacecraft: no thermal effects, rover slewing, array tracking, battery chemistry, eclipse, equipment redundancy, power overhead variability, antenna pointing or radio link budget. An Earth-access percentage is **not** a communications guarantee. Default settings are hypothetical, not mission requirements.

### Actual DEM-backed local-horizon option

Click **Load NASA terrain** (or supply the actual NASA LOLA LDEM_80S_80MPP_ADJ.TIF in the local import control). It attempts an on-demand byte-range read from the NASA GSFC PGDA **80 m/pixel cloud-optimized south-polar GeoTIFF**. It reads only a ~40 km-wide patch around the selected lunar surface point, computes 72 azimuth-dependent horizon samples to a 20 km radius, and applies these samples **only to the selected-site engineering feasibility card**. A coarse spherical-lunar curvature correction is used; values are estimates.

- Source and methods: [NASA PGDA — A New View of the Lunar South Pole from LOLA](https://pgda.gsfc.nasa.gov/products/90), Barker et al. (2023), DOI [10.3847/PSJ/acf3e1](https://doi.org/10.3847/PSJ/acf3e1).
- Coverage: 80–90° south, MOON_ME south polar stereographic coordinates, with an assumed 0° east central meridian. Study-point accuracy depends on coordinate and DEM provenance.
- **Data availability is not guaranteed.** The NASA host may block or fail byte-range/CORS requests and remote datasets are large. If so, the app clearly says terrain is unavailable and retains the **flat-horizon** simulation; no invented terrain profile is used. Local importing is an option.
- Coarse data can miss small hazards and near-field shadows; azimuth interpolation can understate narrow occlusions. Neither this module nor the globe texture certifies a site for landing. Map imagery is not the same as the DEM.
- Rankings in the comparison section **remain flat-horizon estimates** to avoid silently mixing DEM availability across sites.

### Independent JPL Horizons comparison workflow

We added a reproducible validation harness. It **does not ship with genuine Horizons baseline data** and should not be represented as scientific validation completed. Obtain Moon-surface observer solar and Earth **azimuth/elevation** values separately from [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/manual.html) for the same UTC dates, coordinates and observer frames. See the [Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html); on the Moon use a surface coordinate observer (Moon body 301, east-positive longitude, latitude and altitude). Take care to use equivalent apparent/airless conventions: our analytical model omits light-time and limb corrections. Document the coordinate frame and ephemeris version.

Prepare a plain CSV with this exact header:

    utc,latitude_deg,longitude_deg_east,sun_azimuth_deg,sun_elevation_deg,earth_azimuth_deg,earth_elevation_deg

Then run:

    npm run validate:horizons -- path/to/independent-reference.csv
    npm run validate:horizons -- path/to/independent-reference.csv 1.0

The command reports maximum absolute error, mean absolute error and RMSE in degrees for both bodies' azimuth and elevation (with circular azimuth wrap). With a tolerance it exits nonzero when any maximum error is exceeded. The source CSV must be independently obtained, checked and archived with provenance. This tool compares numbers; it **cannot authenticate reference origins** or establish that Horizons comparison has already been performed.

#### Running tests

    npm test
    npm run build

New tests cover battery accounting/brownout, Earth antenna masks, terrain occlusion, azimuth interpolation, stereographic coordinates and DEM coverage failure. These are unit checks, **not** independent scientific validation or browser verification of NASA COG availability.


## Mission Window Finder (Phase 3)

The new **Window Finder** compares the site catalog against possible mission start dates rather than ranking all sites for only one start date. Choose a UTC scan start, 30 or 60 consecutive possible starts, 3/7/14-day duration, and the ranking objective. A heatmap shows each site vs date, recommended window cards list approximate solar, Earth, and simultaneous access, and clicking a heatmap square or recommendation opens the existing planner at that site/window. Export all candidate start-date results as CSV.

**Methodology and constraints:**
- Reuses the `src/astro.js` analytical Sun/Earth solver. Samples **every 4 hours** and assumes each 4-hour interval has the state of its starting sample. Each candidate day is evaluated from **12:00 UTC**. The normal planner resamples at 2 hours, so its more detailed metrics can differ slightly.
- Balanced score is explicitly `0.70 * dualAccessPct + 0.15 * solarAccessPct + 0.15 * earthVisibilityPct`. Solar or Earth priorities use the corresponding percentage directly. Rankings are **heuristics**, not scientifically optimized landing choices.
- All candidate scores remain on a **spherical 0° geometric horizon** for consistent comparisons. Existing optional DEM terrain is not applied to the finder. **No slope/landability, engineering energy balance, communication link margin, eclipse, PSR hazards, human factors or trajectory constraints** enter this ranking.
- Input dates are validated as actual UTC dates, and multi-date sampling is reused once per site rather than recomputing each overlapping window from scratch.
- New unit tests compare finder percentages with the planner's 4-hour sampling and check ranking order, UTC year transitions, blackout bounds, date validation and score math.

### Independent NASA/JPL ephemeris audit

**Scientific validation must be measured, not assumed.** The local checker `npm run validate:jpl` requests airless Sun (10) and Earth (399) azimuth/elevation quantities directly from [NASA JPL Horizons](https://ssd-api.jpl.nasa.gov/doc/horizons.html), from three Moon-fixed geodetic sites (`coord@301`) in November 2026 and March/July 2027. It compares those independent observations with `src/astro.js` and prints a JSON report with input queries, UTC timestamps, model and reference angles, azimuth-wrapped errors, maximum error, mean absolute error and RMSE (degrees).

The first 20 real Horizons observations from Mons Mouton and Malapert on 14–15 November 2026 are preserved in `tests/fixtures/jpl-horizons-20261114.csv`, with a 1° regression threshold **only for those specific samples**. The standard pull-request CI executes a broader three-site/three-season audit on a **best-effort basis**. If JPL cannot be contacted or does not return a valid ephemeris, the script fails explicitly; the successful build/tests still only attest to program correctness. **A successful test build is not independent validation**, and no results must be quoted without confirming the actual audit output. The simple analytical engine and Horizons use different apparent/geometric conventions, so nonzero errors are expected. The model should be corrected or replaced with a cached JPL/NAIF SPICE ephemeris if errors prove material.

Run standalone:

    npm run validate:jpl

For strict quality gating of the independently measured maximum angular error:

    HORIZONS_MAX_ERROR_DEG=1 npm run validate:jpl

The existing CSV-based independent reference comparison tool remains available: `npm run validate:horizons -- references.csv [maximum_error_deg]`. Neither command can verify terrain model accuracy. Reproducible data and actual in-browser NASA DEM reading still require additional validation.

### Independent JPL validation results — October 10, 2026

The live audit successfully retrieved **90 independent Sun/Earth azimuth/elevation observations** (45 unique site/UTC epochs, two celestial targets) across three lunar sites and three dates separated by months: November 14–15, 2026, March 14–15, 2027, and July 14–15, 2027.

| Angular comparison | Maximum absolute error | Mean absolute error | RMSE |
| --- | ---: | ---: | ---: |
| Azimuth (circular difference) | 0.47998° | 0.42715° | 0.42867° |
| Elevation | 0.28492° | 0.14149° | 0.18812° |

Source: real [NASA/JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html) outputs from [GitHub Actions run 38064420213](https://github.com/adamjamiesimson/LunarNav-V2/actions/runs/38064420213) (successful live audit step). Verified reference angles are preserved in:
- [Three-site three-season fixture](tests/fixtures/jpl-horizons-three-seasons.csv) — 45 UTC/site rows = 90 independently queried target angles.
- [Initial November 2026 fixture](tests/fixtures/jpl-horizons-20261114.csv) — 10 UTC/site rows = 20 independently queried target angles.

Automated regression checks ensure each of these **sampled reference cases** stays within a 1° tolerance. That tolerance is an engineering test threshold and **not** a blanket accuracy claim: worst-case angular error across all lunar dates/coordinates is not established. Predictions within approximately a degree of the apparent horizon are particularly sensitive to model error, sample interval, terrain, solar/Earth disc size and illumination/refraction conventions. JPL apparent positions and the current analytical geometry are not identical in their physical assumptions. We have not independently verified the LOLA DEM loader's absolute georegistration, all landing-site coordinates, or the power model against flight-grade software. A future kernel-based ephemeris should aim to reduce the remaining systematic angle differences.

## Phase 4 — Coverage-aware NASA LOLA terrain comparison

The Mission Window Finder now has an **explicit horizon-source selector**:
- **Geometric baseline (default)** compares all five published study coordinates using the same smooth 0° horizon assumptions as before. This mode always works without NASA DEM downloads.
- **Loaded terrain** compares **only** sites whose entire 20 km local-horizon profile was actually computed from compatible 80 m/pixel GeoTIFF elevations. **At least two** successfully loaded sites are required, and the Finder never mixes real terrain-corrected sites with unavailable/flat-horizon ones. Missing/stale/unvalidated horizon arrays produce an explicit error, not false zeros.
- **Load NASA terrain for all sites** attempts a sequential download of the needed local COG windows via range requests; partial failures are displayed site by site. You can also load a compatible TIFF manually for individual sites in the planner, then return to Finder. Those imported files are **user-supplied and unverified**; the app never claims they came from NASA. Successfully loaded site profiles are cached within the browser session for comparisons, not persisted or uploaded.
- The Finder's heatmap/CSV exports show which horizon model was used, and exports record the data provenance. The engineering panel still uses its loaded profile for the currently selected site.

### NASA server and georeferencing limitations

The exact [NASA GSFC PGDA 80m south polar COG](https://pgda.gsfc.nasa.gov/products/90) is `LDEM_80S_80MPP_ADJ.TIF`, hosted under `https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/`. NASA's site may temporarily return HTTP 503, fail CORS, or not support requests from Vercel/browser locations. Our built-in **best-effort availability probe** (`npm run check:lola`) checks the COG with a 256-byte HTTP range request and the pinned GeoTIFF.js browser library. **Even a successful probe does not prove that real browser decoding, projection and scientific horizon coordinates are correct.**

The DEM loader checks that the user's coordinate projects within the data bounding box, that the georeferencing gives roughly square 80 m/pixel cells, and that at least 80% of sampled horizon pixels are valid. It uses a south-polar stereographic MOON_ME coordinate assumption with east-positive longitude. This is a *provisional* engineering implementation, not independently verified GIS registration. Far-field occlusion beyond 20 km, permanent shadow, local slopes, spacecraft height, solar/Earth limb and measurement uncertainty remain unaccounted for. Do not interpret Finder percentages or rankings as flight-qualified landing recommendations.

Reference: Barker et al. (2023), [NASA PGDA](https://pgda.gsfc.nasa.gov/products/90), [data DOI 10.60903/gsfcpgda-lola-spole](https://doi.org/10.60903/gsfcpgda-lola-spole).

### Same-origin terrain proxy and safety preflight

The Vercel project now rewrites `/assets/lola-80m.tif` to NASA's public `LDEM_80S_80MPP_ADJ.TIF` URL, because NASA's raw Range response can omit browser CORS headers. Before opening a remote DEM, `selectSafeLolaSource()` sends a 64-byte Range request and **requires HTTP 206**; if Vercel does not preserve the Range response, it attempts NASA's direct URL only if CORS and partial bytes work. If neither endpoint provides safe partial access, the app refuses remote terrain loading rather than accidentally downloading the complete 181 MB dataset. The local file-import option remains available.

The October 10 GitHub Actions external availability probe returned **HTTP 206** and a 256-byte response from NASA, while the GeoTIFF.js bundle returned 200. NASA's direct response omitted a visible Access-Control-Allow-Origin header in that check; this is **not** proof that the website's same-origin rewrite supports 206, or that in-browser raster decoding and the 20 km horizon work. Those still require browser testing.


## Phase 5 — Offline NASA-derived lunar horizons + matched-date terrain effects

**The repository now ships small, source-backed derived horizon profiles for all five built-in lunar study coordinates.** All five profiles were extracted from the [NASA GSFC PGDA LOLA 80 m/pixel south-polar COG](https://pgda.gsfc.nasa.gov/products/90) by five separate [GitHub Actions jobs](https://github.com/adamjamiesimson/LunarNav-V2/actions/runs/38113102807). Each of the jobs actually read source elevation tiles and emitted 72 horizon elevation samples (5° azimuth bins, 20 km radius, 200 m ray steps). No made-up or synthetic data was substituted. The compact archive is [data/lola-horizons.json](data/lola-horizons.json), with 360 total derived horizon angles; raw 181 MB elevation rasters are **not** packaged.

| Built-in coordinate | Peak computed 20 km local horizon |
| --- | ---: |
| Mons Mouton | 4.018° |
| Malapert Region | 14.715° |
| Shackleton Rim (approximate candidate point) | 37.723° |
| Faustini Rim (illustrative point) | 9.032° |
| Nobile Region (illustrative point) | 12.775° |

The peak values are **model outputs at specific representative points**, not regional statistics or independently geospatially certified truth. Small obstacles, beyond-20-km obstructions, DEM uncertainty, limb visibility, surface slopes, local coordinate errors and flight-readiness are not covered.

### Behavior

- The site-specific terrain catalog is loaded **locally from the deployed site**, without downloading a NASA GeoTIFF at runtime. The app matches every profile against the site ID, exact coordinates, NASA dataset URL, sampling parameters, 72 azimuths, valid coverage, and range of elevations. Invalid data is refused, not silently replaced.
- Switch the Finder from **Geometric baseline** to **Loaded LOLA terrain** to see terrain-corrected candidate windows. When using terrain mode, it displays a new **Terrain Effect** section comparing the *exact same site/start date/duration* against the flat-horizon baseline. Deltas are in **percentage points**, and the CSV includes both models and matched differences. The built-in study sites are not certified landing locations.
- The original smoother baseline remains available, and the on-demand NASA or local GeoTIFF loader remains optional for user-selected coordinates and updated profiles. A user-supplied TIFF is not independently verified to come from NASA. Successfully loaded custom profiles take precedence for their exact site in that browsing session.
- NASA URL availability and GeoTIFF decoding no longer affect the normal five-site terrain Finder, as it uses the bundled derived profiles. The app does not pretend the profile is a true surface mesh. The globe's image texture is **not** a height map.

### Regenerate the catalog

The [Prepare NASA LOLA site profiles](.github/workflows/prepare-lola.yml) workflow can be started **manually** from GitHub Actions. It independently requests each site as a matrix job and logs \`LOLA_PROFILE_JSON:\` with a compact output from \`scripts/export-lola-site.js\`. A failed NASA request produces **no invented output**. Changes to the actual bundled catalog must be reviewed and committed after source-coordinate and integrity checks; regeneration does **not** silently overwrite the production data. The original official NASA COG extraction run is recorded as provenance in the catalog.

### Scientific qualifications

The lunar geometrical solver's benchmark of 90 Sun/Earth observations against JPL Horizons establishes errors for those *particular samples*, not universal accuracy. The derived LOLA horizon itself has not been independently tested with separate planetary-GIS raytracing or full terrain shadows; 20 km local visibility, angle binning, and sample timing can cause meaningful uncertainty near the horizon. Use the tool as **experimental mission-site screening only**, never as proof of landing safety, continuous power or operational radio contact.


## Phase 6 — Immersive Mission Control (visual experience + local visibility)

The primary LunarNav interface now focuses on two immediate mission questions: **what is visible from this site at the selected UTC time, and when will the next modeled visibility transition occur?** The Moon remains an interactive 3D *visual* globe; it is not a topographic rendering of LOLA data.

### Experience and interactions

- A streamlined, high-contrast dark landing experience puts **Explore the Moon** and **Find the best window** first.
- The previously hard-coded \`86.7°S\` mission-context card is replaced by **actual selected-site Sun/Earth local-horizon clearance angles** and a synchronized UTC mission HUD. Positive margins mean that body is above the currently selected local horizon; negative margins mean an obstruction under the approximate model. A warning appears when either margin is within 0.5° of the modeled horizon. This warning threshold is advisory, **not** a universal error guarantee.
- The **local sky diagram** renders the azimuth-dependent horizon from the bundled NASA LOLA 80m-derived 20km horizon profiles as a gold boundary, with Sun/Earth markers showing whether each is above that horizon. When terrain isn't available, the diagram explicitly labels its fallback **0° geometric horizon**; manually uploaded, unverified DEM data is labeled as unverified rather than NASA.
- The globe adds **Focus on site**, **Reset**, zoom, drag/keyboard orbit, and an immersive overlay with an **Esc** shortcut. When WebGL is unsupported, it keeps the schematic polar-map fallback. The image badge identifies whether NASA LROC imagery actually loaded; otherwise a procedural placeholder or schematic is shown.
- The mission clock adds **-6 hours**, **+6 hours**, and **Next horizon event**. The next-event search examines modeled Sun/Earth horizon state at 30-minute intervals, brackets changes and refines the crossing within the bracket; navigation rounds to a 30-minute visual step. This does **not** prove physical crossing accuracy below 30 minutes, and it may miss shorter temporary transitions between samples.

### Distinctions that matter

The **main timeline, legacy site cards, and mission summary** continue to use 0° *geometric* horizon visibility. **Live site status, selected-site power screening and the terrain-mode Finder** can use actual loaded local horizon profiles. They are intentionally labeled as different model views; do not compare percentages as if those data sources were identical. Globe illumination remains an artistic/geometric rendering based on a Sun vector, not terrain-cast lunar shadows.

There is **no quantitative antenna link budget, slope or landing-hazard certification, or mission-readiness guarantee**. The site catalog contains representative study coordinates, not validated safe landing spots.

### Automated browser verification

PRs include \`.github/workflows/browser-smoke.yml\`, which builds the standalone app and uses headless Chromium at desktop and mobile viewports. It verifies rendering without external network access, focus/full-screen/Esc, UTC clock stepping, terrain Finder and geometric-vs-terrain differences, and the absence of uncaught script errors. The workflow saves screenshots as a short-lived artifact. Source tests and production builds run separately via \`.github/workflows/ci.yml\`. A browser smoke pass proves these representative flows, **not** all Vercel devices, NASA image access, WebGL drivers or accuracy of terrain physics.


## Phase 7 — Focused multi-page LunarNav

The previously crowded single-screen dashboard is now a six-page mission-control workspace:

| Route | Purpose |
| --- | --- |
| `/` | Minimal overview and quick entries to the key tools |
| `/explore` | Full lunar globe, site selection, live Sun/Earth margins, local sky, time controls and visibility timeline |
| `/windows` | Site/date heatmap, ranked mission windows, NASA-derived terrain mode, exact-date comparisons and CSV |
| `/engineering` | Solar/battery assumptions, engineering time series, Earth elevation mask, optional DEM loading and export |
| `/compare` | All five site cards under the same UTC assumptions, with links to inspect sites in Explorer |
| `/science` | Independent JPL benchmark, NASA elevation source, model assumptions and links to technical details |

A lightweight client router uses **real URL paths and browser History API**, preserves selected site/date/duration across tools and supports browser Back/Forward. Existing `#planner`, `#finder`, `#compare`, `/planner`, and `/finder` links resolve to the appropriate new page. Vercel `rewrites` serve `index.html` on direct navigation and refresh; JS and CSS use root-relative asset paths. There is a single shared instance of the existing scientific engine and all existing DOM controls remain mounted, but only the requested tool's page is shown. Browser layout and navigation are intentionally separate from any claim of scientific accuracy.

### Run and verify

```sh
npm run dev                         # route-aware dev preview at http://127.0.0.1:4173/
npm run build
npm run preview                     # route-aware production preview
npm test                            # model, DOM and routing tests
```

The Chromium smoke workflow checks homepage links, focused page isolation, direct URL refresh, History API back/forward, Finder-to-Explorer handoff, engineering and comparison tools, and responsive desktop/mobile layouts. The public Vercel deployment still requires a visual check: source/build/Chromium CI is not proof of browser appearance on every device.

All scientific caveats continue to apply: terrain is an experimental 20 km derived NASA LOLA local horizon, the JPL benchmark covers sampled reference cases only, visual globe lighting isn't a true DEM shadow model, and no outputs are mission- or flight-qualified.


## Branded welcome and first-visit tutorial

LunarNav features a skippable **six-second branded lunar intro** once per browser tab session. It is a cinematic welcome animation (not a claim that NASA data is downloading), with a CSS progress track, orbital visuals, and an immediately accessible **Skip intro** button. Reopening another page within that tab, or refreshing it, does not repeat the splash. A 9.5-second emergency CSS fallback removes the screen if the main application fails to start.

On a **new visitor's first visit**, the intro is followed by a guided ten-step tour that highlights real interface elements across the six pages: overview, lunar globe, mission parameters, Sun/Earth visibility and local terrain, timeline, mission window discovery, terrain-aware Finder mode, engineering lab, site comparison, and scientific sources. The steps preview different pages **without replacing the current URL or modifying the selected site/date**. They display contextual explanations, step progress, Next/Back/Skip buttons, keyboard Left/Right navigation and Escape, a focus-contained dialog, a dimmed spotlight, and a mobile-specific layout.

The tutorial completion/skip state is kept in browser **localStorage**. Users who completed or skipped the tour do not see it again automatically on the same browser profile; they can launch it again using the header **?** button or footer **Take a tour** action. The loading screen uses **sessionStorage** so it appears only once in each tab session. When browser storage is denied, the experience remains skippable and does not crash. No login, personal information upload or tracking is required.

Automated tests cover all ten steps, storage failures, the first six-second intro, persistence, reload, replay, mobile skip and a full browser navigation pass. The splash and tour can be skipped without losing access to the underlying analytical model.
