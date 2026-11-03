import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOON_RADIUS_KM, greatCircleDistanceKm, totalDurationHours,
  visibilityAlongTraverse, summarizeTraverseVisibility, estimateSurfaceTraverse
} from '../src/travel.js';

test('great-circle distance between identical coordinates is zero', () => {
  assert.equal(greatCircleDistanceKm(-84.79, 29.2, -84.79, 29.2), 0);
  assert.ok(greatCircleDistanceKm(-84.79, 29.2, -84.79, 29.2 - 360) < 1e-9, 'equivalent longitudes');
});

test('great-circle distance across different lunar coordinates is plausible and symmetric', () => {
  // Mons Mouton (-84.79, 29.2) to Malapert (-85.99, 357.07): ~85 km, southern highlands.
  const a = greatCircleDistanceKm(-84.79, 29.2, -85.99, 357.07);
  const b = greatCircleDistanceKm(-85.99, 357.07, -84.79, 29.2);
  assert.ok(a > 50 && a < 150, `distance ${a} km outside expected band`);
  assert.ok(Math.abs(a - b) < 1e-9, 'distance is symmetric');
  // Full out-of-phase longitude separation at the pole is bounded by the half circumference.
  const far = greatCircleDistanceKm(-89.9, 0, -89.9, 180);
  assert.ok(far > 0 && far <= Math.PI * MOON_RADIUS_KM);
});

test('invalid coordinates are rejected', () => {
  assert.throws(() => greatCircleDistanceKm(0, 0, 200, 0), /Invalid lunar coordinates/);
  assert.throws(() => greatCircleDistanceKm(0, 0, 0, 500), /Invalid lunar coordinates/);
  assert.throws(() => greatCircleDistanceKm(NaN, 0, 0, 0), /Invalid lunar coordinates/);
});

test('longitude wrapping uses the shortest angular separation', () => {
  // Antarctica-spanning points near +179° and -179° should be only ~2° apart.
  const short = greatCircleDistanceKm(-88, 179, -88, -179);
  const roundTrip = greatCircleDistanceKm(-88, 179, -88, 181);
  assert.ok(short < 10, `expected small distance, got ${short}`);
  assert.ok(Math.abs(short - roundTrip) < 1e-6);
});

test('driving time equals distance/speed; total adds the operational delay', () => {
  assert.equal(totalDurationHours(100, 10, 0), 10);
  assert.equal(totalDurationHours(100, 10, 5), 15);
  assert.equal(totalDurationHours(84.83490420200594, 10, 2), 84.83490420200594 / 10 + 2);
  assert.throws(() => totalDurationHours(100, 0), /Invalid rover speed/);
  assert.throws(() => totalDurationHours(100, 10, -1), /Invalid operational delay/);
  assert.throws(() => totalDurationHours(-1, 10), /Invalid traverse distance/);
});

test('different rover speeds produce inversely proportional drive times', () => {
  const r1 = estimateSurfaceTraverse({
    originLat: -84.79, originLon: 29.2, destinationLat: -85.99, destinationLon: 357.07,
    departUTC: '2026-11-14T12:00:00Z', speedKph: 5
  });
  const r2 = estimateSurfaceTraverse({
    originLat: -84.79, originLon: 29.2, destinationLat: -85.99, destinationLon: 357.07,
    departUTC: '2026-11-14T12:00:00Z', speedKph: 20
  });
  assert.ok(Math.abs(r1.drivingHours - r2.drivingHours * 4) < 1e-9, 'drive time scales inversely with speed');
  assert.equal(r1.distanceKm, r2.distanceKm);
});

test('UTC date transitions are handled: arrival lands the next UTC day when the traverse crosses midnight', () => {
  const result = estimateSurfaceTraverse({
    originLat: -84.79, originLon: 29.2, destinationLat: -85.99, destinationLon: 357.07,
    departUTC: '2026-11-14T23:00:00Z', speedKph: 5, delayHours: 2
  });
  assert.equal(result.departureUTC.slice(0, 10), '2026-11-14');
  assert.ok(new Date(result.arrivalUTC).getTime() > new Date(result.departureUTC).getTime());
  assert.ok(new Date(result.arrivalUTC).getUTCDate() !== 14, 'arrival should cross into the next UTC day');
});

test('visibility sampling evaluates Sun and Earth along the journey with flat geometric horizon', () => {
  const result = estimateSurfaceTraverse({
    originLat: -84.79, originLon: 29.2, destinationLat: -85.99, destinationLon: 357.07,
    departUTC: '2026-11-14T12:00:00Z', speedKph: 10
  });
  assert.ok(result.visibility.samples.length >= 2, 'must have sampled visibility points');
  for (const sample of result.visibility.samples){
    assert.ok(Number.isFinite(sample.sun.elevation));
    assert.ok(Number.isFinite(sample.earth.elevation));
    assert.equal(typeof sample.sun.visible, 'boolean');
    assert.equal(typeof sample.earth.visible, 'boolean');
  }
  assert.ok(result.visibility.sunIlluminatedPct >= 0 && result.visibility.sunIlluminatedPct <= 100);
  assert.ok(result.visibility.earthVisiblePct >= 0 && result.visibility.earthVisiblePct <= 100);
  assert.match(result.limitation, /Geodesic surface-distance estimate/);
});

test('continuous solar illumination is not confused with guaranteed safe traversability', () => {
  const result = estimateSurfaceTraverse({
    originLat: -84.79, originLon: 29.2, destinationLat: -85.99, destinationLon: 357.07,
    departUTC: '2026-11-14T12:00:00Z', speedKph: 10
  });
  assert.match(result.limitation, /no slope, obstacle or traversability model/i);
  assert.match(result.limitation, /does not guarantee safe rover movement/i);
});

test('traverse results distinguish driving duration from total traverse duration', () => {
  const result = estimateSurfaceTraverse({
    originLat: -84.79, originLon: 29.2, destinationLat: -85.99, destinationLon: 357.07,
    departUTC: '2026-11-14T12:00:00Z', speedKph: 10, delayHours: 3
  });
  assert.equal(result.totalHours, result.drivingHours + result.delayHours);
  assert.equal(result.delayHours, 3);
  assert.ok(result.totalHours > result.drivingHours);
});

test('missing terrain information is reported and flat horizon used', () => {
  const result = estimateSurfaceTraverse({
    originLat: -84.79, originLon: 29.2, destinationLat: -85.99, destinationLon: 357.07,
    departUTC: '2026-11-14T12:00:00Z', speedKph: 10
  });
  assert.equal(result.terrainProfileApplied, false);
  assert.equal(result.visibility.terrainApplied, false);
});

test('valid terrain horizon profile is applied to origin visibility sampling', () => {
  const profile = {
    azimuthDeg: [0, 45, 90, 135, 180, 225, 270, 315],
    elevationDeg: Array(8).fill(4)
  };
  const result = estimateSurfaceTraverse({
    originLat: -84.79, originLon: 29.2, destinationLat: -85.99, destinationLon: 357.07,
    departUTC: '2026-11-14T12:00:00Z', speedKph: 10, profile
  });
  assert.equal(result.terrainProfileApplied, true);
  assert.equal(result.visibility.terrainApplied, true);
});

test('invalid traverse inputs are rejected clearly', () => {
  assert.throws(() => estimateSurfaceTraverse({
    originLat: -84.79, originLon: 29.2, destinationLat: -85.99, destinationLon: 357.07,
    departUTC: 'not-a-date'
  }), /departure UTC/);
  assert.throws(() => estimateSurfaceTraverse({
    originLat: -84.79, originLon: 29.2, destinationLat: -85.99, destinationLon: 357.07,
    departUTC: '2026-11-14T12:00:00Z', speedKph: 0
  }), /Invalid traverse distance|Invalid rover speed/);
});