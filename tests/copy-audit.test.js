import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {JSDOM} from 'jsdom';

function read(path){return readFileSync(new URL('../'+path,import.meta.url),'utf8');}

test('shipped site copy has no em dashes',()=>{
  const runtime=['index.html','README.md','api/chat.js',
    ...readdirSync(new URL('../src/',import.meta.url))
      .filter(name=>name.endsWith('.js')||name.endsWith('.css')).map(name=>'src/'+name)];
  for(const file of runtime){
    assert.equal(read(file).includes('\u2014'),false,'em dash in '+file);
  }
});
test('unnecessary captions are gone while essential data and controls remain',()=>{
  const doc=new JSDOM(read('index.html')).window.document;
  assert.equal(doc.querySelector('.graphics-note'),null);
  assert.equal(doc.querySelector('.context-bar > span'),null);
  assert.equal(doc.getElementById('best-window-dates')?.textContent,'');
  assert.equal(doc.getElementById('tour-progress').getAttribute('aria-valuemax'),'12');
  for(const id of ['site-select','mission-date','mission-sun-margin','map-image-status',
    'finder-model-badge','metrics-model','terrain-status','eng-earth','assistant-fab','panorama-open',
    'loading-progress','loading-percent']){
    assert.ok(doc.getElementById(id),'missing existing feature or scientific indicator: '+id);
  }
  const methods=doc.querySelector('[data-view="science"]').textContent;
  assert.match(methods,/Globe relief exaggeration affects the display only/);
  assert.match(methods,/line-of-sight geometry/);
  assert.match(methods,/measured errors are specific to the sample/);
});
test('natural copy omits ornamental and repeated messages',()=>{
  const html=read('index.html'),app=read('src/app.js'),onboarding=read('src/onboarding.js');
  assert.doesNotMatch(html,/Within selected mission window|Active mission/);
  assert.doesNotMatch(app,/No continuous overlap detected in sampled period|Destination follows Explore/);
  assert.doesNotMatch(onboarding,/step six hours, or jump/);
  assert.match(app,/Results ready for/);
});
