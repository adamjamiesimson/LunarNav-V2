import test from 'node:test';
import assert from 'node:assert/strict';
import {findMissionWindows,finderScore,FINDER_WEIGHTS} from '../src/finder.js';
import {sampleWindow,summarize} from '../src/astro.js';

const sites=[
  {id:'mons',name:'Mons Mouton',lat:-84.79,lon:29.2},
  {id:'malapert',name:'Malapert',lat:-85.99,lon:357.07}
];
const conf={sites,startDate:'2026-11-14',searchDays:12,windowDays:3,stepHours:4,priority:'balanced'};
test('scan returns every site/start-date window and sorted rankings',()=>{
  const result=findMissionWindows(conf);
  assert.equal(result.matrix.length,2);
  assert.equal(result.matrix[0].windows.length,12);
  assert.equal(result.ranked.length,24);
  assert.equal(result.matrix[1].windows.at(-1).startDate,'2026-11-25');
  for(let i=1;i<result.ranked.length;i++)assert.ok(result.ranked[i-1].score>=result.ranked[i].score);
  assert.equal(result.bestBySite.length,2);
});
test('finder uses the exact same samples and date interpretation as existing planner',()=>{
  const result=findMissionWindows(conf);
  for(const row of result.matrix){
    for(const window of [row.windows[0],row.windows[4],row.windows[11]]){
      const src=sampleWindow({start:new Date(window.startDate+'T12:00:00Z'),lat:row.site.lat,
        lon:row.site.lon,days:3,stepHours:4});
      const summary=summarize(src);
      assert.ok(Math.abs(window.sunPct-summary.sun)<1e-9);
      assert.ok(Math.abs(window.earthPct-summary.earth)<1e-9);
      assert.ok(Math.abs(window.dualPct-summary.dual)<1e-9);
    }
  }
});
test('balanced ranking is explicitly 70% simultaneous and 15% per individual access',()=>{
  const p={dualPct:60,sunPct:100,earthPct:80};
  assert.equal(FINDER_WEIGHTS.dual,0.7);
  assert.equal(finderScore(p,'balanced'),0.7*60+0.15*100+0.15*80);
  assert.equal(finderScore(p,'sun'),100);
  assert.equal(finderScore(p,'earth'),80);
});
test('sensible bounds and invalid UTC days are rejected',()=>{
  for(const options of [
    {startDate:'2026-02-29'},{searchDays:0},{searchDays:91},
    {windowDays:29},{stepHours:5},{priority:'fake'}
  ]) assert.throws(()=>findMissionWindows({...conf,...options}));
});
test('longest blackout and overlap never exceed full window and all percentages bounded',()=>{
  const scan=findMissionWindows({...conf,startDate:'2027-04-10',searchDays:7,windowDays:7});
  for(const w of scan.ranked){
    for(const key of ['sunPct','earthPct','dualPct']) assert.ok(w[key]>=0&&w[key]<=100);
    assert.ok(w.dualPct<=w.sunPct+1e-6&&w.dualPct<=w.earthPct+1e-6);
    for(const key of ['longestDualHours','longestDarknessHours','longestEarthBlackoutHours'])
      assert.ok(w[key]>=0&&w[key]<=168);
  }
});
test('date scan crossing New Year uses UTC, not local timezone',()=>{
  const scan=findMissionWindows({...conf,startDate:'2026-12-29',searchDays:6,windowDays:3});
  assert.equal(scan.matrix[0].windows.at(-1).startDate,'2027-01-03');
});
