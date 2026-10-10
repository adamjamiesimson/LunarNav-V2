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
