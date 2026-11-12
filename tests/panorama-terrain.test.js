import test from 'node:test';
import assert from 'node:assert/strict';
import {polarFrameXY} from '../src/terrain.js';

const polarSize=64,domainKm=1862.4;
const polarBlock={size:polarSize,domainKm,horizontalGroundSampleM:domainKm*1000/polarSize,heightMinM:0,heightMaxM:4095};
const metadata={...polarBlock,north:polarBlock,global:{width:360,height:180,heightMinM:0,heightMaxM:4095}};

async function setup(t,{missing=false,invalid=false,metadataAvailable=true}={}){
  const draws=[],requests=[];
  const images={
    '/assets/moon-relief.png':{width:polarSize,height:polarSize,heightCode:(x,y)=>1000+x+2*y},
    '/assets/moon-relief-north.png':{width:polarSize,height:polarSize,heightCode:(x,y)=>500+x+2*y},
    '/assets/moon-relief-global.png':{width:360,height:180,heightCode:x=>100+x}
  };
  class FixtureImage {
    set src(path){
      requests.push(path);
      queueMicrotask(()=>{
        if(missing){this.onerror();return;}
        Object.assign(this,images[path]);
        this.onload();
      });
    }
  }
  const document={createElement(tag){
    assert.equal(tag,'canvas');
    const canvas={width:0,height:0,getContext(type){
      assert.equal(type,'2d');
      assert.ok(canvas.width<=16&&canvas.height<=16,'allocates only the requested elevation window');
      const bytes=new Uint8ClampedArray(canvas.width*canvas.height*4);
      return {
        drawImage(img,sx,sy,sw,sh,dx,dy){
          draws.push({sx,sy,sw,sh,dx,dy});
          for(let row=0;row<sh;row++)for(let col=0;col<sw;col++){
            const offset=((dy+row)*canvas.width+dx+col)*4;
            const code=invalid?0:img.heightCode(sx+col,sy+row);
            bytes[offset]=code>>4;
            bytes[offset+1]=(code&15)<<4;
            bytes[offset+3]=255;
          }
        },
        getImageData(){return {data:bytes};}
      };
    }};
    return canvas;
  }};
  const previous={Image:globalThis.Image,document:globalThis.document};
  Object.assign(globalThis,{Image:FixtureImage,document});
  t.after(()=>{
    for(const [name,value] of Object.entries(previous)){
      if(value===undefined)delete globalThis[name];
      else globalThis[name]=value;
    }
  });
  t.mock.method(globalThis,'fetch',async url=>{
    assert.equal(url,'data/relief.json');
    return {ok:metadataAvailable,json:async()=>metadata};
  });
  // Each test gets fresh production metadata and image caches.
  const {loadSiteHeights}=await import('../src/grid-terrain.js?fixture='+encodeURIComponent(t.name));
  return {loadSiteHeights,draws,requests};
}

test('panorama samples the south polar grid in metres',async t=>{
  const {loadSiteHeights,requests}=await setup(t);
  const heights=await loadSiteHeights({lat:-90,lon:0});
  assert.deepEqual(requests,['/assets/moon-relief.png']);
  assert.equal(heights.resolutionM,polarBlock.horizontalGroundSampleM);
  assert.equal(heights.heightAt(-90,0),1096);
  assert.ok(heights.heightAt(-89,0)<1096,'the south grid rows run toward decreasing y');
  assert.equal(heights.heightAt(-75,0),null,'samples outside the window are absent');
});

test('panorama samples the north polar grid with the mirrored row direction',async t=>{
  const {loadSiteHeights,requests}=await setup(t);
  const heights=await loadSiteHeights({lat:90,lon:0});
  assert.deepEqual(requests,['/assets/moon-relief-north.png']);
  assert.equal(heights.resolutionM,polarBlock.horizontalGroundSampleM);
  assert.equal(heights.heightAt(90,0),596);
  assert.ok(heights.heightAt(89,0)>596,'the north grid rows run toward increasing y');
});

test('panorama samples global elevations and equivalent 0°/360° longitudes',async t=>{
  const {loadSiteHeights,requests}=await setup(t);
  const heights=await loadSiteHeights({lat:20,lon:0});
  assert.deepEqual(requests,['/assets/moon-relief-global.png']);
  assert.ok(Math.abs(heights.heightAt(20,0)-280)<1e-8);
  assert.ok(Math.abs(heights.heightAt(20,359.5)-279.5)<1e-8);
  assert.equal(heights.heightAt(20,359.5),heights.heightAt(20,-0.5));
});

test('panorama reads across the global image seam and interpolates between edge pixels',async t=>{
  const {loadSiteHeights,draws}=await setup(t);
  const heights=await loadSiteHeights({lat:0,lon:179.75});
  assert.equal(draws.length,2,'the wrapped window is read in two strips');
  assert.ok(draws[0].sx+draws[0].sw===360&&draws[1].sx===0);
  assert.ok(Math.abs(heights.heightAt(0,179.5)-279.5)<1e-8);
  assert.ok(Math.abs(heights.heightAt(0,-179.5)-100.5)<1e-8);
});

test('panorama interpolates a native patch and falls back to the bundled grid at its edges and gaps',async t=>{
  const {loadSiteHeights}=await setup(t);
  const site={lat:-88,lon:30};
  const {x,y}=polarFrameXY(site.lat,site.lon);
  const patch={data:Float32Array.of(100,200,300,400),width:2,height:2,
    originX:x-500,originY:y+500,resolutionX:1000,resolutionY:-1000};
  const base=await loadSiteHeights(site);
  const heights=await loadSiteHeights(site,{patch});
  assert.equal(heights.usedPatch,true);
  assert.equal(heights.heightAt(site.lat,site.lon),250);
  assert.equal(heights.heightAt(-88.1,site.lon),base.heightAt(-88.1,site.lon));
  patch.data[0]=NaN;
  assert.equal(heights.heightAt(site.lat,site.lon),base.heightAt(site.lat,site.lon));
});

test('panorama reports missing terrain images',async t=>{
  const {loadSiteHeights}=await setup(t,{missing:true});
  await assert.rejects(loadSiteHeights({lat:-85,lon:0}),/relief grid unavailable/);
});

test('panorama rejects a terrain window containing only NoData',async t=>{
  const {loadSiteHeights}=await setup(t,{invalid:true});
  await assert.rejects(loadSiteHeights({lat:10,lon:0}),/No elevation data near this site/);
});

test('panorama reports unavailable metadata and rejects invalid coordinates',async t=>{
  const {loadSiteHeights,requests}=await setup(t,{metadataAvailable:false});
  await assert.rejects(loadSiteHeights({lat:91,lon:0}),/Invalid panorama coordinates/);
  await assert.rejects(loadSiteHeights({lat:10,lon:0}),/relief metadata unavailable/);
  assert.deepEqual(requests,[]);
});
