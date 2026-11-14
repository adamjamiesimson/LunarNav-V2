// NASA LOLA terrain support. Source: Barker et al. 2023, NASA GSFC PGDA
// south-polar COG mosaics (pgda.gsfc.nasa.gov/products/90,
// doi.org/10.3847/PSJ/acf3e1). Only a local window is read, via HTTP byte
// ranges; the full GeoTIFF never lands in browser memory. Profiles are capped
// at 20 km and assume the file's south-polar MOON_ME stereo projection centred
// on east longitude 0. Products: LDEM_80S (80S-90S, 80 m/px) and LDEM_60S
// (60S-90S, 60 m/px), the latter also serving custom waypoints. Not a
// landing safety map.
export const LOLA_COG='https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF';
export const LOLA_COG_60S='https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_60S_60MPP_ADJ.TIF';
export const LOLA_PRODUCTS=Object.freeze({
  '80s':{cog:LOLA_COG,proxy:'/assets/lola-80m.tif',label:'NASA GSFC PGDA LOLA 80m south-polar DEM',minLat:-90,maxLat:-80},
  '60s':{cog:LOLA_COG_60S,proxy:'/assets/lola-60s-60m.tif',label:'NASA GSFC PGDA LOLA 60m south-polar DEM (60°S–90°S)',minLat:-90,maxLat:-60}
});
// Smallest product covering a latitude (lighter COG where possible).
export function productFor(latitude){
  if(!Number.isFinite(latitude)||latitude> -60||latitude< -90)throw Error('NASA LOLA south-polar DEMs only cover 60°S to 90°S');
  return latitude> -80?'60s':'80s';
}
const DEG=Math.PI/180;
const RMOON=1737400;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function polarFrameXY(lat,lon){
  const radius=2*RMOON*Math.tan((90-Math.abs(lat))*DEG/2);
  return {x:radius*Math.sin(lon*DEG),y:radius*Math.cos(lon*DEG)};
}
export function polarXY(lat,lon){
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)<60||Math.abs(lat)>90)
    throw Error('LOLA terrain covers only 60°S to 90°S and 60°N to 90°N');
  return polarFrameXY(lat,lon);
}
// Horizon profile from real elevation pixels (metres). The grid starts at
// originX/originY with pixel size resolutionX/resolutionY. Radial sampling
// adapts to the DEM pixel size unless overridden. Outside the source window
// nothing is extrapolated; radial coverage is reported per profile and too
// little coverage rejects it.
export function deriveHorizonFromRaster({data,width,height,originX,originY,resolutionX,resolutionY,noData},site,{
  azimuthBins=72,radiusKm=20,stepMeters=null,centerXY=null,frameLon=null,stereoDistortion=true
}={}){
  if(!data||data.length!==width*height||!resolutionX||!resolutionY)throw Error('Invalid DEM raster');
  if(azimuthBins<8||azimuthBins>720||radiusKm<1||radiusKm>60)throw Error('Invalid horizon sampling');
  const pixelM=Math.max(Math.abs(resolutionX),Math.abs(resolutionY));
  const step=(stepMeters===null?Math.max(20,pixelM):stepMeters);
  if(!(step>=10))throw Error('Invalid horizon sampling');
  // centerXY supplies the observer position in the raster frame (local
  // east/north windows set frameLon=0; polar-stereo rasters use the site
  // longitude so the azimuth basis matches the grid axes).
  const center=centerXY||polarFrameXY(site.lat,site.lon);
  const read=(x,y)=>{
    const col=Math.floor((x-originX)/resolutionX),row=Math.floor((y-originY)/resolutionY);
    if(col<0||col>=width||row<0||row>=height)return null;
    const val=Number(data[row*width+col]);
    if(!Number.isFinite(val) || (noData!==null&&noData!==undefined&&val===Number(noData)))return null;
    return val;
  };
  const observer=read(center.x,center.y);
  if(observer===null)throw Error('No valid LOLA elevation at selected coordinates');
  // Local east/north rasters use a neutral azimuth basis; polar-stereo
  // rasters rotate it by the site longitude.
  const longitude=(frameLon!==null?frameLon:site.lon)*DEG;
  const northSign=frameLon===null&&site.lat>0?-1:1;
  const north=[northSign*Math.sin(longitude),northSign*Math.cos(longitude)];
  const east=[Math.cos(longitude),-Math.sin(longitude)];
  const elevationDeg=[],azimuthDeg=[];
  let covered=0,required=0,minLastRange=Infinity;
  for(let i=0;i<azimuthBins;i++){
    const az=360*i/azimuthBins,angle=az*DEG;
    const dir=[north[0]*Math.cos(angle)+east[0]*Math.sin(angle),
               north[1]*Math.cos(angle)+east[1]*Math.sin(angle)];
    let maxAngle=0,lastRange=0;
    // Projected metres in a polar-stereo raster run longer than ground metres
    // away from the central meridian; ground-metre rasters opt out.
    const groundScale=stereoDistortion?1+Math.pow(Math.hypot(center.x,center.y)/(2*RMOON),2):1;
    for(let distance=step;distance<=radiusKm*1000;distance+=step){
      required++;
      const projected=distance*groundScale;
      const z=read(center.x+dir[0]*projected,center.y+dir[1]*projected);
      if(z===null)continue;
      covered++;lastRange=distance;
      // Spherical lunar curvature relative to the observer's tangent plane.
      const apparent=(z-observer-distance*distance/(2*RMOON))/distance;
      const angleDeg=Math.atan(apparent)/DEG;
      if(angleDeg>maxAngle)maxAngle=angleDeg;
    }
    minLastRange=Math.min(minLastRange,lastRange);
    azimuthDeg.push(az);elevationDeg.push(Math.max(0,maxAngle));
  }
  if(covered<required*0.8)throw Error('Insufficient valid DEM coverage for reliable horizon profile');
  return {
    azimuthDeg,elevationDeg,observerHeightM:observer,
    coveragePct:100*covered/required,radiusKm,stepMeters:step,
    maxReliableRangeKm:minLastRange/1000,azimuthBins,
    resolutionM:pixelM,
    lat:site.lat,lon:site.lon,source:'NASA GSFC PGDA LOLA south-polar DEM (Barker et al. 2023)',
    caveat:`${pixelM} m/pixel DEM, ${radiusKm} km radius, ${azimuthBins} azimuth bins, ${step} m radial steps; `+
      'no limb or disc corrections; not flight validated.'
  };
}

// Bounded LRU cache for loaded DEM patches (Float32 samples are heavy).
export function createPatchCache(limit=6){
  const store=new Map();
  return {
    get(key){if(!store.has(key))return undefined;const v=store.get(key);store.delete(key);store.set(key,v);return v;},
    set(key,value){store.set(key,value);while(store.size>limit)store.delete(store.keys().next().value);return value;},
    has(key){return store.has(key);},
    get size(){return store.size;}
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
      const timer=setTimeout(()=>{script.remove();reject(Error('GeoTIFF reader timed out'));},15000);
      script.onload=()=>{clearTimeout(timer);globalThis.GeoTIFF?.fromUrl?resolve(globalThis.GeoTIFF):reject(Error('GeoTIFF library not available'));};
      script.onerror=()=>{clearTimeout(timer);reject(Error('Could not load GeoTIFF reader from CDN'));};
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
  if(pixelSize<60||pixelSize>100)throw Error('Expected NASA 60–100 m/pixel DEM; found '+pixelSize.toFixed(1)+' m/pixel');
  if(Math.abs(Math.abs(resolutionX)-Math.abs(resolutionY))>1)
    throw Error('DEM pixels are not square; cannot use stereographic horizon assumptions');
  if(right-left<3||bottom-top<3)throw Error('Site outside the selected LOLA raster');
  if((right-left)*(bottom-top)>1600000)throw Error('DEM window too large for interactive terrain sampling');
  return {window:[left,top,right,bottom],
    originX:originX+left*resolutionX,originY:originY+top*resolutionY,
    resolutionX,resolutionY};
}

// COGs need true 206 byte responses; reject proxies that send the whole image.
export async function selectSafeLolaSource(productKey='80s',{signal}={}){
  const product=LOLA_PRODUCTS[productKey]||LOLA_PRODUCTS['80s'];
  const candidates=[product.proxy,product.cog];
  const errors=[];
  for(const url of candidates){
    try{
      const response=await fetch(url,{
        headers:{Range:'bytes=0-63'},
        signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000),cache:'no-store'
      });
      // Immediately cancel even when the server responds 200 with a full file.
      await response.body?.cancel();
      if(response.status===206)return url;
      errors.push(url+': HTTP '+response.status+' (requires 206 Partial Content)');
    }catch(error){errors.push(url+': '+error.message);}
  }
  throw Error('NASA terrain byte-range access is unavailable. '+errors.join(' | ')+'. Use a local compatible 60–100 m GeoTIFF.');
}

// Load a terrain patch and derive its horizon profile. The full Float32
// elevation samples ride along on the result (profile.patch) so the same data
// can feed geometry and the surface views.
export async function loadLolaTerrain(site,{file=null,onProgress=()=>{},signal}={}){
  const requestSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000);
  const g=await ensureGeoTIFF();
  requestSignal.throwIfAborted();
  onProgress('Opening NASA LOLA elevation metadata…');
  // fromUrl reads the cloud-optimized GeoTIFF over HTTP ranges. Local .tif
  // files remain the escape hatch when CORS or upstream access fails.
  const productKey=productFor(site.lat);
  const product=LOLA_PRODUCTS[productKey];
  const remoteUrl=file?null:await selectSafeLolaSource(productKey,{signal:requestSignal});
  if(remoteUrl)onProgress('Loading safe 206-byte-range NASA terrain source…');
  const tiff=file?await g.fromBlob(file):await g.fromUrl(remoteUrl,{allowFullFile:false},requestSignal);
  const image=await tiff.getImage(0,requestSignal);
  // Conventions are explicit: MOON_ME south-polar stereo, metres. GeoTIFF
  // projection metadata for planetary CRS is often custom, so measurable
  // bounds/resolution get validated instead of trusting an Earth EPSG id.
  const box=image.getBoundingBox();
  const center=polarXY(site.lat,site.lon);
  if(box.length!==4 || !box.every(Number.isFinite) || center.x<box[0]||
    center.x>box[2]||center.y<box[1]||center.y>box[3])
    throw Error('Selected coordinates do not project inside this DEM; verify MOON_ME south-polar georeferencing');
  const radiusKm=20;
  const {window,...geo}=subsetWindow(image,site,radiusKm);
  onProgress('Reading a local 40 km DEM patch (may take a moment)…');
  const r=await image.readRasters({window,samples:[0],signal:requestSignal});
  requestSignal.throwIfAborted();
  const data=r[0];if(!data)throw Error('Could not decode NASA elevation pixels');
  const noData=typeof image.getGDALNoData==='function'?image.getGDALNoData():null;
  onProgress('Computing the terrain horizon at 1° azimuth intervals…');
  const result=deriveHorizonFromRaster({data,width:r.width,height:r.height,...geo,noData},site,{radiusKm,azimuthBins:360});
  // Keep the original numerical raster (never an 8-bit reduction).
  let min=Infinity,max=-Infinity;
  for(const v of data){const n=Number(v);if(Number.isFinite(n)&&!(noData!==null&&n===Number(noData))){if(n<min)min=n;if(n>max)max=n;}}
  result.patch={data,width:r.width,height:r.height,...geo,noData,
    minM:Number.isFinite(min)?min:null,maxM:Number.isFinite(max)?max:null,
    groundSampleM:result.resolutionM,units:'metres',
    projection:'MOON_ME south-polar stereographic, centered 90°S / 0°E'};
  result.azimuthStepDeg=360/result.azimuthBins;
  result.verticalDatum='LOLA elevations relative to the 1737.4 km mean lunar radius';
  result.loadedFrom=file?'Local GeoTIFF supplied by user':(productKey==='60s'?'NASA LOLA 60m COG via byte-range reads':'NASA LOLA COG via byte-range reads');
  result.provenance=file?'User-provided GeoTIFF: its origin is NOT independently verified':(remoteUrl.startsWith('/')?'Vercel same-origin NASA COG proxy':'NASA PGDA direct COG URL');
  result.source=file?'User-supplied GeoTIFF, asserted compatible with LOLA MOON_ME projection':product.label;
  result.verifiedSource=!file;
  return result;
}
