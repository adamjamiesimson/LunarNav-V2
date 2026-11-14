import {ephemeris} from './astro.js';
import {horizonAt,bodyVisible} from './mission.js';

export const MOON_RADIUS_KM = 1737.4;
export const HAVERSINE_MODEL = 'great-circle-spherical-lunar-surface-v1';
const DEG = Math.PI / 180;

// Great-circle surface distance in km (east-positive longitude, degrees).
export function greatCircleDistanceKm(lat1, lon1, lat2, lon2){
  const valid = v => Number.isFinite(v) && Math.abs(v) <= 90;
  const validLon = v => Number.isFinite(v) && Math.abs(v) <= 360;
  if(!valid(lat1) || !valid(lat2) || !validLon(lon1) || !validLon(lon2)){
    throw new Error('Invalid lunar coordinates for traverse');
  }
  const p1 = lat1 * DEG, p2 = lat2 * DEG;
  const dLat = (lat2 - lat1) * DEG;
  const dLon = ((lon2 - lon1 + 540) % 360 - 180) * DEG;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return MOON_RADIUS_KM * c;
}

export function totalDurationHours(distanceKm, speedKph, delayHours = 0){
  if(!Number.isFinite(distanceKm) || distanceKm < 0) throw new Error('Invalid traverse distance');
  if(!Number.isFinite(speedKph) || speedKph <= 0) throw new Error('Invalid rover speed');
  if(!Number.isFinite(delayHours) || delayHours < 0) throw new Error('Invalid operational delay');
  return distanceKm / speedKph + delayHours;
}

// Sample Sun and Earth at the origin over the traverse schedule. The model has no route terrain.
export function visibilityAlongTraverse({departureUTC, distanceKm, speedKph, delayHours = 0, lat, lon, profile = null, sampleHours = 1} = {}){
  const departure = new Date(departureUTC);
  if(Number.isNaN(departure.getTime())) throw new Error('Invalid traverse departure UTC time');
  if(!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('Invalid traverse coordinates');
  if(!(sampleHours >= 0.1 && sampleHours <= 48)) throw new Error('Invalid traverse visibility sampling step');
  const total = totalDurationHours(distanceKm, speedKph, delayHours);
  const count = Math.max(1, Math.ceil(total / sampleHours));
  const result = [];
  for(let i = 0; i <= count; i++){
    const hours = Math.min(total, i * sampleHours);
    const obs = ephemeris(new Date(departure.getTime() + hours * 3600000), lat, lon);
    const sunBarrier = horizonAt(profile, obs.sun.azimuth);
    const earthBarrier = horizonAt(profile, obs.earth.azimuth);
    result.push({
      offsetHours: hours,
      time: obs.time,
      sun: {azimuth: obs.sun.azimuth, elevation: obs.sun.elevation,
        visible: bodyVisible(profile,obs.sun.azimuth,obs.sun.elevation), exposedToSun: obs.sun.elevation > 0, horizonDeg: sunBarrier},
      earth:{azimuth: obs.earth.azimuth, elevation: obs.earth.elevation,
        visible: bodyVisible(profile,obs.earth.azimuth,obs.earth.elevation), geometricVisible: obs.earth.elevation > 0, horizonDeg: earthBarrier}
    });
  }
  return result;
}

export function summarizeTraverseVisibility(samples){
  const intervals = samples.slice(0, -1);
  const steps = Math.max(1, intervals.length);
  const percent = visible => 100 * intervals.filter(visible).length / steps;
  return {
    sunIlluminatedPct: percent(s => s.sun.visible),
    sunAboveFlatHorizonPct: percent(s => s.sun.exposedToSun),
    earthVisiblePct: percent(s => s.earth.visible),
    earthGeometricPct: percent(s => s.earth.geometricVisible),
    anyLimitedSolar: intervals.some(s => !s.sun.visible),
    anyEarthLimited: intervals.some(s => !s.earth.visible),
    terrainApplied: samples.some(s => (s.sun.horizonDeg || 0) > 0 || (s.earth.horizonDeg || 0) > 0),
    model: 'analytical-screening-v1 samples over geodesic traverse'
  };
}

export function estimateSurfaceTraverse({
  originLat, originLon, destinationLat, destinationLon,
  departUTC, speedKph = 10, delayHours = 0, profile = null, sampleHours = 1
} = {}){
  const distanceKm = greatCircleDistanceKm(originLat, originLon, destinationLat, destinationLon);
  const driveHours = distanceKm / speedKph;
  const totalHours = totalDurationHours(distanceKm, speedKph, delayHours);
  const departure = new Date(departUTC);
  if(Number.isNaN(departure.getTime())) throw new Error('Invalid traverse departure UTC time');
  const arrival = new Date(departure.getTime() + totalHours * 3600000);
  const samples = visibilityAlongTraverse({departureUTC: departUTC, distanceKm, speedKph, delayHours, lat: originLat, lon: originLon, profile, sampleHours});
  const summary = summarizeTraverseVisibility(samples);
  return {
    model: HAVERSINE_MODEL,
    origin: {lat: originLat, lon: originLon},
    destination: {lat: destinationLat, lon: destinationLon},
    distanceKm,
    speedKph,
    delayHours,
    drivingHours: driveHours,
    totalHours,
    departureUTC: departure.toISOString(),
    arrivalUTC: arrival.toISOString(),
    visibility: {...summary, samples},
    terrainProfileApplied: Boolean(profile),
    limitation: 'Geodesic surface-distance estimate on a spherical Moon. No slope, obstacle or traversability model; visibility screening does not guarantee safe rover movement.'
  };
}