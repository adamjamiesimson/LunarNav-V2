import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {polarXY,productFor,LOLA_PRODUCTS,LOLA_COG_60S} from '../src/terrain.js';

const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');

test('terrain coverage extends to 60°S for custom waypoints',()=>{
  assert.equal(productFor(-84.79),'80s','polar sites use the lighter 80°S product');
  assert.equal(productFor(-70),'60s','mid-latitude waypoints use the 60°S product');
  assert.throws(()=>productFor(-30),/60°S to 90°S/);
  assert.throws(()=>productFor(NaN));
  const p=polarXY(-70,12);
  assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));
  assert.throws(()=>polarXY(-50,12),/60°S/);
});

test('both NASA products are registered with proxy and source URLs',()=>{
  for(const key of ['80s','60s']){
    const product=LOLA_PRODUCTS[key];
    assert.ok(product.cog.startsWith('https://pgda.gsfc.nasa.gov/'),key+' source is NASA');
    assert.ok(product.proxy.startsWith('/assets/'),key+' has a same-origin proxy');
    assert.ok(product.minLat<product.maxLat);
  }
  assert.match(LOLA_COG_60S,/LDEM_60S_60MPP_ADJ\.TIF/);
});

test('custom waypoints automatically load real terrain, never silently faked',()=>{
  assert.match(app,/deriveGridHorizon/,'custom waypoint selection derives terrain instantly from the baked grid');
  assert.match(app,/terrainAttempted/,'failed loads are remembered, not looped');
  assert.match(app,/No terrain grid covers this location/,'out-of-coverage points get an explicit message');
});

test('baked relief texture matches its NASA metadata',()=>{
  const meta=JSON.parse(readFileSync(new URL('../data/relief.json',import.meta.url),'utf8'));
  assert.match(meta.source,/NASA GSFC PGDA LOLA/);
  assert.match(meta.sourceUrl,/LDEM_60S_60MPP_ADJ\.TIF/);
  assert.equal(meta.projection.includes('south-polar stereographic'),true);
  assert.ok(meta.size>=1024,'relief grid is at least 1024²');
  assert.ok(meta.domainKm>1000&&meta.domainKm<2500,'stereographic domain matches the 60°S cut');
  assert.ok(meta.heightMinM<-1000&&meta.heightMaxM>1000,'height range matches real lunar topography');
  assert.ok(meta.heightMaxM-meta.heightMinM>10000,'full relief range preserved');
  assert.equal(typeof meta.horizontalGroundSampleM,'number','horizontal GSD is reported separately');
  assert.ok(Math.abs(meta.horizontalGroundSampleM-480)<2,'3880 px across the 1862 km domain is ~480 m/px');
  assert.ok(meta.verticalQuantisationM<=5,'vertical quantisation is metres-level, not an 8-bit ramp');
  assert.ok(!('metresPerPixel' in meta),'the ambiguous metresPerPixel misnomer is gone');
  assert.deepEqual(meta.global.coverageLat,[-90,90],'global grid covers the full sphere once the polar grids are folded in');
  assert.match(meta.global.coverageNote,/LDEM_60N/);
  assert.ok(meta.global.verticalQuantisationM<=5);
  // The north polar grid mirrors the south treatment (LDEM_60N, same datum).
  assert.match(meta.north.source,/LDEM_60N/);
  assert.match(meta.north.validation,/RMS 17 m/);
  assert.ok(Math.abs(meta.north.horizontalGroundSampleM-480)<2,'north grid matches the south polar GSD');
  assert.ok(meta.north.heightMinM<-5000&&meta.north.heightMaxM>5000);
  const northPng=readFileSync(new URL('../assets/moon-relief-north.png',import.meta.url));
  assert.deepEqual([...northPng.subarray(0,8)],[137,80,78,71,13,10,26,10],'valid north PNG signature');
  assert.equal(northPng.readUInt32BE(16),meta.north.size,'north PNG width matches metadata');
  const png=readFileSync(new URL('../assets/moon-relief.png',import.meta.url));
  assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10],'valid PNG signature');
  assert.equal(png.readUInt32BE(16),meta.size,'PNG width matches metadata');
  assert.equal(png.readUInt32BE(20),meta.size,'PNG height matches metadata');
});
