# LunarNav V2 — Lunar Mission Intelligence

An independently built, transparent lunar south-pole mission-planning experience for **NASA Space Apps Challenge 2026**, Team **1st LunarNav**. This is an experimental alternative to Ankush's LunaSight, intended to explore design and functionality before both teams integrate their best ideas.

## What works in this version

- Schematic, interactive lunar south-pole projection with selectable reference coordinates and custom map-selected waypoints
- UTC date/time and 3-, 7-, 14- or 28-day mission windows
- Analytical Moon-fixed **Sun and Earth azimuth/elevation**, recalculated as the UTC timeline moves
- Local sky-dome plot and replayable illumination / Earth-link / overlap timelines
- Same-window ranked comparison of five study points (with individual coordinate provenance)
- Simultaneous availability %, solar access %, Earth visibility %, and longest sampled Earth blackout
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
