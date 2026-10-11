/**
 * Portable derived terrain profiles. Only allow compact, versioned data
 * with exact NASA COG provenance and coordinates matching the selected site.
 * Profiles contain 72 *derived* horizon angles, not the original NASA DEM.
 * They are still exploratory and not separately raytrace or flight validated.
 */
import {LOLA_COG} from './terrain.js';

export const TERRAIN_CACHE_VERSION='lola-local-horizon-v1';
export function validateProfile(site,profile){
  if(!site||!profile||typeof profile!=='object')return false;
  if(profile.siteId!==site.id||
     Math.abs(profile.lat-site.lat)>1e-6||Math.abs(profile.lon-site.lon)>1e-6||
     profile.datasetUrl!==LOLA_COG||
     profile.radiusKm!==20||profile.stepMeters!==200||
     Math.abs(profile.resolutionM-80)>0.01||
     !(profile.coveragePct>=95&&profile.coveragePct<=100))return false;
  const az=profile.azimuthDeg,el=profile.elevationDeg;
  if(!Array.isArray(az)||!Array.isArray(el)||az.length!==72||el.length!==72)return false;
  if(!Number.isFinite(profile.observerHeightM))return false;
  return az.every((v,i)=>Number.isFinite(v)&&Math.abs(v-i*5)<1e-6) &&
    el.every(v=>Number.isFinite(v)&&v>=0&&v<=90);
}
export function importVerifiedCache(catalog,sites){
  if(!catalog||catalog.algorithm!==TERRAIN_CACHE_VERSION||
     !catalog.generatedUtc||!Number.isFinite(Date.parse(catalog.generatedUtc))||
     catalog.datasetUrl!==LOLA_COG||!catalog.profiles||
     typeof catalog.profiles!=='object')return [];
  const entries=[];
  for(const site of sites){
    const p=catalog.profiles[site.id];
    if(!p)continue;
    if(!validateProfile(site,p))continue;
    entries.push({site,profile:{
      ...p,verifiedSource:true,provenance:'Bundled NASA-derived profile, exported in GitHub Actions; geospatial raytrace not independently validated',
      source:'NASA GSFC PGDA LOLA 80m-derived local horizon (archived)'
    }});
  }
  return entries;
}
export async function loadBundledTerrain(sites,{fetcher=fetch}={}){
  const response=await fetcher('/data/lola-horizons.json',{cache:'no-cache'});
  if(!response.ok)throw Error('Bundled terrain catalog not available (HTTP '+response.status+')');
  return importVerifiedCache(await response.json(),sites);
}
