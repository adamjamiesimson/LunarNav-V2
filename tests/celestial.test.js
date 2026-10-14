import test from 'node:test';
import assert from 'node:assert/strict';
import {horizontalToLunarVector,skyBodies,hitCelestialBody,celestialSpin,SCENE_BODIES} from '../src/celestial.js';

const unit=v=>v.map(n=>n/Math.hypot(...v));
const camera={center:[0,0,1],east:[1,0,0],north:[0,1,0]};
const opposite={center:[0,0,-1],east:[-1,0,0],north:[0,1,0]};

test('local Sun and Earth observations reconstruct unit vectors in Moon-fixed 3D coordinates',()=>{
 const zenith=horizontalToLunarVector({azimuth:42,elevation:90},0,0);
 assert.ok(Math.abs(zenith[0]-1)<1e-12);
 const east=horizontalToLunarVector({azimuth:90,elevation:0},0,0);
 assert.ok(Math.abs(east[1]-1)<1e-12);
 assert.ok(Math.abs(Math.hypot(...east)-1)<1e-12);
});

test('Sun and Earth use shared three-dimensional anchors that project with the orbiting camera',()=>{
 const sun=unit([0.9,0.1,0.7]),earth=unit([-0.9,0.3,-0.7]);
 const a=skyBodies(camera,sun,earth,1200,600);
 const b=skyBodies(opposite,sun,earth,1200,600);
 assert.ok(a.sun.visible&&a.earth.visible&&b.sun.visible&&b.earth.visible);
 assert.ok(a.sun.x>0&&a.earth.x<0);
 assert.ok(b.sun.x<0&&b.earth.x>0);
 assert.ok(a.sun.depth>0&&a.earth.depth<0);
 assert.ok(b.sun.depth<0&&b.earth.depth>0);
 assert.ok(Math.abs(Math.hypot(...a.sun.world)-SCENE_BODIES.sun.distance)<1e-12);
});

test('frontmost 3D body can occult the Moon, and the Moon hides rearward spheres',()=>{
 const front=skyBodies(camera,[0,0,1],[0,0,-1],1200,600);
 assert.equal(hitCelestialBody(front,600,300,1200,600),'sun');
 const back=skyBodies(camera,[0,0,-1],[0,0,1],1200,600);
 assert.equal(hitCelestialBody(back,600,300,1200,600),'earth');
 assert.equal(back.sun.exposed,false);
 assert.equal(hitCelestialBody(back,600,0,1200,600),null);
});

test('screen-plane distances and sphere sizes scale together with zoom',()=>{
 const a=skyBodies(camera,[1,0,0],[0,1,0],1200,600,0.87);
 const b=skyBodies(camera,[1,0,0],[0,1,0],1200,600,1.74);
 assert.ok(Math.abs(b.sun.x-2*a.sun.x)<1e-12);
 assert.ok(Math.abs(b.earth.r-2*a.earth.r)<1e-12);
});

test('Earth spins faster than Moon and Sun across a 12-hour UTC step',()=>{
 const then=celestialSpin('2026-10-14T00:00:00Z');
 const later=celestialSpin('2026-10-14T12:00:00Z');
 const arc=(a,b)=>{let d=(b-a+2*Math.PI)%(2*Math.PI);return Math.min(d,2*Math.PI-d);};
 assert.ok(arc(then.earth,later.earth)>2.5);
 assert.ok(arc(then.moon,later.moon)<0.15);
 assert.ok(arc(then.sun,later.sun)<0.15);
});
