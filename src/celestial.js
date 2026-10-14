/**
 * View-space layout and visual spin for the three-body overview.
 * Coordinates are screen/illustration units, never true orbital distances.
 * Independent of WebGL so pointer hit-testing matches the shader exactly.
 */
const TAU=Math.PI*2;
const wrapRadians=n=>((n%TAU)+TAU)%TAU;
export function celestialLayout(width,height){
  const aspect=Math.max(1,width)/Math.max(1,height);
  const spread=Math.min(0.82,aspect*0.63);
  return {
    sun:{x:-spread,y:0.25,r:Math.min(0.31,spread*0.39)},
    earth:{x:spread,y:0.06,r:Math.min(0.27,spread*0.34)},
    moon:{x:0,y:-0.22,r:Math.min(0.34,spread*0.45)}
  };
}
export function hitCelestialBody(layout,x,y,width,height){
  const scale=height*0.5;
  for(const name of ['moon','earth','sun']){
    const body=layout[name],dx=(x-width*0.5)/scale-body.x;
    const dy=(height*0.5-y)/scale-body.y;
    if(dx*dx+dy*dy<=body.r*body.r)return name;
  }
  return null;
}
/** Visual spin only: not an attitude/ephemeris solution. */
export function celestialSpin(timeUTC){
  const ms=typeof timeUTC==='number'?timeUTC:Date.parse(timeUTC);
  if(!Number.isFinite(ms))return {sun:0,earth:0,moon:0};
  const days=ms/86400000;
  return {
    sun:wrapRadians(TAU*days/25.38),
    earth:wrapRadians(TAU*days/(86164.0905/86400)),
    moon:wrapRadians(TAU*days/27.321661)
  };
}
