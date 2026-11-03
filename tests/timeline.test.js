import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  TIMELINE, indicatorX, fractionToOffset, timelineFractionFromSVGPoint,
  horizontalCTM, clientXToSVGX, timelineWidth
} from '../src/timeline.js';
const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('indicator x position maps offset linearly across the timeline width', () => {
  const total = 7 * 24;
  const x0 = indicatorX(0, total);
  const xFull = indicatorX(total, total);
  assert.equal(x0, TIMELINE.L);
  assert.equal(xFull, TIMELINE.W - TIMELINE.R);
  const middle = indicatorX(total / 2, total);
  assert.ok(Math.abs(middle - (x0 + xFull) / 2) < 1e-9);
});

test('timeline boundaries are respected when offsets are clamped', () => {
  const total = 7 * 24;
  assert.equal(indicatorX(-100, total), TIMELINE.L);
  assert.equal(indicatorX(1000, total), TIMELINE.W - TIMELINE.R);
  assert.equal(fractionToOffset(-0.5, total), 0);
  assert.equal(fractionToOffset(2, total), total);
});

test('fraction-to-offset converts a linear screen fraction into mission hours', () => {
  const total = 28 * 24;
  assert.equal(fractionToOffset(0, total), 0);
  assert.equal(fractionToOffset(1, total), total);
  assert.ok(Math.abs(fractionToOffset(0.5, total) - total / 2) < 1e-9);
});

test('SVG point fraction maps the full track region, clipping outside it', () => {
  const geometry = TIMELINE;
  assert.equal(timelineFractionFromSVGPoint({x: geometry.L}), 0);
  assert.equal(timelineFractionFromSVGPoint({x: geometry.W - geometry.R}), 1);
  assert.equal(timelineFractionFromSVGPoint({x: geometry.L - 50}), 0);
  assert.equal(timelineFractionFromSVGPoint({x: geometry.W + 100}), 1);
  const half = (geometry.L + (geometry.W - geometry.R)) / 2;
  assert.ok(Math.abs(timelineFractionFromSVGPoint({x: half}) - 0.5) < 1e-9);
});

test('screen coordinates convert through the SVG CTM with responsive scale', () => {
  // At 960px rendered 1:1 the CTM maps clientX directly.
  const ctm1x = {scale: 1, offsetX: 0};
  assert.equal(clientXToSVGX(TIMELINE.W - TIMELINE.R, ctm1x), TIMELINE.W - TIMELINE.R);
  // Half-scale responsive layout: SVG user units are 2x larger per CSS pixel.
  const ctmHalf = {scale: 0.5, offsetX: 40};
  const x = clientXToSVGX(200, ctmHalf);
  assert.ok(Math.abs(x - (200 - 40) / 0.5) < 1e-9);
  const fraction = timelineFractionFromSVGPoint({x});
  const withoutCtm = timelineFractionFromSVGPoint({x: 200});
  assert.notEqual(fraction, withoutCtm, 'CTM-aware conversion must differ from raw pixels');
});

test('horizontalCTM decomposes the SVG matrix without a DOM dependency', () => {
  const fakeSVG = {getScreenCTM: () => ({a: 1.2, e: 30})};
  assert.deepEqual(horizontalCTM(fakeSVG), {scale: 1.2, offsetX: 30});
  assert.equal(horizontalCTM(null), null);
  assert.equal(horizontalCTM({getScreenCTM: () => null}), null);
});

test('click-to-jump handler and pointer drag handlers are both wired in app.js', () => {
  assert.match(app, /pointerdown/);
  assert.match(app, /pointermove/);
  assert.match(app, /pointerup/);
  assert.match(app, /pointercancel/);
  assert.match(app, /setPointerCapture/);
  assert.match(app, /touch-action:\s*none/);
  assert.match(app, /getScreenCTM|horizontalCTM/);
  assert.match(app, /setOffset\(/);
  assert.match(app, /time-indicator/);
  assert.match(app, /indicator-triangle/);
  assert.match(app, /indicator-handle/);
});

test('indicator drag surface and appearance exist in the markup and CSS', () => {
  assert.match(html, /id="assistant-fab"/);
  assert.match(html, /id="assistant-root"/);
  assert.match(app, /id="timeline-hit"/);
  assert.match(app, /indicator-handle/);
  assert.match(css, /cursor:\s*col-resize/);
  assert.match(css, /touch-action:\s*none/);
});

test('timeline geometry stays consistent with the drawTimeline viewBox', () => {
  assert.equal(TIMELINE.W, 960);
  assert.equal(TIMELINE.L, 112);
  assert.equal(TIMELINE.R, 12);
  assert.equal(timelineWidth(), 960 - 112 - 12);
});

test('responsive SVG scaling does not corrupt the offset conversion', () => {
  // Rendered panel 600px wide, viewBox 960 units, 40px page offset.
  const scale = 600 / 960;
  const offsetX = 40;
  const ctm = {scale, offsetX};
  const clickAt = {x: 40 + scale * (TIMELINE.L + timelineWidth() / 2)};
  const svgX = clientXToSVGX(clickAt.x, ctm);
  const total = 7 * 24;
  const offset = fractionToOffset(timelineFractionFromSVGPoint({x: svgX}), total);
  assert.ok(Math.abs(offset - total / 2) < 0.01, `expected mid-window offset, got ${offset}`);
});