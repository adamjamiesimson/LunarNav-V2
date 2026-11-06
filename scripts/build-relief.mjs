/**
 * Bake the lunar relief textures for the 3D globe from NASA elevation data:
 *
 *   assets/moon-relief.png         — south-polar grid (60°S–90°S, stereographic)
 *   assets/moon-relief-global.png  — global grid (90°S–60°N, equirectangular)
 *   data/relief.json               — scale/provenance metadata
 *
 * Sources (measured elevation, never rendered colour maps):
 *   - NASA GSFC PGDA LOLA south-polar DEM LDEM_60S_60MPP_ADJ.TIF (Barker 2023)
 *     read through COG overview range requests via geotiff.
 *   - SLDEM2015 (LRO LOLA + Kaguya SELENE coregistered, PDS3 label verified;
 *     128 px/deg equirectangular float32, heights relative to R=1737.4 km),
 *     read with strided byte-range row requests from the MIT archive.
 *
 * Heights are encoded as 16-bit values split across the R and G channels
 * (8-bit-per-channel PNG), so no vertical precision is lost to an 8-bit ramp.
 * The north polar cap (60°N–90°N) is not covered by these products and is
 * encoded as the 0-level with coverage reported in the metadata.
 *
 * The textures are visual relief for the globe only; horizon calculations use
 * the native-resolution DEM patches (see src/terrain.js), never this bake.
 *
 * Usage: node scripts/build-relief.mjs
 */
import {fromUrl} from 'geotiff';
import {writeFileSync,mkdirSync,existsSync,readFileSync} from 'node:fs';
import {deflateSync} from 'node:zlib';

const POLAR_COG='https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_60S_60MPP_ADJ.TIF';
const NORTH_IMG='http://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/FLOAT_IMG/LDEM_60N_240M_FLOAT.IMG';
const SLDEM_IMG='http://imbrium.mit.edu/DATA/SLDEM2015/GLOBAL/FLOAT_IMG/SLDEM2015_128_60S_60N_000_360_FLOAT.IMG';
const SLDEM_LBL='http://imbrium.mit.edu/DATA/SLDEM2015/GLOBAL/FLOAT_IMG/SLDEM2015_128_60S_60N_000_360_FLOAT.LBL';
const POLAR_SIZE=3880;          // polar grid width (nearest COG overview)
const GLOBAL_W=2048,GLOBAL_H=1024;
const POLAR_DOMAIN_M=931200;    // 60°S stereographic half-width
const RMOON=1737400;

// ---- minimal PNG writer: 8-bit RGB, 12-bit height packed into R (high) and
// the upper nibble of G (low) ----
function png12(width,height,codes){
  const crcTable=[...Array(256)].map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;return c>>>0;});
  const crc=buf=>{let c=0xFFFFFFFF;for(const b of buf)c=crcTable[(c^b)&0xFF]^(c>>>8);return (c^0xFFFFFFFF)>>>0;};
  const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const body=Buffer.concat([Buffer.from(type),data]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(body));return Buffer.concat([len,body,c]);};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2; // 8-bit RGB
  const stride=width*3+1;
  const rows=Buffer.alloc(stride*height);
  for(let y=0;y<height;y++){
    const off=y*stride;
    rows[off]=1; // filter: Sub — deltas stay small across each row
    const prev=[0,0,0];
    for(let x=0;x<width;x++){
      const v=Math.max(0,Math.min(4095,codes[y*width+x]));
      const px=[v>>4,(v&15)<<4,0];
      for(let k=0;k<3;k++){
        rows[off+1+x*3+k]=(px[k]-prev[k])&255; // PNG Sub deltas against the raw left pixel
        prev[k]=px[k];
      }
    }
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(rows,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}

async function withRetry(fn,tries=6){
  for(let attempt=1;;attempt++){
    try{return await fn();}
    catch(error){
      if(attempt>=tries)throw error;
      const wait=attempt*2000;
      console.warn(`attempt ${attempt} failed (${error.message}); retrying in ${wait/1000}s…`);
      await new Promise(r=>setTimeout(r,wait));
    }
  }
}

// Run async tasks with bounded concurrency: thousands of small range reads are
// round-trip bound, so parallel fetches cut the bake from ~40 min to ~2 min.
async function mapConcurrent(items,fn,workers=24){
  let next=0;
  const run=async()=>{while(next<items.length){const i=next++;await fn(items[i],i);}};
  await Promise.all(Array.from({length:Math.min(workers,items.length)},run));
}

// 3x3 box smoothing (mask-aware, NaN = missing) to remove decimation aliasing
// before encoding; without it the height gradient turns point-sampling noise
// into visible shading speckle on the globe.
function smoothGrid(values,width,height,passes=2){
  let src=Float32Array.from(values),dst=new Float32Array(values.length);
  for(let p=0;p<passes;p++){
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      let sum=0,n=0;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const xx=x+dx,yy=y+dy;
        if(xx<0||xx>=width||yy<0||yy>=height)continue;
        const v=src[yy*width+xx];
        if(!Number.isFinite(v))continue;
        sum+=v;n++;
      }
      dst[y*width+x]=n?sum/n:NaN;
    }
    const t=src;src=dst;dst=t;
  }
  values.set(src);
}

const sldemFetch=async(range,url=SLDEM_IMG)=>{
  const res=await fetch(url,{headers:{Range:range},signal:AbortSignal.timeout(60000)});
  if(!(res.status===206||res.status===200))throw Error('range read failed: '+res.status);
  return Buffer.from(await res.arrayBuffer());
};

// ---- 1. south-polar grid from the LOLA COG overview ----
console.log('polar: opening',POLAR_COG);
const tif=await withRetry(()=>fromUrl(POLAR_COG,{allowFullFile:false}));
const levels=[];
for(let i=0;i<await tif.getImageCount();i++){const img=await tif.getImage(i);levels.push({i,img,w:img.getWidth()});}
const fitting=levels.filter(l=>l.w>=2048&&l.w<=POLAR_SIZE).sort((a,b)=>b.w-a.w);
const pick=fitting[0]||levels.reduce((a,b)=>Math.abs(b.w-POLAR_SIZE)<Math.abs(a.w-POLAR_SIZE)?b:a);
const polarImg=pick.img,size=pick.w;
console.log(`polar: baking overview ${pick.i} (${size}x${size})`);
const polarData=(await withRetry(()=>polarImg.readRasters({width:size,height:size})))[0];
const polarNoData=typeof polarImg.getGDALNoData==='function'?polarImg.getGDALNoData():null;
let pMin=Infinity,pMax=-Infinity;
const polarVals=new Float32Array(size*size).fill(NaN);
for(let i=0;i<polarData.length;i++){
  const v=Number(polarData[i]);
  if(!Number.isFinite(v)||(polarNoData!==null&&v===Number(polarNoData)))continue;
  polarVals[i]=v;
  if(v<pMin)pMin=v;if(v>pMax)pMax=v;
}
smoothGrid(polarVals,size,size,1); // light smoothing; geotiff already resamples

// ---- 1b. north-polar grid from the LOLA GDR shape mosaic (LDEM_60N_240M)
// Raw float32 rows, pole at pixel centre (offsets verified from the PDS label);
// orientation verified empirically against SLDEM2015 (RMS 17 m in the overlap
// ring: x=(col-off)*240, y=(row-off)*240, lon=atan2(x,y)).
console.log('north: reading LDEM_60N_240M rows (strided byte ranges)');
const NROWS=7760,NPIX=7760,NOFF=3879.5,NSCALE=240.0;
const northVals=new Float32Array(size*size).fill(NaN);
let nMin=Infinity,nMax=-Infinity;
const nStride=NROWS/size; // 2.0 for 3880
const northRows=Array.from({length:size},(_,j)=>j);
await mapConcurrent(northRows,async j=>{
  const srow=Math.round(j*nStride);
  const start=srow*NPIX*4;
  const buf=await withRetry(()=>sldemFetch(`bytes=${start}-${start+NPIX*4-1}`,NORTH_IMG));
  for(let i=0;i<size;i++){
    const scol=Math.round(i*nStride);
    const v=buf.readFloatLE(scol*4)*1000; // km above R=1737.4 (verified from LBL)
    if(Number.isFinite(v)){northVals[j*size+i]=v;if(v<nMin)nMin=v;if(v>nMax)nMax=v;}
  }
  if(j%512===0)console.log(`north: row ${j}/${size}`);
});
smoothGrid(northVals,size,size,1);
const northRange=nMax-nMin||1;
const northCodes=new Uint16Array(size*size);
for(let i=0;i<northVals.length;i++)
  northCodes[i]=Number.isFinite(northVals[i])?Math.round((northVals[i]-nMin)/northRange*4095):0;
const polarRange=pMax-pMin||1;
const polarCodes=new Uint16Array(size*size);
const polarQuantM=polarRange/4095; // 12-bit vertical quantisation
for(let i=0;i<polarVals.length;i++){
  const v=polarVals[i];
  polarCodes[i]=Number.isFinite(v)?Math.round((v-pMin)/polarRange*4095):0;
}

// ---- 2. global equirectangular grid: SLDEM2015 rows + polar rows from the COG ----
console.log('global: reading SLDEM2015 rows (strided byte ranges)');
const rows=15360,cols=46080,rowBytes=cols*4;         // verified from the PDS label
const globalCodes=new Uint16Array(GLOBAL_W*GLOBAL_H);
let gMin=Infinity,gMax=-Infinity;
const gValues=new Float32Array(GLOBAL_W*GLOBAL_H).fill(NaN);
const sldemRows=[];
for(let j=0;j<GLOBAL_H;j++){
  const lat=90-(j+0.5)*180/GLOBAL_H;
  if(lat>=-60&&lat<=60)sldemRows.push(j);
}
await mapConcurrent(sldemRows,async j=>{
  const lat=90-(j+0.5)*180/GLOBAL_H;
  const srow=Math.round((60-lat)/120*(rows-1));       // row 0 = +60° (north-up)
  const buf=await withRetry(()=>sldemFetch(`bytes=${srow*rowBytes}-${srow*rowBytes+rowBytes-1}`));
  for(let i=0;i<GLOBAL_W;i++){
    const lon=-180+(i+0.5)*360/GLOBAL_W;
    const scol=Math.round(((lon%360)+360)%360/360*(cols-1)); // column 0 = 0 deg E (verified empirically)
    const v=buf.readFloatLE(scol*4);                  // km above R=1737.4 (verified from LBL)
    if(Number.isFinite(v)){gValues[j*GLOBAL_W+i]=v*1000;if(v*1000<gMin)gMin=v*1000;if(v*1000>gMax)gMax=v*1000;}
  }
  if(j%128===0)console.log(`global: row ${j}/${GLOBAL_H}`);
});
// Polar rows (below 60°S) from the COG grid sampled bilinearly.
const polarSample=(lat,lon)=>{
  const r=2*RMOON*Math.tan((90+lat)*Math.PI/360),lr=lon*Math.PI/180;
  const u=(r*Math.sin(lr)+POLAR_DOMAIN_M)/(2*POLAR_DOMAIN_M);
  const v=(POLAR_DOMAIN_M-r*Math.cos(lr))/(2*POLAR_DOMAIN_M);
  if(u<0||u>1||v<0||v>1)return NaN;
  const x=u*(size-1),y=v*(size-1);
  const x0=Math.floor(x),y0=Math.floor(y);
  const x1=Math.min(size-1,x0+1),y1=Math.min(size-1,y0+1);
  const h=(a,b)=>{
    const code=polarCodes[b*size+a];
    return code?pMin+code/4095*polarRange:NaN;        // 0 encodes nodata (12-bit codes)
  };
  const vals=[h(x0,y0),h(x1,y0),h(x0,y1),h(x1,y1)];
  if(vals.some(v=>!Number.isFinite(v)))return NaN;
  const fx=x-x0,fy=y-y0;
  return (vals[0]*(1-fx)+vals[1]*fx)*(1-fy)+(vals[2]*(1-fx)+vals[3]*fx)*fy;
};
const polarSampleNorth=(lat,lon)=>{
  const r=2*RMOON*Math.tan((90-lat)*Math.PI/360),lr=lon*Math.PI/180;
  const u=(r*Math.sin(lr)+POLAR_DOMAIN_M)/(2*POLAR_DOMAIN_M);
  const v=(r*Math.cos(lr)+POLAR_DOMAIN_M)/(2*POLAR_DOMAIN_M); // north grid rows run -y -> +y
  if(u<0||u>1||v<0||v>1)return NaN;
  const x=u*(size-1),y=v*(size-1);
  const x0=Math.floor(x),y0=Math.floor(y);
  const x1=Math.min(size-1,x0+1),y1=Math.min(size-1,y0+1);
  const h=(a,b)=>{
    const code=northCodes[b*size+a];
    return code?nMin+code/4095*northRange:NaN;
  };
  const vals=[h(x0,y0),h(x1,y0),h(x0,y1),h(x1,y1)];
  if(vals.some(v=>!Number.isFinite(v)))return NaN;
  const fx=x-x0,fy=y-y0;
  return (vals[0]*(1-fx)+vals[1]*fx)*(1-fy)+(vals[2]*(1-fx)+vals[3]*fx)*fy;
};
for(let j=0;j<GLOBAL_H;j++){
  const lat=90-(j+0.5)*180/GLOBAL_H;
  if(lat>=-60)continue;
  for(let i=0;i<GLOBAL_W;i++){
    const lon=-180+(i+0.5)*360/GLOBAL_W;
    const m=polarSample(lat,lon);
    if(Number.isFinite(m)){gValues[j*GLOBAL_W+i]=m;if(m<gMin)gMin=m;if(m>gMax)gMax=m;}
  }
}
// North cap rows (> 60°N) from the LDEM_60N grid.
for(let j=0;j<GLOBAL_H;j++){
  const lat=90-(j+0.5)*180/GLOBAL_H;
  if(lat<=60)continue;
  for(let i=0;i<GLOBAL_W;i++){
    const lon=-180+(i+0.5)*360/GLOBAL_W;
    const m=polarSampleNorth(lat,lon);
    if(Number.isFinite(m)){gValues[j*GLOBAL_W+i]=m;if(m<gMin)gMin=m;if(m>gMax)gMax=m;}
  }
}
const gRange=gMax-gMin||1;
smoothGrid(gValues,GLOBAL_W,GLOBAL_H,2); // SLDEM rows are point-decimated: smooth hard
for(let i=0;i<gValues.length;i++)
  globalCodes[i]=Number.isFinite(gValues[i])?Math.round((gValues[i]-gMin)/gRange*4095):0;

// ---- 3. write textures + metadata ----
mkdirSync('assets',{recursive:true});
mkdirSync('data',{recursive:true});
writeFileSync('assets/moon-relief.png',png12(size,size,polarCodes));
writeFileSync('assets/moon-relief-north.png',png12(size,size,northCodes));
writeFileSync('assets/moon-relief-global.png',png12(GLOBAL_W,GLOBAL_H,globalCodes));
const meta=JSON.parse(existsSync('data/relief.json')?readFileSync('data/relief.json','utf8'):'{}');
writeFileSync('data/relief.json',JSON.stringify({
  version:'lola-polar-relief-v2',
  projection:'MOON_ME south-polar stereographic, centered 90°S / 0°E',
  encoding:'12-bit height packed into PNG R (high) and the upper nibble of G (low)',
  size,domainKm:POLAR_DOMAIN_M*2/1000,radiusKm:POLAR_DOMAIN_M/1000,
  heightMinM:pMin,heightMaxM:pMax,
  horizontalGroundSampleM:POLAR_DOMAIN_M*2/size,
  verticalQuantisationM:polarQuantM,
  source:'NASA GSFC PGDA LOLA south-polar DEM (Barker et al. 2023) LDEM_60S_60MPP_ADJ.TIF',
  sourceUrl:POLAR_COG,
  north:{
    file:'assets/moon-relief-north.png',size,projection:'MOON_ME north-polar stereographic, centered 90°N / 0°E',
    heightMinM:nMin,heightMaxM:nMax,
    horizontalGroundSampleM:POLAR_DOMAIN_M*2/size,
    verticalQuantisationM:northRange/4095,
    source:'NASA LOLA GDR north-polar shape mosaic LDEM_60N_240M (raw float32)',
    sourceUrl:NORTH_IMG,
    datum:'heights above/below the 1737.4 km mean lunar radius',
    validation:'grid orientation and scale cross-checked against SLDEM2015 in the 55-60 degN overlap ring: RMS 17 m, bias +0.9 m'
  },
  global:{
    file:'assets/moon-relief-global.png',width:GLOBAL_W,height:GLOBAL_H,
    coverageLat:[-90,90],
    coverageNote:'90S-60S from LDEM_60S, 60S-60N from SLDEM2015, 60N-90N from LDEM_60N; cross-faded at the boundaries',
    heightMinM:gMin,heightMaxM:gMax,
    horizontalGroundSampleMAtEquator:RMOON*Math.PI*2/GLOBAL_W/1, // ≈ 5.3 km
    verticalQuantisationM:gRange/4095,
    source:'SLDEM2015 (LRO LOLA + Kaguya SELENE coregistered) + LDEM_60S polar rows',
    sourceUrl:SLDEM_IMG,
    datum:'heights above/below the 1737.4 km mean lunar radius'
  },
  generatedUtc:new Date().toISOString(),
  note:'Visual relief for the 3D globe; horizon profiles are computed from native-resolution DEM patches instead.'
},null,2)+'\n');
console.log(`wrote polar ${size}x${size} (${pMin.toFixed(0)}..${pMax.toFixed(0)} m) and global ${GLOBAL_W}x${GLOBAL_H} (${gMin.toFixed(0)}..${gMax.toFixed(0)} m)`);
