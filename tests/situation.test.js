import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SITES} from '../src/sites.js';
import {ephemeris} from '../src/astro.js';
import {inspectSituation,buildSkyDiagram,fmtMargin} from '../src/situation.js';

const fixtures=JSON.parse(readFileSync(new URL('../data/lola-horizons.json',import.meta.url),'utf-8'));
const site=SITES.find(s=>s.id==='mons-mouton');
const profile={...fixtures.profiles[site.id],verifiedSource:true};
const obs=ephemeris(new Date('2026-11-14T12:00:00Z'),site.lat,site.lon);
test('live situation tracks actual site terrain azimuth horizon and geometric fallback',()=>{
  const flat=inspectSituation(obs);
  const local=inspectSituation(obs,profile);
  assert.equal(flat.terrain,false);
  assert.equal(local.terrain,true);
  assert.equal(local.source,'20 KM LOLA HORIZON');
  assert.ok(local.sunBarrier>=0&&local.earthBarrier>=0);
  assert.ok(local.sunMargin<=flat.sunMargin+1e-9);
  assert.ok(local.earthMargin<=flat.earthMargin+1e-9);
  assert.equal(local.sunVisible,local.sunMargin>0);
  assert.equal(local.earthVisible,local.earthMargin>0);
});
test('negative horizons cannot be misrepresented as visible',()=>{
  const fake={sun:{azimuth:90,elevation:5},earth:{azimuth:270,elevation:2}};
  const testProfile={azimuthDeg:[0,90,180,270],elevationDeg:[1,12,2,4]};
  const result=inspectSituation(fake,testProfile);
  assert.equal(result.sunVisible,false);
  assert.equal(result.earthVisible,false);
  assert.equal(result.combined,'BOTH OBSTRUCTED');
  assert.equal(result.sunMargin,-7);
  assert.equal(result.earthMargin,-2);
});
test('near-horizon readings disclose uncertainty rather than pretending to certify visibility',()=>{
  const marginal=inspectSituation({sun:{azimuth:90,elevation:0.2},earth:{azimuth:270,elevation:5}});
  assert.equal(marginal.nearBoundary,true);
  assert.equal(marginal.combined,'DUAL VISIBILITY');
  assert.equal(fmtMargin(-0.45),'-0.45°');
});
test('local sky shows a real azimuth-dependent skyline only with a loaded terrain profile',()=>{
  const plain=buildSkyDiagram(obs);
  const terrain=buildSkyDiagram(obs,profile);
  assert.match(plain,/geometric horizon/);
  assert.doesNotMatch(plain,/LOLA HORIZON/);
  assert.match(terrain,/NASA-derived local terrain horizon/);
  assert.match(terrain,/LOCAL LOLA HORIZON/);
  assert.match(terrain,/<polygon points="/);
  assert.match(terrain,/<circle/);
  assert.match(terrain,/SUN/);
  assert.match(terrain,/EARTH/);
});
test('mission control does not read terrain from globe visual texture',()=>{
  const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
  const globe=readFileSync(new URL('../src/globe.js',import.meta.url),'utf8');
  const fallback=readFileSync(new URL('../src/map.js',import.meta.url),'utf8');
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const build=readFileSync(new URL('../scripts/build.js',import.meta.url),'utf8');
  for(const id of ['mission-verdict','mission-source','mission-sun-margin','mission-earth-margin','mission-caution','hud-clock','hud-sun','hud-earth','hud-status','hud-horizon','horizon-label','sky-horizon-note','focus-site','expand-globe','hero-explore','hero-find','map-image-status']){
    assert.ok(html.includes('id="'+id+'"'),'missing view element: '+id);
    assert.ok(app.includes("'#"+id+"'")||globe.includes("'#"+id+"'"),'missing JS for: '+id);
  }
  assert.match(app,/inspectSituation\(obs,state\.terrain\)/);
  assert.match(app,/buildSkyDiagram\(obs,state\.terrain\)/);
  assert.match(app,/globe-immersive/);
  assert.match(globe,/focusSite\(\)/);
  assert.match(fallback,/focusSite\(\)/);
  assert.match(build,/src\/situation\.js/);
  assert.match(html,/GLOBE LIGHTING/);
});

test('unverified user-supplied terrain is never labeled as NASA LOLA',()=>{
  const userProfile={...profile,verifiedSource:false,source:'Local GeoTIFF'};
  const result=inspectSituation(obs,userProfile);
  assert.match(result.source,/UNVERIFIED/);
  assert.doesNotMatch(result.source,/LOLA/);
  const chart=buildSkyDiagram(obs,userProfile);
  assert.match(chart,/UNVERIFIED DEM HORIZON/);
  assert.doesNotMatch(chart,/NASA-derived local terrain horizon/);
});
