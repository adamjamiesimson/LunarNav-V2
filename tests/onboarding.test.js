import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  INTRO_DURATION_MS,INTRO_SESSION_KEY,TOUR_DONE_KEY,
  TOUR_STEPS,introNeeded,tourNeeded
} from '../src/onboarding.js';
import {PAGE_ROUTES} from '../src/router.js';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
const build=readFileSync(new URL('../scripts/build.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const memory=()=>{
  const m=new Map();
  return {getItem:key=>m.get(key)??null,setItem:(key,value)=>m.set(key,value)};
};
test('intro is exactly six seconds and is one per session',()=>{
  assert.equal(INTRO_DURATION_MS,6000);
  const storage=memory();
  assert.equal(introNeeded(storage),true);
  storage.setItem(INTRO_SESSION_KEY,'1');
  assert.equal(introNeeded(storage),false);
});
test('tutorial is one time for each browser profile and replay remains available',()=>{
  const storage=memory();
  assert.equal(tourNeeded(storage),true);
  storage.setItem(TOUR_DONE_KEY,'1');
  assert.equal(tourNeeded(storage),false);
  assert.match(html,/id="restart-tour"/);
  assert.match(html,/id="tour-help"/);
});
test('storage-denied browsers fail open and remain skippable',()=>{
  const unavailable={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}};
  assert.equal(introNeeded(unavailable),true);
  assert.equal(tourNeeded(unavailable),true);
  assert.match(html,/id="intro-skip"/);
  assert.match(html,/id="tour-skip"/);
});
test('guided tour explains every major module in the six-page workspace',()=>{
  assert.equal(TOUR_STEPS.length,10);
  assert.deepEqual([...new Set(TOUR_STEPS.map(s=>s.page))],
    ['home','explore','windows','engineering','compare','science']);
  for(const step of TOUR_STEPS){
    assert.ok(PAGE_ROUTES[step.page]);
    assert.ok(step.title.length>=9);
    assert.ok(step.description.length>=35);
    // Section selectors must be represented somewhere in the page markup.
    assert.ok(step.target.startsWith('.')||step.target.startsWith('#'));
    if(step.target.startsWith('#'))assert.ok(html.includes('id="'+step.target.slice(1)+'"'),step.target);
    else assert.ok(html.includes(step.target.slice(1)),step.target);
  }
});
test('intro and tutorial UI ships in the static production output',()=>{
  for(const id of [
    'intro-loader','intro-skip','tour-root','tour-backdrop','tour-spotlight',
    'tour-dialog','tour-title','tour-description','tour-progress','tour-next',
    'tour-back','tour-counter','tour-skip','restart-tour','tour-help'
  ])assert.ok(html.includes('id="'+id+'"'),id);
  assert.match(css,/data-intro-loading/);
  assert.match(css,/#tour-spotlight/);
  assert.match(build,/src\/onboarding\.js/);
  assert.match(app,/initOnboarding/);
  assert.match(html,/data-intro-loading/);
});
