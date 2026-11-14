// Use the screen CTM to keep pointer positions aligned across responsive SVG sizes.
export const TIMELINE = Object.freeze({W:960,H:126,L:112,R:12,Y:17,rowGap:34,rowH:17});
const timelineWidth = TIMELINE.W - TIMELINE.L - TIMELINE.R;

export function indicatorX(offsetHours, totalHours){
  const ratio = totalHours > 0 ? Math.max(0, Math.min(1, offsetHours / totalHours)) : 0;
  return TIMELINE.L + timelineWidth * ratio;
}

export function fractionToOffset(fraction, totalHours){
  const f = Math.max(0, Math.min(1, Number(fraction) || 0));
  return Math.max(0, Math.min(totalHours, f * totalHours));
}

export function timelineFractionFromSVGPoint(point, geometry = TIMELINE){
  const width = geometry.W - geometry.L - geometry.R;
  const u = (point.x - geometry.L) / width;
  return Math.max(0, Math.min(1, u));
}

export function horizontalCTM(svg){
  const ctm = typeof svg?.getScreenCTM === 'function' ? svg.getScreenCTM() : null;
  if (!ctm) return null;
  return {scale: ctm.a || 1, offsetX: ctm.e || 0};
}

export function clientXToSVGX(clientX, ctm){
  return (clientX - ctm.offsetX) / ctm.scale;
}
