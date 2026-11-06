/**
 * Bake the south-polar relief texture for the 3D globe from the NASA GSFC
 * PGDA LOLA south-polar DEM (Barker et al. 2023, LDEM_60S_60MPP_ADJ.TIF).
 *
 * Reads only a COG overview level through HTTP byte ranges and writes:
 *   assets/moon-relief.png  — 8-bit grayscale height grid (polar stereographic)
 *   data/relief.json        — scale/offset/provenance metadata
 *
 * The texture is visual relief for the globe only; horizon calculations use
 * the native-resolution DEM patches (see src/terrain.js), never this bake.
 *
 * Usage: node scripts/build-relief.mjs
 */
import {fromUrl} from 'geotiff';
import {writeFileSync,mkdirSync} from 'node:fs';
import {deflateSync} from 'node:zlib';

const COG='https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_60S_60MPP_ADJ.TIF';
const TARGET=4096;               // desired bake width; nearest COG overview at/above 2048 is used
const DOMAIN_KM=1862.4;          // 2 * 1737.4 * tan(15°): the 60°S stereographic domain
const RADIUS_KM=DOMAIN_KM/2;

function png8gray(width,height,pixels){
  const crcTable=[...Array(256)].map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;return c>>>0;});
  const crc=buf=>{let c=0xFFFFFFFF;for(const b of buf)c=crcTable[(c^b)&0xFF]^(c>>>8);return (c^0xFFFFFFFF)>>>0;};
  const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const body=Buffer.concat([Buffer.from(type),data]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(body));return Buffer.concat([len,body,c]);};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=0; // 8-bit grayscale
  const rows=Buffer.alloc((width+1)*height);
  for(let y=0;y<height;y++){rows[y*(width+1)]=0;pixels.copy?pixels.copy(rows,y*(width+1)+1,y*width,(y+1)*width):Buffer.from(pixels.buffer,y*width,width).copy(rows,y*(width+1)+1);}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(rows,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}

const tif=await fromUrl(COG,{allowFullFile:false});
const count=await tif.getImageCount();
const levels=[];
for(let i=0;i<count;i++){const img=await tif.getImage(i);levels.push({i,img,w:img.getWidth()});}
console.log('overview widths:',levels.map(l=>l.w).join(', '));
// Largest overview that still fits the target bake width.
const fitting=levels.filter(l=>l.w>=2048&&l.w<=TARGET).sort((a,b)=>b.w-a.w);
const pick=fitting[0]||levels.reduce((a,b)=>Math.abs(b.w-TARGET)<Math.abs(a.w-TARGET)?b:a);
const level=pick.i,best=pick.img;
const width=best.getWidth(),height=best.getHeight();
console.log(`COG overviews: ${count}; baking overview level ${level} (${width}x${height})`);
let rasters;
for(let attempt=1;;attempt++){
  try{rasters=await best.readRasters({width,height});break;}
  catch(error){
    if(attempt>=4)throw error;
    console.warn(`read attempt ${attempt} failed (${error.message}); retrying in ${attempt*3}s…`);
    await new Promise(r=>setTimeout(r,attempt*3000));
  }
}
const data=rasters[0];
const nodata=typeof best.getGDALNoData==='function'?best.getGDALNoData():null;

let min=Infinity,max=-Infinity;
for(let i=0;i<data.length;i++){
  const v=data[i];
  if(!Number.isFinite(v)||(nodata!==null&&v===Number(nodata)))continue;
  if(v<min)min=v;if(v>max)max=v;
}
const scale=(max-min)/255||1;
const pixels=Buffer.alloc(width*height);
for(let i=0;i<data.length;i++){
  const v=data[i];
  const valid=Number.isFinite(v)&&!(nodata!==null&&v===Number(nodata));
  pixels[i]=valid?Math.max(0,Math.min(255,Math.round((v-min)/scale))):0;
}

mkdirSync('assets',{recursive:true});
mkdirSync('data',{recursive:true});
writeFileSync('assets/moon-relief.png',png8gray(width,height,pixels));
writeFileSync('data/relief.json',JSON.stringify({
  version:'lola-polar-relief-v1',
  projection:'MOON_ME south-polar stereographic, centered 90°S / 0°E',
  size:width,domainKm:DOMAIN_KM,radiusKm:RADIUS_KM,
  heightMinM:min,heightMaxM:max,metresPerPixel:scale,
  source:'NASA GSFC PGDA LOLA south-polar DEM (Barker et al. 2023) LDEM_60S_60MPP_ADJ.TIF',
  sourceUrl:COG,
  generatedUtc:new Date().toISOString(),
  note:'Visual relief for the 3D globe; horizon profiles are computed from native-resolution DEM patches instead.'
},null,2)+'\n');
console.log(`wrote assets/moon-relief.png (${width}x${height}, ${min.toFixed(0)}..${max.toFixed(0)} m) + data/relief.json`);
