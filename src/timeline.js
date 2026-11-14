// Timeline geometry. Framework-free so the drag maths works in plain Node;
// the DOM pointer wiring lives in app.js. Screen to SVG user units goes
// through the CTM so the mapping survives viewBox scaling and responsive
// layouts.
export const TIMELINE = Object.freeze({W:960,H:126,L:112,R:12,Y:17,rowGap:34,rowH:17});
export const timelineWidth = () => TIMELINE.W - TIMELINE.L - TIMELINE.R;

// SVG x of the time indicator for an offset in hours.
export function indicatorX(offsetHours, totalHours){
  const ratio = totalHours > 0 ? Math.max(0, Math.min(1, offsetHours / totalHours)) : 0;
  return TIMELINE.L + timelineWidth() * ratio;
}

// Clamp a 0..1 fraction to the mission window in hours.
export function fractionToOffset(fraction, totalHours){
  const f = Math.max(0, Math.min(1, Number(fraction) || 0));
  return Math.max(0, Math.min(totalHours, f * totalHours));
}

// SVG user-space x -> clamped timeline fraction.
export function timelineFractionFromSVGPoint(point, geometry = TIMELINE){
  const width = geometry.W - geometry.L - geometry.R;
  const u = (point.x - geometry.L) / width;
  return Math.max(0, Math.min(1, u));
}

// Pull {scale, offsetX} out of the SVG CTM for horizontal mapping.
export function horizontalCTM(svg){
  const ctm = typeof svg?.getScreenCTM === 'function' ? svg.getScreenCTM() : null;
  if (!ctm) return null;
  return {scale: ctm.a || 1, offsetX: ctm.e || 0};
}

export function clientXToSVGX(clientX, ctm){
  return (clientX - ctm.offsetX) / ctm.scale;
}
