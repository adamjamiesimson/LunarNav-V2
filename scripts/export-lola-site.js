#!/usr/bin/env node
// Export 72 horizon angles from the NASA 80 m COG.
// Usage: node scripts/export-lola-site.js <site-id>
import * as GeoTIFF from 'geotiff';
import {SITES} from '../src/sites.js';
import {loadLolaTerrain,LOLA_COG} from '../src/terrain.js';

const site=SITES.find(s=>s.id===process.argv[2]);
if(!site)throw Error('Unknown site; choose: '+SITES.map(s=>s.id).join(', '));
globalThis.GeoTIFF=GeoTIFF;
let profile=null;
for(let attempt=1;attempt<=3;attempt++){
  try {
    console.error('NASA LOLA '+site.id+' attempt '+attempt);
    profile=await loadLolaTerrain(site,{onProgress:m=>console.error(site.id+': '+m)});
    break;
  } catch (error) {
    console.error(site.id+' attempt '+attempt+' failed: '+error.message);
    if(attempt<3)await new Promise(resolve=>setTimeout(resolve,1000*attempt));
  }
}
if(!profile){
  console.log('LOLA_PROFILE_UNAVAILABLE:'+site.id);
  process.exitCode=1;
}else{
  if(profile.coveragePct<95||profile.elevationDeg.length!==72||
      profile.elevationDeg.some(x=>!Number.isFinite(x)||x<0||x>90))
    throw Error('NASA profile failed quality checks for '+site.id);
  const output={
    siteId:site.id,lat:site.lat,lon:site.lon,
    azimuthDeg:profile.azimuthDeg,
    elevationDeg:profile.elevationDeg.map(x=>Number(x.toFixed(6))),
    radiusKm:profile.radiusKm,resolutionM:profile.resolutionM,
    stepMeters:profile.stepMeters,coveragePct:profile.coveragePct,
    observerHeightM:profile.observerHeightM,
    source:'NASA GSFC PGDA LOLA LDEM_80S_80MPP_ADJ.TIF',
    datasetUrl:LOLA_COG,
    extraction:'LunarNav 20 km local-horizon-v1, 5 degree azimuth, 200 m radial samples',
    note:'Computed using NASA elevation pixels; derived horizon is experimental, not independently raytrace-validated.'
  };
  console.log('LOLA_PROFILE_JSON:'+JSON.stringify(output));
}
