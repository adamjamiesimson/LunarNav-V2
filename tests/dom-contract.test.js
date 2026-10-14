import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const build=readFileSync(new URL('../scripts/build.js',import.meta.url),'utf8');
test('mission finder controls exist and map onto JS event listeners',()=>{
 for(const id of [
   'finder-date','finder-range','finder-duration','finder-priority','finder-run',
   'finder-heatmap','finder-top','finder-caption','finder-shell-status','finder-export'
 ]){
   assert.ok(html.includes('id="'+id+'"'),'Missing HTML control: '+id);
   assert.ok(app.includes("'#"+id+"'"),'Missing JS integration for: '+id);
 }
});
test('new analytics dependency included in deployable static build',()=>{
 assert.match(app,/from '\.\/finder\.js'/);
 assert.match(build,/src\/finder\.js/);
 assert.match(html,/data-route="windows"/);
});
test('navigation uses deliberate screening language rather than unqualified accuracy claims',()=>{
 assert.match(html,/flat-horizon/i);
 assert.match(html,/not universal error bounds/i);
 assert.match(html,/four hours/i);
});

test('terrain-aware finder mode advertises honest site coverage and exposes loading controls',()=>{
 for(const id of ['finder-mode','finder-load-all','finder-open-terrain','finder-terrain-count','finder-data-status']){
   assert.ok(html.includes('id="'+id+'"'),'Missing coverage UI: '+id);
   assert.ok(app.includes("'#"+id+"'"),'Missing coverage JS: '+id);
 }
 assert.match(html,/No flat-horizon results are mixed in/i);
 assert.match(app,/getCachedTerrain/);
});

test('Phase 5 terrain comparison UI and source-backed catalog are wired into production',()=>{
  for(const id of ['finder-impact','finder-impact-items']){
    assert.ok(html.includes('id="'+id+'"'),'Missing comparison panel '+id);
    assert.ok(app.includes("'#"+id+"'"),'Missing comparison integration for '+id);
  }
  assert.match(app,/loadBundledTerrain/);
  assert.match(app,/compareFinderModels/);
  assert.match(build,/src\/terrain-cache\.js/);
  assert.match(build,/data\/lola-horizons\.json/);
  assert.match(app,/delta_dual_pp/);
});

test('Multipage workspace keeps all live tool DOM nodes while showing one view at a time',()=>{
 const views=['home','explore','windows','engineering','compare','science'];
 for(const view of views)assert.ok(html.includes('data-view="'+view+'"'),'Missing view '+view);
 for(const route of views)assert.ok(html.includes('data-route="'+route+'"'),'Missing nav route '+route);
 assert.match(html,/src="\/src\/app\.js"/);
 assert.match(html,/href="\/src\/styles\.css"/);
 assert.match(app,/history\.pushState/);
 assert.match(app,/popstate/);
 assert.match(build,/src\/router\.js/);
 assert.match(app,/navigatePage\('explore'\)/);
 assert.match(app,/navigatePage\('engineering'\)/);
});

test('Earth and Sun are part of the existing Moon globe, not a separate 3D scene',()=>{
 const globe=readFileSync(new URL('../src/globe.js',import.meta.url),'utf8');
 for(const id of ['celestial-view','celestial-scrubber','celestial-play','celestial-speed','celestial-clock','celestial-reset']){
   assert.ok(html.includes('id="'+id+'"'),'missing control '+id);
   assert.ok(app.includes("'#"+id+"'"),'missing control handler '+id);
 }
 assert.match(globe,/skyBodies\(a,sunlight,earthlight/);
 assert.match(globe,/horizontalToLunarVector\(obs.earth/);
 assert.match(globe,/setCelestialVisible\(enabled\)/);
 assert.match(globe,/showSkyBodies>0\.5/);
 assert.match(globe,/celestialDrag/);
 assert.match(build,/src\/celestial\.js/);
 assert.match(html,/SPHERES ENLARGED FOR VISIBILITY/);
 assert.ok(!app.includes('setSystemView('),'old separate-system toggle still wired');
});
