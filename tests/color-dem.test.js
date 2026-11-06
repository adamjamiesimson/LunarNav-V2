import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeColorElevation} from '../src/color-dem.js';

const georef={projection:'equirectangular',extent:[-180,180,-60,60]};
const pixel=(r,g,b)=>({data:new Uint8Array([r,g,b,255]),width:1,height:1});

test('a documented continuous colour ramp decodes to the legend elevations',()=>{
  const stops=[{color:'#000000',heightM:-1000},{color:'#ffffff',heightM:1000}];
  const out=decodeColorElevation(pixel(128,128,128),{stops,georef});
  assert.ok(Math.abs(out.heights[0])<10,'mid-grey decodes near 0 m');
  assert.equal(out.minM,out.maxM);
  assert.equal(out.coveragePct,100);
  const low=decodeColorElevation(pixel(10,10,10),{stops,georef});
  assert.ok(low.heights[0]<-900,'near-black decodes near the legend minimum');
});

test('pixels outside the legend are masked, never converted to arbitrary heights',()=>{
  const stops=[{color:'#000000',heightM:-1000},{color:'#ffffff',heightM:1000}];
  const mixed={data:new Uint8Array([128,128,128,255,255,0,0,255]),width:2,height:1};
  const out=decodeColorElevation(mixed,{stops,georef,tolerance:20});
  assert.ok(Number.isNaN(out.heights[1]),'off-ramp colour becomes NoData');
  assert.ok(Number.isFinite(out.heights[0]),'legend colour still decodes');
  assert.equal(out.coveragePct,50);
  assert.throws(()=>decodeColorElevation(pixel(255,0,0),{stops,georef,tolerance:20}),/No pixels match/);
});

test('discrete legend bands decode to their documented band heights',()=>{
  const stops=[{color:'#102030',heightM:-500},{color:'#304050',heightM:0},{color:'#506070',heightM:500}];
  const out=decodeColorElevation(pixel(0x30,0x40,0x50),{stops,georef,tolerance:8});
  assert.equal(out.heights[0],0);
});

test('unreliable inputs are rejected as quantitative sources',()=>{
  const stops=[{color:'#000000',heightM:-1000},{color:'#ffffff',heightM:1000}];
  assert.throws(()=>decodeColorElevation(pixel(0,0,0),{georef}),/legend/i,'missing legend rejected');
  assert.throws(()=>decodeColorElevation(pixel(0,0,0),{stops:[stops[0]],georef}),/at least two/);
  assert.throws(()=>decodeColorElevation(pixel(0,0,0),{stops}),/georef/,'missing geographic reference rejected');
  assert.throws(()=>decodeColorElevation(pixel(0,0,0),
    {stops:[{color:'#000',heightM:5},{color:'#fff',heightM:1}],georef}),/increasing|colour/);
  assert.throws(()=>decodeColorElevation({data:new Uint8Array([255,0,0,255]),width:1,height:1},
    {stops,georef,tolerance:5}),/No pixels match/,'colours that are not the calibrated ramp are rejected');
});
