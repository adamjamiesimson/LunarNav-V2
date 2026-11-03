import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRANSIT_PROFILES, formatHours, transitPhases, estimateEarthMoonTransit
} from '../src/transit.js';
import {executeTool, TOOL_DECLARATIONS} from '../src/tools.js';
import {executeBrowserTool, configureAssistantState} from '../src/tool-executor.js';

const MONS_MOUTON = {id: 'mons-mouton', name: 'Mons Mouton', lat: -84.79, lon: 29.2};

test('direct transfer profile is a nominal 3–4 day reference, not a distance/speed division', () => {
  assert.equal(TRANSIT_PROFILES.direct.id, 'direct');
  assert.equal(TRANSIT_PROFILES.direct.referenceHours, 84); // 3.5 days
  assert.deepEqual(TRANSIT_PROFILES.direct.rangeHours, [72, 96]);
  // Extended profile is a longer low-energy reference.
  assert.ok(TRANSIT_PROFILES.extended.referenceHours > TRANSIT_PROFILES.direct.referenceHours);
  assert.equal(TRANSIT_PROFILES.custom.referenceHours, null);
});

test('estimateEarthMoonTransit forward mode: departure anchors arrival time', () => {
  const r = estimateEarthMoonTransit({
    destination: MONS_MOUTON, profile: 'direct',
    departUTC: '2026-11-10T12:00:00Z', scheduleMode: 'depart'
  });
  assert.equal(r.departureUTC, '2026-11-10T12:00:00.000Z');
  assert.equal(r.arrivalUTC, '2026-11-14T00:00:00.000Z');
  assert.equal(r.totalTransitHours, 84);
  assert.equal(r.model, 'earth-moon-transit-reference-durations-v1');
  assert.match(r.limitation, /NOT a trajectory solver/);
  assert.equal(r.destination.name, 'Mons Mouton');
});

test('backward landing mode: desired landing date back-computes the departure', () => {
  const land = '2026-11-20T00:00:00Z';
  const r = estimateEarthMoonTransit({
    destination: MONS_MOUTON, profile: 'direct',
    landingUTC: land, scheduleMode: 'land'
  });
  assert.equal(r.arrivalUTC, new Date(land).toISOString());
  assert.equal(r.scheduleMode, 'land');
  assert.equal(r.departureUTC, '2026-11-16T12:00:00.000Z');
});

test('extended and custom profiles change the total transit duration', () => {
  const ext = estimateEarthMoonTransit({destination: MONS_MOUTON, profile: 'extended', departUTC: '2026-11-10T12:00:00Z', scheduleMode: 'depart'});
  assert.ok(ext.totalTransitHours > 96, 'extended is > 96h');
  const custom = estimateEarthMoonTransit({destination: MONS_MOUTON, profile: 'custom', referenceHours: 200, departUTC: '2026-11-10T12:00:00Z', scheduleMode: 'depart'});
  assert.equal(custom.totalTransitHours, 200);
  assert.ok(new Date(custom.arrivalUTC) - new Date(custom.departureUTC) === 200 * 3600000);
});

test('invalid inputs are rejected clearly', () => {
  // Unknown profiles fall back to the direct reference rather than throwing
  // (graceful degrade by design); genuinely invalid values still throw.
  assert.equal(estimateEarthMoonTransit({destination: MONS_MOUTON, profile: 'bogus', departUTC: '2026-11-10T12:00:00Z'}).profile, 'direct');
  assert.throws(() => estimateEarthMoonTransit({destination: MONS_MOUTON, profile: 'custom', referenceHours: -5, departUTC: '2026-11-10T12:00:00Z'}), /Invalid transit duration/);
  assert.throws(() => estimateEarthMoonTransit({destination: {lat: 999, lon: 0}, profile: 'direct', departUTC: '2026-11-10T12:00:00Z'}), /Invalid lunar destination coordinates/);
  assert.throws(() => estimateEarthMoonTransit({destination: MONS_MOUTON, profile: 'direct', departUTC: null, landingUTC: null}), /Provide either a departure or a landing/);
});

test('phase breakdown separates arrival, LOI, descent and touchdown, and sums to total', () => {
  const r = estimateEarthMoonTransit({destination: MONS_MOUTON, profile: 'direct', departUTC: '2026-11-10T12:00:00Z', scheduleMode: 'depart'});
  const phaseNames = r.phases.map(p => p.phase);
  assert.ok(phaseNames.some(n => /Earth departure/.test(n)));
  assert.ok(phaseNames.some(n => /Lunar transfer/.test(n)));
  assert.ok(phaseNames.some(n => /LOI/.test(n)));
  assert.ok(phaseNames.some(n => /Descent/.test(n)));
  assert.ok(phaseNames.some(n => /touchdown/i.test(n)));
  const sum = r.phases.reduce((a, p) => a + p.durationHours, 0);
  assert.ok(Math.abs(sum - r.totalTransitHours) < 0.01, `phases sum ${sum} ≈ total ${r.totalTransitHours}`);
  // Phases are timestamped relative to the departure.
  assert.equal(r.phases[0].startUTC, '2026-11-10T12:00:00.000Z');
});

test('formatHours renders sensible labels and never fabricates precision', () => {
  assert.equal(formatHours(0), '0 h');
  assert.equal(formatHours(12), '12 h');
  assert.equal(formatHours(84), '3 d 12 h');
  assert.equal(formatHours(180), '7 d 12 h');
});

test('the landing site coordinates do not change the Earth–Moon transit duration', () => {
  const a = estimateEarthMoonTransit({destination: {id: 'shackleton', name: 'Shackleton Rim', lat: -89.9, lon: 180}, profile: 'direct', departUTC: '2026-11-10T12:00:00Z', scheduleMode: 'depart'});
  const b = estimateEarthMoonTransit({destination: {id: 'malapert', name: 'Malapert Region', lat: -85.99, lon: 357.07}, profile: 'direct', departUTC: '2026-11-10T12:00:00Z', scheduleMode: 'depart'});
  assert.equal(a.totalTransitHours, b.totalTransitHours);
  assert.notEqual(a.destination.name, b.destination.name);
});

test('transit tool is declared and executes in the server tool layer', () => {
  assert.ok(TOOL_DECLARATIONS.some(t => t.name === 'estimate_earth_moon_transit'));
  const result = executeTool('estimate_earth_moon_transit', {
    profile: 'direct', departUTC: '2026-11-10T12:00:00Z', scheduleMode: 'depart'
  }, {
    site: {id: 'mons-mouton', name: 'Mons Mouton', lat: -84.79, lon: 29.2},
    date: '2026-11-14', time: '12:00', days: 7, isCustom: false
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.destination.name, 'Mons Mouton');
  assert.equal(result.value.totalTransitHours, 84);
  assert.equal(typeof result.summary, 'string');
});

test('transit tool defaults to the context landing site and handles site id', () => {
  const result = executeTool('estimate_earth_moon_transit', {
    profile: 'extended', landingUTC: '2026-12-01T00:00:00Z', scheduleMode: 'land', destinationSiteId: 'shackleton'
  }, {site: {id: 'mons-mouton', name: 'Mons Mouton', lat: -84.79, lon: 29.2}, date: '2026-11-14', time: '12:00', days: 7, isCustom: false});
  assert.equal(result.ok, true);
  assert.equal(result.value.destination.name, 'Shackleton Rim');
  assert.equal(result.value.scheduleMode, 'land');
  // Arrival equals the desired landing date.
  assert.equal(result.value.arrivalUTC, '2026-12-01T00:00:00.000Z');
});

test('transit tool rejects unknown site ids', () => {
  const result = executeTool('estimate_earth_moon_transit', {profile: 'direct', destinationSiteId: 'nasa-ausa', departUTC: '2026-11-10T12:00:00Z'}, {site: {id: 'mons-mouton', name: 'Mons Mouton', lat: -84.79, lon: 29.2}, date: '2026-11-14', time: '12:00', days: 7});
  assert.equal(result.ok, false);
  assert.match(result.error, /Unknown LunarNav site id/);
});

test('browser tool executor mirrors the server transit tool', () => {
  configureAssistantState(() => ({site: {id: 'mons-mouton', name: 'Mons Mouton', lat: -84.79, lon: 29.2}, isCustom: false}));
  const result = executeBrowserTool('estimate_earth_moon_transit', {
    profile: 'direct', departUTC: '2026-11-10T12:00:00Z', scheduleMode: 'depart'
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.totalTransitHours, 84);
  assert.equal(result.value.destination.id, 'mons-mouton');
});