/**
 * Celestial reference bodies rendered behind the interactive Moon.
 * Directions are lunar-body-fixed, aligned with the analytical ephemeris.
 * Marker sizes are deliberately enlarged and sky projection is illustrative:
 * this is a directional visual reference, NOT a to-scale distance model.
 */
const TAU=Math.PI*2;
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const wrapRadians=n=>((n%TAU)+TAU)%TAU;

/** Azimuth clockwise from north, elevation relative to selected lunar site. */
export function horizontalToLunarVector(observation,lat,lon){
  const R=Math.PI/180;
  const phi=lat*R,theta=lon*R,az=observation.azimuth*R,el=observation.elevation*R;
  const east=[-Math.sin(theta),Math.cos(theta),0];
  const north=[-Math.sin(phi)*Math.cos(theta),-Math.sin(phi)*Math.sin(theta),Math.cos(phi)];
  const up=[Math.cos(phi)*Math.cos(theta),Math.cos(phi)*Math.sin(theta),Math.sin(phi)];
  const n=[0,1,2].map(i=>up[i]*Math.sin(el)+north[i]*Math.cos(el)*Math.cos(az)+east[i]*Math.cos(el)*Math.sin(az));
  const length=Math.hypot(...n)||1;
  return n.map(v=>v/length);
}

/**
 * Shared Moon-fixed 3D scene used by the GPU renderer and pointer picking.
 * True Sun/Earth *directions* come from the lunar ephemeris; displayed radii
 * and distances are compressed to make all three spheres inspectable together.
 * This scene must never be interpreted as a distance/size/orbit-scale model.
 */
export const SCENE_BODIES = Object.freeze({
  sun: Object.freeze({distance:1.75,radius:0.20}),
  earth: Object.freeze({distance:1.75,radius:0.19})
});

/** Project the same 3D spheres that the WebGL ray tracer intersects. */
export function skyBodies(camera,sunDirection,earthDirection,width,height,moonRadius=0.87){
  const project=(direction,{distance,radius})=>{
    const unit=direction.map(v=>v/(Math.hypot(...direction)||1));
    const world=unit.map(v=>v*distance);
    const x=dot(world,camera.east)*moonRadius;
    const y=dot(world,camera.north)*moonRadius;
    const r=radius*moonRadius;
    const depth=dot(world,camera.center);
    const visible=Math.abs(x)<=width/height+r && Math.abs(y)<=1+r;
    const screenDistance=Math.hypot(x,y);
    const moonDepth=Math.sqrt(Math.max(0,1-(screenDistance/moonRadius)**2));
    const exposed=visible && (screenDistance+r>=moonRadius ||
      depth+radius>=moonDepth);
    return {world,x,y,r,depth,worldRadius:radius,visible,exposed};
  };
  return {
    sun:project(sunDirection,SCENE_BODIES.sun),
    earth:project(earthDirection,SCENE_BODIES.earth),
    moon:{x:0,y:0,r:moonRadius,depth:0,worldRadius:1,visible:true,exposed:true}
  };
}

/** Find the frontmost *ray-sphere* intersection rather than a flat 2D target. */
export function hitCelestialBody(layout,x,y,width,height){
  const scale=height*0.5;
  const px=(x-width*0.5)/scale,py=(height*0.5-y)/scale;
  const moonRadius=layout.moon.r;
  const moonPixel=(px*px+py*py)/(moonRadius*moonRadius);
  let nearest=moonPixel<=1?'moon':null;
  let nearestDepth=moonPixel<=1?Math.sqrt(Math.max(0,1-moonPixel)):-Infinity;
  for(const name of ['sun','earth']){
    const body=layout[name];
    if(!body?.visible)continue;
    const dx=px-body.x,dy=py-body.y;
    if(dx*dx+dy*dy>body.r*body.r)continue;
    const worldR=body.worldRadius;
    const crossSection=(dx*dx+dy*dy)/(moonRadius*moonRadius);
    const depth=body.depth+Math.sqrt(Math.max(0,worldR*worldR-crossSection));
    if(depth>nearestDepth){nearest=name;nearestDepth=depth;}
  }
  return nearest;
}

/** Approximate visual surface spin by UTC time, independent of lunar horizon calculations. */
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
