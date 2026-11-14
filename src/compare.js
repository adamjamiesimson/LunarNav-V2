import {sampleWindow,summarize,longestDualWindow,longestRunHours} from './astro.js';
import {simulateMission,DEFAULT_ENGINEERING} from './mission.js';

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
    longestEarthBlackoutHours:stats.longestBlackoutHours,
    longestEarthVisibilityHours:longestRunHours(intervals,stepHours,s=>s.earth.visible),
    simultaneousPct:stats.dual,
    longestSimultaneousHours:longestDualWindow(samples).hours,
    solarEnergyWh:simulateMission(samples,DEFAULT_ENGINEERING,profile).generatedWh
  };
}

export function comparisonRows(entries){
  const cell=(fn,unit,digits=1)=>entries.map(e=>({value:fn(e.metrics),unit,digits}));
  return [
    {label:'Total illumination',values:cell(m=>m.illuminationHours,'h')},
    {label:'Longest continuous darkness',values:cell(m=>m.longestDarknessHours,'h')},
    {label:'Geometric Earth visibility',values:cell(m=>m.earthVisibilityPct,'%')},
    {label:'Longest Earth-view gap',values:cell(m=>m.longestEarthBlackoutHours,'h')},
    {label:'Simultaneous Sun + Earth',values:cell(m=>m.simultaneousPct,'%')},
    {label:'Estimated solar energy',values:cell(m=>m.solarEnergyWh/1000,'kWh')}
  ];
}
