#!/usr/bin/env node
/**
 * Independent live NASA/JPL Horizons check. Never claims validation if the API fails.
 * Moon-fixed observer coord@301, geodetic east longitude/latitude, 0 km altitude,
 * airless apparent azimuth/elevation, UTC, quantity 4.
 * Run npm run validate:jpl; outputs independent measured errors or a hard failure.
 */
import {ephemeris} from '../src/astro.js';
const endpoint='https://ssd.jpl.nasa.gov/api/horizons.api';
const sites=[{name:'Mons Mouton',lat:-84.79,lon:29.2},{name:'Malapert Region',lat:-85.99,lon:357.07},
  {name:'Shackleton Rim (approx)',lat:-89.9,lon:180.0}];
const periods=[
  {start:'2026-11-14 12:00',stop:'2026-11-15 12:00'},
  {start:'2027-03-14 12:00',stop:'2027-03-15 12:00'},
  {start:'2027-07-14 12:00',stop:'2027-07-15 12:00'}
];
const targets=[{name:'sun',command:'10'},{name:'earth',command:'399'}];
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const angular=(a,b)=>Math.abs(((a-b+540)%360)-180);
const q=v=>String.fromCharCode(39)+v+String.fromCharCode(39);
function iso(text){
  const m=text.match(/^(\d{4})-([A-Za-z]{3})-(\d\d)\s+(\d\d):(\d\d)/);
  if(!m)throw Error('Unknown Horizons calendar date '+text);
  const month=months.indexOf(m[2]);if(month<0)throw Error('Unknown Horizons month');
  return [m[1],String(month+1).padStart(2,'0'),m[3]].join('-')+'T'+m[4]+':'+m[5]+':00.000Z';
}
function parse(text){
  const x=String(text).match(/\$\$SOE([\s\S]*?)\$\$EOE/);
  if(!x)throw Error('No ephemeris records from Horizons: '+String(text).slice(-500));
  const out=[];
  for(const line of x[1].trim().split(/\r?\n/)){
    if(!line.trim())continue;
    const fields=line.split(',').map(s=>s.trim());
    const time=iso(fields[0]);
    const numeric=fields.slice(1).filter(s=>s!==''&&Number.isFinite(Number(s))).map(Number);
    if(numeric.length<2)throw Error('No azimuth/elevation in Horizons line '+line);
    const [azimuth,elevation]=numeric.slice(-2);
    if(azimuth<0||azimuth>=360||elevation< -90||elevation>90)throw Error('Invalid angles in Horizons line '+line);
    out.push({time,azimuth,elevation});
  }
  if(out.length<3)throw Error('Horizons returned too few epochs');
  return out;
}
async function query(site,target,period){
  const params=new URLSearchParams({format:'json',COMMAND:q(target.command),MAKE_EPHEM:q('YES'),
    EPHEM_TYPE:q('OBSERVER'),OBJ_DATA:q('NO'),CENTER:q('coord@301'),
    COORD_TYPE:q('GEODETIC'),SITE_COORD:q([site.lon,site.lat,0].join(',')),
    QUANTITIES:q('4'),CSV_FORMAT:q('YES'),START_TIME:q(period.start),
    STOP_TIME:q(period.stop),STEP_SIZE:q('6 h'),
    TIME_TYPE:q('UT'),APPARENT:q('AIRLESS')});
  const url=endpoint+'?'+params;
  const response=await fetch(url,{signal:AbortSignal.timeout(45000)});
  if(!response.ok)throw Error('NASA Horizons HTTP '+response.status);
  const body=await response.json();
  if(body.error||!body.result)throw Error('NASA Horizons response error: '+(body.error||'missing result'));
  return {records:parse(body.result),url};
}
async function run(){
  const comparisons=[],queries=[];
  for(const site of sites)for(const period of periods)for(const target of targets){
    const {records,url}=await query(site,target,period);
    queries.push({site:site.name,target:target.name,period:period.start,url});
    for(const row of records){
      const own=ephemeris(row.time,site.lat,site.lon)[target.name];
      comparisons.push({site:site.name,target:target.name,time:row.time,
        refAz:row.azimuth,refEl:row.elevation,modelAz:own.azimuth,modelEl:own.elevation,
        azimuthErrorDeg:angular(own.azimuth,row.azimuth),elevationErrorDeg:Math.abs(own.elevation-row.elevation)});
    }
  }
  const stats=key=>{
    const xs=comparisons.map(r=>r[key]);
    return {maxDeg:Math.max(...xs),meanDeg:xs.reduce((a,b)=>a+b,0)/xs.length,
      rmseDeg:Math.sqrt(xs.reduce((a,b)=>a+b*b,0)/xs.length)};
  };
  const result={origin:'Independent NASA/JPL Horizons API',sampleCount:comparisons.length,
    model:'analytical-screening-v1',generatedAt:new Date().toISOString(),
    note:'Apparent Horizons vs geometric truncated analytical model; no terrain or flight qualification.',
    azimuth:stats('azimuthErrorDeg'),elevation:stats('elevationErrorDeg'),comparisons,queries};
  console.log(JSON.stringify(result,null,2));
  const tol=Number(process.env.HORIZONS_MAX_ERROR_DEG||0);
  if(tol>0&&(result.azimuth.maxDeg>tol||result.elevation.maxDeg>tol)){
    console.error('WARNING: independent error exceeds '+tol+' degrees');process.exitCode=1;
  }
}
run().catch(error=>{console.error('NOT SCIENTIFICALLY VALIDATED — live JPL request failed:',error.message);process.exitCode=2;});
