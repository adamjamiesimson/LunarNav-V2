/**
 * Experimental NASA LOLA terrain support.
 *
 * Source: Barker et al. 2023 NASA GSFC PGDA, south-polar COG 80m/pixel
 * https://pgda.gsfc.nasa.gov/products/90
 * https://doi.org/10.3847/PSJ/acf3e1
 *
 * Read only a local window through HTTP byte ranges; never download or unpack
 * the entire 181 MB GeoTIFF into browser memory. This profile is coarse,
 * limited to 20 km and assumes the file's south-polar MOON_ME stereographic
 * projection, centered on east longitude 0°. It is not a landing safety map.
 */
export const LOLA_COG='https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF';
const DEG=Math.PI/180;
const RMOON=1737400;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function polarXY(lat,lon){
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat < -90 || lat> -80)throw Error('LOLA 80S terrain only covers 80°S to 90°S');
  const radius=2*RMOON*Math.tan((90+lat)*DEG/2);
  return {x:radius*Math.sin(lon*DEG),y:radius*Math.cos(lon*DEG)};
}
/** Compute horizon profile against real elevation pixels already supplied in metres.
 * Grid starts at originX/originY; pixel size resolutionX/resolutionY in metres.
 * Values outside the source window are deliberately NOT extrapolated.
 */
export function deriveHorizonFromRaster({data,width,height,originX,originY,resolutionX,resolutionY,noData},site,{
  azimuthBins=72,radiusKm=20,stepMeters=200
}={}){
  if(!data||data.length!==width*height||!resolutionX||!resolutionY)throw Error('Invalid DEM raster');
  if(azimuthBins<8||azimuthBins>720||radiusKm<1||radiusKm>60||stepMeters<10)throw Error('Invalid horizon sampling');
  const center=polarXY(site.lat,site.lon);
  const read=(x,y)=>{
    const col=Math.floor((x-originX)/resolutionX),row=Math.floor((y-originY)/resolutionY);
    if(col<0||col>=width||row<0||row>=height)return null;
    const val=Number(data[row*width+col]);
    if(!Number.isFinite(val) || (noData!==null&&noData!==undefined&&val===Number(noData)))return null;
    return val;
  };
  const observer=read(center.x,center.y);
  if(observer===null)throw Error('No valid LOLA elevation at selected coordinates');
  const longitude=site.lon*DEG;
  const north=[Math.sin(longitude),Math.cos(longitude)];
  const east=[Math.cos(longitude),-Math.sin(longitude)];
  const elevationDeg=[],azimuthDeg=[];
  let covered=0,required=0;
  for(let i=0;i<azimuthBins;i++){
    const az=360*i/azimuthBins,angle=az*DEG;
    const dir=[north[0]*Math.cos(angle)+east[0]*Math.sin(angle),
               north[1]*Math.cos(angle)+east[1]*Math.sin(angle)];
    let maxAngle=0,observed=0,samples=0;
    // At fixed latitude the raster scale differs slightly from lunar ground
    // distance; a spherical stereographic correction is used here.
    const groundScale=1+Math.pow(Math.hypot(center.x,center.y)/(2*RMOON),2);
    for(let distance=stepMeters;distance<=radiusKm*1000;distance+=stepMeters){
      required++;
      const projected=distance/groundScale;
      const z=read(center.x+dir[0]*projected,center.y+dir[1]*projected);
      if(z===null)continue;
      covered++;observed++;samples++;
      // Spherical lunar curvature relative to the observer's tangent plane.
      const apparent=(z-observer-distance*distance/(2*RMOON))/distance;
      const angleDeg=Math.atan(apparent)/DEG;
      if(angleDeg>maxAngle)maxAngle=angleDeg;
    }
    azimuthDeg.push(az);elevationDeg.push(Math.max(0,maxAngle));
  }
  if(covered<required*0.8)throw Error('Insufficient valid DEM coverage for reliable horizon profile');
  return {
    azimuthDeg,elevationDeg,observerHeightM:observer,
    coveragePct:100*covered/required,radiusKm,stepMeters,
    resolutionM:Math.max(Math.abs(resolutionX),Math.abs(resolutionY)),
    lat:site.lat,lon:site.lon,source:'NASA GSFC PGDA LOLA south-polar DEM 80 m/pixel (Barker et al. 2023)',
    caveat:'Coarse 80 m/pixel, 20 km radius, 5° azimuth bins, no limb correction; not flight validated.'
  };
}
let loaderPromise;
async function ensureGeoTIFF(){
  if(globalThis.GeoTIFF?.fromUrl)return globalThis.GeoTIFF;
  if(!loaderPromise){
    loaderPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.js';
      script.crossOrigin='anonymous';
      script.onload=()=>globalThis.GeoTIFF?.fromUrl?resolve(globalThis.GeoTIFF):reject(Error('GeoTIFF library not available'));
      script.onerror=()=>reject(Error('Could not load GeoTIFF reader from CDN'));
      document.head.appendChild(script);
    }).catch(e=>{loaderPromise=null;throw e;});
  }
  return loaderPromise;
}
function subsetWindow(image,site,radiusKm){
  const siteXY=polarXY(site.lat,site.lon);
  const [originX,originY]=image.getOrigin(),[resolutionX,resolutionY]=image.getResolution();
  if(!resolutionX||!resolutionY)throw Error('DEM has no supported georeferencing');
  const extra=radiusKm*1000*1.06;
  const cols=[(siteXY.x-extra-originX)/resolutionX,(siteXY.x+extra-originX)/resolutionX];
  const rows=[(siteXY.y-extra-originY)/resolutionY,(siteXY.y+extra-originY)/resolutionY];
  const left=clamp(Math.floor(Math.min(...cols)),0,image.getWidth()),right=clamp(Math.ceil(Math.max(...cols)),0,image.getWidth());
  const top=clamp(Math.floor(Math.min(...rows)),0,image.getHeight()),bottom=clamp(Math.ceil(Math.max(...rows)),0,image.getHeight());
  const pixelSize=Math.max(Math.abs(resolutionX),Math.abs(resolutionY));
  if(pixelSize<60||pixelSize>100)throw Error('Expected NASA 80 m/pixel DEM; found '+pixelSize.toFixed(1)+' m/pixel');
  if(Math.abs(Math.abs(resolutionX)-Math.abs(resolutionY))>1)
    throw Error('DEM pixels are not square; cannot use stereographic horizon assumptions');
  if(right-left<3||bottom-top<3)throw Error('Site outside the selected LOLA raster');
  if((right-left)*(bottom-top)>1600000)throw Error('DEM window too large for interactive terrain sampling');
  return {window:[left,top,right,bottom],
    originX:originX+left*resolutionX,originY:originY+top*resolutionY,
    resolutionX,resolutionY};
}

/** COGs require true 206 byte responses; reject proxies returning the entire 181 MB image. */
export async function selectSafeLolaSource(){
  const candidates=['/assets/lola-80m.tif',LOLA_COG];
  const errors=[];
  for(const url of candidates){
    try{
      const response=await fetch(url,{
        headers:{Range:'bytes=0-63'},
        signal:AbortSignal.timeout(10000),cache:'no-store'
      });
      // Immediately cancel even when the server responds 200 with a full file.
      await response.body?.cancel();
      if(response.status===206)return url;
      errors.push(url+': HTTP '+response.status+' (requires 206 Partial Content)');
    }catch(error){errors.push(url+': '+error.message);}
  }
  throw Error('NASA terrain byte-range access is unavailable. '+errors.join(' | ')+'. Use a local compatible 80m GeoTIFF.');
}

/** Explicit user-triggered loading. No invisible automatic network requests. */
export async function loadLolaTerrain(site,{file=null,onProgress=()=>{}}={}){
  const g=await ensureGeoTIFF();
  onProgress('Opening NASA LOLA elevation metadata…');
  // fromUrl uses HTTP ranges for the cloud-optimized remote GeoTIFF.
  // Local .tif files remain an escape hatch when CORS or upstream access fails.
  const remoteUrl=file?null:await selectSafeLolaSource();
  if(remoteUrl)onProgress('Loading safe 206-byte-range NASA terrain source…');
  const tiff=file?await g.fromBlob(file):await g.fromUrl(remoteUrl);
  const image=await tiff.getImage();
  // Coordinate conventions are explicit: MOON_ME south-polar stereographic,
  // metres and 80m/pixel. GeoTIFF projection metadata is often custom for
  // planetary CRS, so we validate measurable bounds/resolution instead of
  // quietly assuming an Earth EPSG identifier.
  const box=image.getBoundingBox();
  const center=polarXY(site.lat,site.lon);
  if(box.length!==4 || !box.every(Number.isFinite) || center.x<box[0]||
    center.x>box[2]||center.y<box[1]||center.y>box[3])
    throw Error('Selected coordinates do not project inside this DEM; verify MOON_ME south-polar georeferencing');
  const radiusKm=20;
  const {window,...geo}=subsetWindow(image,site,radiusKm);
  onProgress('Reading a local 40 km DEM patch (may take a moment)…');
  const r=await image.readRasters({window,samples:[0]});
  const data=r[0];if(!data)throw Error('Could not decode NASA elevation pixels');
  onProgress('Computing the terrain horizon at 5° azimuth intervals…');
  const result=deriveHorizonFromRaster({
    data,width:r.width,height:r.height,...geo,
    noData:typeof image.getGDALNoData==='function'?image.getGDALNoData():null
  },site,{radiusKm,azimuthBins:72,stepMeters:200});
  result.loadedFrom=file?'Local GeoTIFF supplied by user':'NASA LOLA COG via byte-range reads';
  result.provenance=file?'User-provided GeoTIFF: its origin is NOT independently verified':(remoteUrl.startsWith('/')?'Vercel same-origin NASA COG proxy':'NASA PGDA direct COG URL');
  result.source=file?'User-supplied 80m GeoTIFF, asserted compatible with LOLA MOON_ME projection':'NASA GSFC PGDA LOLA 80m south-polar DEM';
  result.verifiedSource=!file;
  return result;
}
