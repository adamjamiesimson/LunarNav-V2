import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ephemeris} from '../src/astro.js';

/**
 * The validation figures displayed on the Science page must be reproducible
 * from the archived JPL Horizons fixtures: not transcribed by hand.
 */
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const fixture=readFileSync(new URL('./fixtures/jpl-horizons-three-seasons.csv',import.meta.url),'utf8').trim().split(/\r?\n/);
const angleError=(a,b)=>Math.abs(((a-b+540)%360)-180);

function fixtureErrors(){
  const errors={sunAz:[],sunEl:[],earthAz:[],earthEl:[]};
  for(const line of fixture.slice(1)){
    const [utc,lat,lon,sunAz,sunEl,earthAz,earthEl]=line.split(',');
    const obs=ephemeris(new Date(utc),Number(lat),Number(lon));
    errors.sunAz.push(angleError(obs.sun.azimuth,Number(sunAz)));
    errors.sunEl.push(Math.abs(obs.sun.elevation-Number(sunEl)));
    errors.earthAz.push(angleError(obs.earth.azimuth,Number(earthAz)));
    errors.earthEl.push(Math.abs(obs.earth.elevation-Number(earthEl)));
  }
  return errors;
}

test('displayed ephemeris validation figures match the archived reference data',()=>{
  const e=fixtureErrors();
  const azMax=Math.max(...e.sunAz,...e.earthAz);
  const elMax=Math.max(...e.sunEl,...e.earthEl);
  const elMean=[...e.sunEl,...e.earthEl].reduce((a,b)=>a+b,0)/(e.sunEl.length+e.earthEl.length);
  assert.ok(Math.abs(azMax-0.480)<0.001,`max azimuth error ${azMax} should match the displayed 0.480°`);
  assert.ok(Math.abs(elMax-0.285)<0.001,`max elevation error ${elMax} should match the displayed 0.285°`);
  assert.ok(Math.abs(elMean-0.141)<0.001,`mean elevation error ${elMean} should match the displayed 0.141°`);
});

test('displayed observation count matches the fixture contents',()=>{
  const rows=fixture.length-1;
  assert.equal(rows,45,'three-seasons fixture holds 45 site/UTC epochs');
  assert.equal(rows*2,90,'two celestial targets per epoch give 90 reference angles');
  assert.ok(html.includes('0.480°'),'max azimuth figure is shown');
  assert.ok(html.includes('0.285°'),'max elevation figure is shown');
  assert.ok(html.includes('0.141°'),'mean elevation figure is shown');
  assert.match(html,/90 independently queried Sun and Earth angles/);
});

test('validation is scoped to the ephemeris, not the whole planning model',()=>{
  assert.match(html,/validates the Sun\/Earth position calculations only/);
});
