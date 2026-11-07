/**
 * Instant terrain horizons from the baked NASA relief grids
 * (assets/moon-relief*.png — the same LOLA-derived surfaces used to displace
 * the 3D globe; provenance in data/relief.json).
 *
 * Deriving the horizon here gives every custom waypoint a real local sky view
 * immediately and offline: the polar grids (60°–90° in either hemisphere) at
 * 480 m, and the global grid for lower latitudes at its honest ~5 km
 * resolution. The horizon maths is shared: deriveHorizonFromRaster is the
 * same function used for the preset sites and the native DEM loader.
 */
import {polarXY,polarFrameXY,deriveHorizonFromRaster} from './terrain.js';
import {MOON_RADIUS_M} from './relief.js';

const GRIDS={
  south:{file:'/assets/moon-relief.png',key:null,north:false},
  north:{file:'/assets/moon-relief-north.png',key:'north',north:true},
  global:{file:'/assets/moon-relief-global.png',key:'global'}
};
const DOMAIN_M=931200;

let metaPromise=null,imageCache=new Map();
function loadMeta(){
  if(!metaPromise)metaPromise=fetch('data/relief.json').then(r=>{
    if(!r.ok)throw Error('relief metadata unavailable');
    return r.json();
  });
  return metaPromise;
}
function loadImage(file){
  if(!imageCache.has(file)){
    imageCache.set(file,new Promise((resolve,reject)=>{
      const img=new Image();
      img.onload=()=>resolve(img);
      img.onerror=()=>reject(Error('relief grid unavailable: '+file));
      img.src=file;
    }));
  }
  return imageCache.get(file);
}
async function gridContext(file){
  const img=await loadImage(file);
  const canvas=document.createElement('canvas');
  canvas.width=img.width;canvas.height=img.height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(img,0,0);
  return {img,ctx};
}

/** Polar-stereographic window (shared with the tests). */
export function gridRasterWindow({size,domainKm,north},site,{radiusKm=20}={}){
  const gsd=domainKm*1000/size;
  const {x,y}=polarXY(site.lat,site.lon);
  const px=(x+DOMAIN_M)/(2*DOMAIN_M)*size;
  const py=(north?(y+DOMAIN_M)/(2*DOMAIN_M):(DOMAIN_M-y)/(2*DOMAIN_M))*size;
  const half=Math.ceil(radiusKm*1000/gsd)+2;
  const x0=Math.round(px)-half,y0=Math.round(py)-half,w=2*half+1;
  return {x0,y0,w,gsd,
    originX:-DOMAIN_M+x0*gsd,
    originY:north?-DOMAIN_M+y0*gsd:DOMAIN_M-y0*gsd,
    resolutionX:gsd,resolutionY:north?gsd:-gsd};
}

/** Equirectangular window in a local east/north metre frame around the site. */
export function globalRasterWindow({width,height},lat,lon,{radiusKm=20}={}){
  const latGsd=Math.PI*MOON_RADIUS_M/height;
  const lonGsd=2*Math.PI*MOON_RADIUS_M*Math.max(0.05,Math.cos(lat*Math.PI/180))/width;
  const halfX=Math.ceil(radiusKm*1000/lonGsd)+2,halfY=Math.ceil(radiusKm*1000/latGsd)+2;
  const px=(((lon%360)+360)%360/360)*width,py=((90-lat)/180)*height;
  const x0=Math.round(px)-halfX,y0=Math.round(py)-halfY;
  return {x0,y0,w:2*halfX+1,h:2*halfY+1,lonGsd,latGsd,
    originX:-halfX*lonGsd,originY:halfY*latGsd,resolutionX:lonGsd,resolutionY:-latGsd};
}

/** Extract a metre-valued raster window; grid edges stay NaN (NoData). */
function readRasterWindow(ctx,x0,y0,w,h,block){
  const sx=Math.max(0,x0),sy=Math.max(0,y0);
  const sw=Math.min(ctx.canvas.width-sx,w),sh=Math.min(ctx.canvas.height-sy,h);
  if(sw<4||sh<4)throw Error('site lies outside the baked relief grid');
  const pixels=ctx.getImageData(sx,sy,sw,sh).data;
  const data=new Float32Array(w*h).fill(NaN);
  const range=block.heightMaxM-block.heightMinM;
  for(let j=0;j<sh;j++)for(let i=0;i<sw;i++){
    const p=(j*sw+i)*4;
    const code=pixels[p]*16+pixels[p+1]/16; // 12-bit height packed into R/G
    if(code>0)data[(j+sy-y0)*w+(i+sx-x0)]=block.heightMinM+code/4095*range;
  }
  return data;
}

function finishProfile(profile,site,source,resolutionM){
  profile.lat=site.lat;profile.lon=site.lon;
  profile.source=source;
  profile.provenance='Derived from the bundled NASA relief grids (data/relief.json)';
  profile.loadedFrom='Baked relief grid';
  profile.verifiedSource=true;
  profile.gridDerived=true;
  profile.resolutionM=resolutionM;
  return profile;
}

async function deriveFromPolar(site,meta,{azimuthBins,radiusKm}){
  const cfg=site.lat>0?GRIDS.north:GRIDS.south;
  const block=cfg.key?meta[cfg.key]:meta;
  if(!block)throw Error('no baked polar grid metadata');
  const {ctx}=await gridContext(cfg.file);
  const win=gridRasterWindow({size:block.size,domainKm:block.domainKm,north:cfg.north},site,{radiusKm});
  const data=readRasterWindow(ctx,win.x0,win.y0,win.w,win.w,block);
  const profile=deriveHorizonFromRaster({data,width:win.w,height:win.w,
    originX:win.originX,originY:win.originY,resolutionX:win.resolutionX,resolutionY:win.resolutionY,noData:null},
    site,{radiusKm,azimuthBins});
  return finishProfile(profile,site,
    `NASA LOLA DEM baked grid (${block.horizontalGroundSampleM} m, ${cfg.north?'north':'south'} polar)`,
    block.horizontalGroundSampleM);
}

async function deriveFromGlobal(site,meta,{azimuthBins,radiusKm}){
  const block=meta.global;
  if(!block)throw Error('no baked global grid metadata');
  const {ctx}=await gridContext(GRIDS.global.file);
  const win=globalRasterWindow({width:block.width,height:block.height},site.lat,site.lon,{radiusKm});
  const data=readRasterWindow(ctx,win.x0,win.y0,win.w,win.h,block);
  const resolutionM=Math.max(win.latGsd,win.lonGsd);
  const profile=deriveHorizonFromRaster({data,width:win.w,height:win.h,
    originX:win.originX,originY:win.originY,resolutionX:win.resolutionX,resolutionY:win.resolutionY,noData:null},
    site,{radiusKm,azimuthBins,centerXY:{x:0,y:0},frameLon:0});
  return finishProfile(profile,site,
    `NASA LOLA/Kaguya DEM baked global grid (~${(resolutionM/1000).toFixed(1)} km) — coarse regional horizon`,
    resolutionM);
}

/**
 * Derive a local horizon profile for any coordinate: high-resolution polar
 * grids near the caps, the global grid elsewhere. Throws only when no grid
 * covers the location or the sampled window lacks valid elevation pixels.
 */
export async function deriveGridHorizon(site,{azimuthBins=360,radiusKm=20}={}){
  const meta=await loadMeta();
  const opts={azimuthBins,radiusKm};
  if(Math.abs(site.lat)>=60){
    try{return await deriveFromPolar(site,meta,opts);}
    catch(error){
      // Sites at the cap edge can fall outside the polar window: use the
      // global grid instead of failing to flat horizon.
      try{return await deriveFromGlobal(site,meta,opts);}catch{throw error;}
    }
  }
  return deriveFromGlobal(site,meta,opts);
}

/* ---- native-resolution (~237 m) patches for mid-latitudes ----
 * SLDEM2015 stores its 128 px/deg grid as raw float rows; a 40 km window needs
 * only ~1 KB from each of ~170 rows, so byte-range reads fetch it in a second
 * or two. The window is sampled into the polar-stereographic frame used
 * everywhere else, so the result also feeds the globe's local patch texture.
 */
const SLDEM_IMG='/assets/sldem.img';
const SLDEM_COLS=46080,SLDEM_ROWS=15360,SLDEM_ROW_BYTES=SLDEM_COLS*4;
const SLDEM_PIXEL_M=10916510/360/128; // 237 m (the Moon is 30.3 km per degree)

async function mapConcurrent(items,fn,workers=8){
  let next=0;
  const run=async()=>{while(next<items.length){const i=next++;await fn(items[i],i);}};
  await Promise.all(Array.from({length:Math.min(workers,items.length)},run));
}

const defaultFetchRow=(row,c0,c1)=>{
  const start=row*SLDEM_ROW_BYTES+c0*4,end=row*SLDEM_ROW_BYTES+c1*4-1;
  const attempt=async n=>{
    try{
      const r=await fetch(SLDEM_IMG,{headers:{Range:`bytes=${start}-${end}`}});
      if(!r.ok)throw Error('SLDEM range read failed: '+r.status);
      return new Float32Array(await r.arrayBuffer());
    }catch(error){
      if(n>=3)throw error;
      await new Promise(res=>setTimeout(res,500*n));
      return attempt(n+1);
    }
  };
  return attempt(0);
};

export async function deriveSldemPatch(site,{azimuthBins=360,radiusKm=20,fetchRow=defaultFetchRow}={}){
  const half=Math.ceil(radiusKm*1000/SLDEM_PIXEL_M)+2;
  const w=2*half+1;
  const {x,y}=polarFrameXY(site.lat,site.lon);
  const originX=x-half*SLDEM_PIXEL_M,originY=y+half*SLDEM_PIXEL_M;
  const data=new Float32Array(w*w).fill(NaN);
  const rowsNeeded=new Map();
  for(let j=0;j<w;j++)for(let i=0;i<w;i++){
    const px=originX+i*SLDEM_PIXEL_M,py=originY-j*SLDEM_PIXEL_M;
    const r=Math.hypot(px,py);
    const lat=Math.sign(site.lat||-1)*(90-2*Math.atan(r/(2*MOON_RADIUS_M))*180/Math.PI);
    const lon=Math.atan2(px,py)*180/Math.PI;
    const row=Math.round((60-lat)/120*(SLDEM_ROWS-1));
    if(row<0||row>=SLDEM_ROWS)continue;
    const col=Math.round(((lon%360)+360)%360/360*(SLDEM_COLS-1));
    if(!rowsNeeded.has(row))rowsNeeded.set(row,[col,col]);
    const span=rowsNeeded.get(row);
    span[0]=Math.min(span[0],col);span[1]=Math.max(span[1],col);
  }
  const rowValues=new Map();
  await mapConcurrent([...rowsNeeded],async ([row,[c0,c1]])=>{
    const values=await fetchRow(row,Math.max(0,c0-1),Math.min(SLDEM_COLS,c1+2));
    rowValues.set(row,{c0:Math.max(0,c0-1),values});
  });
  for(let j=0;j<w;j++)for(let i=0;i<w;i++){
    const px=originX+i*SLDEM_PIXEL_M,py=originY-j*SLDEM_PIXEL_M;
    const r=Math.hypot(px,py);
    const lat=Math.sign(site.lat||-1)*(90-2*Math.atan(r/(2*MOON_RADIUS_M))*180/Math.PI);
    const lon=Math.atan2(px,py)*180/Math.PI;
    const row=Math.round((60-lat)/120*(SLDEM_ROWS-1));
    const entry=rowValues.get(row);
    if(!entry)continue;
    const col=Math.round(((lon%360)+360)%360/360*(SLDEM_COLS-1))-entry.c0;
    const v=entry.values[col];
    if(Number.isFinite(v))data[j*w+i]=v*1000; // km above R=1737.4 (verified from LBL)
  }
  const profile=deriveHorizonFromRaster({data,width:w,height:w,
    originX,originY,resolutionX:SLDEM_PIXEL_M,resolutionY:-SLDEM_PIXEL_M,noData:null},
    site,{radiusKm,azimuthBins,stereoDistortion:false});
  let min=Infinity,max=-Infinity;
  for(const v of data)if(Number.isFinite(v)){if(v<min)min=v;if(v>max)max=v;}
  profile.patch={data,width:w,height:w,originX,originY,
    resolutionX:SLDEM_PIXEL_M,resolutionY:-SLDEM_PIXEL_M,noData:null,
    minM:min,maxM:max,groundSampleM:SLDEM_PIXEL_M,units:'metres',
    projection:'local polar-stereographic window'};
  return finishProfile(profile,site,
    'NASA LOLA+Kaguya SLDEM2015 patch ('+Math.round(SLDEM_PIXEL_M)+' m)',
    SLDEM_PIXEL_M);
}
