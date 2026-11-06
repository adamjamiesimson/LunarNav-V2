import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {MOON_RADIUS_M,POLAR_DOMAIN_M,polarReliefUV,globalReliefUV,decodeHeight,sampleGrid,
  displacedRadiusM,intersectDisplacedSphere,displacedNormal} from '../src/relief.js';

const unit=v=>{const d=Math.hypot(...v);return [v[0]/d,v[1]/d,v[2]/d];};
const at=(x,y,z)=>unit([x,y,z]);

// Rays from (0,0,8) parameterised by impact parameter around the unit sphere.
const O=[0,0,8];
const rayAt=b=>{const k=b*8/Math.sqrt(64-b*b);return unit([k,0,-8]);};

// Synthetic heightfields in metres, keyed by unit direction.
const ridgeEast=dir=>dir[0]>0.9?2500:0;
const northSlope=k=>dir=>dir[1]*k;

test('displaced surface radius follows actual elevation values',()=>{
  assert.equal(displacedRadiusM(0),MOON_RADIUS_M);
  assert.equal(displacedRadiusM(1000),MOON_RADIUS_M+1000);
  assert.equal(displacedRadiusM(-500,2),MOON_RADIUS_M-1000,'exaggeration scales displacement only');
});

test('a ridge physically raises the geometric silhouette, a depression lowers it',()=>{
  const grazing=rayAt(0.999);
  const flat=intersectDisplacedSphere(O,grazing,{heightAt:()=>0});
  const withRidge=intersectDisplacedSphere(O,grazing,{heightAt:ridgeEast});
  assert.ok(flat!==null&&withRidge!==null);
  assert.ok(withRidge<flat,'ridge surface is closer along a grazing ray');
  const beyond=rayAt(1.0005);
  assert.equal(intersectDisplacedSphere(O,beyond,{heightAt:()=>0}),null,'ray misses the flat sphere');
  assert.ok(intersectDisplacedSphere(O,beyond,{heightAt:ridgeEast})!==null,'ridge extends the real silhouette');
  assert.equal(intersectDisplacedSphere(O,rayAt(1.002),{heightAt:ridgeEast}),null,'sky above the ridge stays empty');
});

test('rays over unchanged terrain behave exactly like the flat sphere',()=>{
  const d=unit([-0.999*8/Math.sqrt(64-0.999*0.999),0,-8]);
  const flat=intersectDisplacedSphere(O,d,{heightAt:()=>0});
  const shifted=intersectDisplacedSphere(O,d,{heightAt:ridgeEast});
  assert.ok(flat!==null);
  assert.ok(Math.abs(shifted-flat)<1e-9,'east-only ridge does not affect the western limb');
});

test('surface normals reconstruct the displaced geometry slopes',()=>{
  const flatN=displacedNormal(at(1,0,0),()=>0);
  assert.ok(Math.abs(flatN[0]-1)<1e-6,'flat surface keeps a radial normal');
  const gentle=displacedNormal(at(1,0,0),northSlope(500));
  const steep=displacedNormal(at(1,0,0),northSlope(4000));
  assert.ok(gentle[1]<-1e-4,'terrain rising toward +y tilts the normal toward -y');
  assert.ok(Math.abs(steep[1])>Math.abs(gentle[1]),'steeper terrain tilts the normal further');
  assert.ok(Math.hypot(...steep)>0.99,'normal stays unit length');
});

test('height grids decode and interpolate without stepping artifacts',()=>{
  const grid={width:2,height:2,get:(x,y)=>[[0,65535],[65535,0]][y][x]};
  assert.ok(Math.abs(decodeHeight(0,-1000,2000)+1000)<1e-9);
  assert.ok(Math.abs(decodeHeight(65535,-1000,2000)-1000)<1e-9);
  const mid=sampleGrid(grid,0.5,0.5);
  assert.ok(Math.abs(mid-32767.5)<1,'bilinear interpolation between corners');
  assert.equal(sampleGrid(grid,-1,-1),sampleGrid(grid,0,0),'clamped outside the grid');
});

test('relief texture mappings are geographically consistent',()=>{
  const pole=polarReliefUV(-90,0);
  assert.ok(Math.abs(pole.u-0.5)<1e-9&&Math.abs(pole.v-0.5)<1e-9,'south pole at the texture centre');
  const east=polarReliefUV(-80,90);
  assert.ok(east.u>0.5&&Math.abs(east.v-0.5)<0.3,'0°E–90°E quadrant projects to the expected side');
  assert.ok(Math.abs(polarReliefUV(-60,0).radiusM-POLAR_DOMAIN_M)<POLAR_DOMAIN_M*0.001,'60°S reaches the domain edge');
  const g=globalReliefUV(0,0);
  assert.ok(Math.abs(g.u-0.5)<1e-9&&Math.abs(g.v-0.5)<1e-9,'prime meridian and equator at the equirect centre');
  assert.ok(Math.abs(globalReliefUV(0,-180).u)<1e-9,'longitude wraps');
});

test('baked relief PNG decodes to smooth terrain, not encoding noise',()=>{
  // Decode the actual shipped texture (PNG Sub filter) and verify real terrain:
  // neighbouring heights must vary gently. This catches encoder/decoder bugs
  // that header-only checks cannot see.
  const png=readFileSync(new URL('../assets/moon-relief.png',import.meta.url));
  let off=8;const idat=[];
  while(off<png.length){
    const len=png.readUInt32BE(off),type=png.toString('ascii',off+4,off+8);
    if(type==='IDAT')idat.push(png.subarray(off+8,off+8+len));
    off+=12+len;
  }
  const w=png.readUInt32BE(16),h=png.readUInt32BE(20);
  const raw=inflateSync(Buffer.concat(idat));
  const stride=w*3+1,out=Buffer.alloc(w*h*3);
  for(let y=0;y<h;y++){
    const f=raw[y*stride];
    for(let x=0;x<stride-1;x++){
      const left=x>=3?out[y*w*3+x-3]:0;
      out[y*w*3+x]=(raw[y*stride+1+x]+(f===1?left:0))&255;
    }
  }
  const code=(x,y)=>16*out[(y*w+x)*3]+out[(y*w+x)*3+1]/16;
  let checked=0,harsh=0;
  for(let y=300;y<340;y++)for(let x=300;x<600;x++){
    const d=Math.abs(code(x,y)-code(x+1,y));
    checked++;
    if(d>200)harsh++; // >~760 m between 480 m texels is not real terrain
  }
  assert.ok(checked>1000);
  assert.ok(harsh<checked*0.01,`relief texture looks noisy: ${harsh}/${checked} harsh jumps`);
  assert.ok(Math.abs(code(301,301)-code(302,301))<201,'neighbouring heights are continuous');
});
