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
console.error('Preparing a single local copy of the official NASA 80m COG for reproducible multi-site processing…');
const response=await fetch(LOLA_COG,{signal:AbortSignal.timeout(100000)});
if(response.status!==200)throw Error('NASA refused whole-file download (HTTP '+response.status+'); cannot generate trusted offline profiles');
const bytes=Number(response.headers.get('content-length')||0);
if(bytes>250000000)throw Error('Refusing unexpectedly large terrain dataset');
const downloaded=await response.arrayBuffer();
if(downloaded.byteLength<10000000 || downloaded.byteLength>250000000)
  throw Error('Unexpected or truncated NASA elevation download: '+downloaded.byteLength+' bytes');
const file=new Blob([downloaded],{type:'image/tiff'});
console.error('Loaded '+(downloaded.byteLength/1000000).toFixed(1)+' MB official NASA COG locally; network not used for each site patch.');
const profiles={};
for(const site of SITES){
  console.error('Deriving real NASA LOLA horizon: '+site.name);
  const profile=await loadLolaTerrain(site,{file,onProgress:s=>console.error(site.id+': '+s)});
  if(profile.coveragePct<80)throw Error('Refusing to archive incomplete horizon: '+site.name);
  if(profile.elevationDeg.some(x=>!Number.isFinite(x)||x<0||x>90))
    throw Error('Refusing to archive non-finite terrain horizon: '+site.name);
  profiles[site.id]={
    lat:site.lat,lon:site.lon,
    azimuthDeg:profile.azimuthDeg,
    elevationDeg:profile.elevationDeg,
    observerHeightM:profile.observerHeightM,
    coveragePct:profile.coveragePct,
    radiusKm:profile.radiusKm,
    resolutionM:profile.resolutionM,
    stepMeters:profile.stepMeters,
    source:'NASA GSFC PGDA LOLA 80m south-polar DEM',
    provenance:'Actual full NASA COG fetched from official URL, patches locally decoded in GitHub Actions',
    verifiedSource:true,
    datasetUrl:LOLA_COG
  };
  console.error('Site complete: '+site.name+', '+profile.coveragePct.toFixed(1)+'% coverage');
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
