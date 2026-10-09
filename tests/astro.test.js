import test from 'node:test';
import assert from 'node:assert/strict';
import { ephemeris, sampleWindow, summarize, rankedSites, longestDualWindow } from '../src/astro.js';
const date='2026-11-14T12:00:00.000Z';
test('sun and earth azimuth/elevation finite and bounded',()=>{for(const lat of [-90,-89.5,-85,0,45,90]) for(const lon of [-180,0,29.2,180,357.07]) {const x=ephemeris(date,lat,lon);for(const body of [x.sun,x.earth]) { assert.ok(Number.isFinite(body.azimuth));assert.ok(body.azimuth>=0&&body.azimuth<360);assert.ok(body.elevation>=-90&&body.elevation<=90);assert.equal(body.visible,body.elevation>0); }}});
test('near side moon equator sees Earth near zenith',()=>{const e=ephemeris(date,0,0).earth;console.log('Earth from (0,0):',e);assert.ok(e.elevation>65,'Earth should be near zenith at near-side equator');});
test('lunar poles see Earth close to horizon',()=>{for(const lat of [-90,90]) assert.ok(Math.abs(ephemeris(date,lat,0).earth.elevation)<10);});
test('opposing latitudes create complementary body elevations',()=>{const a=ephemeris(date,47,22);const b=ephemeris(date,-47,202);assert.ok(Math.abs(a.sun.elevation+b.sun.elevation)<1e-5);assert.ok(Math.abs(a.earth.elevation+b.earth.elevation)<1e-5);});
test('samples, summary and ranking are internally consistent',()=>{const samples=sampleWindow({start:date,lat:-85,lon:29,days:4,stepHours:2});assert.equal(samples.length,49);const stats=summarize(samples);for(const k of ['sun','earth','dual']) assert.ok(stats[k]>=0&&stats[k]<=100);assert.ok(stats.dual<=stats.sun+1e-9 && stats.dual<=stats.earth+1e-9);const ranked=rankedSites([{lat:-85,lon:29},{lat:-90,lon:0}],date,4);assert.equal(ranked.length,2);});
test('bad coordinates rejected',()=>assert.throws(()=>ephemeris(date,100,0)));

test('longest simultaneous access is based on consecutive intervals',()=>{const samples=[true,true,false,true,true,true,false].map((dual,i)=>({time:new Date(Date.parse(date)+i*3600000).toISOString(),dual}));const w=longestDualWindow(samples);assert.equal(w.hours,3);assert.equal(w.start,samples[3].time);assert.equal(w.end,samples[6].time);});
