import test from 'node:test';
import assert from 'node:assert/strict';
import {horizontalToLunarVector,skyBodies,hitCelestialBody,celestialSpin} from '../src/celestial.js';
const unit=v=>v.map(n=>n/Math.hypot(...v));
const camera={center:[0,0,1],east:[1,0,0],north:[0,1,0]};
test('horizontal Sun and Earth observations reconstruct normalized lunar-fixed directions',()=>{
 const zenith=horizontalToLunarVector({azimuth:42,elevation:90},0,0);
 assert.ok(Math.abs(zenith[0]-1)<1e-12);
 const east=horizontalToLunarVector({azimuth:90,elevation:0},0,0);
 assert.ok(Math.abs(east[1]-1)<1e-12);
 assert.ok(Math.abs(Math.hypot(...east)-1)<1e-12);
});
test('celestial body positions are camera-dependent and hidden behind viewer',()=>{
 const sun=unit([0.9,0.1,0.7]),earth=unit([-0.9,0.3,0.7]);
 const a=skyBodies(camera,sun,earth,1200,600,0.87);
 assert.ok(a.sun.visible&&a.earth.visible);
 assert.ok(a.sun.x>0&&a.earth.x<0);
 const opposite={center:[0,0,-1],east:[-1,0,0],north:[0,1,0]};
 const b=skyBodies(opposite,sun,earth,1200,600,0.87);
 assert.equal(b.sun.visible,false);
 assert.equal(b.earth.visible,false);
});
test('body picking respects Moon foreground and distant sphere markers',()=>{
 const l={moon:{x:0,y:0,r:0.87},earth:{x:1.1,y:0,r:0.15,visible:true},sun:{x:-1.1,y:0,r:0.16,visible:true}};
 assert.equal(hitCelestialBody(l,600,300,1200,600),'moon');
 assert.equal(hitCelestialBody(l,930,300,1200,600),'earth');
 assert.equal(hitCelestialBody(l,270,300,1200,600),'sun');
 assert.equal(hitCelestialBody(l,600,0,1200,600),null);
});
test('Earth rotates faster than Moon and Sun as simulated UTC advances',()=>{
 const then=celestialSpin('2026-10-14T00:00:00Z');
 const later=celestialSpin('2026-10-14T12:00:00Z');
 const arc=(a,b)=>{let d=(b-a+2*Math.PI)%(2*Math.PI);return Math.min(d,2*Math.PI-d);};
 assert.ok(arc(then.earth,later.earth)>2.5);
 assert.ok(arc(then.moon,later.moon)<0.15);
 assert.ok(arc(then.sun,later.sun)<0.15);
});
