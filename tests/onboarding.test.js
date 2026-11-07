import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {routeFromURL} from '../src/router.js';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const doc=new JSDOM(html).window.document;

test('fresh visitors enter the explorer without timed onboarding',()=>{
  assert.equal(routeFromURL('/'),'explore');
  assert.equal(doc.querySelector('[data-view="explore"]').hidden,false);
  assert.equal(doc.querySelector('#intro-loader'),null);
  assert.doesNotMatch(html,/data-intro-loading|setTimeout/);
});
test('help has one optional action and requires no browser storage',()=>{
  assert.equal(doc.querySelectorAll('#planner-help').length,1);
  assert.equal(doc.querySelectorAll('[id*="tour"]').length,0);
  assert.doesNotMatch(html,/sessionStorage|localStorage/);
});
test('help and scientific limitations remain accessible through Methods',()=>{
  assert.ok(doc.querySelector('a.nav-link[data-route="science"]'));
  const science=doc.querySelector('#science-page').textContent;
  assert.match(science,/Select a site or click the globe/);
  assert.match(science,/resolution|resolutions/);
  assert.match(science,/unverified/);
});
test('duplicate launch and analysis buttons are removed',()=>{
  for(const id of ['analyze-btn','hero-explore','hero-find','replay-btn'])assert.equal(doc.getElementById(id),null,id);
  for(const id of ['focus-site','celestial-play','download-csv','brief-btn'])assert.ok(doc.getElementById(id),id);
});
test('scientific controls retain accessible labels',()=>{
  for(const id of ['mission-date','mission-time','time-scrubber','relief-exaggeration'])assert.ok(doc.querySelector('label[for="'+id+'"]'),id);
  assert.match(doc.querySelector('#moon-map').getAttribute('aria-label'),/select a point/);
});
