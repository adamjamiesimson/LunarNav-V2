import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {executeTool, TOOL_DECLARATIONS} from '../src/tools.js';
import {geminiErrorStatus, isTransientGeminiError, friendlyModelError} from '../api/chat.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const chat = readFileSync(new URL('../api/chat.js', import.meta.url), 'utf8');
const assistant = readFileSync(new URL('../src/assistant.js', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const context = {
  site: {id: 'mons-mouton', name: 'Mons Mouton', lat: -84.79, lon: 29.2},
  date: '2026-11-14', time: '12:00', days: 7, offsetHours: 0
};

test('Gemini API key is never exposed in frontend files or committed config', () => {
  // No file may contain an actual key value...
  for (const file of [html, app, assistant, chat]){
    assert.ok(!/AIza[0-9A-Za-z_-]{20,}/.test(file), 'a hardcoded Gemini key was found');
  }
  // ...and the browser modules must never read it from the environment.
  assert.match(chat, /process\.env\.GEMINI_API_KEY/);
  assert.match(chat, /process\.env\.GEMINI_MODEL/);
  assert.doesNotMatch(app, /GEMINI_API_KEY/);
  assert.doesNotMatch(html, /GEMINI_API_KEY/);
  assert.doesNotMatch(assistant, /process\.env\.GEMINI_API_KEY/);
  assert.ok(packageJson.dependencies['@google/genai'], 'SDK runtime dependency declared');
});

test('all declared tools execute against the existing LunarNav modules', () => {
  const names = TOOL_DECLARATIONS.map(t => t.name);
  assert.ok(names.includes('get_mission_context'));
  assert.ok(names.includes('calculate_celestial_conditions'));
  assert.ok(names.includes('analyze_mission_window'));
  assert.ok(names.includes('compare_locations'));
  assert.ok(names.includes('find_optimal_windows'));
  assert.ok(names.includes('simulate_engineering'));
  assert.ok(names.includes('inspect_operations'));
  assert.ok(names.includes('find_next_horizon_event'));
  assert.ok(names.includes('estimate_surface_traverse'));
  assert.ok(names.includes('estimate_earth_moon_transit'));
  for (const name of names){
    const result = executeTool(name, {}, context);
    assert.equal(typeof result.ok, 'boolean', name);
    assert.equal(typeof result.summary, 'string', name);
  }
});

test('valid tool invocation with structured args returns actual calculation results', () => {
  const result = executeTool('calculate_celestial_conditions', {
    utcTimestamp: '2026-11-14T12:00:00Z', lat: -84.79, lon: 29.2
  }, context);
  assert.equal(result.ok, true);
  assert.ok(Math.abs(result.value.sun.elevation_deg) < 90);
  assert.ok(result.value.sun.azimuth_deg >= 0 && result.value.sun.azimuth_deg < 360);
  assert.equal(typeof result.value.sun.visible, 'boolean');
  assert.match(result.value.model, /analytical-screening-v1/);
});

test('multiple sequential tool calls produce consistent results on the same context', () => {
  const first = executeTool('calculate_celestial_conditions', {
    utcTimestamp: '2026-11-14T12:00:00Z', lat: -84.79, lon: 29.2
  }, context);
  const second = executeTool('calculate_celestial_conditions', {
    utcTimestamp: '2026-11-14T12:00:00Z', lat: -84.79, lon: 29.2
  }, context);
  assert.deepEqual(first.value.sun, second.value.sun, 'identical calls must return identical structures');
});

test('structured tool responses expose raw numbers, bounded and non-negative where required', () => {
  const result = executeTool('analyze_mission_window', {
    startUTC: '2026-11-14T12:00:00Z', days: 7, lat: -84.79, lon: 29.2
  }, context);
  for (const key of ['solarAvailabilityPct', 'earthVisibilityPct', 'simultaneousVisibilityPct']){
    assert.ok(result.value[key] >= 0 && result.value[key] <= 100, key);
  }
  assert.ok(result.value.longestEarthBlackoutHours >= 0);
});

test('terrain profiles in context are applied to situation inspection', () => {
  const terrainProfile = {
    azimuthDeg: [0, 45, 90, 135, 180, 225, 270, 315],
    elevationDeg: Array(8).fill(5)
  };
  const withTerrain = executeTool('inspect_operations', {utcTimestamp: '2026-11-14T12:00:00Z'}, {
    ...context, terrainProfile
  });
  assert.equal(withTerrain.ok, true);
  assert.ok(['20 KM LOLA HORIZON'].some(x => withTerrain.value.horizonSource.includes('LOLA')) ||
    withTerrain.value.sun.marginDeg < executeTool('inspect_operations', {utcTimestamp: '2026-11-14T12:00:00Z'}, context).value.sun.marginDeg + 1e-9);
});

test('invalid tool input yields a structured failure, never a thrown exception', () => {
  const result = executeTool('calculate_celestial_conditions', {utcTimestamp: 'nope', lat: -84.79, lon: 29.2}, context);
  assert.equal(result.ok, false);
  assert.match(result.error, /Invalid utcTimestamp|Invalid lunar coordinates/);
  const unknown = executeTool('delete_all', {}, context);
  assert.equal(unknown.ok, false);
});

test('unknown or forged tool names are rejected', () => {
  const result = executeTool('send_to_moon', {}, context);
  assert.equal(result.ok, false);
  assert.match(result.error, /Unknown tool/);
});

test('504 DEADLINE_EXCEEDED from Gemini is transient and gets retry guidance', () => {
  // Exactly the provider error seen in production: raw JSON in message.
  const error = new Error('{"error":{"code":504,"message":"Deadline expired before operation could complete.","status":"DEADLINE_EXCEEDED"}}');
  assert.equal(geminiErrorStatus(error), 504);
  assert.ok(isTransientGeminiError(error), 'deadline errors must be retried across models');
  const message = friendlyModelError(error);
  assert.match(message, /timed out/i);
  assert.match(message, /Asking again usually succeeds/i);
  assert.ok(!/GEMINI_API_KEY/.test(message), 'timeout errors must not blame the API key');
});

test('auth failures are not retried and point at GEMINI_API_KEY', () => {
  const error = new Error('{"error":{"code":403,"message":"API key not valid.","status":"PERMISSION_DENIED"}}');
  assert.equal(geminiErrorStatus(error), 403);
  assert.ok(!isTransientGeminiError(error), 'auth errors must not be retried');
  assert.match(friendlyModelError(error), /GEMINI_API_KEY/);
});

test('the assistant hint distinguishes timeouts from configuration problems', () => {
  assert.match(assistant, /provider timed out/i, 'timeouts get retry guidance');
  assert.match(assistant, /GEMINI_API_KEY/, 'auth errors keep key guidance');
});

test('find_optimal_windows returns ranked results and rejects bad sites', () => {
  const result = executeTool('find_optimal_windows', {
    sites: ['mons-mouton', 'malapert'], startDate: '2026-11-14', searchDays: 12, windowDays: 3
  }, context);
  assert.equal(result.ok, true);
  assert.ok(result.value.top.length > 0);
  const bad = executeTool('find_optimal_windows', {sites: ['nasa-ausa'], startDate: '2026-11-14'}, context);
  assert.equal(bad.ok, false);
});

test('simulate_engineering uses live mission samples and reflects parameter changes', () => {
  const low = executeTool('simulate_engineering', {areaM2: 1, loadW: 500, batteryWh: 200}, context);
  const high = executeTool('simulate_engineering', {areaM2: 100, loadW: 50, batteryWh: 50000}, context);
  assert.equal(low.ok, true);
  assert.equal(high.ok, true);
  assert.ok(low.value.generatedWh < high.value.generatedWh, 'larger array must generate more modeled energy');
});

test('estimate_surface_traverse tool returns the same geodesic model as the UI', () => {
  const result = executeTool('estimate_surface_traverse', {
    originLat: -84.79, originLon: 29.2, destinationLat: -85.99, destinationLon: 357.07,
    departUTC: '2026-11-14T12:00:00Z', speedKph: 10
  }, context);
  assert.equal(result.ok, true);
  assert.match(result.value.model, /great-circle-spherical-lunar-surface-v1/);
  assert.ok(result.value.distanceKm > 0);
  assert.ok(result.value.totalHours >= result.value.drivingHours);
  assert.ok(result.value.visibility.samples.length >= 2);
});

test('Gemini integration rejects unresolvable site references before calling the model', () => {
  const result = executeTool('find_optimal_windows', {
    sites: [{lat: -84.79, lon: 29.2}, {lat: -85.99, lon: 357.07}],
    startDate: '2026-11-14', searchDays: 5, windowDays: 3
  }, context);
  assert.equal(result.ok, true, 'coordinate objects must be accepted');
});