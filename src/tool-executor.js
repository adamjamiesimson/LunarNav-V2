/**
 * Browser-side tool-execution layer used by the mission assistant.
 *
 * Reuses the exact same exported LunarNav calculation functions the planner
 * UI uses (ephemeris, sampleWindow, summarize, findMissionWindows,
 * simulateMission, inspectSituation, findNextHorizonEvent, estimateSurfaceTraverse,
 * estimateEarthMoonTransit).
 * Returns structured function responses; the actual tool *declarations* live
 * server-side in src/tools.js so browser and API never drift.
 */
import {ephemeris,sampleWindow,summarize,longestDualWindow,rankedSites} from './astro.js';
import {SITES} from './sites.js';
import {simulateMission,validateEngineering} from './mission.js';
import {findMissionWindows} from './finder.js';
import {inspectSituation,findNextHorizonEvent} from './situation.js';
import {estimateSurfaceTraverse} from './travel.js';
import {estimateEarthMoonTransit} from './transit.js';

export {TOOL_DECLARATIONS} from './tools.js';

const lunarNav = {
  state: {
    site: null, date: null, time: null, days: 7, offsetHours: 0,
    inspectionUTC: null, terrain: null, simulation: null, missionSummary: null,
    finder: null, isCustom: false
  },
  terrainProfilesBySite: {},
  setState(partial){ Object.assign(this.state, partial); }
};

/** Attach live application state (set up once by app.js). */
export function configureAssistantState(hook){
  lunarNav.stateIsConfigured = true;
  lunarNav.getContext = hook;
}
export function currentAssistantContext(){
  if (typeof lunarNav.getContext === 'function') return lunarNav.getContext();
  return lunarNav.state;
}

function profileForSite(siteId){
  return lunarNav.terrainProfilesBySite[siteId] || (lunarNav.state.site?.id === siteId ? lunarNav.state.terrain : null) || null;
}
function currentSite(){
  const c = currentAssistantContext();
  if (!c.site) throw new Error('No mission configuration loaded yet. Select a site and run the planner first.');
  return c.site;
}
function baseUTC(){
  const c = currentAssistantContext();
  const base = (c.date && /^\d{4}-\d{2}-\d{2}$/.test(String(c.date))) && (c.time && /^\d\d:\d\d$/.test(String(c.time)))
    ? new Date(`${c.date}T${c.time}:00Z`)
    : new Date();
  return base;
}

const browserExecutors = {
  get_mission_context(){
    const c = currentAssistantContext();
    return {
      app: 'LunarNav V2 — lunar south-pole mission planning',
      selectedSite: c.site,
      mission: {startDate: c.date, startTimeUTC: c.time, startUTC: baseUTC().toISOString(), durationDays: c.days},
      inspectionOffsetHours: c.offsetHours,
      inspectionUTC: c.inspectionUTC || new Date(baseUTC().getTime() + (c.offsetHours || 0) * 3600000).toISOString(),
      terrain: {applied: Boolean(c.terrain?.applied || c.terrainProfileApplied), source: c.terrain?.source || null, verifiedSource: Boolean(c.terrain?.verifiedSource)},
      missionSummary: c.missionSummary || null,
      simulation: c.simulation || null,
      finder: c.finder ? {startDate: c.finder.startDate, top: (c.finder.top || []).slice(0, 5)} : null,
      availableSites: SITES.map(s => ({id: s.id, name: s.name, lat: s.lat, lon: s.lon})),
      limitations: 'Analytical screening ephemeris; geometric horizon unless terrain loaded; not flight-qualified; Earth visibility is not an RF link budget.'
    };
  },
  calculate_celestial_conditions(args){
    const utc = new Date(String(args.utcTimestamp));
    if (Number.isNaN(utc.getTime())) throw new Error('Invalid utcTimestamp');
    const obs = ephemeris(utc, Number(args.lat), Number(args.lon));
    const view = inspectSituation(obs, profileForSite(currentSite().id));
    return {
      utc: obs.time, lat: Number(args.lat), lon: Number(args.lon),
      sun: {azimuth_deg: obs.sun.azimuth, elevation_deg: obs.sun.elevation, horizonDeg: view.sunBarrier, marginDeg: view.sunMargin, visible: view.sunVisible, geometricVisible: obs.sun.visible},
      earth: {azimuth_deg: obs.earth.azimuth, elevation_deg: obs.earth.elevation, horizonDeg: view.earthBarrier, marginDeg: view.earthMargin, visible: view.earthVisible, geometricVisible: obs.earth.visible},
      model: obs.model, horizon: view.source,
      caveat: 'Analytical ephemeris ±~0.5° samples; geometric visibility, not a link budget.'
    };
  },
  analyze_mission_window(args){
    const start = new Date(String(args.startUTC));
    const days = Number(args.days);
    if (Number.isNaN(start.getTime()) || !(days >= 1 && days <= 31)) throw new Error('Invalid mission window');
    const stepHours = Number(args.stepHours) || 2;
    const samples = sampleWindow({start, days, stepHours, lat: Number(args.lat), lon: Number(args.lon)});
    const stats = summarize(samples);
    const best = longestDualWindow(samples);
    return {startUTC: start.toISOString(), days, stepHours,
      solarAvailabilityPct: stats.sun, earthVisibilityPct: stats.earth, simultaneousVisibilityPct: stats.dual,
      longestEarthBlackoutHours: stats.longestBlackoutHours, longestDualWindowHours: best.hours,
      bestDualStartUTC: best.start, bestDualEndUTC: best.end,
      model: 'analytical-screening-v1, ' + stepHours + 'h samples, 0° geometric horizon',
      caveat: 'Sample-based screening estimates.'};
  },
  compare_locations(){
    const c = currentAssistantContext();
    const base = baseUTC();
    const days = Number(c.days) || 7;
    const ranking = rankedSites(SITES, base, days);
    return {windowStartUTC: base.toISOString(), days,
      ranked: ranking.map((entry, index) => ({
        rank: index + 1, site: entry.site.id, name: entry.site.name, lat: entry.site.lat, lon: entry.site.lon,
        solarAvailabilityPct: entry.stats.sun, earthVisibilityPct: entry.stats.earth,
        simultaneousVisibilityPct: entry.stats.dual, longestEarthBlackoutHours: entry.stats.longestBlackoutHours
      })),
      methodology: 'rankedSites: same UTC window, flat 0° geometric horizon, ranking by simultaneous access then solar.',
      caveat: 'Screening ranking only — not landing safety.'};
  },
  find_optimal_windows(args){
    const refs = Array.isArray(args.sites) ? args.sites : [];
    if (!refs.length) throw new Error('Provide at least one site id or coordinate object');
    const sites = refs.map(ref => {
      if (typeof ref === 'string') {
        const s = SITES.find(x => x.id === ref);
        if (!s) throw new Error('Unknown site id: ' + ref);
        return s;
      }
      return {id: ref.id || 'custom', name: ref.name || 'Custom', lat: Number(ref.lat), lon: Number(ref.lon)};
    }).slice(0, 20);
    const startDate = String(args.startDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('Invalid finder startDate');
    const terrainMode = args.terrainMode === 'terrain' ? 'terrain' : 'flat';
    let terrainProfiles = null;
    if (terrainMode === 'terrain') {
      terrainProfiles = {};
      for (const site of sites) {
        const p = profileForSite(site.id);
        if (!p) throw new Error('No loaded NASA LOLA terrain for ' + site.name + ' in this session. Use flat mode or load terrain.');
        terrainProfiles[site.id] = {...p};
      }
    }
    const result = findMissionWindows({
      sites, startDate, searchDays: Number(args.searchDays) || 30, windowDays: Number(args.windowDays) || 7,
      stepHours: 4, priority: args.priority === 'sun' ? 'sun' : args.priority === 'earth' ? 'earth' : 'balanced',
      terrainMode, terrainProfiles
    });
    return {startDate: result.startDate, searchDays: result.searchDays, windowDays: result.windowDays,
      priority: result.priority, terrainMode: result.terrainMode, model: result.model, scoring: result.scoring,
      top: result.top.map((w, i) => ({rank: i + 1, siteId: w.siteId, siteName: w.siteName, startDate: w.startDate,
        solarAccessPct: w.sunPct, earthVisibilityPct: w.earthPct, sunEarthPct: w.dualPct,
        longestDualHours: w.longestDualHours, longestEarthBlackoutHours: w.longestEarthBlackoutHours,
        score: w.score})),
      bestBySite: result.bestBySite.map(({best}) => ({siteId: best.siteId, siteName: best.siteName, startDate: best.startDate, score: best.score}))};
  },
  simulate_engineering(args){
    const c = currentAssistantContext();
    const base = baseUTC();
    const days = Number(c.days) || 7;
    const samples = sampleWindow({start: base, lat: c.site.lat, lon: c.site.lon, days, stepHours: 2});
    if (samples.length < 2) throw new Error('Cannot sample the mission window');
    const settings = validateEngineering({
      areaM2: args.areaM2, efficiencyPct: args.efficiencyPct, deratePct: args.deratePct,
      loadW: args.loadW, batteryWh: args.batteryWh, earthCutoffDeg: args.earthCutoffDeg,
      startingChargePct: args.startingChargePct
    });
    const sim = simulateMission(samples, settings, profileForSite(c.site.id));
    return {windowStartUTC: base.toISOString(), days, terrainApplied: sim.terrainApplied,
      generatedWh: sim.generatedWh, consumedWh: sim.consumedWh, unmetWh: sim.unmetWh, unmetHours: sim.unmetHours,
      minimumSocPct: sim.minimumSocPct, endingSocPct: sim.endingSocPct, solarAccessPct: sim.solarAccessPct,
      earthAccessPct: sim.earthAccessPct, dualAccessPct: sim.dualAccessPct,
      longestAccessGapHours: sim.longestAccessGapHours, firstBrownoutUTC: sim.firstBrownout || null,
      assumptions: 'Fixed horizontal array, 1361 W/m², constant load, ideal battery, no thermal or RF link budget.',
      caveat: sim.terrainApplied ? 'Loaded local horizon applied.' : 'Flat 0° geometric horizon and antenna mask screening used.'};
  },
  inspect_operations(args){
    const c = currentAssistantContext();
    const site = currentSite();
    const base = baseUTC();
    const utc = args.utcTimestamp ? new Date(String(args.utcTimestamp)) : new Date(base.getTime() + (args.offsetHours ?? c.offsetHours ?? 0) * 3600000);
    if (Number.isNaN(utc.getTime())) throw new Error('Invalid utcTimestamp');
    const lat = args.lat !== undefined ? Number(args.lat) : site.lat;
    const lon = args.lon !== undefined ? Number(args.lon) : site.lon;
    const obs = ephemeris(utc, lat, lon);
    const view = inspectSituation(obs, profileForSite(site.id));
    return {utc: obs.time, site: {lat, lon},
      sun: {elevation_deg: obs.sun.elevation, azimuth_deg: obs.sun.azimuth, horizonDeg: view.sunBarrier, marginDeg: view.sunMargin, visible: view.sunVisible},
      earth: {elevation_deg: obs.earth.elevation, azimuth_deg: obs.earth.azimuth, horizonDeg: view.earthBarrier, marginDeg: view.earthMargin, visible: view.earthVisible},
      combinedOutlook: view.combined, nearBoundary: view.nearBoundary, horizonSource: view.source,
      warning: 'Angular margins, not link or safety margins.'};
  },
  find_next_horizon_event(args){
    const start = new Date(String(args.startUTC));
    if (Number.isNaN(start.getTime())) throw new Error('Invalid startUTC');
    const event = findNextHorizonEvent({
      startUTC: start.toISOString(), site: {lat: Number(args.lat), lon: Number(args.lon)},
      durationHours: Number(args.durationHours), offsetHours: Number(args.offsetHours) || 0, stepMinutes: 30
    });
    return event || {result: 'No sampled Sun or Earth horizon transition within this window.',
      note: 'Sample resolution 30 min; near-horizon decisions carry angular uncertainty.'};
  },
  estimate_surface_traverse(args){
    const r = estimateSurfaceTraverse({
      originLat: Number(args.originLat), originLon: Number(args.originLon),
      destinationLat: Number(args.destinationLat), destinationLon: Number(args.destinationLon),
      departUTC: String(args.departUTC), speedKph: Number(args.speedKph) || 10,
      delayHours: Number(args.delayHours) || 0, profile: profileForSite(currentSite().id)
    });
    return {model: r.model, origin: r.origin, destination: r.destination, distanceKm: r.distanceKm,
      drivingHours: r.drivingHours, delayHours: r.delayHours, totalHours: r.totalHours,
      departureUTC: r.departureUTC, arrivalUTC: r.arrivalUTC,
      visibility: {sunIlluminatedPct: r.visibility.sunIlluminatedPct, earthVisiblePct: r.visibility.earthVisiblePct,
        anyLimitedSolar: r.visibility.anyLimitedSolar, anyEarthLimited: r.visibility.anyEarthLimited,
        terrainApplied: r.visibility.terrainApplied,
        samples: (r.visibility.samples || []).slice(0, 24).map(s => ({
          offsetHours: s.offsetHours, time: s.time, sunElevationDeg: s.sun.elevation,
          sunVisibleHorizon: s.sun.visible, earthElevationDeg: s.earth.elevation, earthVisibleHorizon: s.earth.visible}))},
      limitation: r.limitation};
  },
  estimate_earth_moon_transit(args){
    const c = currentAssistantContext();
    let destination = null;
    const siteId = args.destinationSiteId ? String(args.destinationSiteId) : c.site?.id;
    const known = SITES.find(s => s.id === siteId);
    if (known){
      destination = {id: known.id, name: known.name, lat: known.lat, lon: known.lon};
    } else if (args.destinationLat !== undefined && args.destinationLon !== undefined){
      destination = {id: args.destinationSiteId || 'custom', name: args.destinationName || 'Custom destination',
        lat: Number(args.destinationLat), lon: Number(args.destinationLon)};
    } else if (c.site){
      destination = {id: c.site.id, name: c.site.name, lat: Number(c.site.lat), lon: Number(c.site.lon)};
    }
    const profile = ['direct', 'extended', 'custom'].includes(String(args.profile)) ? String(args.profile) : 'direct';
    const scheduleMode = String(args.scheduleMode) === 'land' ? 'land' : 'depart';
    const r = estimateEarthMoonTransit({
      destination,
      profile,
      referenceHours: args.referenceHours !== undefined ? Number(args.referenceHours) : null,
      departUTC: args.departUTC || null,
      landingUTC: args.landingUTC || null,
      scheduleMode
    });
    return {
      model: r.model, profile: r.profileLabel, transferProfile: r.profile, scheduleMode: r.scheduleMode,
      destination: r.destination, totalTransitHours: r.totalTransitHours, totalTransitLabel: r.totalTransitLabel,
      departureUTC: r.departureUTC, arrivalUTC: r.arrivalUTC,
      lunarArrivalUTC: r.phases.find(p => p.kind === 'insertion').endUTC || r.arrivalUTC,
      phases: r.phases, assumptions: r.assumptions, limitation: r.limitation,
      note: 'Earth departure → lunar transfer → LOI → descent → touchdown are distinct events.'
    };
  }
};

/** Execute one of the declared LunarNav tools in the browser. */
export function executeBrowserTool(name, args = {}, context = currentAssistantContext()){
  const fn = browserExecutors[name];
  if (!fn) return {ok: false, error: 'Unknown tool: ' + name, summary: 'Unknown tool: ' + name};
  try {
    const value = fn(args, context);
    return {ok: true, value, summary: summarizeTool(name, value, args)};
  } catch (error) {
    return {ok: false, error: error.message || 'Tool execution failed', summary: name + ' failed: ' + (error.message || 'error')};
  }
}
function summarizeTool(name, value, args){
  if (name === 'calculate_celestial_conditions') return `Sun ${value.sun.elevation_deg.toFixed(2)}°, Earth ${value.earth.elevation_deg.toFixed(2)}° at ${value.utc}`;
  if (name === 'analyze_mission_window') return `Dual ${value.simultaneousVisibilityPct.toFixed(1)}% · Sun ${value.solarAvailabilityPct.toFixed(1)}% · Earth ${value.earthVisibilityPct.toFixed(1)}%`;
  if (name === 'compare_locations') return `Ranked ${value.ranked.length} locations · top ${value.ranked[0]?.name}`;
  if (name === 'find_optimal_windows') return `${value.top.length} windows · best ${value.top[0]?.siteName} ${value.top[0]?.startDate}`;
  if (name === 'simulate_engineering') return `Min SOC ${value.minimumSocPct.toFixed(1)}% · unmet ${value.unmetHours.toFixed(1)} h`;
  if (name === 'inspect_operations') return `${value.combinedOutlook} · Sun ${value.sun.marginDeg.toFixed(2)}° · Earth ${value.earth.marginDeg.toFixed(2)}°`;
  if (name === 'find_next_horizon_event') return value.result || `Next ${value.eventType} crossing ${value.eventUTC}`;
  if (name === 'estimate_surface_traverse') return `${value.distanceKm.toFixed(1)} km · ${value.totalHours.toFixed(1)} h traverse`;
  if (name === 'estimate_earth_moon_transit') return `${value.totalTransitLabel} · depart ${value.departureUTC.slice(0, 16).replace('T', ' ')} UTC → land ${value.arrivalUTC.slice(0, 16).replace('T', ' ')} UTC`;
  if (name === 'get_mission_context') return `${value.selectedSite.name} ${value.mission.startUTC}`;
  return 'Tool executed';
}