import test from 'node:test';
import assert from 'node:assert/strict';
import {polarFrameXY,deriveHorizonFromRaster} from '../src/terrain.js';
import {MOON_RADIUS_M,globalReliefUV} from '../src/relief.js';
import {fetchSldemRow,deriveSldemPatch,sldemPixelAt,globalRasterWindow} from '../src/grid-terrain.js';
const total=15360*46080*4;
const headers={'content-range':'bytes 0-7/'+total,'content-length':'8','content-type':'application/octet-stream'};
const originalFetch=globalThis.fetch;

test('SLDEM uses the PDS pixel-registered origin and wraps east longitudes',()=>{
  for(const lat of [-59,-30,0,30,59])for(const lon of [-0.1,0,45,180,359.9,405]){
    const point=polarFrameXY(lat,lon),hemisphere=lat>0?1:-1;
    const pixel=sldemPixelAt(point.x,point.y,hemisphere);
    assert.ok(Math.abs(pixel.row-Math.floor((60-lat)*128))<=1);
    assert.ok(Math.abs(pixel.col-Math.floor(((lon%360)+360)%360*128))<=1);
  }
});
test('SLDEM decodes little-endian kilometres without reinterpreting host endianness',async()=>{
  const bytes=new Uint8Array(8),view=new DataView(bytes.buffer);
  view.setFloat32(0,1.25,true);view.setFloat32(4,-2.5,true);
  globalThis.fetch=async()=>new Response(bytes,{status:206,headers});
  try{assert.deepEqual([...await fetchSldemRow(0,0,2)],[1.25,-2.5]);}
  finally{globalThis.fetch=originalFetch;}
});
test('a full multigigabyte response is cancelled before its body is read',async()=>{
  let cancelled=false,read=false;
  globalThis.fetch=async()=>({status:200,headers:new Headers(),body:{cancel:async()=>{cancelled=true;},getReader(){read=true;throw Error('must not read');}}});
  try{await assert.rejects(fetchSldemRow(0,0,2),/exact.*206/);assert.ok(cancelled);assert.equal(read,false);}
  finally{globalThis.fetch=originalFetch;}
});
test('SLDEM rejects mismatched ranges, lengths, text, compression and error statuses',async()=>{
  try{
    for(const [status,changes] of [[206,{'content-range':'bytes 4-11/'+total}],[206,{'content-length':'100'}],[206,{'content-type':'text/html'}],[206,{'content-type':'image/png'}],[206,{'content-encoding':'gzip'}],[404,{}],[416,{}]]){
      globalThis.fetch=async()=>new Response(new Uint8Array(8),{status,headers:{...headers,...changes}});
      await assert.rejects(fetchSldemRow(0,0,2),/exact.*206/);
    }
  }finally{globalThis.fetch=originalFetch;}
});
test('SLDEM rejects truncated or oversized streaming bodies even without Content-Length',async()=>{
  try{
    for(const size of [4,12]){
      globalThis.fetch=async()=>new Response(new Uint8Array(size),{status:206,headers:{'content-range':headers['content-range']}});
      await assert.rejects(fetchSldemRow(0,0,2),size===4?/Truncated/:/Oversized/);
    }
  }finally{globalThis.fetch=originalFetch;}
});
test('SLDEM propagates network failures and validates ranges before fetching',async()=>{
  let calls=0;globalThis.fetch=async()=>{calls++;throw Error('offline');};
  try{
    await assert.rejects(fetchSldemRow(-1,0,2),/Invalid/);assert.equal(calls,0);
    await assert.rejects(fetchSldemRow(0,0,2),/offline/);assert.equal(calls,1);
  }finally{globalThis.fetch=originalFetch;}
});
test('native patches reject unsupported coordinates, unsafe sizes and invalid row format',async()=>{
  for(const lat of [-90,-60,60,90,NaN])await assert.rejects(deriveSldemPatch({lat,lon:0}),/coordinates/);
  await assert.rejects(deriveSldemPatch({lat:0,lon:0},{radiusKm:Infinity}),/radius/);
  await assert.rejects(deriveSldemPatch({lat:0,lon:0},{fetchRow:async()=>new Float32Array(0)}),/float32 row/);
});
test('native patches preserve metre units, both hemispheres, and physical 20 km coverage',async()=>{
  for(const lat of [-30,0,30]){
    const site={lat,lon:45};
    const profile=await deriveSldemPatch(site,{fetchRow:async(row,c0,c1)=>Float32Array.from({length:c1-c0},()=>1.25)});
    assert.equal(profile.observerHeightM,1250);
    assert.equal(profile.patch.hemisphere,lat>0?1:-1);
    assert.ok(profile.coveragePct>99);
    assert.ok(profile.maxReliableRangeKm>19.5);
    const projectedSpacing=profile.patch.resolutionX;
    const {x,y}=polarFrameXY(lat,45);
    const scale=1+(Math.hypot(x,y)/(2*MOON_RADIUS_M))**2;
    assert.ok(Math.abs(projectedSpacing/scale-profile.resolutionM)<1e-8);
  }
});
test('SLDEM seam windows request two short column spans rather than a full row',async()=>{
  let maxSpan=0;
  await deriveSldemPatch({lat:0,lon:0},{radiusKm:2,fetchRow:async(row,c0,c1)=>{
    maxSpan=Math.max(maxSpan,c1-c0);return new Float32Array(c1-c0);
  }});
  assert.ok(maxSpan<30,'2 km patch at 0° uses short reads on either side of longitude wrap');
});
test('SLDEM missing or out-of-domain elevations never become fabricated terrain',async()=>{
  for(const value of [NaN,Infinity,1e30])await assert.rejects(deriveSldemPatch({lat:20,lon:45},{radiusKm:1,
    fetchRow:async(row,c0,c1)=>new Float32Array(c1-c0).fill(value)}),/No valid|Insufficient/);
});
test('global baked horizon uses the same longitude origin as globe displacement',()=>{
  for(const lon of [-180,0,145,180,360]){
    const window=globalRasterWindow({width:8192,height:4096},20,lon);
    const u=globalReliefUV(20,lon).u;
    assert.ok(Math.abs((window.x0+(window.w-1)/2)-u*8192)<=0.5);
  }
});
test('polar projected distances and north azimuth agree in both hemispheres',()=>{
  for(const lat of [-30,30]){
    const site={lat,lon:0},{x,y}=polarFrameXY(lat,0);
    const scale=1+(Math.hypot(x,y)/(2*MOON_RADIUS_M))**2,spacing=1000*scale;
    const width=47,half=23;
    const data=Float32Array.from({length:width*width},(_,i)=>{
      const row=Math.floor(i/width);
      return (lat>0?row-half:half-row)*100;
    });
    const profile=deriveHorizonFromRaster({data,width,height:width,originX:x-half*spacing,originY:y+half*spacing,
      resolutionX:spacing,resolutionY:-spacing},site,{radiusKm:20,azimuthBins:72,stepMeters:20000});
    assert.ok(profile.elevationDeg[0]>profile.elevationDeg[36],'terrain north of observer raises northern skyline');
    assert.ok(profile.coveragePct>99);
    assert.ok(profile.elevationDeg[0]>5&&profile.elevationDeg[0]<7,'slope reflects ground distance, not projected distance');
  }
});
