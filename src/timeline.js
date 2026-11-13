/**
 * Operational Visibility timeline : pure geometry and coordinate mapping.
 *
 * Kept framework-free so the drag math can be unit-tested in Node while the
 * DOM pointer-event wiring stays in app.js. Screen coordinates are converted
 * to SVG user units through the SVG coordinate transformation matrix so the
 * mapping remains correct under viewBox scaling and responsive layouts.
 */
export const TIMELINE = Object.freeze({W:960,H:126,L:112,R:12,Y:17,rowGap:34,rowH:17});
export const timelineWidth = () => TIMELINE.W - TIMELINE.L - TIMELINE.R;

/** Horizontal x position (SVG user units) of the indicator for an offset. */
export function indicatorX(offsetHours, totalHours){
  const ratio = totalHours > 0 ? Math.max(0, Math.min(1, offsetHours / totalHours)) : 0;
  return TIMELINE.L + timelineWidth() * ratio;
}

/** Clamp a 0..1 fraction to the total mission window in hours. */
export function fractionToOffset(fraction, totalHours){
  const f = Math.max(0, Math.min(1, Number(fraction) || 0));
  return Math.max(0, Math.min(totalHours, f * totalHours));
}

/** Convert an SVG user-space x coordinate into a clamped timeline fraction. */
export function timelineFractionFromSVGPoint(point, geometry = TIMELINE){
  const width = geometry.W - geometry.L - geometry.R;
  const u = (point.x - geometry.L) / width;
  return Math.max(0, Math.min(1, u));
}

/** Decompose the SVG CTM into {scale, offsetX} for horizontal mapping. */
export function horizontalCTM(svg){
  const ctm = typeof svg?.getScreenCTM === 'function' ? svg.getScreenCTM() : null;
  if (!ctm) return null;
  return {scale: ctm.a || 1, offsetX: ctm.e || 0};
}

/** Map a clientX value through the CTM to an SVG user-space x coordinate. */
export function clientXToSVGX(clientX, ctm){
  return (clientX - ctm.offsetX) / ctm.scale;
}