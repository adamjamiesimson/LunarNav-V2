/**
 * LunarNav Gemini tool layer.
 *
 * The same analytical modules that power the browser planner (astro.js,
 * finder.js, mission.js, situation.js, travel.js) are imported directly into
 * the Vercel serverless function and executed through Gemini function calling.
 * No duplicate or simplified astronomy is introduced here: every tool either
 * returns live application state or calls the existing calculation functions.
 */
import {ephemeris,sampleWindow,summarize,longestDualWindow,rankedSites} from './astro.js';
import {SITES} from './sites.js';
import {simulateMission,validateEngineering} from './mission.js';
import {findMissionWindows} from './finder.js';
import {inspectSituation,findNextHorizonEvent} from './situation.js';
import {estimateSurfaceTraverse} from './travel.js';
import {estimateEarthMoonTransit,TRANSIT_PROFILES} from './transit.js';
import {horizonAt} from './mission.js';

const MAX_WINDOW_WINDOWS=20;
const str=v=>typeof v==='string'?v.trim():'';
const num=(v,fallback,name)=>{
  const n=Number(v);
  if(!Number.isFinite(n))throw new Error(`Missing or invalid ${name}`);
  return n;
};

export const TOOL_DECLARATIONS=Object.freeze([
{
  name:'get_mission_context',
  description:'Return the currently selected LunarNav mission configuration: site, coordinates, mission start date/time in UTC, duration, current inspection time, terrain status and available analysis results.',
  parameters:{type:'object',properties:{},required:[]}
},
{
  name:'calculate_celestial_conditions',
  description:'Calculate Sun and Earth azimuth, elevation and geometric visibility at a UTC timestamp and lunar coordinates using LunarNav’s analytical ephemeris.',
  parameters:{type:'object',properties:{
    utcTimestamp:{type:'string',description:'ISO 8601 UTC timestamp'},
    lat:{type:'number',description:'Lunar latitude in degrees (south negative)'},
    lon:{type:'number',description:'East-positive lunar longitude in degrees'}
  },required:['utcTimestamp','lat','lon']}
},
{
  name:'analyze_mission_window',
  description:'Analyse a mission window: solar availability %, Earth visibility %, simultaneous visibility %, longest Earth blackout and longest continuous dual-access period, sampling with the existing LunarNav ephemeris.',
  parameters:{type:'object',properties:{
    startUTC:{type:'string',description:'ISO 8601 UTC mission start'},
    days:{type:'number',description:'Mission length in days, 1–31'},
    lat:{type:'number'},lon:{type:'number'},
    stepHours:{type:'number',description:'Sampling step in hours (default 2)'}
  },required:['startUTC','lat','lon']}
},
{
  name:'compare_locations',
  description:'Compare the five LunarNav study locations for the current mission configuration using the existing same-window ranking methodology (rankedSites). Returns structured numerical results and the model assumptions.',
  parameters:{type:'object',properties:{},required:[]}
},
{
  name:'find_optimal_windows',
  description:'Search for the best mission start dates across selected lunar sites using the existing Window Finder (findMissionWindows). Accepts site ids or explicit coordinates, a UTC start date, search length, mission duration, ranking priority and horizon source.',
  parameters:{type:'object',properties:{
    sites:{type:'array',items:{type:'string',description:'LunarNav site id such as mons-mouton, or an object {name, lat, lon} for custom coordinates'},description:'Sites to include in the search (1–20). Use site ids from the available locations, or custom coordinates as {lat, lon} objects.'},
    startDate:{type:'string',description:'First candidate UTC date in YYYY-MM-DD'},
    searchDays:{type:'number',description:'Number of candidate start dates, 1–90'},
    windowDays:{type:'number',description:'Mission duration in days, 1–28'},
    priority:{type:'string',enum:['balanced','sun','earth'],description:'Ranking priority'},
    terrainMode:{type:'string',enum:['flat','terrain'],description:'Horizon model: flat geometric or loaded NASA LOLA terrain'}
  },required:['sites','startDate']}
},
{
  name:'simulate_engineering',
  description:'Run the LunarNav first-order power and direct-to-Earth screening for the current selected window. Returns generated energy, unmet demand, battery minimum/ending state of charge, Earth geometric access and warnings.',
  parameters:{type:'object',properties:{
    areaM2:{type:'number',description:'Solar panel area in m²'},
    efficiencyPct:{type:'number',description:'Cell conversion efficiency in %'},
    deratePct:{type:'number',description:'System derating in %'},
    loadW:{type:'number',description:'Continuous payload load in watts'},
    batteryWh:{type:'number',description:'Usable battery energy in watt-hours'},
    earthCutoffDeg:{type:'number',description:'Earth antenna elevation mask in degrees'},
    startingChargePct:{type:'number',description:'Battery initial charge in % (default 100)'}
  },required:[]}
},
{
  name:'inspect_operations',
  description:'Inspect local operational conditions for the current site (or a given timestamp/coordinate): Sun/Earth visibility, terrain-adjusted horizon margins when data is loaded, near-boundary warnings.',
  parameters:{type:'object',properties:{
    utcTimestamp:{type:'string',description:'Optional ISO UTC timestamp; defaults to the current inspection time'},
    lat:{type:'number'},lon:{type:'number'}
  },required:[]}
},
{
  name:'find_next_horizon_event',
  description:'Find the next sampled Sun or Earth horizon transition within a mission window using findNextHorizonEvent. Returns the modeled crossing time, type and visibility after the crossing.',
  parameters:{type:'object',properties:{
    startUTC:{type:'string',description:'ISO UTC mission start'},
    durationHours:{type:'number',description:'Mission duration in hours'},
    offsetHours:{type:'number',description:'Hours after start from which to search'},
    lat:{type:'number'},lon:{type:'number'}
  },required:['startUTC','durationHours','lat','lon']}
},
{
  name:'estimate_surface_traverse',
  description:'Estimate a lunar surface rover traverse between two coordinates: great-circle geodesic distance, driving time, total traverse time including operational delay, departure/arrival UTC timestamps and sampled Sun/Earth visibility along the journey. Uses the same estimator as the LunarNav travel panel.',
  parameters:{type:'object',properties:{
    originLat:{type:'number'},originLon:{type:'number'},
    destinationLat:{type:'number'},destinationLon:{type:'number'},
    departUTC:{type:'string',description:'ISO 8601 UTC departure timestamp'},
    speedKph:{type:'number',description:'Assumed average rover speed in km/h (default 10)'},
    delayHours:{type:'number',description:'Additional operational delay in hours (default 0)'}
  },required:['originLat','originLon','destinationLat','destinationLon','departUTC']}
},
{
  name:'estimate_earth_moon_transit',
  description:'Estimate the Earth-to-Moon spacecraft transit for the selected landing destination using reference transfer-profile durations (direct ~3–4 days, extended ~7.5 days low-energy, or operator-supplied custom). Computes departure/arrival UTC timestamps (forward from a departure time, or backward from a desired landing time) and a phase breakdown (Earth departure, lunar transfer, LOI, descent, surface touchdown). This is a scheduling estimate, NOT a trajectory or delta-v solver.',
  parameters:{type:'object',properties:{
    profile:{type:'string',enum:['direct','extended','custom'],description:'Transfer profile: direct (default), extended (fuel-efficient), or custom.'},
    referenceHours:{type:'number',description:'Total transit duration in hours; required for profile=custom.'},
    departUTC:{type:'string',description:'ISO 8601 UTC Earth departure timestamp (used when scheduleMode=depart).'},
    landingUTC:{type:'string',description:'ISO 8601 UTC desired landing timestamp (used when scheduleMode=land; departure is back-calculated).'},
    scheduleMode:{type:'string',enum:['depart','land'],description:'Whether a departure time or a desired landing time anchors the estimate.'},
    destinationSiteId:{type:'string',description:'Optional LunarNav site id for the landing destination; defaults to the currently selected site.'},
    destinationLat:{type:'number'},destinationLon:{type:'number'}
  },required:['profile']}
}
]);

/** Look up a site reference (id string or coordinate object) from context. */
function resolveSite(ref,context){
  if(typeof ref==='string'){
    const known=SITES.find(s=>s.id===ref);
    if(known)return known;
    throw new Error('Unknown LunarNav site id: '+ref+'. Use one of '+SITES.map(s=>s.id).join(', ')+' or supply explicit lat/lon.');
  }
  if(ref&&typeof ref==='object'&&Number.isFinite(ref.lat)&&Number.isFinite(ref.lon)){
    return {id:ref.id||'custom',name:ref.name||('Custom '+ref.lat.toFixed(2)+','+ref.lon.toFixed(2)),lat:ref.lat,lon:ref.lon,custom:true};
  }
  throw new Error('Invalid site reference; pass a site id or an object with lat and lon.');
}
function contextSite(context){
  if(!context?.site)throw new Error('No mission configuration is available; use get_mission_context first or give explicit coordinates.');
  const site=context.site;
  return {id:site.id, name:site.name||'Selected site', lat:Number(site.lat), lon:Number(site.lon), custom:Boolean(context.isCustom)};
}
function contextBaseUTC(context){
  const site=contextSite(context);
  const parts=[context.date, context.time];
  if(context.date&&context.time&&/^\d{4}-\d{2}-\d{2}$/.test(str(context.date))&&/^\d\d:\d\d$/.test(str(context.time))){
    return new Date(`${context.date}T${context.time}:00Z`);
  }
  return new Date(Date.now());
}
function contextProfile(context){
  return context?.terrainProfile&&Array.isArray(context.terrainProfile.azimuthDeg)?context.terrainProfile:null;
}

function runGetMissionContext(args, context){
  const site=contextSite(context);
  const base=contextBaseUTC(context);
  return {
    app:'LunarNav V2 — lunar south-pole mission planning',
    selectedSite:site,
    mission:{startDate:context.date,startTimeUTC:context.time,startUTC:base.toISOString(),durationDays:context.days},
    inspectionOffsetHours:context.offsetHours,
    inspectionUTC:context.inspectionUTC||new Date(base.getTime()+(context.offsetHours||0)*3600000).toISOString(),
    terrain:{applied:Boolean(context?.terrain?.applied),source:context?.terrain?.source||null,verifiedSource:Boolean(context?.terrain?.verifiedSource),coveragePct:context?.terrain?.coveragePct??null,radiusKm:context?.terrain?.radiusKm??null},
    missionSummary:context.missionSummary||null,
    simulation:context.simulation||null,
    finder:context.finder||null,
    availableSites:SITES.map(s=>({id:s.id,name:s.name,lat:s.lat,lon:s.lon})),
    limitations:'Analytical screening ephemeris; geometric horizon unless terrain loaded; not flight-qualified; Earth visibility is not an RF link budget.'
  };
}
function runCalculateCelestialConditions(args,context){
  const utc=new Date(str(args.utcTimestamp));
  if(Number.isNaN(utc.getTime()))throw new Error('Invalid utcTimestamp');
  const lat=num(args.lat,0,'lat'),lon=num(args.lon,0,'lon');
  if(Math.abs(lat)>90)throw new Error('Latitude must be between -90 and 90');
  const obs=ephemeris(utc,lat,lon);
  const profile=contextProfile(context);
  const view=inspectSituation(obs,profile);
  return {
    utc:obs.time,site:{lat,lon},
    sun:{azimuth_deg:obs.sun.azimuth,elevation_deg:obs.sun.elevation,horizonDeg:view.sunBarrier,marginDeg:view.sunMargin,visible:view.sunVisible,geometricVisible:obs.sun.visible},
    earth:{azimuth_deg:obs.earth.azimuth,elevation_deg:obs.earth.elevation,horizonDeg:view.earthBarrier,marginDeg:view.earthMargin,visible:view.earthVisible,geometricVisible:obs.earth.visible},
    model:obs.model,
    horizon:view.source,
    caveat:'Analytical ephemeris ±~0.5° samples; decisions near the horizon are uncertain; geometric visibility, not a link budget.'
  };
}
function runAnalyzeMissionWindow(args){
  const days=num(args.days,7,'days');
  const start=new Date(str(args.startUTC));
  if(Number.isNaN(start.getTime())||days<1||days>31)throw new Error('Invalid mission window start/duration');
  const stepHours=args.stepHours?num(args.stepHours,2,'stepHours'):2;
  const samples=sampleWindow({start,days,stepHours,lat:num(args.lat,0,'lat'),lon:num(args.lon,0,'lon')});
  const stats=summarize(samples);
  const best=longestDualWindow(samples);
  return {startUTC:start.toISOString(),days,stepHours,
    solarAvailabilityPct:stats.sun,earthVisibilityPct:stats.earth,simultaneousVisibilityPct:stats.dual,
    longestEarthBlackoutHours:stats.longestBlackoutHours,
    longestDualWindowHours:best.hours,bestDualStartUTC:best.start,bestDualEndUTC:best.end,
    model:'analytical-screening-v1, '+stepHours+'h samples, 0° geometric horizon',
    caveat:'Two-hour sample-based estimates selected.'};
}
function runCompareLocations(args, context){
  const base=contextBaseUTC(context);
  const days=Number(context.days)||7;
  if(!(days>=1&&days<=31))throw new Error('Invalid mission duration in context');
  const ranking=rankedSites(SITES,base,days);
  return {windowStartUTC:base.toISOString(),days,
    ranked:ranking.map((entry,index)=>({
      rank:index+1,site:entry.site.id,name:entry.site.name,lat:entry.site.lat,lon:entry.site.lon,
      solarAvailabilityPct:entry.stats.sun,earthVisibilityPct:entry.stats.earth,simultaneousVisibilityPct:entry.stats.dual,
      longestEarthBlackoutHours:entry.stats.longestBlackoutHours
    })),
    methodology:'rankedSites: same UTC window, four-hour samples, flat 0° geometric horizon; ranking by simultaneous access then solar.',
    caveat:'Screening ranking only — not landing safety.'};
}
function runFindOptimalWindows(args,context){
  const siteRefs=Array.isArray(args.sites)?args.sites:[];
  if(!siteRefs.length)throw new Error('Provide at least one site id or coordinate object to search');
  const sites=siteRefs.map(ref=>resolveSite(ref,context)).slice(0,MAX_WINDOW_WINDOWS);
  const startDate=str(args.startDate);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate))throw new Error('Invalid finder startDate (expected YYYY-MM-DD)');
  const terrainMode=args.terrainMode==='terrain'?'terrain':'flat';
  let terrainProfiles=null;
  if(terrainMode==='terrain'){
    terrainProfiles={};
    for(const site of sites){
      const id=site.id;
      const p=context?.terrainProfilesBySite?.[id];
      if(!p||!Array.isArray(p.azimuthDeg)){
        throw new Error('No loaded NASA LOLA terrain profile for '+site.name+' in this browser session. Load terrain for the sites first, or use flat mode.');
      }
      terrainProfiles[id]={...p, lat:site.lat, lon:site.lon};
    }
  }
  const result=findMissionWindows({
    sites,startDate,
    searchDays:Number(args.searchDays)||30,
    windowDays:Number(args.windowDays)||7,
    stepHours:4,
    priority:args.priority==='sun'?'sun':args.priority==='earth'?'earth':'balanced',
    terrainMode,terrainProfiles
  });
  return {
    startDate:result.startDate,searchDays:result.searchDays,windowDays:result.windowDays,
    priority:result.priority,terrainMode:result.terrainMode,model:result.model,scoring:result.scoring,
    top:result.top.map(w=>({rank:null,siteId:w.siteId,siteName:w.siteName,startDate:w.startDate,
      solarAccessPct:w.sunPct,earthVisibilityPct:w.earthPct,sunEarthPct:w.dualPct,
      longestDualHours:w.longestDualHours,longestEarthBlackoutHours:w.longestEarthBlackoutHours,
      longestDarknessHours:w.longestDarknessHours,score:w.score})),
    bestBySite:result.bestBySite.map(({site,best})=>({siteId:best.siteId,siteName:best.siteName,startDate:best.startDate,score:best.score,dualPct:best.dualPct}))
  };
}
function runSimulateEngineering(args,context){
  const site=contextSite(context);
  const base=contextBaseUTC(context);
  const days=Number(context.days)||7;
  const samples=sampleWindow({start:base,lat:site.lat,lon:site.lon,days,stepHours:2});
  if(samples.length<2)throw new Error('Cannot build mission samples for simulation');
  const settings=validateEngineering({
    areaM2:args.areaM2??undefined,efficiencyPct:args.efficiencyPct??undefined,
    deratePct:args.deratePct??undefined,loadW:args.loadW??undefined,
    batteryWh:args.batteryWh??undefined,earthCutoffDeg:args.earthCutoffDeg??undefined,
    startingChargePct:args.startingChargePct??undefined
  });
  const sim=simulateMission(samples,settings,contextProfile(context));
  return {
    windowStartUTC:base.toISOString(),days,terrainApplied:sim.terrainApplied,
    generatedWh:sim.generatedWh,consumedWh:sim.consumedWh,unmetWh:sim.unmetWh,
    unmetHours:sim.unmetHours,minimumSocPct:sim.minimumSocPct,endingSocPct:sim.endingSocPct,
    solarAccessPct:sim.solarAccessPct,earthAccessPct:sim.earthAccessPct,
    dualAccessPct:sim.dualAccessPct,longestAccessGapHours:sim.longestAccessGapHours,
    firstBrownoutUTC:sim.firstBrownout||null,
    assumptions:'Fixed horizontal array, 1361 W/m², constant load, ideal battery, no thermal or RF link budget.',
    caveat:sim.terrainApplied?'Loaded local horizon applied to solar/access screening.':'Flat 0° geometric horizon and antenna mask screening used.'
  };
}
function runInspectOperations(args,context){
  const site=contextSite(context);
  const base=contextBaseUTC(context);
  const utc=args.utcTimestamp?new Date(str(args.utcTimestamp)):new Date(base.getTime()+((context.offsetHours||0))*3600000);
  if(Number.isNaN(utc.getTime()))throw new Error('Invalid utcTimestamp');
  const lat=args.lat!==undefined?num(args.lat,0,'lat'):site.lat;
  const lon=args.lon!==undefined?num(args.lon,0,'lon'):site.lon;
  const obs=ephemeris(utc,lat,lon);
  const profile=contextProfile(context);
  const view=inspectSituation(obs,profile);
  return {utc:obs.time,site:{lat,lon},
    sun:{elevation_deg:obs.sun.elevation,azimuth_deg:obs.sun.azimuth,horizonDeg:view.sunBarrier,marginDeg:view.sunMargin,visible:view.sunVisible},
    earth:{elevation_deg:obs.earth.elevation,azimuth_deg:obs.earth.azimuth,horizonDeg:view.earthBarrier,marginDeg:view.earthMargin,visible:view.earthVisible},
    combinedOutlook:view.combined,nearBoundary:view.nearBoundary,
    horizonSource:view.source,
    warning:'Angular margins, not link or safety margins.'};
}
function runFindNextHorizonEvent(args){
  const start=new Date(str(args.startUTC));
  const lat=num(args.lat,0,'lat'),lon=num(args.lon,0,'lon');
  const durationHours=num(args.durationHours,0,'durationHours');
  if(Number.isNaN(start.getTime())||!(durationHours>0&&durationHours<=24*60))throw new Error('Invalid horizon-search window');
  const event=findNextHorizonEvent({
    startUTC:start.toISOString(),site:{lat,lon},
    durationHours,offsetHours:Number(args.offsetHours)||0,stepMinutes:30
  });
  return event||{result:'No sampled Sun or Earth horizon transition within this window.',
    note:'Sample resolution 30 min; refined to ~1 min during bisection. Near-horizon decisions carry angular uncertainty.'};
}
function runEstimateSurfaceTraverse(args,context){
  const r=estimateSurfaceTraverse({
    originLat:num(args.originLat,0,'originLat'),originLon:num(args.originLon,0,'originLon'),
    destinationLat:num(args.destinationLat,0,'destinationLat'),destinationLon:num(args.destinationLon,0,'destinationLon'),
    departUTC:str(args.departUTC),speedKph:Number(args.speedKph)||10,
    delayHours:Number(args.delayHours)||0,profile:contextProfile(context)
  });
  return {
    model:r.model,origin:r.origin,destination:r.destination,
    distanceKm:r.distanceKm,drivingHours:r.drivingHours,delayHours:r.delayHours,
    totalHours:r.totalHours,departureUTC:r.departureUTC,arrivalUTC:r.arrivalUTC,
    visibility:{sunIlluminatedPct:r.visibility.sunIlluminatedPct,
      sunAboveFlatHorizonPct:r.visibility.sunAboveFlatHorizonPct,
      earthVisiblePct:r.visibility.earthVisiblePct,earthGeometricPct:r.visibility.earthGeometricPct,
      anyLimitedSolar:r.visibility.anyLimitedSolar,anyEarthLimited:r.visibility.anyEarthLimited,
      terrainApplied:r.visibility.terrainApplied,
      samples:(r.visibility.samples||[]).slice(0,50).map(s=>({offsetHours:s.offsetHours,time:s.time,
        sunElevationDeg:s.sun.elevation,sunVisibleFlat:s.sun.exposedToSun,sunVisibleHorizon:s.sun.visible,
        earthElevationDeg:s.earth.elevation,earthVisibleFlat:s.earth.geometricVisible,earthVisibleHorizon:s.earth.visible}))},
    limitation:r.limitation,
    caveat:'Geodesic great-circle estimate on a spherical Moon (R=1737.4 km); no obstacle or traversability model; visibility along the path is a screening estimate, not an operations guarantee.'
  };
}

function runEstimateEarthMoonTransit(args, context){
  let destination = null;
  if (typeof args.destinationSiteId === 'string' && args.destinationSiteId.trim()){
    const site = SITES.find(s => s.id === args.destinationSiteId.trim());
    if (!site) throw new Error('Unknown LunarNav site id for destination: ' + args.destinationSiteId);
    destination = {id: site.id, name: site.name, lat: site.lat, lon: site.lon};
  } else if (args.destinationLat !== undefined && args.destinationLon !== undefined){
    destination = {id: args.destinationSiteId || 'custom', name: args.destinationName || 'Custom destination', lat: num(args.destinationLat, 0, 'destinationLat'), lon: num(args.destinationLon, 0, 'destinationLon')};
  } else {
    // Default to the currently selected mission landing site.
    const site = contextSite(context);
    destination = {id: site.id, name: site.name, lat: site.lat, lon: site.lon};
  }
  const profile = ['direct', 'extended', 'custom'].includes(String(args.profile)) ? String(args.profile) : 'direct';
  const scheduleMode = String(args.scheduleMode) === 'land' ? 'land' : 'depart';
  const estimate = estimateEarthMoonTransit({
    destination,
    profile,
    referenceHours: args.referenceHours !== undefined ? Number(args.referenceHours) : null,
    departUTC: args.departUTC || null,
    landingUTC: args.landingUTC || null,
    scheduleMode
  });
  return {
    model: estimate.model,
    profile: estimate.profileLabel,
    transferProfile: estimate.profile,
    scheduleMode: estimate.scheduleMode,
    destination: estimate.destination,
    totalTransitHours: estimate.totalTransitHours,
    totalTransitLabel: estimate.totalTransitLabel,
    departureUTC: estimate.departureUTC,
    arrivalUTC: estimate.arrivalUTC,
    lunarArrivalUTC: estimate.phases.find(p => p.kind === 'insertion').endUTC || estimate.arrivalUTC,
    phases: estimate.phases,
    assumptions: estimate.assumptions,
    limitation: estimate.limitation,
    note: 'Earth departure → lunar transfer → LOI → descent → touchdown are distinct events; arrival/landing timing and coordinates frame the approach discussion but do not change the Earth–Moon transit duration.'
  };
}

const EXECUTORS={
  get_mission_context:runGetMissionContext,
  calculate_celestial_conditions:runCalculateCelestialConditions,
  analyze_mission_window:runAnalyzeMissionWindow,
  compare_locations:runCompareLocations,
  find_optimal_windows:runFindOptimalWindows,
  simulate_engineering:runSimulateEngineering,
  inspect_operations:runInspectOperations,
  find_next_horizon_event:runFindNextHorizonEvent,
  estimate_surface_traverse:runEstimateSurfaceTraverse,
  estimate_earth_moon_transit:runEstimateEarthMoonTransit
};

/** Execute a declared tool against the live mission context. Never fails badly:
 * tool errors are returned as structured failures so the model can explain them. */
export function executeTool(name,args={},context={}){
  const fn=EXECUTORS[name];
  if(!fn)return {ok:false,error:'Unknown tool: '+name};
  try{
    const value=fn(args,context);
    return {ok:true,value,summary:toolSummary(name,value,args)};
  }catch(error){
    return {ok:false,error:error.message||'Tool execution failed',summary:`${name} failed: ${error.message||'internal error'}`};
  }
}
function toolSummary(name,value,args){
  if(name==='calculate_celestial_conditions')return `Sun ${value.sun.elevation_deg.toFixed(2)}°, Earth ${value.earth.elevation_deg.toFixed(2)}° at ${value.utc}`;
  if(name==='analyze_mission_window')return `Dual ${value.simultaneousVisibilityPct.toFixed(1)}% · Sun ${value.solarAvailabilityPct.toFixed(1)}% · Earth ${value.earthVisibilityPct.toFixed(1)}%`;
  if(name==='compare_locations')return `Ranked ${value.ranked.length} locations · top ${value.ranked[0]?.name}`;
  if(name==='find_optimal_windows')return `${value.top.length} windows found · best ${value.top[0]?.siteName} ${value.top[0]?.startDate}`;
  if(name==='simulate_engineering')return `Min SOC ${value.minimumSocPct.toFixed(1)}% · unmet ${value.unmetHours.toFixed(1)} h · generated ${(value.generatedWh/1000).toFixed(1)} kWh`;
  if(name==='inspect_operations')return `${value.combinedOutlook} · Sun ${value.sun.marginDeg.toFixed(2)}° · Earth ${value.earth.marginDeg.toFixed(2)}°`;
  if(name==='find_next_horizon_event')return value.result||`Next ${value.eventType} crossing ${value.eventUTC}`;
  if(name==='estimate_surface_traverse')return `${value.distanceKm.toFixed(1)} km · ${value.totalHours.toFixed(1)} h traverse`;
  if(name==='estimate_earth_moon_transit')return `${value.totalTransitLabel} · depart ${value.departureUTC.slice(0,16).replace('T',' ')} UTC → land ${value.arrivalUTC.slice(0,16).replace('T',' ')} UTC`;
  if(name==='get_mission_context')return `${value.selectedSite.name} ${value.mission.startUTC}`;
  return 'Tool executed';
}