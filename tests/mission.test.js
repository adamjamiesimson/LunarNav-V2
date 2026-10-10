import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateMission,horizonAt,validateEngineering} from '../src/mission.js';
import {polarXY,deriveHorizonFromRaster} from '../src/terrain.js';
const make=(sun,earth,time)=>({time:new Date(time).toISOString(),
  sun:{azimuth:90,elevation:sun,visible:sun>0},
  earth:{azimuth:270,elevation:earth,visible:earth>0}});
const series=(values)=>values.map((v,i)=>make(v[0],v[1],Date.UTC(2026,10,14,12+i*2)));
test('power model: no sunlight drains stored energy until a brownout',()=>{
  const samples=series([[-2,10],[-1,10],[-1,10],[-1,10]]);
  const out=simulateMission(samples,{areaM2:10,loadW:100,batteryWh:300,earthCutoffDeg:5});
  assert.equal(out.generatedWh,0);
  assert.equal(out.unmetWh,300);
  assert.equal(out.unmetHours,3);
  assert.equal(out.minimumSocPct,0);
  assert.equal(out.earthAccessPct,100);
});
test('sunlight creates power only above geometric horizon; battery caps at capacity',()=>{
  const samples=series([[90,5],[90,5],[90,5]]);
  const out=simulateMission(samples,{areaM2:2,efficiencyPct:50,deratePct:100,loadW:100,batteryWh:500});
  assert.ok(out.generatedWh>5000);
  assert.equal(out.minimumSocPct,100);
  assert.equal(out.endingSocPct,100);
  assert.equal(out.unmetHours,0);
});
test('Earth cutoff excludes sub-mask geometry even when Earth is above horizon',()=>{
  const out=simulateMission(series([[10,2],[10,4],[10,6]]),{earthCutoffDeg:5});
  assert.equal(out.earthAccessPct,0);
  assert.equal(out.longestAccessGapHours,4);
});
test('terrain horizon blocks Sun while flat screen permits Sun',()=>{
  const profile={azimuthDeg:[0,90,180,270],elevationDeg:[0,15,0,0]};
  const samples=series([[8,20],[8,20],[8,20]]);
  assert.equal(simulateMission(samples,{},null).solarAccessPct,100);
  assert.equal(simulateMission(samples,{},profile).solarAccessPct,0);
});
test('horizon azimuth interpolation wraps across north',()=>{
  const profile={azimuthDeg:[0,90,180,270],elevationDeg:[4,0,0,0]};
  assert.equal(horizonAt(profile,315),2);
  assert.equal(horizonAt(profile,45),2);
  assert.equal(horizonAt(profile,-45),2);
});
test('mission settings reject invalid or nonsensical engineering inputs',()=>{
  assert.throws(()=>validateEngineering({batteryWh:-1}),/battery/);
  assert.throws(()=>validateEngineering({earthCutoffDeg:92}),/elevation/);
});
test('LOLA stereographic south pole projects to map origin',()=>{
  const pt=polarXY(-90,230);
  assert.ok(Math.abs(pt.x)<1e-8&&Math.abs(pt.y)<1e-8);
  assert.throws(()=>polarXY(-70,0),/covers/);
});
test('DEM-derived horizon rises over a synthetic high point to the east',()=>{
  const width=11,height=11,arr=new Float32Array(width*height).fill(0);
  // Map origin=-1000m,+1000m, step=200m: local south pole at pixel [5,5].
  arr[5*width+8]=120; // east +600 m
  const p=deriveHorizonFromRaster({
    data:arr,width,height,originX:-1000,originY:1000,
    resolutionX:200,resolutionY:-200,noData:null
  },{lat:-90,lon:0},{azimuthBins:36,radiusKm:1,stepMeters:200});
  assert.ok(p.elevationDeg[9]>0);
  assert.equal(p.elevationDeg[27],0);
  assert.ok(p.coveragePct>=80);
});
test('DEM loader refuses missing observer pixels rather than claiming terrain applied',()=>{
  const d=new Float32Array(121).fill(-9999);
  assert.throws(()=>deriveHorizonFromRaster({
    data:d,width:11,height:11,originX:-1000,originY:1000,
    resolutionX:200,resolutionY:-200,noData:-9999
  },{lat:-90,lon:0},{azimuthBins:36,radiusKm:1,stepMeters:200}),/No valid/);
});
