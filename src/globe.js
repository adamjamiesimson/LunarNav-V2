/**
 * Immersive lunar globe — a dependency-free WebGL visualization backed by the
 * NASA SVS 2025 LROC color map. Surface appearance is visual context only;
 * it is NOT a terrain horizon model, elevation dataset or landing-risk map.
 * https://svs.gsfc.nasa.gov/4720/
 *
 * Earth, Moon and Sun are ray-traced as spheres in a shared Moon-fixed scene.
 * Celestial directions follow the ephemeris; their displayed size/distance is
 * deliberately compressed for inspection. The 2D polar fallback remains.
 */
import {SITES,fmtCoord} from './sites.js';
import {createMap as createPolarMap} from './map.js';
import {skyBodies,hitCelestialBody,celestialSpin,horizontalToLunarVector} from './celestial.js';

const D=Math.PI/180;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
// Zoom floor of 0.35 fits the compressed Sun/Earth orbits (1.75 scene units)
// inside the viewport so the full simulation loop is visible.
const zoomLevel=v=>clamp(v,0.35,2.1);
const wrap=n=>((n%360)+360)%360;
// Earth's spin axis is tilted 23.44° (obliquity) from the orbital-plane normal.
// The shader maps the texture pole to (0,cos(pitch),-sin(pitch)), whose pitch=0
// position lies in the orbital plane; obliquity-90° puts the pole 23.44° from
// the orbital normal (+z, the lunar pole axis of this Moon-fixed scene).
const EARTH_BASE_PITCH=(23.44-90)*D;
const spherical=(lat,lon)=>[Math.cos(lat*D)*Math.cos(lon*D),Math.cos(lat*D)*Math.sin(lon*D),Math.sin(lat*D)];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const norm=a=>{const d=Math.hypot(...a)||1;return a.map(x=>x/d);};
const add=(a,b,k=1)=>a.map((x,i)=>x+k*b[i]);
const vertex=String.raw`attribute vec2 position;
void main(){gl_Position=vec4(position,0.0,1.0);}`;
const fragment=String.raw`precision highp float;
uniform vec2 resolution;
uniform vec3 forward, right, up, sun;
uniform float zoom, hasTexture, showSkyBodies, hasEarthTexture, elapsedDays;
uniform vec3 spinYaw, spinPitch;
uniform vec4 sunSphere, earthSphere;
uniform sampler2D moon, earthImage, reliefMap, globalMap, patchMap, northMap;
uniform vec4 reliefCfg; // polar: range m, min m, texel size, covered
uniform vec4 northCfg;  // north polar: range m, min m, texel size, covered
uniform vec4 globalCfg; // global: range m, min m, covered, unused
uniform vec4 patchCfg;  // patch: range m, min m, texel size, covered
uniform vec4 patchGeo;  // patch window: originX, originY, spanX, spanY (polar metres)
uniform float reliefExag; // relief exaggeration (1.0 = physical scale)
float hash(vec2 x){return fract(sin(dot(x,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
             mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}

/* All celestial spheres are rendered in the Moon's WebGL view, with Moon occlusion.
   Angular directions follow the ephemeris; marker sizes are illustrative. */
float fbm(vec2 p){
 return 0.52*noise(p)+0.30*noise(p*2.07+11.3)+0.18*noise(p*4.13-3.7);
}
vec3 sphereNormal(vec2 q){
 return vec3(q,sqrt(max(0.0,1.0-dot(q,q))));
}
vec3 turned(vec3 n,float yaw,float pitch){
  vec3 p=vec3(n.x,n.y*cos(pitch)-n.z*sin(pitch),n.y*sin(pitch)+n.z*cos(pitch));
  return vec3(p.x*cos(yaw)-p.z*sin(yaw),p.y,p.x*sin(yaw)+p.z*cos(yaw));
}
vec3 moonAlbedo(vec3 n){
 float lon=atan(n.y,n.x);
 float lat=asin(clamp(n.z,-1.0,1.0));
 vec2 uv=vec2(fract(0.5+lon/6.2831853),0.5+lat/3.14159265);
 if(hasTexture>0.5){
   vec3 rock=texture2D(moon,uv).rgb;
   return mix(rock,vec3(dot(rock,vec3(0.3,0.59,0.11))),0.26);
 }
 float land=0.65*noise(uv*vec2(80.0,46.0))
           +0.24*noise(uv*vec2(360.0,180.0))
           +0.11*noise(uv*vec2(1200.0,600.0));
 float spots=pow(noise(uv*vec2(28.0,15.0)),2.7);
 return vec3(0.38+0.32*land-0.12*spots);
}
// Prototype: the terrain-aware ray march below calls this before its definition.
float sphereHit(vec3 origin,vec3 ray,vec3 center,float radius);
/* Terrain heights decode 12-bit values packed into PNG R (high) and the upper
   nibble of G (low). Sources: NASA LOLA polar grid (data/relief.json) and the
   native-resolution DEM patch at the selected waypoint. */
float hDecode(vec3 c,vec4 cfg){
 float code=floor(c.r*255.0+0.5)*16.0+floor(c.g*255.0+0.5)/16.0;
 return cfg.y+code/4095.0*cfg.x;
}
vec2 polarUV(vec3 n){
 float lat=asin(clamp(n.z,-1.0,1.0));
 float lon=atan(n.y,n.x);
 float r=2.0*1737400.0*tan((1.5707963+lat)*0.5);
 float dom=931200.0;
 return vec2((r*sin(lon)+dom)/(2.0*dom),(dom-r*cos(lon))/(2.0*dom));
}
vec2 northUV(vec3 n){
 float lat=asin(clamp(n.z,-1.0,1.0));
 float lon=atan(n.y,n.x);
 float r=2.0*1737400.0*tan((1.5707963-lat)*0.5);
 float dom=931200.0;
 return vec2((r*sin(lon)+dom)/(2.0*dom),(r*cos(lon)+dom)/(2.0*dom));
}
float heightAt(vec3 n){
 float lat=asin(clamp(n.z,-1.0,1.0));
 float lon=atan(n.y,n.x);
 float rS=2.0*1737400.0*tan((1.5707963+lat)*0.5);
 float rN=2.0*1737400.0*tan((1.5707963-lat)*0.5);
 float polarH=0.0,globalH=0.0,pr=0.0;
 bool hasPolar=false,hasGlobal=false;
 if(reliefCfg.w>0.5&&rS<=945000.0){
   vec2 uv=polarUV(n);
   if(uv.x>0.002&&uv.x<0.998&&uv.y>0.002&&uv.y<0.998){polarH=hDecode(texture2D(reliefMap,uv).rgb,reliefCfg);hasPolar=true;pr=rS;}
 }
 if(!hasPolar&&northCfg.w>0.5&&rN<=945000.0){
   vec2 uv=northUV(n);
   if(uv.x>0.002&&uv.x<0.998&&uv.y>0.002&&uv.y<0.998){polarH=hDecode(texture2D(northMap,uv).rgb,northCfg);hasPolar=true;pr=rN;}
 }
 if(globalCfg.z>0.5){
   vec2 guv=vec2(fract((lon+3.14159265)/6.2831853),(1.5707963-lat)/3.14159265);
   globalH=hDecode(texture2D(globalMap,guv).rgb,globalCfg);hasGlobal=true;
 }
 float base;
 if(hasPolar&&hasGlobal)
   base=mix(polarH,globalH,smoothstep(915000.0,940000.0,pr)); // narrow fade over the grid edge
 else if(hasPolar)base=polarH;
 else if(hasGlobal)base=globalH;
 else base=0.0;
 if(patchCfg.w>0.5){
   vec2 puv=vec2((rS*sin(lon)-patchGeo.x)/patchGeo.z,(patchGeo.y-rS*cos(lon))/patchGeo.w);
   if(puv.x>0.0&&puv.x<1.0&&puv.y>0.0&&puv.y<1.0){
     float patchH=hDecode(texture2D(patchMap,puv).rgb,patchCfg);
     // Cross-fade the native-resolution patch into the coarser grid at its
     // border, so the sub-grid relief difference cannot draw a seam.
     float edge=min(min(puv.x,1.0-puv.x),min(puv.y,1.0-puv.y));
     return mix(base,patchH,smoothstep(0.0,0.08,edge));
   }
 }
 return base;
}
float reliefRadius(vec3 dir){return 1.0+reliefExag*heightAt(dir)/1737400.0;}
/* Terrain-aware ray intersection (mirrors src/relief.js): walk in from an
   outer bound and bisect the first crossing of the displaced surface. The
   step adapts to the remaining distance so narrow exaggerated ridges near the
   limb cannot be skipped (fixed steps left holes there at high exaggeration). */
float moonHit(vec3 o,vec3 d){
 float bound=1.0+reliefExag*0.0075;
 float t0=sphereHit(o,d,vec3(0.0),bound);
 if(t0>9.0e5)return 1.0e6;
 float t=t0;
 float f=length(o+t*d)-reliefRadius(normalize(o+t*d));
 if(f<=0.0)return t;
 for(int i=0;i<160;i++){
   float st=clamp(f*0.35,0.0005,0.005);
   float tn=t+st;
   float dn=length(o+tn*d);
   float fn=dn-reliefRadius(normalize(o+tn*d));
   if(fn<=0.0){
     float lo=t,hi=tn;
     for(int j=0;j<8;j++){
       float m=0.5*(lo+hi);
       float dm=length(o+m*d);
       if(dm-reliefRadius(normalize(o+m*d))>0.0)lo=m;else hi=m;
     }
     return 0.5*(lo+hi);
   }
   t=tn;f=fn;
   if(dn<0.9)return t; // inside the deepest possible terrain: already crossed
 }
 return 1.0e6;
}
/* Normals reconstructed from the displaced height field (central differences),
   so lighting follows the real surface shape. */
vec3 terrainNormal(vec3 n){
 vec3 east=normalize(cross(vec3(0.0,0.0,1.0),n));
 vec3 northv=cross(n,east);
 float e=0.004;
 float g1=(heightAt(normalize(n+east*e))-heightAt(normalize(n-east*e)))/(2.0*e*1737400.0);
 float g2=(heightAt(normalize(n+northv*e))-heightAt(normalize(n-northv*e)))/(2.0*e*1737400.0);
 return normalize(n-(g1*east+g2*northv)*reliefExag);
}
/* Orthographic rays through one Moon-fixed 3D coordinate system.
   Depth selects the nearest sphere, rather than compositing three 2D disks. */
float sphereHit(vec3 origin,vec3 ray,vec3 center,float radius){
 if(radius<=0.0)return 1.0e6;
 vec3 offset=origin-center;
 float b=dot(offset,ray);
 float delta=b*b-dot(offset,offset)+radius*radius;
 if(delta<0.0)return 1.0e6;
 float root=sqrt(delta);
 float near=-b-root;
 return near>0.0?near:(-b+root>0.0?-b+root:1.0e6);
}
void main(){
 vec2 screen=(gl_FragCoord.xy-resolution*0.5)/(resolution.y*0.5);
 float scale=0.87*zoom;
 vec3 rayOrigin=forward*4.0+right*screen.x/scale+up*screen.y/scale;
 vec3 ray=-forward;
 vec3 space=vec3(0.023,0.038,0.060);
 space+=0.024*exp(-length(screen-vec2(0.35,-0.1))*1.7)*vec3(0.35,0.7,1.0);
 vec2 starCell=floor(gl_FragCoord.xy/22.0);
 float star=step(0.9955,hash(starCell));
 float glow=pow(max(0.0,1.0-length(fract(gl_FragCoord.xy/22.0)-0.5)*2.0),8.0);
 space+=vec3(0.35,0.53,0.63)*star*glow*0.65;

 float moonT=moonHit(rayOrigin,ray);
 float sunT=1.0e6,earthT=1.0e6;
 vec2 sunPos=vec2(dot(sunSphere.xyz,right),dot(sunSphere.xyz,up))*scale;
 vec2 earthPos=vec2(dot(earthSphere.xyz,right),dot(earthSphere.xyz,up))*scale;
 float sunR=sunSphere.w*scale,earthR=earthSphere.w*scale;
 if(showSkyBodies>0.5){
   sunT=sphereHit(rayOrigin,ray,sunSphere.xyz,sunSphere.w);
   earthT=sphereHit(rayOrigin,ray,earthSphere.xyz,earthSphere.w);
   if(sunR>0.0){
     float outer=max(0.0,(length(screen-sunPos)-sunR)/sunR);
     float halo=exp(-outer*4.0);
     float angle=atan(screen.y-sunPos.y,screen.x-sunPos.x);
     float flare=pow(0.5+0.5*sin(angle*13.0+sin(angle*7.0)*3.0),8.0);
     space+=vec3(0.85,0.32,0.064)*halo*(0.26+0.13*flare);
   }
   if(earthR>0.0){
     float halo=exp(-pow(abs(length(screen-earthPos)/earthR-1.0)*19.0,1.4));
     space+=vec3(0.035,0.25,0.75)*halo*0.20;
   }
 }
 // An occluded or out-of-view sphere cannot draw on top of a nearer body.
 float nearT=min(moonT,min(sunT,earthT));
 if(nearT>9.0e5){gl_FragColor=vec4(space,1.0);return;}

 vec3 hitPoint=rayOrigin+nearT*ray;
 if(sunT<=moonT && sunT<=earthT){
   vec3 normal=normalize(hitPoint-sunSphere.xyz);
   vec3 solar=turned(normal,spinYaw.x,spinPitch.x);
   vec2 pos=solar.xy*9.0+vec2(solar.z*3.4,2.6);
   float cells=fbm(pos*5.5);
   float flows=fbm(pos*0.85+fbm(pos*1.9)*2.7);
   float spots=smoothstep(0.67,0.77,fbm(pos*0.66+vec2(18.0,11.0)));
   float hot=clamp(0.42+0.46*cells+0.26*flows,0.0,1.0);
   vec3 fire=mix(vec3(1.0,0.40,0.07),vec3(1.0,0.96,0.60),hot);
   fire*=1.0-0.58*spots;
   fire*=0.8+0.2*pow(max(dot(normal,forward),0.0),0.48);
   float disk=1.0-smoothstep(0.987,1.01,length(screen-sunPos)/max(sunR,0.001));
   gl_FragColor=vec4(mix(space,fire,disk),1.0);
   return;
 }
 if(earthT<=moonT){
   vec3 normal=normalize(hitPoint-earthSphere.xyz);
   vec3 rot=turned(normal,spinYaw.y,spinPitch.y);
   vec2 uv=vec2(fract(0.5+atan(rot.x,rot.z)/6.2831853),
                0.5+asin(clamp(rot.y,-1.0,1.0))/3.14159265);
   float elevation=fbm(uv*vec2(6.7,4.5)+vec2(2.7,0.0));
   float land=smoothstep(0.455,0.545,elevation);
   float detail=fbm(uv*vec2(33.0,19.0)+vec2(4.1,2.4));
   vec3 ocean=mix(vec3(0.015,0.09,0.21),vec3(0.035,0.30,0.52),0.4+0.6*detail);
   vec3 terrain=mix(vec3(0.075,0.28,0.13),vec3(0.52,0.39,0.24),detail);
   vec3 albedo=mix(ocean,terrain,land);
   albedo=mix(albedo,vec3(0.86,0.91,0.95),smoothstep(0.80,0.95,abs(rot.y))*0.92);
   if(hasEarthTexture>0.5)albedo=texture2D(earthImage,uv).rgb;
   vec2 cloudUV=uv+vec2(elapsedDays*0.005,0.0);
   float clouds=0.85*smoothstep(0.57,0.72,fbm(cloudUV*vec2(23.0,13.0)+vec2(0.0,3.9)));
   clouds+=0.25*smoothstep(0.61,0.75,fbm(cloudUV*vec2(46.0,26.0)));
   albedo=mix(albedo,vec3(0.94,0.98,1.0),clamp(clouds,0.0,0.92));
   // Lighting is based on the Moon-fixed Sun direction, not screen-space dots.
   float daylight=max(0.0,dot(normal,normalize(sun)));
   float reflected=pow(max(0.0,dot(reflect(-normalize(sun),normal),forward))+0.002,28.0);
   vec3 earthColor=albedo*(0.045+0.98*pow(daylight+0.002,0.76));
   earthColor+=vec3(0.13,0.39,0.70)*reflected*0.26*daylight;
   float rim=pow(1.0-max(0.0,dot(normal,forward))+0.002,3.7);
   earthColor+=vec3(0.10,0.42,0.85)*rim*(0.17+0.61*daylight);
   float disk=1.0-smoothstep(0.987,1.013,length(screen-earthPos)/max(earthR,0.001));
   gl_FragColor=vec4(mix(space,earthColor,disk),1.0);
   return;
 }
 vec3 n=normalize(hitPoint);
 vec3 rock=moonAlbedo(n);
 vec3 nl=terrainNormal(n);
 float daylight=max(0.0,dot(nl,normalize(sun)));
 float shade=0.115+0.94*pow(daylight+0.002,0.78);
 float rim=pow(1.0-max(0.0,dot(n,forward))+0.002,4.0);
 vec3 result=rock*shade*vec3(0.97,1.01,1.06);
 result+=vec3(0.18,0.28,0.32)*rim*0.19;
 gl_FragColor=vec4(result,1.0);
}`;

function program(gl){
 const compile=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
   if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){console.warn('Lunar globe shader:',gl.getShaderInfoLog(s));gl.deleteShader(s);throw new Error('Moon shader failed');}return s;};
 const p=gl.createProgram(),vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment);
 gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);
 gl.deleteShader(vs);gl.deleteShader(fs);
 if(!gl.getProgramParameter(p,gl.LINK_STATUS)){console.warn(gl.getProgramInfoLog(p));throw new Error('Moon shader link failed');}
 return p;
}

export function createMap(canvas,{onPick,onHover}){
 const stage=canvas.parentElement;
 const background=document.createElement('canvas');
 background.id='moon-globe';background.setAttribute('aria-hidden','true');
 stage.insertBefore(background,canvas);
 let gl;
 try{gl=background.getContext('webgl',{alpha:false,antialias:true,depth:false});}
 catch(error){console.warn('3D globe unavailable',error);}
 if(!gl){background.remove();const status=document.querySelector('#map-image-status');if(status)status.textContent='2D POLAR SCHEMATIC';return createPolarMap(canvas,{onPick,onHover});}

 let p;
 try{p=program(gl);}catch(error){console.warn(error);background.remove();const status=document.querySelector('#map-image-status');if(status)status.textContent='2D POLAR SCHEMATIC';return createPolarMap(canvas,{onPick,onHover});}
 gl.useProgram(p);
 const loc=name=>gl.getUniformLocation(p,name);
 const u={resolution:loc('resolution'),forward:loc('forward'),right:loc('right'),up:loc('up'),sun:loc('sun'),zoom:loc('zoom'),hasTexture:loc('hasTexture'),showSkyBodies:loc('showSkyBodies'),hasEarthTexture:loc('hasEarthTexture'),elapsedDays:loc('elapsedDays'),sunSphere:loc('sunSphere'),earthSphere:loc('earthSphere'),spinYaw:loc('spinYaw'),spinPitch:loc('spinPitch'),moon:loc('moon'),earthImage:loc('earthImage'),reliefMap:loc('reliefMap'),globalMap:loc('globalMap'),patchMap:loc('patchMap'),northMap:loc('northMap'),reliefCfg:loc('reliefCfg'),globalCfg:loc('globalCfg'),patchCfg:loc('patchCfg'),patchGeo:loc('patchGeo'),northCfg:loc('northCfg'),reliefExag:loc('reliefExag')};
 const quad=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,quad);
 gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
 const position=gl.getAttribLocation(p,'position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
 const texture=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
 gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([160,160,160,255]));
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 // Start with a complete texture so shader sampling always has a valid fallback.
 gl.generateMipmap(gl.TEXTURE_2D);
 gl.uniform1i(u.moon,0);

 let loaded=false,earthLoaded=false,site=SITES[0],zoom=1,lat=-73,lon=25,viewMode='overview',showSkyBodies=true;
 let simulatedUTC=Date.parse('2026-11-14T12:00:00Z'),layout=null,activeBody='moon',celestialDrag=null;
 let terrainRose=null;
 const manualSpin={sun:{yaw:0,pitch:0},earth:{yaw:0,pitch:0},moon:{yaw:0,pitch:0}};
 stage.classList.add('show-celestial-bodies');
 let imageStatus='GLOBE VISUALIZATION';
 const setImageStatus=text=>{imageStatus=text;const el=document.querySelector('#map-image-status');if(el)el.textContent=imageStatus;};
 let sunlight=norm([0.5,0.32,-0.75]),earthlight=norm([0.22,0.18,0.95]),w=0,h=0,dpr=1,frame=0;
 let origin=null,dragging=false,moved=false,suppressCelestialClick=false;
 const ctx=canvas.getContext('2d');
 const axes=()=>{
   const center=spherical(lat,lon),east=[-Math.sin(lon*D),Math.cos(lon*D),0];
   const north=[-Math.sin(lat*D)*Math.cos(lon*D),-Math.sin(lat*D)*Math.sin(lon*D),Math.cos(lat*D)];
   return {center,east,north};
 };
 const project=(point,riseM=0)=>{
   const {center,east,north}=axes(),normal=spherical(point.lat,point.lon),visible=dot(normal,center)>0;
   const r=h*0.5*0.87*zoom*(1+riseM/1737400);
   return {x:w/2+dot(normal,east)*r,y:h/2-dot(normal,north)*r,visible};
 };
 function redraw(){
   frame=0;
   if(!w||!h)return;
   gl.viewport(0,0,background.width,background.height);gl.useProgram(p);
   const a=axes();
   gl.uniform2f(u.resolution,background.width,background.height);
   gl.uniform3fv(u.forward,a.center);gl.uniform3fv(u.right,a.east);gl.uniform3fv(u.up,a.north);
   gl.uniform3fv(u.sun,sunlight);gl.uniform1f(u.zoom,zoom);gl.uniform1f(u.hasTexture,loaded?1:0);
   gl.uniform1f(u.showSkyBodies,showSkyBodies?1:0);gl.uniform1f(u.hasEarthTexture,earthLoaded?1:0);
   gl.uniform1f(u.elapsedDays,simulatedUTC/86400000);
   gl.uniform4fv(u.reliefCfg,reliefCfg);
   gl.uniform4fv(u.globalCfg,globalCfg);
   gl.uniform4fv(u.patchCfg,patchCfg);
   gl.uniform4fv(u.patchGeo,patchGeo);
   gl.uniform4fv(u.northCfg,northCfg);
   gl.uniform1f(u.reliefExag,reliefExag);
   const bodies=['sun','earth','moon'],rotation=celestialSpin(simulatedUTC);
   gl.uniform3fv(u.spinYaw,bodies.map(name=>rotation[name]+manualSpin[name].yaw));
   gl.uniform3fv(u.spinPitch,bodies.map(name=>(name==='earth'?EARTH_BASE_PITCH:0)+manualSpin[name].pitch));
   layout=skyBodies(a,sunlight,earthlight,w,h,0.87*zoom);
   for(const [name,key] of [['sun','sunSphere'],['earth','earthSphere']]){
     const sphere=layout[name];gl.uniform4f(u[key],...sphere.world,showSkyBodies&&sphere.visible?sphere.worldRadius:0);
   }
   positionCelestialLabels();
   gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.drawArrays(gl.TRIANGLES,0,6);
   ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
   const R=h*0.5*0.87*zoom;
   ctx.save();ctx.translate(w/2,h/2);
   ctx.strokeStyle='rgba(174,208,217,0.17)';ctx.lineWidth=1;
   // Lunar parallels are rendered only on the visible hemisphere.
   for(const latitude of [-70,-80,-85,-88]){
     ctx.beginPath();let started=false;
     for(let L=0;L<=360;L+=3){const q=project({lat:latitude,lon:L});const x=q.x-w/2,y=q.y-h/2;
       if(!q.visible){started=false;continue;}
       if(!started){ctx.moveTo(x,y);started=true;}else ctx.lineTo(x,y);
     }
     ctx.stroke();
   }
   // Selected-area crosshair and latitude labels; not a topographic map.
   ctx.setLineDash([3,7]);ctx.strokeStyle='rgba(165,200,210,0.21)';
   ctx.beginPath();ctx.moveTo(-R-16,0);ctx.lineTo(R+16,0);ctx.moveTo(0,-R-16);ctx.lineTo(0,R+16);ctx.stroke();
   ctx.setLineDash([]);
   ctx.strokeStyle='rgba(148,199,218,0.36)';ctx.beginPath();ctx.arc(0,0,R,0,Math.PI*2);ctx.stroke();
   ctx.restore();
   const points=SITES.concat(site.custom?[site]:[]);
   const overlays=points.map(point=>{
     // The selected marker rides the displaced surface at its terrain height.
     const rise=point.id===site.id&&terrainRose&&Number.isFinite(terrainRose.observerHeightM)?terrainRose.observerHeightM*reliefExag:0;
     return {point,pos:project(point,rise)};}).filter(x=>x.pos.visible &&
     (!showSkyBodies||!layout||!['sun','earth'].includes(hitCelestialBody(layout,x.pos.x,x.pos.y,w,h))));
   for(const {point,pos} of overlays){
     const selected=point.id===site.id;
     ctx.save();
     const accent=selected?'#e9f7d8':point.accent||'#b4dbdf';
     ctx.strokeStyle=selected?'rgba(220,246,217,0.85)':'rgba(171,211,227,0.6)';
     ctx.lineWidth=selected?1.4:1;ctx.fillStyle=accent;
     ctx.shadowColor=accent;ctx.shadowBlur=selected?16:8;
     ctx.beginPath();ctx.arc(pos.x,pos.y,selected?5:3,0,Math.PI*2);ctx.fill();
     ctx.shadowBlur=0;ctx.beginPath();ctx.arc(pos.x,pos.y,selected?16:9,0,Math.PI*2);ctx.stroke();
     if(selected){
       const rightSide=pos.x<w-160,tx=pos.x+(rightSide?22:-22);
       ctx.beginPath();ctx.moveTo(pos.x+(rightSide?16:-16),pos.y);ctx.lineTo(tx+(rightSide?12:-12),pos.y-17);ctx.strokeStyle='rgba(217,242,225,0.73)';ctx.stroke();
       ctx.textAlign=rightSide?'left':'right';ctx.font='600 11px "Space Grotesk",sans-serif';
       ctx.fillStyle='#f5faf4';ctx.shadowColor='#000';ctx.shadowBlur=5;ctx.fillText(point.name.toUpperCase(),tx+(rightSide?16:-16),pos.y-22);
       ctx.font='10px "DM Mono",monospace';ctx.fillStyle='#c5d9d6';ctx.fillText(fmtCoord(point.lat,point.lon),tx+(rightSide?16:-16),pos.y-7);
     }
     ctx.restore();
   }
   // Terrain rose at the selected waypoint: line colour = terrain horizon height,
  // line weight = local rate of change (slope) — high weight means strong blocking.
  if(terrainRose&&Array.isArray(terrainRose.elevationDeg)){
    const origin=project({lat:terrainRose.lat,lon:terrainRose.lon});
    if(origin.visible){
      const bins=terrainRose.elevationDeg.length,step=1.2*Math.PI/180;
      const cosLat=Math.max(0.1,Math.cos(terrainRose.lat*Math.PI/180));
      for(let i=0;i<bins;i++){
        const az=terrainRose.azimuthDeg[i]*Math.PI/180;
        const h=terrainRose.elevationDeg[i];
        const slope=Math.abs(terrainRose.elevationDeg[(i+1)%bins]-terrainRose.elevationDeg[(i+bins-1)%bins]);
        const tip=project({lat:terrainRose.lat+Math.cos(az)*step,lon:terrainRose.lon+Math.sin(az)*step/cosLat});
        if(!tip.visible)continue;
        ctx.strokeStyle='rgba(201,155,82,'+(0.22+0.55*Math.min(1,h/30)).toFixed(3)+')';
        ctx.lineWidth=1+Math.min(2.5,slope/4);
        ctx.beginPath();ctx.moveTo(origin.x,origin.y);ctx.lineTo(tip.x,tip.y);ctx.stroke();
      }
    }
  }
  ctx.save();ctx.textAlign='center';ctx.fillStyle='rgba(185,210,218,0.65)';ctx.font='10px "DM Mono",monospace';
   ctx.fillText('DRAG TO ORBIT  ·  CLICK TO INSPECT',w/2,h-23);ctx.restore();
 }
 function positionCelestialLabels(){
   const annotations=stage.querySelector('.celestial-annotations');
   if(!annotations||!layout)return;
   for(const name of ['sun','earth']){
     const sphere=layout[name],label=annotations.querySelector('.celestial-'+name);
     if(!label)continue;
     label.hidden=!showSkyBodies||!sphere.exposed;
     label.style.left=(w/2+sphere.x*h/2)+'px';
     label.style.top=(h/2-sphere.y*h/2+sphere.r*h/2+13)+'px';
   }
   const note=annotations.querySelector('.celestial-disclaimer');
   if(note)note.hidden=!showSkyBodies;
 }
 const request=()=>{if(!frame)frame=requestAnimationFrame(redraw);};
 function size(){
   w=stage.clientWidth;h=stage.clientHeight;dpr=Math.min(devicePixelRatio||1,2);
   if(!w||!h)return;
   for(const el of [canvas,background]){el.width=Math.max(1,Math.round(w*dpr));el.height=Math.max(1,Math.round(h*dpr));el.style.width=w+'px';el.style.height=h+'px';}
   request();
 }
 function nearest(x,y){
   if(showSkyBodies&&layout&&['sun','earth'].includes(hitCelestialBody(layout,x,y,w,h)))return null;
   let target=null,distance=24;
   for(const s of SITES.concat(site.custom?[site]:[])){
     const q=project(s),d=Math.hypot(q.x-x,q.y-y);
     if(q.visible&&d<distance){target=s;distance=d;}
   }
   return target;
 }
 function worldAt(x,y){
   const X=(x-w/2)/(h*0.5*0.87*zoom),Y=(h/2-y)/(h*0.5*0.87*zoom);
   const sq=X*X+Y*Y;if(sq>1)return null;
   const {center,east,north}=axes();
   const n=norm(add(add(center.map(v=>v*Math.sqrt(1-sq)),east,X),north,Y));
   return {lat:Math.asin(clamp(n[2],-1,1))/D,lon:wrap(Math.atan2(n[1],n[0])/D)};
 }
 const where=e=>{const r=canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};};
 canvas.addEventListener('pointerdown',e=>{
   if(e.button!==0)return;
   const point=where(e);
   const body=showSkyBodies&&layout?hitCelestialBody(layout,point.x,point.y,w,h):null;
   if(body==='sun'||body==='earth'){
     activeBody=body;
     celestialDrag={name:body,x:e.clientX,y:e.clientY,pointerId:e.pointerId,moved:false};
     canvas.setPointerCapture(e.pointerId);canvas.style.cursor='grabbing';
     e.preventDefault();return;
   }
   activeBody='moon';origin={x:e.clientX,y:e.clientY,lat,lon};
   moved=false;dragging=true;canvas.setPointerCapture(e.pointerId);
 });
 canvas.addEventListener('pointermove',e=>{
   const point=where(e);
   if(celestialDrag){
     if(celestialDrag.pointerId===e.pointerId){
       const spin=manualSpin[celestialDrag.name];
       if(Math.hypot(e.clientX-celestialDrag.x,e.clientY-celestialDrag.y)>1)celestialDrag.moved=true;
       spin.yaw+=(e.clientX-celestialDrag.x)*0.014;
       spin.pitch=clamp(spin.pitch+(e.clientY-celestialDrag.y)*0.014,-1.35,1.35);
       celestialDrag.x=e.clientX;celestialDrag.y=e.clientY;request();
     }
     onHover(null,e);return;
   }
   if(dragging&&origin){
     const dx=e.clientX-origin.x,dy=e.clientY-origin.y;
     if(Math.hypot(dx,dy)>4)moved=true;
     if(moved){viewMode='manual';lon=wrap(origin.lon-dx*0.3/zoom);lat=clamp(origin.lat+dy*0.24/zoom,-89,89);request();}
     onHover(null,e);
   }else{
     const celestial=showSkyBodies&&layout?hitCelestialBody(layout,point.x,point.y,w,h):null;
     const near=celestial==='moon'||!celestial?nearest(point.x,point.y):null;
     canvas.style.cursor=near||celestial?'grab':worldAt(point.x,point.y)?'grab':'default';
     onHover(near,e);
   }
 });
 const finish=e=>{
   if(celestialDrag&&celestialDrag.pointerId===e.pointerId){
     suppressCelestialClick=celestialDrag.moved;celestialDrag=null;
   }
   dragging=false;origin=null;
   if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
 };
 canvas.addEventListener('pointerup',finish);canvas.addEventListener('pointercancel',finish);
 canvas.addEventListener('pointerleave',()=>onHover(null));
 canvas.addEventListener('click',e=>{
   if(suppressCelestialClick){suppressCelestialClick=false;return;}
   if(moved){moved=false;return;}
   const pt=where(e),chosen=nearest(pt.x,pt.y);
   if(chosen){onPick(chosen);return;}
   const coordinate=worldAt(pt.x,pt.y);
   if(!coordinate)return;
   onPick({id:'custom',name:'Custom waypoint',region:'User-defined study coordinate',...coordinate,tag:'Custom study',kind:'Exploratory',accent:'#d8f1cf',custom:true,detail:'Coordinates selected on the visual globe. Imagery is not a slope or hazard assessment.'});
 });
 canvas.addEventListener('wheel',e=>{
   if(!worldAt(where(e).x,where(e).y))return;
   e.preventDefault();zoom=zoomLevel(zoom+(e.deltaY<0?0.1:-0.1));request();
 },{passive:false});
 canvas.tabIndex=0;
 canvas.addEventListener('keydown',e=>{
   if(['1','2','3'].includes(e.key)){
     activeBody={1:'sun',2:'earth',3:'moon'}[e.key];
     e.preventDefault();return;
   }
   const k=e.key;
   if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-'].includes(k))return;
   e.preventDefault();
   if(activeBody!=='moon'&&showSkyBodies&&k.startsWith('Arrow')){
     const yaw=k==='ArrowLeft'?-0.14:k==='ArrowRight'?0.14:0;
     const pitch=k==='ArrowUp'?-0.14:k==='ArrowDown'?0.14:0;
     const body=manualSpin[activeBody];body.yaw+=yaw;body.pitch=clamp(body.pitch+pitch,-1.35,1.35);
   }else{
     if(k==='ArrowLeft')lon=wrap(lon+8);if(k==='ArrowRight')lon=wrap(lon-8);
     if(k==='ArrowUp')lat=clamp(lat+6,-89,89);if(k==='ArrowDown')lat=clamp(lat-6,-89,89);
     if(k==='+')zoom=zoomLevel(zoom+0.1);if(k==='-')zoom=zoomLevel(zoom-0.1);
   }
   request();
 });
 // Load real NASA Blue Marble surface imagery, with shader-based oceans/land
 // available when a network request or image CORS permission fails.
 const earthTexture=gl.createTexture();
 gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,earthTexture);
 gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([35,98,154,255]));
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 gl.generateMipmap(gl.TEXTURE_2D);
 gl.uniform1i(u.earthImage,1);
 // NASA relief textures (baked by scripts/build-relief.mjs): the wide global
 // grid loads first and the finer polar grid upgrades it when ready; the
 // waypoint DEM patch uploads separately at native resolution. Heights are
 // 12-bit values packed into R/G (see data/relief.json).
 const makeDataTexture=(unit,repeat)=>{
   const tex=gl.createTexture();
   gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,tex);
   gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]));
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,repeat?gl.REPEAT:gl.CLAMP_TO_EDGE);
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
   return tex;
 };
 const reliefTexture=makeDataTexture(2,false),globalTexture=makeDataTexture(3,true),patchTexture=makeDataTexture(4,false),northTexture=makeDataTexture(5,false);
 gl.uniform1i(u.reliefMap,2);gl.uniform1i(u.globalMap,3);gl.uniform1i(u.patchMap,4);gl.uniform1i(u.northMap,5);
 let reliefCfg=[0,1,1/3880,0],globalCfg=[0,1,0,0],patchCfg=[0,1,1,0],patchGeo=[0,0,1,1],northCfg=[0,1,1/3880,0];
 let reliefExag=1;
 const uploadRelief=(unit,tex,img)=>{
   gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,tex);
   gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
   gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE); // heights are data, not colour
   gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
 };
 fetch('data/relief.json').then(r=>r.ok?r.json():null).then(meta=>{
   if(!meta)return;
   reliefCfg[0]=meta.heightMaxM-meta.heightMinM;reliefCfg[1]=meta.heightMinM;reliefCfg[2]=1/meta.size;
   if(meta.global){globalCfg[0]=meta.global.heightMaxM-meta.global.heightMinM;globalCfg[1]=meta.global.heightMinM;}
   if(meta.north){northCfg[0]=meta.north.heightMaxM-meta.north.heightMinM;northCfg[1]=meta.north.heightMinM;northCfg[2]=1/meta.north.size;}
   request();
 }).catch(()=>{});
 const globalImg=new Image();globalImg.decoding='async';
 globalImg.onload=()=>{uploadRelief(3,globalTexture,globalImg);globalCfg[2]=1;request();};
 globalImg.src='/assets/moon-relief-global.png';
 const northImg=new Image();northImg.decoding='async';
 northImg.onload=()=>{uploadRelief(5,northTexture,northImg);northCfg[3]=1;request();};
 northImg.src='/assets/moon-relief-north.png';
 const reliefImg=new Image();reliefImg.decoding='async';
 reliefImg.onload=()=>{uploadRelief(2,reliefTexture,reliefImg);reliefCfg[3]=1;request();};
 reliefImg.src='/assets/moon-relief.png';
 const earthImg=new Image();earthImg.crossOrigin='anonymous';earthImg.decoding='async';
 earthImg.onload=()=>{
   try{
     gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,earthTexture);
     gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
     gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,earthImg);
     gl.generateMipmap(gl.TEXTURE_2D);
     earthLoaded=true;request();
   }catch(error){console.warn('Blue Marble unavailable; procedural Earth active',error);}
 };
 let triedEarthDirect=false;
 earthImg.onerror=()=>{
   if(!triedEarthDirect){triedEarthDirect=true;earthImg.src='https://svs.gsfc.nasa.gov/vis/a000000/a002900/a002915/bluemarble-1024.png';}
   else console.info('NASA Blue Marble unavailable; using procedural Earth texture');
 };
 earthImg.src='/assets/bluemarble-1024.png';
 const img=new Image();
 img.crossOrigin='anonymous';img.decoding='async';
 img.onload=()=>{
   try{
     gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
     gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
     gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
     gl.generateMipmap(gl.TEXTURE_2D);
     loaded=true;setImageStatus('NASA LROC IMAGERY · LOADED');request();
   }catch(e){console.warn('LROC map not available; using procedural texture.',e);}
 };
 let triedDirect=false;
 img.onerror=()=>{
   if(!triedDirect){triedDirect=true;img.src='https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg';}
   else{console.warn('NASA globe imagery could not load; procedural visual fallback is active.');setImageStatus('PROCEDURAL MOON · IMAGE UNAVAILABLE');}
 };
 img.src='/assets/lroc-color.jpg';
 if(typeof ResizeObserver!=='undefined')new ResizeObserver(size).observe(stage);
 else window.addEventListener('resize',size);
 size();
 return {
   setCelestialVisible(enabled){
     showSkyBodies=Boolean(enabled);
     stage.classList.toggle('show-celestial-bodies',showSkyBodies);
     canvas.setAttribute('aria-label','Interactive Moon globe. Drag the Moon to orbit; drag visible Earth or Sun to spin them. Keyboard: 1 Sun, 2 Earth, 3 Moon; arrow keys rotate selected body. All spheres share Moon-fixed coordinates; their distances and sizes are compressed for visibility.');
     request();return showSkyBodies;
   },
   rotateBody(name,yaw,pitch=0){
     if(!Object.hasOwn(manualSpin,name))return;
     if(name==='moon'){lon=wrap(lon-yaw/D);lat=clamp(lat+pitch/D,-89,89);viewMode='manual';}
     else{manualSpin[name].yaw+=yaw;manualSpin[name].pitch=clamp(manualSpin[name].pitch+pitch,-1.35,1.35);}
     request();
   },
   resetBodies(){for(const name of ['sun','earth'])manualSpin[name]={yaw:0,pitch:0};request();},
   render(newSite=site){
     site=newSite;
     if(!newSite.custom){
       lon=wrap(newSite.lon);
       lat=viewMode==='focus'?clamp(newSite.lat,-89,50):-73;
     }
     request();
   },
   focusSite(){viewMode='focus';lat=clamp(site.lat,-89,50);lon=wrap(site.lon);zoom=1.35;request();return Math.round(zoom*100);},
   zoomBy(delta){zoom=zoomLevel(zoom+delta);request();return Math.round(zoom*100);},
   resetView(){viewMode='overview';lat=-73;lon=wrap(site.lon);zoom=1;request();return 100;},
   setSun(obs,focus=site){
     sunlight=horizontalToLunarVector(obs.sun,focus.lat,focus.lon);
     earthlight=horizontalToLunarVector(obs.earth,focus.lat,focus.lon);
     // Earth texture rotation follows the selected UTC inspection time.
     const ms=Date.parse(obs.time);
     if(Number.isFinite(ms))simulatedUTC=ms;
     request();
   },
   setTerrainRose(profile){terrainRose=profile||null;request();},
   setTerrainPatch(patch){
     if(!patch||!patch.data){patchCfg[3]=0;request();return;}
     const {data,width,height,originX,originY,resolutionX,resolutionY,minM,maxM}=patch;
     const range=(maxM-minM)||1;
     const codes=new Uint8Array(width*height*3);
     for(let i=0;i<data.length;i++){
       const v=Math.max(0,Math.min(4095,Math.round(((Number(data[i])||0)-minM)/range*4095)));
       codes[i*3]=v>>4;codes[i*3+1]=(v&15)<<4;
     }
     gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,patchTexture);
     gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
     gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,codes);
     patchCfg=[range,minM,1/Math.max(width,height),1];
     patchGeo=[originX,originY,width*resolutionX,height*Math.abs(resolutionY)];
     request();
   },
   setReliefExaggeration(v){reliefExag=Math.max(0.2,Math.min(12,Number(v)||1));request();}
 };
}
