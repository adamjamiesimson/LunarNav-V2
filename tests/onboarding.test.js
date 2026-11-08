import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {initOnboarding,LOADING_DURATION_MS,TOUR_STEPS} from '../src/onboarding.js';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function setup(page='science'){
  const dom=new JSDOM(html),doc=dom.window.document;
  let timer,delay,current=page,preset=null;
  const clock={setTimeout(fn,ms){timer=fn;delay=ms;return 1;},scrollTo(){},clearTimeout(){}};
  initOnboarding({doc,clock,getPage:()=>current,navigateView:p=>{current=p;},onGraphicsChange:p=>{preset=p;}});
  return {doc,advance:()=>timer(),get delay(){return delay;},get page(){return current;},get preset(){return preset;}};
}
test('every visit starts with a five-second loading screen before graphics',()=>{
  for(let i=0;i<2;i++){
    const ui=setup();
    assert.equal(LOADING_DURATION_MS,5000);assert.equal(ui.delay,5000);
    assert.equal(ui.doc.querySelector('#onboarding-dialog').dataset.stage,'loading');
    assert.equal(ui.doc.querySelector('[data-onboarding-panel="graphics"]').hidden,true);
    ui.advance();assert.equal(ui.doc.querySelector('#onboarding-dialog').dataset.stage,'graphics');
  }
  assert.doesNotMatch(readFileSync(new URL('../src/onboarding.js',import.meta.url),'utf8'),/localStorage|sessionStorage/);
});
test('all requested graphics presets apply the exact relief multiplier before the tutorial',()=>{
  for(const value of [2,5,10]){
    const ui=setup();ui.advance();
    ui.doc.querySelector(`input[name="startup-graphics"][value="${value}"]`).checked=true;
    ui.doc.querySelector('#graphics-continue').click();
    assert.equal(ui.preset,value);assert.equal(ui.page,'explore');
    assert.equal(ui.doc.querySelector('#onboarding-dialog').dataset.stage,'tour');
  }
});
test('tutorial supports Back, completion, cleanup and returning to the original route',()=>{
  const ui=setup();ui.advance();ui.doc.querySelector('#graphics-continue').click();
  assert.equal(ui.doc.querySelector('#tour-back').disabled,true);
  ui.doc.querySelector('#tour-next').click();assert.equal(ui.doc.querySelector('#tour-counter').textContent,'2 / 3');
  ui.doc.querySelector('#tour-back').click();assert.equal(ui.doc.querySelector('#tour-counter').textContent,'1 / 3');
  for(let i=0;i<TOUR_STEPS.length;i++)ui.doc.querySelector('#tour-next').click();
  assert.equal(ui.page,'science');assert.equal(ui.doc.querySelector('#onboarding-dialog').hasAttribute('open'),false);
  assert.equal(ui.doc.querySelectorAll('.tour-target').length,0);assert.equal(ui.doc.querySelector('#app').inert,false);
});
test('tutorial can be skipped or replayed without changing site and time inputs',()=>{
  const ui=setup();ui.advance();
  const date=ui.doc.querySelector('#mission-date').value;
  ui.doc.querySelector('#graphics-continue').click();ui.doc.querySelector('#tour-skip').click();
  ui.doc.querySelector('#restart-tour').click();assert.equal(ui.doc.querySelector('#tour-counter').textContent,'1 / 3');
  ui.doc.querySelector('#tour-skip').click();assert.equal(ui.doc.querySelector('#mission-date').value,date);
  assert.equal(ui.page,'science');
});
test('graphics selection and scientific controls retain accessible labels and visual-only explanation',()=>{
  const doc=setup().doc;
  for(const id of ['mission-date','mission-time','time-scrubber','relief-exaggeration'])assert.ok(doc.querySelector('label[for="'+id+'"]'),id);
  assert.equal(doc.querySelector('input[name="startup-graphics"]:checked').value,'5');
  assert.match(doc.querySelector('.graphics-note').textContent,/calculations are unchanged/);
  assert.deepEqual([...doc.querySelector('#relief-exaggeration').options].map(o=>o.value),['2','5','10']);
});
