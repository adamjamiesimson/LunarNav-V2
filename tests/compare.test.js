import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleWindow,summarize} from '../src/astro.js';
import {horizonAt,DEFAULT_ENGINEERING,simulateMission} from '../src/mission.js';
import {windowMetrics,comparisonRows,differenceNotes} from '../src/compare.js';

const start='2026-11-14T12:00:00.000Z';
const site={lat:-84.79,lon:29.2};
// A profile with a real obstruction toward the Sun's dominant azimuth band.
const profile={lat:site.lat,lon:site.lon,azimuthDeg:Array.from({length:72},(_,i)=>i*5),
  elevationDeg:Array.from({length:72},(_,i)=>i*5<120?8:0)};

test('comparison metrics agree with the shared sampling and summary functions',()=>{
  const m=windowMetrics({start,days:7,...site});
  const samples=sampleWindow({start,days:7,stepHours:2,lat:site.lat,lon:site.lon});
  const stats=summarize(samples);
  const total=m.totalHours;
  assert.equal(total,7*24,'same time span as the planner window');
  assert.ok(Math.abs(m.illuminationHours/total*100-stats.sun)<1e-9,'illumination must match summarize().sun');
  assert.ok(Math.abs(m.earthVisibilityPct-stats.earth)<1e-9,'Earth metric must match summarize().earth');
  assert.ok(Math.abs(m.simultaneousPct-stats.dual)<1e-9);
  assert.equal(m.illuminationHours+m.darknessHours,total,'light and dark must partition the window');
  assert.equal(m.terrainApplied,false);
  assert.equal(m.longestEarthBlackoutHours,stats.longestBlackoutHours);
});

test('metrics honour the terrain horizon exactly like the planner samples',()=>{
  const flat=windowMetrics({start,days:7,...site});
  const terrain=windowMetrics({start,days:7,...site,profile});
  assert.equal(terrain.terrainApplied,true);
  assert.ok(terrain.illuminationHours<flat.illuminationHours,'terrain obstruction must reduce sampled sunlight');
  for(const s of terrain.samples)
    assert.equal(s.sun.visible,s.sun.elevation>horizonAt(profile,s.sun.azimuth),'sample visibility follows the shared horizon rule');
});

test('summary metrics are consistent with the underlying timeline data',()=>{
  const m=windowMetrics({start,days:7,...site,profile});
  assert.ok(m.longestDarknessHours>=0&&m.longestDarknessHours<=m.totalHours);
  assert.ok(m.longestEarthVisibilityHours>=0&&m.longestEarthVisibilityHours<=m.totalHours);
  assert.ok(m.maxSunElevationDeg>=-90&&m.maxSunElevationDeg<=90);
  const expected=simulateMission(m.samples,DEFAULT_ENGINEERING,profile).generatedWh;
  assert.ok(Math.abs(m.solarEnergyWh-expected)<1e-6,'energy figure comes from the same power model');
});

test('side-by-side rows carry units and the values they report',()=>{
  const entries=[
    {name:'A',kind:'test',metrics:windowMetrics({start,days:3,...site})},
    {name:'B',kind:'test',metrics:windowMetrics({start,days:3,lat:-85.99,lon:357.07})}
  ];
  const rows=comparisonRows(entries);
  assert.equal(rows.length,6);
  for(const row of rows){
    assert.equal(row.values.length,2);
    for(const v of row.values){assert.ok(Number.isFinite(v.value));assert.ok(v.unit.length>0);}
  }
  assert.equal(rows[0].values[0].value,entries[0].metrics.illuminationHours);
  assert.equal(rows.find(r=>r.label==='Longest Earth-view gap').values[0].value,entries[0].metrics.longestEarthBlackoutHours);
  // Same interval for every compared entry.
  assert.equal(entries[0].metrics.totalHours,entries[1].metrics.totalHours);
});

test('difference notes are derived from the computed metrics, never hardcoded',()=>{
  // Beta's horizon blocks Earth's azimuth band, so the Earth-view trade-off differs.
  const earthBlock={lat:-85.99,lon:357.07,azimuthDeg:Array.from({length:72},(_,i)=>i*5),
    elevationDeg:Array.from({length:72},(_,i)=>{const az=i*5;return az>=315&&az<=355?30:0;})};
  const two=[
    {name:'Alpha',kind:'test',metrics:windowMetrics({start,days:7,...site})},
    {name:'Beta',kind:'test',metrics:windowMetrics({start,days:7,lat:-85.99,lon:357.07,profile:earthBlock})}
  ];
  const notes=differenceNotes(two);
  assert.ok(notes.length>=2,'two sites must produce comparative notes');
  assert.ok(notes.every(n=>typeof n==='string'&&n.length>20));
  assert.ok(notes.some(n=>n.includes('Alpha')||n.includes('Beta')),'notes name the compared sites');
  assert.ok(notes.some(n=>/radio-link|line-of-sight/i.test(n)),'Earth-view note keeps the geometric caveat');
  // Column order must not change the conclusions.
  const swapped=differenceNotes([two[1],two[0]]);
  assert.deepEqual(notes,swapped,'note content follows the data, not the column order');
  assert.equal(differenceNotes([two[0]]).length,0,'fewer than two entries yields no comparison');
});
