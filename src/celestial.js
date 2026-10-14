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

/** Project sphere anchors into the Moon-camera sky. Returns visibility and coordinates. */
export function skyBodies(camera,sunDirection,earthDirection,width,height,moonRadius=0.87){
  const scale=1.27;
  const project=(direction,radius)=>{
    const x=dot(direction,camera.east)*scale,y=dot(direction,camera.north)*scale;
    const front=dot(direction,camera.center)>0.015;
    const within=Math.abs(x)<width/height+radius && Math.abs(y)<1+radius;
    // Moon is in the foreground and the shader handles partial occultation.
    const visible=front&&within;
    const exposed=visible && Math.hypot(x,y)>moonRadius-radius*0.45;
    return {x,y,r:radius,visible,exposed};
  };
  return {
    sun:project(sunDirection,0.16),
    earth:project(earthDirection,0.145),
    moon:{x:0,y:0,r:moonRadius,visible:true,exposed:true}
  };
}

/** Only allow drags on visible pixels; Moon covers overlapping sky bodies. */
export function hitCelestialBody(layout,x,y,width,height){
  const scale=height*0.5;
  const px=(x-width*0.5)/scale,py=(height*0.5-y)/scale;
  if(px*px+py*py<=layout.moon.r*layout.moon.r)return 'moon';
  for(const name of ['earth','sun']){
    const body=layout[name],dx=px-body.x,dy=py-body.y;
    if(body.visible && dx*dx+dy*dy<=body.r*body.r)return name;
  }
  return null;
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
