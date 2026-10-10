#!/usr/bin/env node
/**
 * Deployment preflight: verify the remote NASA LOLA 80S/80MPP GeoTIFF endpoint
 * and the pinned GeoTIFF.js browser bundle, without downloading the DEM.
 * This is a network-readiness check ONLY, not proof of browser CORS, valid DEM
 * projection or scientific accuracy. All checks report independently.
 */
const hosts=[
 {name:'NASA LOLA COG byte-range',url:'https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF',range:true},
 {name:'GeoTIFF.js browser library',url:'https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.js',range:false}
];
let failed=false;
for(const host of hosts){
 try{
  const method=host.range?'GET':'HEAD';
  const response=await fetch(host.url,{method,headers:host.range?{Range:'bytes=0-255'}:{},
    signal:AbortSignal.timeout(15000)});
  const size=Number(response.headers.get('content-length')||0);
  const ranges=response.headers.get('accept-ranges')||'not stated';
  const cors=response.headers.get('access-control-allow-origin')||'not stated';
  const ok=host.range?response.status===206:response.ok;
  const data={source:host.name,status:response.status,ok,contentLength:size,
    byteRanges:ranges,cors,responseType:response.headers.get('content-type')};
  if(host.range&&response.status===200){
    data.note='Server ignored Range: unsafe for browser COG loader. Response deliberately cancelled.';
  }
  await response.body?.cancel();
  console.log(JSON.stringify(data));
  if(!ok)failed=true;
 }catch(error){
   failed=true;console.error(JSON.stringify({source:host.name,ok:false,error:error.message}));
 }
}
if(failed){console.error('Remote terrain loading NOT certified. Application must fall back to geometric mode.');process.exitCode=1;}
