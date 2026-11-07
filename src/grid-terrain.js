/**
 * Instant terrain horizons from the baked NASA relief grids
 * (assets/moon-relief.png and assets/moon-relief-north.png — the same LOLA
 * derived 480 m polar-stereographic surfaces used to displace the 3D globe,
 * provenance in data/relief.json).
 *
 * Deriving the horizon here gives every custom waypoint a real local sky view
 * immediately, offline and in both hemispheres; the native-resolution DEM
 * loader in terrain.js remains available as an upgrade. The horizon maths is
 * shared: deriveHorizonFromRaster is the same function used for the presets.
 */
import {polarXY,deriveHorizonFromRaster} from './terrain.js';

const GRIDS={
  south:{file:'/assets/moon-relief.png',key:null,north:false},
  north:{file:'/assets/moon-relief-north.png',key:'north',north:true}
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

/**
 * Derive a local horizon profile for any coordinate inside the polar grids
 * (60°–90° latitude in either hemisphere). Throws outside coverage or when
 * the sampled window lacks enough valid elevation pixels.
 */
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

export async function deriveGridHorizon(site,{azimuthBins=360,radiusKm=20}={}){
  const meta=await loadMeta();
  const cfg=Math.abs(site.lat)>=60&&site.lat>0?GRIDS.north:GRIDS.south;
  const block=cfg.key?meta[cfg.key]:meta;
  if(!block)throw Error('no baked grid metadata for this hemisphere');
  const size=block.size;
  const img=await loadImage(cfg.file);
  const canvas=document.createElement('canvas');
  canvas.width=img.width;canvas.height=img.height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(img,0,0);
  const {x0,y0,w,gsd,originX,originY,resolutionX,resolutionY}=gridRasterWindow({size,domainKm:block.domainKm,north:cfg.north},site,{radiusKm});
  const sx=Math.max(0,x0),sy=Math.max(0,y0);
  const sw=Math.min(img.width-sx,w),sh=Math.min(img.height-sy,w);
  if(sw<4||sh<4)throw Error('site lies outside the baked relief grids');
  const pixels=ctx.getImageData(sx,sy,sw,sh).data;
  // Full window with NaN padding where the grid ends; 0 codes are nodata.
  const data=new Float32Array(w*w).fill(NaN);
  const range=block.heightMaxM-block.heightMinM;
  for(let j=0;j<sh;j++)for(let i=0;i<sw;i++){
    const p=(j*sw+i)*4;
    const code=pixels[p]*16+pixels[p+1]/16;
    if(code>0)data[(j+sy-y0)*w+(i+sx-x0)]=block.heightMinM+code/4095*range;
  }
  const profile=deriveHorizonFromRaster({
    data,width:w,height:w,originX,originY,resolutionX,resolutionY,noData:null
  },site,{radiusKm,azimuthBins});
  profile.source=`NASA LOLA DEM baked grid (${block.horizontalGroundSampleM} m, ${cfg.north?'north':'south'} polar)`;
  profile.provenance='Derived from the bundled NASA relief grids (data/relief.json)';
  profile.loadedFrom='Baked relief grid';
  profile.verifiedSource=true;
  profile.gridDerived=true;
  return profile;
}
