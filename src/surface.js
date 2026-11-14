import {MOON_RADIUS_M} from './relief.js';
import {horizonAt} from './mission.js';

const R=Math.PI/180;
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const norm=v=>{const d=Math.hypot(...v)||1;return v.map(x=>x/d);};

// East-north-up basis at a coordinate (lunar-fixed frame).
export function localFrame(lat,lon){
  const phi=lat*R,theta=lon*R;
  return {
    up:[Math.cos(phi)*Math.cos(theta),Math.cos(phi)*Math.sin(theta),Math.sin(phi)],
    north:[-Math.sin(phi)*Math.cos(theta),-Math.sin(phi)*Math.sin(theta),Math.cos(phi)],
    east:[-Math.sin(theta),Math.cos(theta),0]
  };
}

// Lunar-fixed position (metres) of a surface point.
export function surfacePoint(lat,lon,heightM=0){
  const r=MOON_RADIUS_M+heightM;
  const {up}=localFrame(lat,lon);
  return up.map(v=>v*r);
}

// Azimuth/elevation of a lunar-fixed direction as seen from the surface.
export function localHorizontal(direction,lat,lon){
  const {up,north,east}=localFrame(lat,lon);
  const d=norm(direction);
  return {
    azimuth:((Math.atan2(dot(d,east),dot(d,north))/R)+360)%360,
    elevation:Math.asin(Math.max(-1,Math.min(1,dot(d,up))))/R
  };
}

export function surfaceCamera({lat,lon,heightM=0,observerHeightM=1.7,headingDeg=0,pitchDeg=0,fovDeg=60}={}){
  const {up,north,east}=localFrame(lat,lon);
  const eye=surfacePoint(lat,lon,heightM+observerHeightM);
  const h=headingDeg*R,p=pitchDeg*R;
  const axis=(c,n,e)=>[0,1,2].map(i=>c[0]*n[i]+c[1]*e[i]);
  const headingDir=axis([Math.cos(h),Math.sin(h)],north,east);   // heading 0 = local north
  const forward=norm([0,1,2].map(i=>Math.cos(p)*headingDir[i]+Math.sin(p)*up[i]));
  const right=norm(axis([Math.cos(h),-Math.sin(h)],east,north)); // east at heading 0
  const viewUp=[
    right[1]*forward[2]-right[2]*forward[1],
    right[2]*forward[0]-right[0]*forward[2],
    right[0]*forward[1]-right[1]*forward[0]
  ];
  return {eye,forward,right,up:norm(viewUp),fovDeg,observerHeightM};
}

export function bodyClearsTerrain(direction,lat,lon,profile=null){
  const {azimuth,elevation}=localHorizontal(direction,lat,lon);
  const horizonDeg=horizonAt(profile,azimuth);
  return {azimuth,elevation,horizonDeg,visible:elevation>horizonDeg};
}
