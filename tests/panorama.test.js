import test from 'node:test';
import assert from 'node:assert/strict';
import {destinationPoint,panoramaDistances,computePanoramaColumns,distanceForElevation,
  horizonAtAzimuth,bodyStatus,createPanoramaView,directionFromAzEl,cameraBasis,projectDirection} from '../src/panorama.js';
import {sampleBilinear} from '../src/grid-terrain.js';
import {greatCircleDistanceKm} from '../src/travel.js';
import {MOON_RADIUS_M} from '../src/relief.js';

const DEG=180/Math.PI;

test('geodesic destinations match the shared spherical distance model',()=>{
  const site={lat:-85,lon:20};
  for(const [az,km] of [[0,10],[90,25],[213,2.5],[359,42]]){
    const p=destinationPoint(site.lat,site.lon,az,km);
    const back=greatCircleDistanceKm(site.lat,site.lon,p.lat,p.lon);
    assert.ok(Math.abs(back-km)<0.05,`destination at ${az}° returns ${back.toFixed(2)} km for ${km} km`);
  }
});

test('ray-marched horizon of a ring terrain matches the analytic angle',()=>{
  const site={lat:-85,lon:20};
  const heightAt=(lat,lon)=>{
    const d=greatCircleDistanceKm(site.lat,site.lon,lat,lon);
    return Math.abs(d-10)<0.8?500:0; // 500 m ring at 10 km (wider than the march's step growth)
  };
  const pano=computePanoramaColumns({heightAt,site,azimuthBins:72,maxDistanceKm:30});
  // atan(500/10000) minus the spherical curvature dip at 10 km
  const expected=Math.atan(500/10000)*DEG-(10000/(2*MOON_RADIUS_M))*DEG;
  for(const column of pano.columns){
    assert.ok(Math.abs(column.horizonDeg-expected)<0.35,
      `azimuth ${column.azimuthDeg} horizon ${column.horizonDeg.toFixed(2)} vs ${expected.toFixed(2)}`);
    assert.ok(Math.abs(column.hitDistanceKm-10)<1,'the blocking sample is the ring itself');
  }
});

test('a directional hill raises only its own azimuth',()=>{
  const site={lat:-85,lon:20};
  const hill=destinationPoint(site.lat,site.lon,90,12);
  const heightAt=(lat,lon)=>{
    const d=greatCircleDistanceKm(hill.lat,hill.lon,lat,lon);
    return d<1?800:0;
  };
  const pano=computePanoramaColumns({heightAt,site,azimuthBins:72,maxDistanceKm:30});
  let peak=pano.columns[0];
  for(const c of pano.columns)if(c.horizonDeg>peak.horizonDeg)peak=c;
  assert.ok(Math.abs(peak.azimuthDeg-90)<=10,`peak azimuth ${peak.azimuthDeg} stays near 90°`);
  assert.ok(peak.horizonDeg>horizonAtAzimuth(pano,270)+2,'the far side stays open');
  assert.ok(distanceForElevation(peak,peak.horizonDeg-0.2)<=peak.hitDistanceKm+0.1);
  assert.equal(distanceForElevation(peak,peak.horizonDeg+2),null,'nothing blocks above the horizon');
});

test('body status reflects ray-marched terrain obstruction honestly',()=>{
  const columns=Array.from({length:360},(_,i)=>({azimuthDeg:i,horizonDeg:i<180?5:0.5,samples:[]}));
  const pano={columns,observerHeightM:2};
  assert.equal(bodyStatus(pano,{azimuth:90,elevation:-2}),'BELOW HORIZON');
  assert.equal(bodyStatus(pano,{azimuth:90,elevation:2}),'BEHIND TERRAIN');
  assert.equal(bodyStatus(pano,{azimuth:90,elevation:12}),'ABOVE HORIZON');
  assert.equal(bodyStatus(pano,{azimuth:270,elevation:1}),'ABOVE HORIZON');
});

test('panorama distances sample densely near the observer',()=>{
  const distances=panoramaDistances(45);
  assert.ok(distances[0]<0.2&&distances[distances.length-1]===45);
  assert.ok(distances.length>30&&distances.length<200);
});

test('bilinear grid sampling interpolates and rejects outside windows',()=>{
  const data=new Float32Array([0,10,20,30,40,50,60,70,80]);
  assert.equal(sampleBilinear(data,3,3,0.5,0.5),20);
  assert.equal(sampleBilinear(data,3,3,1,1),40);
  assert.equal(sampleBilinear(data,3,3,0,2),60);
  assert.equal(sampleBilinear(data,3,3,2,2),80);
  assert.equal(sampleBilinear(data,3,3,-0.1,1),null);
  assert.equal(sampleBilinear(data,3,3,1,2.2),null);
});

test('camera basis is orthonormal and yaw 0 looks north',()=>{
  const {forward,right,up}=cameraBasis(0,0);
  assert.ok(Math.abs(forward.y-1)<1e-9&&Math.abs(forward.x)<1e-9,'yaw 0 faces north');
  assert.ok(Math.abs(right.x-1)<1e-9,'right is east');
  const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
  assert.ok(Math.abs(dot(forward,right))<1e-9&&Math.abs(dot(forward,up))<1e-9&&Math.abs(dot(right,up))<1e-9,'axes are orthogonal');
  assert.ok(Math.abs(dot(up,up)-1)<1e-9,'axes are unit length');
});

test('azimuth/elevation directions follow the panorama convention',()=>{
  const east=directionFromAzEl(90,0);
  assert.ok(Math.abs(east.x-1)<1e-9&&Math.abs(east.y)<1e-9,'east is +x');
  const up=directionFromAzEl(0,90);
  assert.ok(Math.abs(up.z-1)<1e-9,'elevation 90 is up');
});

test('marker projection puts the view centre at screen centre',()=>{
  const camera={yawDeg:123,pitchDeg:7,fovDeg:75,aspect:16/9};
  const {forward}=cameraBasis(123,7);
  const centre=projectDirection(forward,camera);
  assert.ok(centre.visible&&Math.abs(centre.x-0.5)<1e-6&&Math.abs(centre.y-0.5)<1e-6);
  const behind=projectDirection({x:-forward.x,y:-forward.y,z:-forward.z},camera);
  assert.equal(behind.visible,false,'objects behind the camera are not projected');
  const k=1/Math.SQRT2;
  const eastish=projectDirection({x:k,y:k,z:0},{yawDeg:0,pitchDeg:0,fovDeg:90,aspect:1});
  assert.ok(eastish.visible&&eastish.x>0.5,'a body east of a north-facing camera appears right of centre');
  const high=projectDirection({x:0,y:k,z:k},{yawDeg:0,pitchDeg:0,fovDeg:90,aspect:1});
  assert.ok(high.visible&&high.y<0.5,'a body above the horizon appears above centre');
});

test('panorama renderer exposes drawing, body updates and cleanup',()=>{
  // Minimal 2D context stub: only the calls the renderer uses.
  const calls=[];
  const ctx={createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h}),
    putImageData(){calls.push('putImageData');},beginPath(){},setLineDash(){},moveTo(){},lineTo(){},
    stroke(){},fill(){},arc(){},fillText(){},measureText:()=>({width:10})};
  const listeners={};
  const canvas={width:240,height:120,style:{},getContext:()=>ctx,
    addEventListener:(t,fn)=>{listeners[t]=fn;},removeEventListener:(t)=>{delete listeners[t];},
    setPointerCapture(){},};
  const site={lat:-85,lon:20};
  const pano=computePanoramaColumns({heightAt:()=>0,site,azimuthBins:24,maxDistanceKm:30});
  const view=createPanoramaView(canvas,{site,panorama:pano,obs:{sun:{azimuth:120,elevation:12},earth:{azimuth:214,elevation:3}}});
  assert.ok(calls.includes('putImageData'),'terrain pixels are written');
  assert.ok(listeners.pointerdown&&listeners.pointermove,'drag interaction is wired');
  view.setObs({sun:{azimuth:120,elevation:-4},earth:{azimuth:214,elevation:3}});
  view.destroy();
  assert.equal(listeners.pointerdown,undefined,'listeners are removed on destroy');
});
