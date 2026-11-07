/**
 * Same-window comparison metrics for sites and mission dates.
 *
 * Every metric is derived from the shared sampleWindow()/summarize() outputs at
 * one time resolution and one horizon rule, so comparison figures can never
 * disagree with the planner timeline. Terrain profiles (when supplied) use the
 * same bodyVisible() horizon rule as the rest of the application. Nothing here
 * ranks a site as suitable for a mission: outputs are comparative planning
 * information only.
 */
import {sampleWindow,summarize,longestDualWindow} from './astro.js';
import {simulateMission,DEFAULT_ENGINEERING} from './mission.js';

const longestRunHours=(intervals,stepHours,predicate)=>{
  let best=0,run=0;
  for(const item of intervals){run=predicate(item)?run+stepHours:0;best=Math.max(best,run);}
  return best;
};

/** Metrics for one site over one mission window (fixed sampling resolution). */
export function windowMetrics({start,days,lat,lon,profile=null,stepHours=2}={}){
  const samples=sampleWindow({start,days,lat,lon,stepHours,profile});
  const stats=summarize(samples);
  const intervals=samples.slice(0,-1);
  let maxSunElevationDeg=-Infinity;
  for(const s of samples)maxSunElevationDeg=Math.max(maxSunElevationDeg,s.sun.elevation);
  return {
    startUTC:new Date(start).toISOString(),days,stepHours,
    totalHours:intervals.length*stepHours,
    terrainApplied:Boolean(profile),samples,
    illuminationHours:stepHours*intervals.filter(s=>s.sun.visible).length,
    darknessHours:stepHours*intervals.filter(s=>!s.sun.visible).length,
    longestDarknessHours:longestRunHours(intervals,stepHours,s=>!s.sun.visible),
    maxSunElevationDeg,
    earthVisibilityPct:stats.earth,
    longestEarthVisibilityHours:longestRunHours(intervals,stepHours,s=>s.earth.visible),
    simultaneousPct:stats.dual,
    longestSimultaneousHours:longestDualWindow(samples).hours,
    solarEnergyWh:simulateMission(samples,DEFAULT_ENGINEERING,profile).generatedWh
  };
}

/** Fixed metric table shared by the site and mission-date comparisons. */
export function comparisonRows(entries){
  const cell=(fn,unit,digits=1)=>entries.map(e=>({value:fn(e.metrics),unit,digits}));
  return [
    {label:'Total illumination',values:cell(m=>m.illuminationHours,'h')},
    {label:'Total darkness',values:cell(m=>m.darknessHours,'h')},
    {label:'Longest continuous darkness',values:cell(m=>m.longestDarknessHours,'h')},
    {label:'Max solar elevation',values:cell(m=>m.maxSunElevationDeg,'°')},
    {label:'Geometric Earth visibility',values:cell(m=>m.earthVisibilityPct,'%')},
    {label:'Longest continuous Earth view',values:cell(m=>m.longestEarthVisibilityHours,'h')},
    {label:'Simultaneous Sun + Earth',values:cell(m=>m.simultaneousPct,'%')},
    {label:'Estimated solar energy',values:cell(m=>m.solarEnergyWh/1000,'kWh')}
  ];
}

/**
 * Plain-language differences computed from the metrics themselves (never
 * hardcoded): illumination trade-offs, darkness exposure and Earth view.
 */
export function differenceNotes(entries){
  if(entries.length<2)return [];
  const byLight=[...entries].sort((a,b)=>b.metrics.illuminationHours-a.metrics.illuminationHours||a.name.localeCompare(b.name));
  const bright=byLight[0],dim=byLight[byLight.length-1];
  const m=bright.metrics,n=dim.metrics,span=m.days;
  const notes=[];
  const hours=(a,b)=>Math.abs(a-b).toFixed(1);
  notes.push(`${bright.name} receives ${hours(m.illuminationHours,n.illuminationHours)} h more sunlight than ${dim.name} over the ${span}-day window (${m.illuminationHours.toFixed(1)} h vs ${n.illuminationHours.toFixed(1)} h of sampled illumination).`);
  if(Math.abs(m.longestDarknessHours-n.longestDarknessHours)>=1)
    notes.push(`Trade-off: ${m.longestDarknessHours>n.longestDarknessHours?bright.name:dim.name} also has the longer continuous darkness (${Math.max(m.longestDarknessHours,n.longestDarknessHours).toFixed(1)} h vs ${Math.min(m.longestDarknessHours,n.longestDarknessHours).toFixed(1)} h), so more total light does not mean shorter dark periods.`);
  const byEarth=[...entries].sort((a,b)=>b.metrics.longestEarthVisibilityHours-a.metrics.longestEarthVisibilityHours||a.name.localeCompare(b.name));
  const e1=byEarth[0],e2=byEarth[byEarth.length-1];
  if(Math.abs(e1.metrics.longestEarthVisibilityHours-e2.metrics.longestEarthVisibilityHours)>=0.5){
    notes.push(`Geometric Earth view favours ${e1.name}: longest continuous view ${e1.metrics.longestEarthVisibilityHours.toFixed(1)} h vs ${e2.metrics.longestEarthVisibilityHours.toFixed(1)} h at ${e2.name} (${e1.metrics.earthVisibilityPct.toFixed(0)}% vs ${e2.metrics.earthVisibilityPct.toFixed(0)}% of the window). This is line-of-sight geometry, not a radio-link guarantee.`);
  }
  const energyGap=Math.abs(m.solarEnergyWh-n.solarEnergyWh)/1000;
  if(energyGap>=0.05)
    notes.push(`First-order solar energy for the ${DEFAULT_ENGINEERING.areaM2} m² reference array differs by ${energyGap.toFixed(1)} kWh (${(m.solarEnergyWh/1000).toFixed(1)} kWh at ${bright.name}, ${(n.solarEnergyWh/1000).toFixed(1)} kWh at ${dim.name}).`);
  return notes;
}
