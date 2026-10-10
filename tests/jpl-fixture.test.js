import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ephemeris} from '../src/astro.js';
const data=readFileSync(new URL('./fixtures/jpl-horizons-20261114.csv',import.meta.url),'utf-8').trim().split(/\r?\n/);
const circle=(a,b)=>Math.abs(((a-b+540)%360)-180);
test('Archived independent Horizons 2026 reference matches current model within 1 degree at sampled sites',()=>{
 const [header,...rows]=data;
 assert.equal(header,'utc,latitude_deg,longitude_deg_east,sun_azimuth_deg,sun_elevation_deg,earth_azimuth_deg,earth_elevation_deg');
 assert.equal(rows.length,10);
 let azMax=0,elMax=0;
 for(const [idx,row] of rows.entries()){
   const [utc,...vals]=row.split(',');
   assert.equal(vals.length,6);
   assert.ok(Number.isFinite(Date.parse(utc)));
   const [lat,lon,sunAz,sunEl,earthAz,earthEl]=vals.map(Number);
   assert.ok([lat,lon,sunAz,sunEl,earthAz,earthEl].every(Number.isFinite));
   const observation=ephemeris(utc,lat,lon);
   for(const [target,az,el] of [['sun',sunAz,sunEl],['earth',earthAz,earthEl]]){
     azMax=Math.max(azMax,circle(observation[target].azimuth,az));
     elMax=Math.max(elMax,Math.abs(observation[target].elevation-el));
   }
 }
 // Regression bound applies to this date/site set ONLY, not to every lunar site/time.
 assert.ok(azMax<1, '2026 reference azimuth error exceeds 1°: '+azMax);
 assert.ok(elMax<1, '2026 reference elevation error exceeds 1°: '+elMax);
});


test('Broader independently archived JPL reference passes explicit 1° regression tolerance across three seasons',()=>{
 const raw=readFileSync(new URL('./fixtures/jpl-horizons-three-seasons.csv',import.meta.url),'utf-8').trim().split(/\r?\n/);
 assert.equal(raw.length-1,45);
 let azMax=0,elMax=0;
 for(const row of raw.slice(1)){
   const [utc,...vals]=row.split(',');
   const [lat,lon,sAz,sEl,eAz,eEl]=vals.map(Number);
   assert.ok(vals.every(v=>Number.isFinite(Number(v))));
   const obs=ephemeris(utc,lat,lon);
   azMax=Math.max(azMax,circle(obs.sun.azimuth,sAz),circle(obs.earth.azimuth,eAz));
   elMax=Math.max(elMax,Math.abs(obs.sun.elevation-sEl),Math.abs(obs.earth.elevation-eEl));
 }
 assert.ok(azMax<1,'More than 1° azimuth discrepancy on archived Horizons samples: '+azMax);
 assert.ok(elMax<1,'More than 1° elevation discrepancy on archived Horizons samples: '+elMax);
});
