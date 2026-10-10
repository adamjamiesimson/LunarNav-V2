#!/usr/bin/env node
/**
 * Derive portable 20 km horizon profiles directly from real NASA LOLA data.
 * This is a reproducible ONE-OFF data preparation script for known site
 * coordinates, NOT a simulator and NOT independent terrain raytrace validation.
 *
 * Run: npm install --no-save --no-package-lock geotiff@2.1.3
 *      node scripts/generate-lola-profiles.js
 * Requires remote byte-range access to NASA GSFC PGDA.
 */
import * as GeoTIFF from 'geotiff';
import {SITES} from '../src/sites.js';
import {LOLA_COG,loadLolaTerrain} from '../src/terrain.js';
globalThis.GeoTIFF=GeoTIFF;
const profiles={};
for(const site of SITES){
  console.error('Fetching real NASA LOLA horizon: '+site.name);
  let profile,lastError;
  for(let attempt=1;attempt<=4;attempt++){
    try{
      profile=await loadLolaTerrain(site,{onProgress:s=>console.error(site.id+' attempt '+attempt+': '+s)});
      break;
    }catch(error){
      lastError=error;
      console.error('NASA tile request failed at '+site.name+' attempt '+attempt+': '+error.message);
      if(attempt<4)await new Promise(resolve=>setTimeout(resolve,800*attempt));
    }
  }
  if(!profile)throw Error('Cannot publish terrain data for '+site.name+' after retries: '+lastError?.message);
  if(!profile.verifiedSource||profile.coveragePct<80)
    throw Error('Refusing to archive incomplete/non-NASA profile: '+site.name);
  const entries=profile.elevationDeg;
  if(entries.some(x=>!Number.isFinite(x)||x<0||x>90))throw Error('Invalid terrain horizon for '+site.name);
  profiles[site.id]={
    lat:site.lat,lon:site.lon,
    azimuthDeg:profile.azimuthDeg,
    elevationDeg:profile.elevationDeg,
    observerHeightM:profile.observerHeightM,
    coveragePct:profile.coveragePct,
    radiusKm:profile.radiusKm,
    resolutionM:profile.resolutionM,
    stepMeters:profile.stepMeters,
    source:profile.source,
    provenance:'NASA GSFC PGDA LOLA 80m COG, derived from real DEM in GitHub Actions',
    verifiedSource:true,
    datasetUrl:LOLA_COG
  };
}
const output={
  algorithm:'lola-local-horizon-v1',
  generatedUtc:new Date().toISOString(),
  dataCitation:'Barker et al. (2023), NASA GSFC PGDA, DOI 10.60903/gsfcpgda-lola-spole',
  datasetUrl:LOLA_COG,
  interpretation:'80m/pixel LOLA MOON_ME south-polar stereographic, 20 km 72-bin horizon using provisional numerical ray casting; not independently terrain validated or flight-qualified',
  profiles
};
console.log('REAL_LOLA_PROFILES_BEGIN');
console.log(JSON.stringify(output));
console.log('REAL_LOLA_PROFILES_END');
