import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SITES} from '../src/sites.js';
import {LOLA_COG} from '../src/terrain.js';
import {validateProfile,importVerifiedCache,loadBundledTerrain} from '../src/terrain-cache.js';
import {findMissionWindows,compareFinderModels} from '../src/finder.js';

const raw=JSON.parse(readFileSync(new URL('../data/lola-horizons.json',import.meta.url),'utf-8'));
const entries=importVerifiedCache(raw,SITES);
const byId=Object.fromEntries(entries.map(({site,profile})=>[site.id,profile]));
test('all five bundled horizon profiles originate from real NASA COG extraction',()=>{
  assert.equal(raw.algorithm,'lola-local-horizon-v1');
  assert.equal(raw.datasetUrl,LOLA_COG);
  assert.match(raw.sourceRunUrl,/github\.com\/adamjamiesimson\/LunarNav-V2\/actions\/runs\/\d+/);
  assert.equal(entries.length,SITES.length);
  assert.equal(entries.reduce((n,e)=>n+e.profile.elevationDeg.length,0),360);
  for(const {site,profile} of entries){
    assert.equal(profile.siteId,site.id);
    assert.equal(profile.lat,site.lat);
    assert.equal(profile.lon,site.lon);
    assert.ok(validateProfile(site,profile));
    assert.ok(profile.coveragePct>=95);
    assert.equal(profile.resolutionM,80);
    assert.equal(profile.verifiedSource,true);
    assert.equal(profile.elevationDeg.length,72);
  }
});
test('bundled profile integrity check fails closed for stale coordinates, altered resolution or unknown source',()=>{
  const site=SITES[0],p=structuredClone(raw.profiles[site.id]);
  const altered=[{...p,lon:p.lon+0.001},{...p,resolutionM:200},
    {...p,datasetUrl:'https://example.com/unknown.tif'},
    {...p,azimuthDeg:p.azimuthDeg.slice(1)},
    {...p,elevationDeg:p.elevationDeg.map((v,i)=>i===0?Number.NaN:v)},
    {...p,coveragePct:70}];
  for(const item of altered)assert.equal(validateProfile(site,item),false);
  const tampered=structuredClone(raw);
  tampered.profiles[site.id].lon+=0.01;
  assert.equal(importVerifiedCache(tampered,SITES).length,SITES.length-1);
  assert.deepEqual(importVerifiedCache({...raw,algorithm:'unknown'},SITES),[]);
});
test('bundled NASA profiles load from local static catalog without any NASA network request',async()=>{
  let url;
  const profiles=await loadBundledTerrain(SITES,{
    fetcher:async input=>{url=input;return {ok:true,json:async()=>raw};}
  });
  assert.equal(url,'/data/lola-horizons.json');
  assert.equal(profiles.length,5);
});
test('matched 30-day finder reveals terrain losses without ever enhancing geometric availability',()=>{
  const parameters={sites:SITES,startDate:'2026-11-14',searchDays:30,windowDays:7,stepHours:4,priority:'balanced'};
  const flat=findMissionWindows(parameters);
  const terrain=findMissionWindows({...parameters,terrainMode:'terrain',terrainProfiles:byId});
  const changes=compareFinderModels(flat,terrain);
  assert.equal(changes.length,5*30);
  assert.equal(terrain.ranked.length,150);
  let affected=0;
  for(const diff of changes){
    for(const key of ['Sun','Earth','Dual']){
      assert.ok(diff['delta'+key+'Pp']<=1e-9,'Terrain unexpectedly increases '+key+' at '+diff.siteName+' '+diff.startDate);
      assert.ok(diff['terrain'+key+'Pct']>=0);
    }
    if(diff.deltaDualPp < -0.001||diff.deltaSunPp < -0.001||diff.deltaEarthPp < -0.001)affected++;
  }
  assert.ok(affected>0,'Real terrain should obstruct at least one of the dates at these sites');
});
test('comparison requires identical site/date/priority sampling assumptions',()=>{
  const p={sites:SITES,startDate:'2026-11-14',searchDays:4,windowDays:3,stepHours:4,priority:'balanced'};
  const b=findMissionWindows(p),t=findMissionWindows({...p,terrainProfiles:byId,terrainMode:'terrain'});
  assert.equal(compareFinderModels(b,t).length,20);
  assert.throws(()=>compareFinderModels(b,findMissionWindows({...p,startDate:'2026-11-15',terrainProfiles:byId,terrainMode:'terrain'})),/same UTC date/);
});
