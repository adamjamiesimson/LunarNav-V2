import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {initOnboarding,LOADING_DURATION_MS,NOTICE_DURATION_MS,TOUR_STEPS} from '../src/onboarding.js';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function setup(page='science'){
  const dom=new JSDOM(html),doc=dom.window.document;
  let timer,delay,current=page,preset=null,elapsed=0,interval=null;
  const clock={
    performance:{now:()=>elapsed},
    setTimeout(fn,ms){timer=fn;delay=ms;return 1;},
    setInterval(fn,ms){interval=fn;return 2;},
    clearInterval(){interval=null;},
    scrollTo(){},clearTimeout(){timer=null;}
  };
  initOnboarding({doc,clock,getPage:()=>current,navigateView:p=>{
    current=p;for(const view of doc.querySelectorAll('[data-view]'))view.hidden=view.dataset.view!==p;
  },onGraphicsChange:p=>{preset=p;}});
  function advance(){if(!timer)throw new Error('No scheduled timeout');const callback=timer;timer=null;elapsed+=delay;callback();}
  return {doc,advance,advanceToGraphics:()=>{advance();advance();},tick:ms=>{elapsed=ms;interval?.();},
    get pendingTimer(){return timer;},
    get delay(){return delay;},get page(){return current;},get preset(){return preset;}};
}
test('every visit shows ten seconds of loading then ten seconds of notice before graphics',()=>{
  for(let i=0;i<2;i++){
    const ui=setup();
    assert.equal(LOADING_DURATION_MS,10000);assert.equal(ui.delay,10000);
    assert.equal(ui.doc.querySelector('#onboarding-dialog').dataset.stage,'loading');
    assert.equal(ui.doc.querySelector('[data-onboarding-panel="graphics"]').hidden,true);
    ui.advance();assert.equal(ui.doc.querySelector('#onboarding-dialog').dataset.stage,'notice');
    assert.equal(ui.delay,NOTICE_DURATION_MS);
    assert.equal(ui.delay,10000);
    assert.equal(ui.doc.querySelector('#onboarding-title').textContent,'Before you explore');
    assert.match(ui.doc.querySelector('#onboarding-description').textContent,/incognito tab/);
    assert.equal(ui.doc.querySelector('[data-onboarding-panel="graphics"]').hidden,true);
    ui.advance();assert.equal(ui.doc.querySelector('#onboarding-dialog').dataset.stage,'graphics');
  }
  assert.doesNotMatch(readFileSync(new URL('../src/onboarding.js',import.meta.url),'utf8'),/localStorage|sessionStorage/);
});
test('loading screen displays LunarNav artwork and updates its percent beneath the logo',()=>{
  const ui=setup(),image=ui.doc.querySelector('[data-onboarding-panel="loading"] img.loading-artwork');
  assert.ok(image,'loading artwork is missing');
  assert.equal(image.getAttribute('src'),'/assets/lunarnav-loading.webp');
  assert.equal(image.getAttribute('alt'),'1st LunarNav moonlit logo');
  assert.equal(ui.doc.querySelector('.loading-track'),null);
  assert.ok(existsSync(new URL('../assets/lunarnav-loading.webp',import.meta.url)));
  assert.ok(ui.doc.querySelector('.loading-status').parentElement.classList.contains('loading-visual'));
  assert.equal(ui.doc.querySelector('#loading-percent').textContent,'0%');
  ui.tick(5000);
  assert.equal(ui.doc.querySelector('#loading-percent').textContent,'50%');
  assert.equal(ui.doc.querySelector('#loading-progress').getAttribute('aria-valuenow'),'50');
  assert.equal(ui.doc.querySelector('#loading-fill').style.width,'50%');
  ui.tick(9900);
  assert.equal(ui.doc.querySelector('#loading-percent').textContent,'99%');
  ui.advance();
  assert.equal(ui.doc.querySelector('#loading-percent').textContent,'100%');
  assert.equal(ui.doc.querySelector('[data-onboarding-panel="loading"]').hidden,true);
  assert.equal(ui.doc.querySelector('#onboarding-dialog').dataset.stage,'notice');
  assert.equal(ui.doc.querySelector('[data-onboarding-panel="graphics"]').hidden,true);
  ui.advance();
  assert.equal(ui.doc.querySelector('[data-onboarding-panel="graphics"]').hidden,false);
});
test('notice is not dismissible via Escape before graphics selection',()=>{
  const ui=setup();
  ui.advance();
  const event=new ui.doc.defaultView.Event('cancel',{cancelable:true});
  ui.doc.getElementById('onboarding-dialog').dispatchEvent(event);
  assert.equal(event.defaultPrevented,true);
  assert.equal(ui.doc.querySelector('#onboarding-dialog').dataset.stage,'notice');
  assert.equal(ui.doc.querySelector('#app').inert,true);
  ui.advance();
  assert.equal(ui.doc.querySelector('#onboarding-dialog').dataset.stage,'graphics');
});
test('Okay skips the ten-second notice and its timer cannot advance the flow again',()=>{
  const ui=setup();
  ui.advance();
  assert.equal(ui.doc.querySelector('#onboarding-dialog').dataset.stage,'notice');
  const button=ui.doc.getElementById('notice-okay');
  assert.equal(button.textContent,'Okay');
  assert.equal(ui.doc.activeElement,button);
  assert.equal(ui.delay,NOTICE_DURATION_MS);
  const staleTimer=ui.pendingTimer;
  button.click();
  assert.equal(ui.doc.querySelector('#onboarding-dialog').dataset.stage,'graphics');
  assert.equal(ui.doc.activeElement?.getAttribute('name'),'startup-graphics');
  assert.equal(ui.pendingTimer,null,'notice timer must be cleared when Okay is clicked');
  staleTimer();
  button.click();
  assert.equal(ui.doc.querySelector('#onboarding-dialog').dataset.stage,'graphics');
  assert.equal(ui.doc.querySelector('#app').inert,true);
});
test('notice markup has an accessible button and no decorative text beyond the message',()=>{
  const doc=setup().doc;
  const panel=doc.querySelector('[data-onboarding-panel="notice"]');
  assert.ok(panel);
  assert.equal(panel.querySelectorAll('button').length,1);
  assert.equal(panel.querySelector('button').getAttribute('id'),'notice-okay');
  assert.equal(panel.querySelector('button').getAttribute('type'),'button');
});
test('all requested graphics presets apply the exact relief multiplier before the tutorial',()=>{
  for(const value of [2,5,10]){
    const ui=setup();ui.advanceToGraphics();
    ui.doc.querySelector(`input[name="startup-graphics"][value="${value}"]`).checked=true;
    ui.doc.querySelector('#graphics-continue').click();
    assert.equal(ui.preset,value);assert.equal(ui.page,'explore');
    assert.equal(ui.doc.querySelector('#onboarding-dialog').dataset.stage,'tour');
  }
});
test('tutorial supports Back, completion, cleanup and returning to the original route',()=>{
  const ui=setup();ui.advanceToGraphics();ui.doc.querySelector('#graphics-continue').click();
  assert.equal(ui.doc.querySelector('#tour-back').disabled,true);
  ui.doc.querySelector('#tour-next').click();assert.equal(ui.doc.querySelector('#tour-counter').textContent,'02 / 12');
  ui.doc.querySelector('#tour-back').click();assert.equal(ui.doc.querySelector('#tour-counter').textContent,'01 / 12');
  assert.equal(TOUR_STEPS.length,12);
  assert.equal(TOUR_STEPS[10].target,'#panorama-open');
  assert.equal(TOUR_STEPS[11].target,'#assistant-fab');
  assert.equal(TOUR_STEPS[10].page,'explore');
  assert.equal(TOUR_STEPS[11].page,'explore');
  for(let i=0;i<TOUR_STEPS.length;i++){
    const target=ui.doc.querySelector(TOUR_STEPS[i].target);
    assert.equal(ui.page,TOUR_STEPS[i].page);
    assert.equal(target.closest('[data-view]')?.hidden??false,false,'target must be on the visible page');
    assert.ok(target.classList.contains('tour-target'));
    assert.equal(ui.doc.querySelectorAll('.tour-target').length,1);
    assert.equal(ui.doc.querySelector('#tour-progress').getAttribute('aria-valuenow'),String(i+1));
    assert.equal(ui.doc.querySelectorAll('#tour-progress .complete').length,i+1);
    ui.doc.querySelector('#tour-next').click();
  }
  assert.equal(ui.page,'science');assert.equal(ui.doc.querySelector('#onboarding-dialog').hasAttribute('open'),false);
  assert.equal(ui.doc.querySelectorAll('.tour-target').length,0);assert.equal(ui.doc.querySelector('#app').inert,false);
});
test('tutorial can be skipped or replayed without changing site and time inputs',()=>{
  const ui=setup();ui.advanceToGraphics();
  const date=ui.doc.querySelector('#mission-date').value;
  ui.doc.querySelector('#graphics-continue').click();ui.doc.querySelector('#tour-skip').click();
  ui.doc.querySelector('#restart-tour').click();assert.equal(ui.doc.querySelector('#tour-counter').textContent,'01 / 12');
  ui.doc.querySelector('#tour-skip').click();assert.equal(ui.doc.querySelector('#mission-date').value,date);
  assert.equal(ui.page,'science');
});

test('cross-page Back, skip and Escape restore the entry page and mission inputs',()=>{
  const ui=setup('planning');ui.advanceToGraphics();
  const values=[...ui.doc.querySelectorAll('#app input,#app select')].map(el=>el.value);
  ui.doc.querySelector('#graphics-continue').click();
  for(let i=0;i<8;i++)ui.doc.querySelector('#tour-next').click();
  assert.equal(ui.page,'engineering');
  ui.doc.querySelector('#tour-back').click();assert.equal(ui.page,'planning');
  ui.doc.querySelector('#tour-skip').click();assert.equal(ui.page,'planning');
  ui.doc.querySelector('#restart-tour').click();
  ui.doc.querySelector('#onboarding-dialog').dispatchEvent(new ui.doc.defaultView.Event('cancel',{cancelable:true}));
  assert.equal(ui.page,'planning');
  assert.equal(ui.doc.querySelectorAll('.tour-target').length,0);
  assert.deepEqual([...ui.doc.querySelectorAll('#app input,#app select')].map(el=>el.value),values);
});

test('spotlight mask and navigation provide an accessible twelve-feature tour',()=>{
  const ui=setup();ui.advanceToGraphics();ui.doc.querySelector('#graphics-continue').click();
  assert.ok(ui.doc.querySelector('#tour-mask #tour-cutout'));
  assert.equal(ui.doc.querySelector('.tour-spotlight').getAttribute('aria-hidden'),'true');
  assert.equal(ui.doc.querySelector('#tour-progress').getAttribute('aria-valuemax'),'12');
  assert.equal(ui.doc.querySelector('#onboarding-title').getAttribute('aria-live'),'polite');
  assert.equal(ui.doc.activeElement,ui.doc.querySelector('#tour-next'));
  assert.equal(ui.doc.querySelector('#onboarding-title').textContent,TOUR_STEPS[0].title);
});
test('graphics selection and scientific controls retain accessible labels and visual-only explanation',()=>{
  const doc=setup().doc;
  for(const id of ['mission-date','mission-time','time-scrubber','relief-exaggeration'])assert.ok(doc.querySelector('label[for="'+id+'"]'),id);
  assert.equal(doc.querySelector('input[name="startup-graphics"]:checked').value,'5');
  assert.equal(doc.querySelector('.graphics-note'),null);
  assert.match(doc.querySelector('#relief-exaggeration').getAttribute('aria-label'),/visual relief exaggeration only/);
  assert.deepEqual([...doc.querySelector('#relief-exaggeration').options].map(o=>o.value),['2','5','10']);
  const options=[...doc.querySelectorAll('.graphics-options label')];
  assert.deepEqual(options.map(o=>o.querySelector('span').firstChild.textContent.trim()),['Low graphics','Medium graphics','High graphics']);
  assert.deepEqual(options.map(o=>o.querySelector('.graphics-profile-hint').textContent),
    ['(better performance)','(balanced)','(better visuals)']);
  assert.deepEqual(options.map(o=>o.querySelector(':scope > small').textContent),['Relief ×2','Relief ×5','Relief ×10']);
});
