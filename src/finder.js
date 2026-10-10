/**
 * Sliding mission-window scan for Moon south-pole candidate sites.
 *
 * Uses exactly the same analytical ephemeris as the mission planner, sampled
 * on a uniform UTC grid. No terrain is applied: the finder is intended to
 * compare like-for-like sites without mixing loaded and missing DEM coverage.
 * All percentages are sample-based exploratory estimates, NOT verified
 * JPL Horizons or flight-qualified operational probabilities.
 */
import {ephemeris} from './astro.js';

const HOUR=3600000,DAY=24*HOUR;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));

export const FINDER_WEIGHTS=Object.freeze({dual:0.7,sun:0.15,earth:0.15});
export const finderScore=(v,priority)=>{
  if(priority==='sun')return v.sunPct;
  if(priority==='earth')return v.earthPct;
  return v.dualPct*FINDER_WEIGHTS.dual+
    v.sunPct*FINDER_WEIGHTS.sun+v.earthPct*FINDER_WEIGHTS.earth;
};

function ensureDate(date){
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Invalid finder UTC date');
  const n=Date.parse(date+'T12:00:00Z');
  if(!Number.isFinite(n)||new Date(n).toISOString().slice(0,10)!==date)
    throw Error('Invalid finder UTC date');
  return n;
}

const longestRun=(values,start,length,predicate,stepHours)=>{
  let best=0,current=0;
  for(let i=start;i<start+length;i++){
    if(predicate(values[i])){current+=stepHours;best=Math.max(best,current);}
    else current=0;
  }
  return best;
};

/** Analyze each possible UTC start date, sharing one sampled ephemeris array per site. */
export function findMissionWindows({
  sites,startDate,searchDays=30,windowDays=7,stepHours=4,priority='balanced'
}={}){
  const epoch=ensureDate(startDate);
  if(!Array.isArray(sites)||!sites.length||sites.length>20)throw Error('Select 1–20 valid sites');
  if(!Number.isInteger(searchDays)||searchDays<1||searchDays>90)throw Error('Search must be 1–90 days');
  if(!Number.isInteger(windowDays)||windowDays<1||windowDays>28)throw Error('Mission duration must be 1–28 days');
  if(![1,2,3,4,6,8,12,24].includes(stepHours))throw Error('Unsupported sampling step');
  if(!['balanced','sun','earth'].includes(priority))throw Error('Invalid finder priority');
  if(24%stepHours!==0)throw Error('Sampling must evenly divide a day');
  const stepsPerDay=24/stepHours,steps=windowDays*stepsPerDay;
  const intervals=(searchDays-1+windowDays)*stepsPerDay;
  const matrix=[],all=[];
  for(const site of sites){
    if(!Number.isFinite(site.lat)||!Number.isFinite(site.lon)||site.lat < -90||site.lat>90)
      throw Error('Invalid coordinates for site '+(site.name||'unknown'));
    const samples=Array.from({length:intervals},(_,i)=>{
      const obs=ephemeris(new Date(epoch+i*stepHours*HOUR),site.lat,site.lon);
      return {sun:obs.sun.visible,earth:obs.earth.visible,
        dual:obs.sun.visible&&obs.earth.visible};
    });
    const sun=[0],earth=[0],dual=[0];
    for(const item of samples){
      sun.push(sun.at(-1)+Number(item.sun));
      earth.push(earth.at(-1)+Number(item.earth));
      dual.push(dual.at(-1)+Number(item.dual));
    }
    const windows=Array.from({length:searchDays},(_,day)=>{
      const start=day*stepsPerDay,end=start+steps;
      const sunPct=100*(sun[end]-sun[start])/steps;
      const earthPct=100*(earth[end]-earth[start])/steps;
      const dualPct=100*(dual[end]-dual[start])/steps;
      const longestDualHours=longestRun(samples,start,steps,s=>s.dual,stepHours);
      const longestEarthBlackoutHours=longestRun(samples,start,steps,s=>!s.earth,stepHours);
      const longestDarknessHours=longestRun(samples,start,steps,s=>!s.sun,stepHours);
      const date=new Date(epoch+day*DAY).toISOString().slice(0,10);
      const item={siteId:site.id,siteName:site.name,siteLat:site.lat,siteLon:site.lon,
        startDate:date,windowDays,sunPct,earthPct,dualPct,
        longestDualHours,longestEarthBlackoutHours,longestDarknessHours};
      item.score=finderScore(item,priority);
      return item;
    });
    matrix.push({site,windows});
    all.push(...windows);
  }
  all.sort((a,b)=>b.score-a.score || b.dualPct-a.dualPct ||
    b.longestDualHours-a.longestDualHours || a.startDate.localeCompare(b.startDate) ||
    String(a.siteId).localeCompare(String(b.siteId)));
  return {matrix,ranked:all,top:all.slice(0,10),bestBySite:matrix.map(m=>({
    site:m.site,best:[...m.windows].sort((a,b)=>b.score-a.score || b.dualPct-a.dualPct)[0]
  })).sort((a,b)=>b.best.score-a.best.score),
  startDate,searchDays,windowDays,stepHours,priority,
  scoring:priority==='balanced'?'70% simultaneous + 15% Sun + 15% Earth':priority==='sun'?'Solar access':'Earth geometric visibility',
  model:'analytical-screening-v1, smooth horizon, UTC, 4-hour samples'};
}
