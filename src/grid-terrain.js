// Terrain horizons straight from the baked NASA relief grids
// (assets/moon-relief*.png, the LOLA-derived surfaces the globe displaces;
// provenance in data/relief.json). Deriving the horizon here gives every
// custom waypoint a real local sky view immediately and offline: polar grids
// (60-90 deg either hemisphere) at 480 m, global grid below that at ~1.33 km.
// The maths is shared: deriveHorizonFromRaster is the same function the
// preset sites and the native DEM loader use.
import {polarXY,polarFrameXY,deriveHorizonFromRaster} from './terrain.js';
import {MOON_RADIUS_M,globalReliefUV} from './relief.js';

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
  return metaPromise.catch(error=>{metaPromise=null;throw error;});
}
function loadImage(file){
  if(!imageCache.has(file)){
    imageCache.set(file,new Promise((resolve,reject)=>{
      const img=new Image();
      img.onload=()=>{
        // Keep at most one decoded grid around (~128 MiB for the global PNG).
        for(const key of imageCache.keys())if(key!==file)imageCache.delete(key);
        resolve(img);
      };
      img.onerror=()=>{imageCache.delete(file);reject(Error('relief grid unavailable: '+file));};
      img.src=file;
    }));
  }
  return imageCache.get(file);
}

// Polar-stereographic window.
export function gridRasterWindow({size,domainKm,north},site,{radiusKm=20}={}){
  const gsd=domainKm*1000/size;
  const {x,y}=polarXY(site.lat,site.lon);
  const px=(x+DOMAIN_M)/(2*DOMAIN_M)*size;
  const py=(north?(y+DOMAIN_M)/(2*DOMAIN_M):(DOMAIN_M-y)/(2*DOMAIN_M))*size;
  const scale=1+(Math.hypot(x,y)/(2*MOON_RADIUS_M))**2;
  const half=Math.ceil(radiusKm*1000*scale/gsd)+2;
  const x0=Math.round(px)-half,y0=Math.round(py)-half,w=2*half+1;
  return {x0,y0,w,gsd,
    originX:-DOMAIN_M+x0*gsd,
    originY:north?-DOMAIN_M+y0*gsd:DOMAIN_M-y0*gsd,
    resolutionX:gsd,resolutionY:north?gsd:-gsd};
}

// Equirectangular window in a local east/north metre frame around the site.
export function globalRasterWindow({width,height},lat,lon,{radiusKm=20}={}){
  const latGsd=Math.PI*MOON_RADIUS_M/height;
  const lonGsd=2*Math.PI*MOON_RADIUS_M*Math.max(0.05,Math.cos(lat*Math.PI/180))/width;
  const halfX=Math.ceil(radiusKm*1000/lonGsd)+2,halfY=Math.ceil(radiusKm*1000/latGsd)+2;
  const uv=globalReliefUV(lat,lon);
  const px=uv.u*width,py=uv.v*height;
  const x0=Math.round(px)-halfX,y0=Math.round(py)-halfY;
  return {x0,y0,w:2*halfX+1,h:2*halfY+1,lonGsd,latGsd,
    originX:(x0-px)*lonGsd,originY:(py-y0)*latGsd,resolutionX:lonGsd,resolutionY:-latGsd};
}

// Metre-valued raster window; grid edges stay NaN (NoData).
function readRasterWindow(img,x0,y0,w,h,block,wrap=false){
  // Read just the requested window, never a 8192x4096 RGBA canvas.
  const canvas=document.createElement('canvas');
  canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx)throw Error('Cannot read relief pixels');
  const sy=Math.max(0,y0),sh=Math.min(img.height,y0+h)-sy;
  if(sh<=0)throw Error('site lies outside the baked relief grid');
  for(let dx=0;dx<w;){
    const source=x0+dx,sx=wrap?((source%img.width)+img.width)%img.width:Math.max(0,source);
    if(!wrap&&source<0){dx+=Math.min(w-dx,-source);continue;}
    const sw=Math.min(w-dx,img.width-sx);
    if(sw<=0)break;
    ctx.drawImage(img,sx,sy,sw,sh,dx,sy-y0,sw,sh);
    dx+=sw;
  }
  const pixels=ctx.getImageData(0,0,w,h).data;
  const data=new Float32Array(w*h).fill(NaN);
  const range=block.heightMaxM-block.heightMinM;
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){
    const p=(j*w+i)*4;
    const code=pixels[p]*16+pixels[p+1]/16; // 12-bit height packed into R/G
    if(code>0&&pixels[p+3])data[j*w+i]=block.heightMinM+code/4095*range;
  }
  canvas.width=canvas.height=0;
  return data;
}

function finishProfile(profile,site,source,resolutionM,{gridDerived=true}={}){
  profile.lat=site.lat;profile.lon=site.lon;
  profile.source=source;
  profile.provenance=gridDerived?'Derived from the bundled NASA relief grids (data/relief.json)':source;
  profile.loadedFrom=gridDerived?'Baked relief grid':'Native SLDEM2015 byte ranges';
  profile.verifiedSource=true;
  profile.gridDerived=gridDerived;
  profile.resolutionM=resolutionM;
  return profile;
}

async function deriveFromPolar(site,meta,{azimuthBins,radiusKm}){
  const cfg=site.lat>0?GRIDS.north:GRIDS.south;
  const block=cfg.key?meta[cfg.key]:meta;
  if(!block)throw Error('no baked polar grid metadata');
  const img=await loadImage(cfg.file);
  const win=gridRasterWindow({size:block.size,domainKm:block.domainKm,north:cfg.north},site,{radiusKm});
  const data=readRasterWindow(img,win.x0,win.y0,win.w,win.w,block);
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
  const img=await loadImage(GRIDS.global.file);
  const win=globalRasterWindow({width:block.width,height:block.height},site.lat,site.lon,{radiusKm});
  const data=readRasterWindow(img,win.x0,win.y0,win.w,win.h,block,true);
  const resolutionM=Math.max(win.latGsd,win.lonGsd);
  const profile=deriveHorizonFromRaster({data,width:win.w,height:win.h,
    originX:win.originX,originY:win.originY,resolutionX:win.resolutionX,resolutionY:win.resolutionY,noData:null},
    site,{radiusKm,azimuthBins,centerXY:{x:0,y:0},frameLon:0});
  return finishProfile(profile,site,
    `NASA LOLA/Kaguya DEM baked global grid (~${(resolutionM/1000).toFixed(1)} km) (coarse regional horizon)`,
    resolutionM);
}

// Local horizon profile for any coordinate: high-res polar grids near the
// caps, the global grid elsewhere. Throws only when no grid covers the spot
// or the window has no valid elevation pixels.
export async function deriveGridHorizon(site,{azimuthBins=360,radiusKm=20}={}){
  const meta=await loadMeta();
  const opts={azimuthBins,radiusKm};
  if(Math.abs(site.lat)>=60){
    try{return await deriveFromPolar(site,meta,opts);}
    catch(error){
      // Cap-edge sites can fall outside the polar window: use the global grid
      // instead of failing to flat horizon.
      try{return await deriveFromGlobal(site,meta,opts);}catch{throw error;}
    }
  }
  return deriveFromGlobal(site,meta,opts);
}

// SLDEM2015 native format: PDS PC_REAL float32 little-endian, kilometres
// above R=1737.4 km. Pixel-registered cylindrical grid, 128 px/degree,
// 0-360E, 60N-60S.
const SLDEM_IMG='/assets/sldem.img';
const SLDEM_COLS=46080,SLDEM_ROWS=15360,SLDEM_ROW_BYTES=SLDEM_COLS*4;
const SLDEM_PIXEL_M=2*Math.PI*MOON_RADIUS_M/SLDEM_COLS;

export function sldemPixelAt(x,y,hemisphere){
  const lat=hemisphere*(90-2*Math.atan(Math.hypot(x,y)/(2*MOON_RADIUS_M))*180/Math.PI);
  const lon=Math.atan2(x,y)*180/Math.PI;
  return {row:Math.floor((60-lat)*128),col:Math.floor(((lon%360)+360)%360*128)};
}

// Reject full-file and malformed responses before reading a single body byte.
export async function fetchSldemRow(row,c0,c1,{signal}={}){
  if(!Number.isInteger(row)||row<0||row>=SLDEM_ROWS||!Number.isInteger(c0)||!Number.isInteger(c1)||c0<0||c1>SLDEM_COLS||c0>=c1)
    throw Error('Invalid SLDEM range');
  const start=row*SLDEM_ROW_BYTES+c0*4,end=row*SLDEM_ROW_BYTES+c1*4-1;
  const response=await fetch(SLDEM_IMG,{headers:{Range:'bytes='+start+'-'+end},
    signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});
  const expected=end-start+1;
  const valid=response.status===206&&
    response.headers.get('content-range')==='bytes '+start+'-'+end+'/'+(SLDEM_ROWS*SLDEM_ROW_BYTES)&&
    (!response.headers.has('content-length')||Number(response.headers.get('content-length'))===expected)&&
    (!response.headers.has('content-type')||/^(application\/(octet-stream|binary)|image\/x-pds)(;|$)/i.test(response.headers.get('content-type')))&&
    (!response.headers.has('content-encoding')||response.headers.get('content-encoding')==='identity');
  if(!valid){await response.body?.cancel();throw Error('SLDEM requires an exact uncompressed 206 byte range');}
  if(!response.body)throw Error('Empty SLDEM response');
  const reader=response.body.getReader(),bytes=new Uint8Array(expected);
  let length=0;
  try{
    while(true){
      const {value,done}=await reader.read();
      if(done)break;
      if(length+value.byteLength>expected)throw Error('Oversized SLDEM response');
      bytes.set(value,length);length+=value.byteLength;
    }
    if(length!==expected)throw Error('Truncated SLDEM response');
  }catch(error){await reader.cancel();throw error;}
  finally{reader.releaseLock();}
  const view=new DataView(bytes.buffer);
  return Float32Array.from({length:c1-c0},(_,i)=>view.getFloat32(i*4,true));
}

export async function deriveSldemPatch(site,{azimuthBins=360,radiusKm=20,fetchRow=fetchSldemRow,signal}={}){
  if(!Number.isFinite(site.lat)||!Number.isFinite(site.lon)||Math.abs(site.lat)>=60)
    throw Error('SLDEM2015 patches require coordinates between 60°S and 60°N');
  if(!Number.isFinite(radiusKm)||radiusKm<1||radiusKm>60)throw Error('Invalid SLDEM patch radius');
  const hemisphere=site.lat>0?1:-1;
  const {x,y}=polarFrameXY(site.lat,site.lon);
  const scale=1+(Math.hypot(x,y)/(2*MOON_RADIUS_M))**2;
  const spacing=SLDEM_PIXEL_M*scale;
  const half=Math.ceil(radiusKm*1000/SLDEM_PIXEL_M*1.03)+2,w=2*half+1;
  const originX=x-half*spacing,originY=y+half*spacing;
  const data=new Float32Array(w*w).fill(NaN),rows=new Map();
  for(let j=0;j<w;j++)for(let i=0;i<w;i++){
    const {row,col}=sldemPixelAt(originX+i*spacing,originY-j*spacing,hemisphere);
    if(row<0||row>=SLDEM_ROWS)continue;
    if(!rows.has(row))rows.set(row,new Map());
    const columns=rows.get(row);
    if(!columns.has(col))columns.set(col,[]);
    columns.get(col).push(j*w+i);
  }
  // Separate spans at 0/360: never read a whole row across the seam.
  const spans=[];
  for(const [row,columns] of rows){
    const sorted=[...columns.keys()].sort((a,b)=>a-b);
    let c0=sorted[0],previous=c0;
    for(const col of sorted.slice(1)){
      if(col>previous+1){spans.push({row,c0,c1:previous+1,columns});c0=col;}
      previous=col;
    }
    spans.push({row,c0,c1:previous+1,columns});
  }
  const controller=new AbortController();
  const combined=AbortSignal.any([controller.signal,AbortSignal.timeout(30000),...(signal?[signal]:[])]);
  let next=0;
  try{
    await Promise.all(Array.from({length:Math.min(8,spans.length)},async()=>{
      while(next<spans.length){
        combined.throwIfAborted();
        const {row,c0,c1,columns}=spans[next++];
        const values=await fetchRow(row,c0,c1,{signal:combined});
        if(!(values instanceof Float32Array)||values.length!==c1-c0)throw Error('Invalid SLDEM float32 row');
        for(let col=c0;col<c1;col++){
          const v=values[col-c0];
          if(!Number.isFinite(v)||Math.abs(v)>12)continue;
          for(const index of columns.get(col)||[])data[index]=v*1000;
        }
      }
    }));
  }catch(error){controller.abort();throw error;}
  const profile=deriveHorizonFromRaster({data,width:w,height:w,
    originX,originY,resolutionX:spacing,resolutionY:-spacing,noData:null},
    site,{radiusKm,azimuthBins,stepMeters:SLDEM_PIXEL_M});
  let min=Infinity,max=-Infinity;
  for(const v of data)if(Number.isFinite(v)){min=Math.min(min,v);max=Math.max(max,v);}
  profile.patch={data,width:w,height:w,originX,originY,
    resolutionX:spacing,resolutionY:-spacing,noData:null,hemisphere,
    minM:min,maxM:max,groundSampleM:SLDEM_PIXEL_M,units:'metres',
    projection:'polar-stereographic window'};
  return finishProfile(profile,site,'NASA LOLA+Kaguya SLDEM2015 patch ('+Math.round(SLDEM_PIXEL_M)+' m)',SLDEM_PIXEL_M,{gridDerived:false});
}

// Elevation samplers for the surface panorama.

// Bilinear grid sample in pixel coordinates; null outside the window.
export function sampleBilinear(data,width,height,fx,fy){
  if(!(fx>=0&&fy>=0&&fx<=width-1&&fy<=height-1))return null;
  const x0=Math.floor(fx),y0=Math.floor(fy),x1=Math.min(x0+1,width-1),y1=Math.min(y0+1,height-1);
  const tx=fx-x0,ty=fy-y0;
  const v00=data[y0*width+x0],v10=data[y0*width+x1],v01=data[y1*width+x0],v11=data[y1*width+x1];
  if(![v00,v10,v01,v11].every(Number.isFinite))return null;
  return v00*(1-tx)*(1-ty)+v10*tx*(1-ty)+v01*(1-tx)*ty+v11*tx*ty;
}

// Terrain heights around a site for the surface panorama: the native patch
// (when loaded) refines the near field, the baked grid covers the rest of the
// radius. Heights are metres above R=1737.4 km.
export async function loadSiteHeights(site,{radiusKm=45,patch=null}={}){
  if(!Number.isFinite(site?.lat)||Math.abs(site.lat)>90||!Number.isFinite(site.lon))
    throw Error('Invalid panorama coordinates');
  const meta=await loadMeta();
  const polar=Math.abs(site.lat)>=60;
  let win,data,resolutionM;
  if(polar){
    const cfg=site.lat>0?GRIDS.north:GRIDS.south;
    const block=cfg.key?meta[cfg.key]:meta;
    if(!block)throw Error('no baked polar grid metadata');
    const img=await loadImage(cfg.file);
    win=gridRasterWindow({size:block.size,domainKm:block.domainKm,north:cfg.north},site,{radiusKm});
    data=readRasterWindow(img,win.x0,win.y0,win.w,win.w,block);
    resolutionM=block.horizontalGroundSampleM;
  }else{
    const block=meta.global;
    if(!block)throw Error('no baked global grid metadata');
    const img=await loadImage(GRIDS.global.file);
    win=globalRasterWindow({width:block.width,height:block.height},site.lat,site.lon,{radiusKm});
    data=readRasterWindow(img,win.x0,win.y0,win.w,win.h,block,true);
    resolutionM=Math.max(win.latGsd,win.lonGsd);
  }
  if(!data.some(Number.isFinite))throw Error('No elevation data near this site');
  const height=polar?win.w:win.h;
  const sampleFrame=(x,y)=>sampleBilinear(data,win.w,height,(x-win.originX)/win.resolutionX,(y-win.originY)/win.resolutionY);
  const heightAt=(lat,lon)=>{
    if(patch&&patch.data){
      const p=polarFrameXY(lat,lon);
      const v=sampleBilinear(patch.data,patch.width,patch.height,
        (p.x-patch.originX)/patch.resolutionX,(p.y-patch.originY)/patch.resolutionY);
      if(Number.isFinite(v))return v;
    }
    if(polar){
      const p=polarXY(lat,lon);
      return sampleFrame(p.x,p.y);
    }
    const deltaLon=(((lon-site.lon+180)%360)+360)%360-180;
    const x=MOON_RADIUS_M*Math.cos(site.lat*Math.PI/180)*deltaLon*Math.PI/180;
    const y=MOON_RADIUS_M*(lat-site.lat)*Math.PI/180;
    return sampleFrame(x,y);
  };
  return {heightAt,resolutionM,usedPatch:Boolean(patch&&patch.data),
    source:'NASA LOLA/Kaguya DEM grid ('+Math.round(resolutionM)+' m/px)'+(patch&&patch.data?' + native waypoint patch':'')};
}
