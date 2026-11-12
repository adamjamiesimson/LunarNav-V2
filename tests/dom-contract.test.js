import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const build=readFileSync(new URL('../scripts/build.js',import.meta.url),'utf8');
const doc=new JSDOM(html).window.document;
test('one planning workflow contains shared mission inputs, comparison and search',()=>{
 const plan=doc.querySelector('[data-view="planning"]');
 for(const id of ['finder-date','planning-time','finder-duration','finder-mode','compare-table','compare-timeline','finder-range','finder-priority','finder-top','finder-heatmap','finder-export'])assert.ok(plan.querySelector('#'+id),'missing planning input/result '+id);
 for(const id of ['finder-run','compare-picks','site-comparison','finder-impact','finder-load-all','date-compare-run','transit-sync'])assert.equal(doc.getElementById(id),null,'redundant control remains '+id);
 assert.ok(doc.querySelector('[data-view="explore"] #download-csv'));
});
test('planning dependencies are included in the static build',()=>{
 for(const module of ['finder','compare','terrain-cache','router','transit'])assert.ok(build.includes('src/'+module+'.js'));
 assert.match(build,/data\/lola-horizons\.json/);
});
test('planning keeps screening limitations and resolution visible',()=>{
 assert.match(doc.querySelector('[data-view="planning"]').textContent,/not universal error bounds/i);
 assert.match(html,/Two-hour comparison and four-hour search/);
 assert.match(html,/not surveyed landing sites/);
 assert.match(html,/Earth visibility is geometry/);
});
test('terrain coverage is explicit and refinement remains in Engineering',()=>{
 for(const id of ['finder-terrain-count','finder-data-status'])assert.ok(doc.getElementById(id));
 assert.match(html,/No flat-horizon results are mixed in/i);
 assert.ok(doc.querySelector('[data-view="engineering"] #terrain-load'));
 assert.ok(doc.querySelector('[data-view="engineering"] #terrain-file'));
});
test('search export retains terrain baseline differences and provenance',()=>{
 assert.match(app,/compareFinderModels/);assert.match(app,/delta_dual_pp/);
 assert.match(app,/data_source/);assert.match(app,/state.finder.startTime/);
});
test('four views retain live modules with one navigation route each',()=>{
 assert.equal(doc.querySelectorAll('[data-view]').length,4);
 for(const view of ['explore','planning','engineering','science']){
   assert.equal(doc.querySelectorAll('[data-view="'+view+'"]').length,1);
   assert.equal(doc.querySelectorAll('a.nav-link[data-route="'+view+'"]').length,1);
 }
 assert.match(app,/history\.pushState/);assert.match(app,/popstate/);
});
test('date comparison and transit are optional details after core results',()=>{
 const plan=doc.querySelector('[data-view="planning"]');
 for(const id of ['date-comparison','transit']){
   assert.equal(doc.querySelectorAll('#'+id).length,1);
   const detail=plan.querySelector('details#'+id);
   assert.ok(detail&&!detail.open);
   assert.ok(html.indexOf('id="'+id+'"')>html.indexOf('id="finder-top"'));
 }
 for(const id of ['transit-mode','transit-date','transit-time','transit-profile','transit-custom-hours','transit-run','transit-results','transit-hint','transit-destination-tag','transit-profile-tag']){
   assert.ok(plan.querySelector('#'+id),'missing transit control '+id);
   assert.ok(app.includes("'#"+id+"'"),'missing transit integration '+id);
 }
});
test('Earth and Sun remain in the Moon globe with UTC simulation controls',()=>{
 const globe=readFileSync(new URL('../src/globe.js',import.meta.url),'utf8');
 for(const id of ['celestial-view','celestial-scrubber','celestial-play','celestial-speed','celestial-clock','celestial-reset'])assert.ok(doc.getElementById(id));
 assert.match(globe,/skyBodies\(a,sunlight,earthlight/);
 assert.match(globe,/horizontalToLunarVector\(obs.earth/);
 assert.match(globe,/setCelestialVisible\(enabled\)/);
 assert.match(build,/src\/celestial\.js/);assert.match(html,/sizes and distances compressed/);
});
