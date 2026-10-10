import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const build=readFileSync(new URL('../scripts/build.js',import.meta.url),'utf8');
test('mission finder controls exist and map onto JS event listeners',()=>{
 for(const id of [
   'finder','finder-date','finder-range','finder-duration','finder-priority','finder-run',
   'finder-heatmap','finder-top','finder-caption','finder-shell-status','finder-export'
 ]){
   assert.ok(html.includes('id="'+id+'"'),'Missing HTML control: '+id);
   assert.ok(app.includes("'#"+id+"'"),'Missing JS integration for: '+id);
 }
});
test('new analytics dependency included in deployable static build',()=>{
 assert.match(app,/from '\.\/finder\.js'/);
 assert.match(build,/src\/finder\.js/);
 assert.match(html,/data-scroll="finder"/);
});
test('navigation uses deliberate screening language rather than unqualified accuracy claims',()=>{
 assert.match(html,/flat-horizon/i);
 assert.match(html,/not universal error bounds/i);
 assert.match(html,/four hours/i);
});
