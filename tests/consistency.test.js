import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ephemeris,sampleWindow,summarize,rankedSites} from '../src/astro.js';
import {horizonAt,bodyVisible} from '../src/mission.js';
import {inspectSituation} from '../src/situation.js';
import {findMissionWindows} from '../src/finder.js';
import {SITES} from '../src/sites.js';
import {executeTool} from '../src/tools.js';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const start='2026-11-14T12:00:00.000Z';
const site={id:'test-site',name:'Test site',lat:-84.79,lon:29.2};
const profile={siteId:'test-site',lat:site.lat,lon:site.lon,source:'test DEM',coveragePct:99,
  azimuthDeg:Array.from({length:72},(_,i)=>i*5),
  elevationDeg:Array.from({length:72},(_,i)=>i*5<120?8:0)};

test('solar visibility accounts for the terrain horizon in every sampled view',()=>{
  const samples=sampleWindow({start,days:3,stepHours:2,lat:site.lat,lon:site.lon,profile});
  for(const s of samples){
    assert.equal(s.sun.visible,s.sun.elevation>horizonAt(profile,s.sun.azimuth),
      'sample visibility must follow the shared terrain-horizon rule');
    assert.equal(s.earth.visible,bodyVisible(profile,s.earth.azimuth,s.earth.elevation));
    assert.equal(s.dual,s.sun.visible&&s.earth.visible);
    const view=inspectSituation(ephemeris(new Date(s.time),site.lat,site.lon),profile);
    assert.equal(view.sunVisible,s.sun.visible,'live readouts and timeline cannot disagree');
    assert.equal(view.earthVisible,s.earth.visible,'live readouts and timeline cannot disagree');
  }
});

test('flat-horizon sampling is exactly the geometric case, and says so',()=>{
  const samples=sampleWindow({start,days:2,stepHours:2,lat:site.lat,lon:site.lon});
  for(const s of samples){
    assert.equal(s.sun.visible,s.sun.elevation>0);
    assert.equal(s.earth.visible,s.earth.elevation>0);
    assert.equal(s.sun.visible,bodyVisible(null,s.sun.azimuth,s.sun.elevation));
  }
  assert.equal(inspectSituation(ephemeris(new Date(start),site.lat,site.lon),null).source,'0° GEOMETRIC HORIZON');
});

test('site ranking uses per-site terrain horizons when profiles are supplied',()=>{
  const flat=rankedSites([{...site,id:'a'},{...site,id:'b'}],start,3);
  const withTerrain=rankedSites([{...site,id:'a'},{...site,id:'b'}],start,3,{'a':profile});
  const aFlat=flat.find(e=>e.site.id==='a').stats.sun;
  const aTerrain=withTerrain.find(e=>e.site.id==='a').stats.sun;
  assert.ok(aTerrain<aFlat,'obstructed site must lose solar access in the ranking');
  assert.equal(withTerrain.find(e=>e.site.id==='b').stats.sun,flat.find(e=>e.site.id==='b').stats.sun,
    'sites without a profile keep the geometric horizon');
});

test('Window Finder and the planner timeline compute the same percentages',()=>{
  const windowDays=3;
  const finder=findMissionWindows({sites:[site],startDate:'2026-11-14',searchDays:1,windowDays,
    stepHours:4,priority:'balanced'});
  const planned=summarize(sampleWindow({start,days:windowDays,stepHours:4,lat:site.lat,lon:site.lon}));
  const w=finder.matrix[0].windows[0];
  assert.ok(Math.abs(w.sunPct-planned.sun)<1e-9,'sun percentages must match the planner sampling');
  assert.ok(Math.abs(w.earthPct-planned.earth)<1e-9,'Earth percentages must match the planner sampling');
  const terrainFinder=findMissionWindows({sites:[site],startDate:'2026-11-14',searchDays:1,windowDays,
    stepHours:4,priority:'balanced',terrainMode:'terrain',terrainProfiles:{'test-site':profile}});
  const terrainPlanned=summarize(sampleWindow({start,days:windowDays,stepHours:4,lat:site.lat,lon:site.lon,profile}));
  const t=terrainFinder.matrix[0].windows[0];
  assert.ok(Math.abs(t.sunPct-terrainPlanned.sun)<1e-9,'terrain-mode finder matches terrain-aware planner sampling');
});

test('Earth visibility is never presented as confirmed communication',()=>{
  assert.match(html,/Geometric Earth/i);
  assert.match(html,/line-of-sight geometry/i);
  assert.doesNotMatch(html,/guaranteed communication|communication guaranteed/i);
  assert.match(app,/NOT a radio link budget/);
});

test('every results panel exposes its horizon model, including the flat fallback',()=>{
  for(const id of ['timeline-model','metrics-model','compare-model','date-compare-model'])
    assert.ok(html.includes('id="'+id+'"'),'missing model badge '+id);
  assert.match(app,/Flat 0° horizon · no terrain/);
  assert.match(app,/LOADED TERRAIN/);
  assert.match(app,/SITES.filter\(site=>!terrainMode\|\|getCachedTerrain\(site\)\)/);
});

test('comparison and date-comparison controls ship wired',()=>{
  for(const id of ['compare-table','compare-timeline','planning-time',
    'date-compare-site','date-compare-a','date-compare-b','finder-duration'])
    assert.ok(html.includes('id="'+id+'"'),'missing comparison control '+id);
  for(const id of ['compare-table','date-compare-site','planning-time','finder-duration'])
    assert.ok(app.includes("'#"+id+"'"),'missing comparison wiring for '+id);
});

test('site classifications are preserved and surfaced to the user',()=>{
  const kinds=new Set(SITES.map(s=>s.kind));
  assert.ok(kinds.has('Historic landing'));
  assert.ok(kinds.has('Approx. candidate'));
  assert.ok(kinds.has('Illustrative point'));
  assert.ok(SITES.every(s=>s.kind&&s.source),'every site keeps a classification and a source link');
  assert.match(app,/site\.kind/,'site classification reaches the interface');
  assert.match(html,/not surveyed landing sites/);
});

test('assistant site comparison applies the same loaded per-site horizon as the planner',()=>{
  const site=SITES[0],p={...profile,lat:site.lat,lon:site.lon,source:'NASA fixture horizon'};
  const ctx={site,date:'2026-11-14',time:'12:00',days:3,terrainProfilesBySite:{[site.id]:p}};
  const actual=executeTool('compare_locations',{},ctx);
  assert.equal(actual.ok,true);
  const expected=rankedSites(SITES,start,3,{[site.id]:p});
  for(const entry of actual.value.ranked){
    const other=expected.find(e=>e.site.id===entry.site);
    assert.equal(entry.solarAvailabilityPct,other.stats.sun);
    assert.equal(entry.terrainApplied,entry.site===site.id);
  }
});
test('assistant never applies the selected site horizon to another physical coordinate',()=>{
  const ctx={site,terrainProfile:{...profile,elevationDeg:Array(72).fill(90)}};
  const other={lat:0,lon:0};
  const actual=executeTool('calculate_celestial_conditions',{utcTimestamp:start,...other},ctx);
  assert.equal(actual.ok,true);
  assert.equal(actual.value.sun.horizonDeg,0);
  assert.equal(actual.value.earth.horizonDeg,0);
});
