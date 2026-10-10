#!/usr/bin/env node
/**
 * Compare the analytical model to independently obtained ephemeris samples.
 *
 * Input: a curated reference CSV exported from (or transcribed from) JPL
 * Horizons for observers on the Moon; no reference samples are included in
 * the repository, so the tool MUST NOT claim the model is already validated.
 *
 * utc,latitude_deg,longitude_deg_east,sun_azimuth_deg,sun_elevation_deg,earth_azimuth_deg,earth_elevation_deg
 *
 * Usage:
 *   node scripts/validate-horizons.js path/to/references.csv [maximum-error-degrees]
 */
import {readFileSync} from 'node:fs';
import {ephemeris} from '../src/astro.js';
const angleError=(a,b)=>Math.abs(((a-b+540)%360)-180);
const diff=(a,b)=>Math.abs(a-b);
function main(){
  const [, ,file,tolArg]=process.argv;
  if(!file){console.error('Usage: node scripts/validate-horizons.js <curated-reference.csv> [max-error-deg]');process.exitCode=2;return;}
  const rows=readFileSync(file,'utf8').trim().split(/\r?\n/);
  const expected=['utc','latitude_deg','longitude_deg_east','sun_azimuth_deg','sun_elevation_deg','earth_azimuth_deg','earth_elevation_deg'];
  if(rows[0]?.trim()!==expected.join(','))throw Error('Invalid CSV columns. See script header for exact schema.');
  if(rows.length<2)throw Error('No independent reference samples provided');
  const names=['sun_azimuth_deg','sun_elevation_deg','earth_azimuth_deg','earth_elevation_deg'];
  const results=Object.fromEntries(names.map(n=>[n,[]]));
  for(const [idx,line] of rows.slice(1).entries()){
    if(!line.trim())continue;
    const values=line.split(',');
    if(values.length!==7)throw Error('Invalid row '+(idx+2));
    const [utc,...raw]=values;
    const numeric=raw.map(Number);
    if(!Number.isFinite(Date.parse(utc))||numeric.some(x=>!Number.isFinite(x)))throw Error('Bad numeric/UTC value at row '+(idx+2));
    const [lat,lon,sunAz,sunEl,earthAz,earthEl]=numeric;
    const pred=ephemeris(utc,lat,lon);
    results.sun_azimuth_deg.push(angleError(pred.sun.azimuth,sunAz));
    results.sun_elevation_deg.push(diff(pred.sun.elevation,sunEl));
    results.earth_azimuth_deg.push(angleError(pred.earth.azimuth,earthAz));
    results.earth_elevation_deg.push(diff(pred.earth.elevation,earthEl));
  }
  if(!results.sun_azimuth_deg.length)throw Error('No usable reference values');
  const summary=Object.fromEntries(names.map(n=>{
    const values=results[n],max=Math.max(...values),mae=values.reduce((a,b)=>a+b,0)/values.length;
    const rmse=Math.sqrt(values.reduce((s,e)=>s+e*e,0)/values.length);
    return [n,{max:max.toFixed(4),mae:mae.toFixed(4),rmse:rmse.toFixed(4)}];
  }));
  console.log(JSON.stringify({model:'analytical-screening-v1',note:'Reference CSV is supplied externally; this script does not certify it as Horizons data.',n:results.sun_azimuth_deg.length,units:'degrees',errors:summary},null,2));
  if(tolArg!==undefined){
    const tolerance=Number(tolArg);
    if(!(tolerance>0&&tolerance<=180))throw Error('Maximum error threshold must be >0 and <=180');
    if(names.some(name=>Number(summary[name].max)>tolerance))process.exitCode=1;
  }
}
try{main();}catch(e){console.error('Reference validation failed:',e.message);process.exitCode=2;}
