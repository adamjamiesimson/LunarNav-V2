#!/usr/bin/env node
/**
 * Read a *real* NASA PGDA LOLA 80m local patch, no artificial raster.
 * Requires temporary CI dependency: npm install --no-save --no-package-lock geotiff@2.1.3
 * Fails closed if a real NASA raster cannot be opened and sampled.
 *
 * The computed horizon still uses provisional MOON_ME stereographic X/Y
 * assumptions. This test checks one real surface location only.
 */
import * as GeoTIFF from 'geotiff';
import {SITES} from '../src/sites.js';
import {LOLA_COG,polarXY,loadLolaTerrain} from '../src/terrain.js';
globalThis.GeoTIFF=GeoTIFF;
const site=SITES.find(s=>s.id==='mons-mouton');
if(!site)throw Error('Mons Mouton not in site catalog');
const tiff=await GeoTIFF.fromUrl(LOLA_COG);
const image=await tiff.getImage();
const origin=image.getOrigin(),resolution=image.getResolution(),box=image.getBoundingBox();
const xy=polarXY(site.lat,site.lon);
const xPixel=(xy.x-origin[0])/resolution[0],yPixel=(xy.y-origin[1])/resolution[1];
const metadata={source:LOLA_COG,site:site.name,coordinates:[site.lat,site.lon],xy,
 origin,resolution,box,width:image.getWidth(),height:image.getHeight(),
 pixelColumn:xPixel,pixelRow:yPixel,geoKeys:image.getGeoKeys()};
console.log('ACTUAL LOLA GEOTIFF METADATA:',JSON.stringify(metadata,null,2));
if(!(xPixel>=0&&xPixel<image.getWidth()&&yPixel>=0&&yPixel<image.getHeight()))
 throw Error('Computed stereographic coordinates do not map within NASA DEM');
const profile=await loadLolaTerrain(site,{onProgress:m=>console.log('NASA LOLA:',m)});
if(!profile.verifiedSource||profile.coveragePct<80)
 throw Error('Real DEM horizon did not pass source/coverage requirements');
const angular=profile.elevationDeg;
const result={
  site:site.name,source:profile.source,provenance:profile.provenance,
  resolutionM:profile.resolutionM,coveragePct:profile.coveragePct,
  observerElevationM:profile.observerHeightM,searchRadiusKm:profile.radiusKm,
  azimuthBins:angular.length,
  minHorizonDeg:Math.min(...angular),maxHorizonDeg:Math.max(...angular),
  averageHorizonDeg:angular.reduce((a,b)=>a+b,0)/angular.length,
  samplesDeg:{north:angular[0],east:angular[18],south:angular[36],west:angular[54]}
};
console.log('ACTUAL LOLA LOCAL HORIZON RESULT:',JSON.stringify(result,null,2));
