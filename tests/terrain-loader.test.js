import test from 'node:test';
import assert from 'node:assert/strict';
import {loadLolaTerrain,polarXY} from '../src/terrain.js';
const site={id:'mons-mouton',name:'Mons Mouton',lat:-84.79,lon:29.2};
const saved=globalThis.GeoTIFF;
function mockImage(pixelSize=80){
 const extent=400000,origin=[-200000,200000],count=Math.round(extent/pixelSize);
 return {
  getBoundingBox:()=>[-200000,-200000,200000,200000],
  getOrigin:()=>origin,
  getResolution:()=>[pixelSize,-pixelSize],
  getWidth:()=>count,getHeight:()=>count,
  getGDALNoData:()=>null,
  async readRasters({window}){
    const width=window[2]-window[0],height=window[3]-window[1];
    const arr=[new Float32Array(width*height)];
    arr.width=width;arr.height=height;
    return arr;
  }
 };
}
test('local GeoTIFF path computes horizons but NEVER claims NASA provenance is verified',async()=>{
  globalThis.GeoTIFF={fromUrl:async()=>{throw Error('should not be called');},
    fromBlob:async()=>({getImage:async()=>mockImage()})};
  try{
    const profile=await loadLolaTerrain(site,{file:{name:'unverified.tif'}});
    assert.equal(profile.lat,site.lat);
    assert.equal(profile.lon,site.lon);
    assert.equal(profile.verifiedSource,false);
    assert.match(profile.provenance,/NOT independently verified/);
    assert.equal(profile.azimuthDeg.length,72);
    assert.ok(profile.coveragePct>99);
  }finally{globalThis.GeoTIFF=saved;}
});
test('incompatible raster pixel size is rejected, never silently presented as LOLA',async()=>{
  globalThis.GeoTIFF={fromUrl:async()=>{throw Error('should not be called');},
    fromBlob:async()=>({getImage:async()=>mockImage(250)})};
  try{
    await assert.rejects(()=>loadLolaTerrain(site,{file:{name:'wrong.tif'}}),/Expected NASA 80 m\/pixel/);
  }finally{globalThis.GeoTIFF=saved;}
});
test('polar stereographic latitude is bounded and finite',()=>{
 assert.ok(polarXY(site.lat,site.lon).x>0);
 assert.throws(()=>polarXY(-70,0),/covers/);
});
