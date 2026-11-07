import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {polarXY,deriveHorizonFromRaster} from '../src/terrain.js';
import {gridRasterWindow,globalRasterWindow} from '../src/grid-terrain.js';
import {SITES} from '../src/sites.js';

const meta=JSON.parse(readFileSync(new URL('../data/relief.json',import.meta.url),'utf8'));

// Decode a window of a baked 12-bit relief PNG (the same format the browser
// path reads through canvas) using only Node built-ins.
function pngWindow(file,x0,y0,w,h){
  const png=readFileSync(new URL('../assets/'+file,import.meta.url));
  let off=8;const idat=[];
  while(off<png.length){
    const len=png.readUInt32BE(off),t=png.toString('ascii',off+4,off+8);
    if(t==='IDAT')idat.push(png.subarray(off+8,off+8+len));
    off+=12+len;
  }
  const W=png.readUInt32BE(16);
  const raw=inflateSync(Buffer.concat(idat));
  const stride=W*3+1,out=Buffer.alloc(W*3*png.readUInt32BE(20));
  for(let y=0;y<png.readUInt32BE(20);y++){
    const f=raw[y*stride];
    for(let x=0;x<stride-1;x++){
      const left=x>=3?out[y*W*3+x-3]:0;
      out[y*W*3+x]=(raw[y*stride+1+x]+(f===1?left:0))&255;
    }
  }
  const data=new Float32Array(w*h).fill(NaN);
  const range=meta.heightMaxM-meta.heightMinM;
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){
    const gx=x0+i,gy=y0+j;
    if(gx<0||gy<0||gx>=W||gy>=W)continue;
    const p=(gy*W+gx)*3;
    const code=16*out[p]+out[p+1]/16;
    if(code>0)data[j*w+i]=meta.heightMinM+code/4095*range;
  }
  return data;
}

test('grid windows are georeferenced consistently with polarXY in both hemispheres',()=>{
  const south=gridRasterWindow({size:meta.size,domainKm:meta.domainKm,north:false},{lat:-84.79,lon:29.2});
  assert.ok(south.w>40&&south.w<120,'window covers the 20 km horizon radius');
  assert.ok(Math.abs(south.resolutionX-480)<1,'matches the baked 480 m grid');
  // The site must land inside its own window, at the right pixel.
  const {x,y}=polarXY(-84.79,29.2);
  const px=(x+931200)/(2*931200)*meta.size;
  const py=(931200-y)/(2*931200)*meta.size;
  assert.ok(Math.abs((px-south.x0)-south.w/2)<2,'site horizontally centred in the window');
  assert.ok(Math.abs((py-south.y0)-south.w/2)<2,'site vertically centred in the window');
  const north=gridRasterWindow({size:meta.north.size,domainKm:meta.domainKm,north:true},{lat:84.79,lon:29.2});
  const {x:nx,y:ny}=polarXY(84.79,29.2);
  const npy=(ny+931200)/(2*931200)*meta.north.size;
  assert.ok(Math.abs((npy-north.y0)-north.w/2)<2,'north grid uses the mirrored row mapping');
  assert.ok(north.resolutionY>0,'north rows run -y to +y');
  assert.throws(()=>gridRasterWindow({size:meta.size,domainKm:meta.domainKm,north:false},{lat:-30,lon:0}),/cover/);
});

test('grid-derived horizon matches the archived native-resolution profile',()=>{
  // Mons Mouton: derive from the baked grid exactly like the browser path and
  // compare with the CI-exported 80 m profile shipped in data/lola-horizons.json.
  const catalog=JSON.parse(readFileSync(new URL('../data/lola-horizons.json',import.meta.url),'utf8'));
  const archived=catalog.profiles['mons-mouton'];
  assert.ok(archived,'bundled reference profile exists');
  const site=SITES.find(s=>s.id==='mons-mouton');
  const win=gridRasterWindow({size:meta.size,domainKm:meta.domainKm,north:false},site);
  const data=pngWindow('moon-relief.png',win.x0,win.y0,win.w,win.w);
  const profile=deriveHorizonFromRaster({data,width:win.w,height:win.w,
    originX:win.originX,originY:win.originY,resolutionX:win.resolutionX,resolutionY:win.resolutionY,noData:null},
    site,{radiusKm:20,azimuthBins:360});
  assert.equal(profile.azimuthBins,360);
  assert.ok(profile.coveragePct>95);
  let sum=0,max=0,n=0;
  for(let i=0;i<archived.azimuthDeg.length;i++){
    const az=archived.azimuthDeg[i];
    const j=Math.round(az); // 1-degree bins
    const d=Math.abs(profile.elevationDeg[j%360]-archived.elevationDeg[i]);
    sum+=d;max=Math.max(max,d);n++;
  }
  assert.ok(sum/n<1.0,`mean horizon difference ${(sum/n).toFixed(2)} deg should be small`);
  assert.ok(max<4,`max horizon difference ${max.toFixed(2)} deg should stay bounded`);
});

test('mid-latitude waypoints derive a labelled coarse horizon from the global grid',()=>{
  const g=meta.global;
  const win=globalRasterWindow({width:g.width,height:g.height},20,145,{radiusKm:20});
  // Site must land at the window's local origin (pixel halfX/halfY).
  const px=((145%360+360)%360/360)*g.width,py=((90-20)/180)*g.height;
  assert.ok(Math.abs((px-win.x0)-(win.w-1)/2)<2,'site horizontally centred');
  assert.ok(Math.abs((py-win.y0)-(win.h-1)/2)<2,'site vertically centred');
  assert.ok(win.lonGsd>3000&&win.latGsd>3000,'global grid is honestly coarse (~5 km)');
  // Decode the real global PNG window and derive like the browser path does.
  const data=pngWindow('moon-relief-global.png',win.x0,win.y0,win.w,win.h);
  const profile=deriveHorizonFromRaster({data,width:win.w,height:win.h,
    originX:win.originX,originY:win.originY,resolutionX:win.resolutionX,resolutionY:win.resolutionY,noData:null},
    {lat:20,lon:145},{radiusKm:20,azimuthBins:360,centerXY:{x:0,y:0}});
  assert.ok(profile.coveragePct>90,'window is inside the global grid');
  assert.equal(profile.lat,20,'site coordinates preserved');
  assert.ok(profile.elevationDeg.some(v=>v>0),'regional slopes produce a real skyline');
  assert.ok(profile.elevationDeg.every(v=>Number.isFinite(v)));
});

test('profiles report their grid provenance for honest labelling',()=>{
  assert.ok(meta.north&&meta.north.source.includes('LDEM_60N'));
  assert.ok(meta.source.includes('LDEM_60S'));
  assert.equal(meta.global.coverageLat[1],90);
});
