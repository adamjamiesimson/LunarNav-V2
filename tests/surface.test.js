import test from 'node:test';
import assert from 'node:assert/strict';
import {localFrame,surfacePoint,localHorizontal,surfaceCamera,bodyClearsTerrain} from '../src/surface.js';
import {horizontalToLunarVector} from '../src/celestial.js';
import {MOON_RADIUS_M} from '../src/relief.js';

test('local east-north-up frames are orthonormal and correctly oriented',()=>{
  for(const [lat,lon] of [[0,0],[0,90],[-84.79,29.2],[-89.9,180]]){
    const {up,north,east}=localFrame(lat,lon);
    for(const v of [up,north,east])assert.ok(Math.abs(Math.hypot(...v)-1)<1e-12);
    const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
    assert.ok(Math.abs(dot(up,north))<1e-12&&Math.abs(dot(up,east))<1e-12&&Math.abs(dot(north,east))<1e-12);
  }
  const eq=localFrame(0,0);
  assert.ok(eq.up[0]>0.999,'up is radial at the equator/prime meridian');
  assert.ok(eq.east[1]>0.999,'east points toward 90°E');
});

test('horizontal directions round-trip exactly through the lunar-fixed frame',()=>{
  for(const [lat,lon] of [[-84.79,29.2],[-70,120],[0,-45]]){
    for(const [az,el] of [[0,10],[90,30],[217.5,0],[-45,62]].map(([a,e])=>[(a+360)%360,e])){
      const v=horizontalToLunarVector({azimuth:az,elevation:el},lat,lon);
      const back=localHorizontal(v,lat,lon);
      assert.ok(Math.abs(back.azimuth-az)<1e-9,`azimuth round-trip at ${lat},${lon}`);
      assert.ok(Math.abs(back.elevation-el)<1e-9,`elevation round-trip at ${lat},${lon}`);
    }
  }
});

test('surface camera sits on the terrain and keeps an orthonormal view basis',()=>{
  const cam=surfaceCamera({lat:-84.79,lon:29.2,heightM:500,observerHeightM:1.7,headingDeg:37,pitchDeg:12});
  assert.ok(Math.abs(Math.hypot(...cam.eye)-(MOON_RADIUS_M+501.7))<1e-6,'eye follows the actual surface elevation');
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  for(const v of [cam.forward,cam.right,cam.up])assert.ok(Math.abs(Math.hypot(...v)-1)<1e-9);
  assert.ok(Math.abs(dot(cam.forward,cam.right))<1e-9,'view basis is orthonormal');
  const flat=surfaceCamera({lat:-84.79,lon:29.2,headingDeg:0,pitchDeg:0});
  const {north}=localFrame(-84.79,29.2);
  assert.ok(Math.abs(dot(flat.forward,north)-1)<1e-9,'heading 0 looks along local north');
});

test('terrain obstruction applies to the local horizontal like the mission model',()=>{
  const profile={azimuthDeg:Array.from({length:36},(_,i)=>i*10),elevationDeg:Array.from({length:36},(_,i)=>i*10>=80&&i*10<=100?25:0)};
  const east=horizontalToLunarVector({azimuth:90,elevation:10},-84.79,29.2);
  const west=horizontalToLunarVector({azimuth:270,elevation:10},-84.79,29.2);
  assert.equal(bodyClearsTerrain(east,-84.79,29.2,profile).visible,false,'ridge to the east blocks the sun');
  assert.equal(bodyClearsTerrain(west,-84.79,29.2,profile).visible,true,'open western horizon stays visible');
  assert.equal(bodyClearsTerrain(east,-84.79,29.2).visible,true,'no profile means the labelled geometric horizon');
});
