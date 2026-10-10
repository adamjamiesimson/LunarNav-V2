/**
 * Immersive lunar globe — a dependency-free WebGL visualization backed by the
 * NASA SVS 2025 LROC color map. Surface appearance is visual context only;
 * it is NOT a terrain horizon model, elevation dataset or landing-risk map.
 * https://svs.gsfc.nasa.gov/4720/
 *
 * The original polar schematic remains available as a WebGL fallback.
 */
import {SITES,fmtCoord} from './sites.js';
import {createMap as createPolarMap} from './map.js';

const D=Math.PI/180;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const wrap=n=>((n%360)+360)%360;
const spherical=(lat,lon)=>[Math.cos(lat*D)*Math.cos(lon*D),Math.cos(lat*D)*Math.sin(lon*D),Math.sin(lat*D)];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const norm=a=>{const d=Math.hypot(...a)||1;return a.map(x=>x/d);};
const add=(a,b,k=1)=>a.map((x,i)=>x+k*b[i]);
const vertex=String.raw`attribute vec2 position;
void main(){gl_Position=vec4(position,0.0,1.0);}`;
const fragment=String.raw`precision highp float;
uniform vec2 resolution;
uniform vec3 forward, right, up, sun;
uniform float zoom, hasTexture;
uniform sampler2D moon;
float hash(vec2 x){return fract(sin(dot(x,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
             mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
void main(){
 vec2 screen=(gl_FragCoord.xy-resolution*0.5)/(resolution.y*0.5);
 float radius=0.87*zoom, rr=dot(screen,screen)/(radius*radius);
 vec3 space=vec3(0.023,0.038,0.060);
 space+=0.024*exp(-length(screen-vec2(0.35,-0.1))*1.7)*vec3(0.35,0.7,1.0);
 vec2 starCell=floor(gl_FragCoord.xy/22.0);
 float star=step(0.9955,hash(starCell));
 float glow=pow(max(0.0,1.0-length(fract(gl_FragCoord.xy/22.0)-0.5)*2.0),8.0);
 space+=vec3(0.35,0.53,0.63)*star*glow*0.65;
 if(rr>=1.0){gl_FragColor=vec4(space,1.0);return;}
 float z=sqrt(max(0.0,1.0-rr));
 vec3 n=normalize(right*screen.x/radius+up*screen.y/radius+forward*z);
 float lon=atan(n.y,n.x);
 float lat=asin(clamp(n.z,-1.0,1.0));
 vec2 uv=vec2(fract(0.5+lon/6.2831853),0.5+lat/3.14159265);
 vec3 rock;
 if(hasTexture>0.5){
    rock=texture2D(moon,uv).rgb;
    rock=mix(rock,vec3(dot(rock,vec3(0.3,0.59,0.11))),0.26);
 }else{
    float land=0.65*noise(uv*vec2(80.0,46.0))
              +0.24*noise(uv*vec2(360.0,180.0))
              +0.11*noise(uv*vec2(1200.0,600.0));
    float spots=pow(noise(uv*vec2(28.0,15.0)),2.7);
    rock=vec3(0.38+0.32*land-0.12*spots);
 }
 float daylight=max(0.0,dot(n,normalize(sun)));
 float shade=0.115+0.94*pow(daylight,0.78);
 float rim=pow(1.0-z,4.0);
 vec3 result=rock*shade*vec3(0.97,1.01,1.06);
 result+=vec3(0.18,0.28,0.32)*rim*0.19;
 result=mix(result,space,smoothstep(0.994,1.0,rr)*0.24);
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
 if(!gl){background.remove();return createPolarMap(canvas,{onPick,onHover});}

 let p;
 try{p=program(gl);}catch(error){console.warn(error);background.remove();return createPolarMap(canvas,{onPick,onHover});}
 gl.useProgram(p);
 const loc=name=>gl.getUniformLocation(p,name);
 const u={resolution:loc('resolution'),forward:loc('forward'),right:loc('right'),up:loc('up'),sun:loc('sun'),zoom:loc('zoom'),hasTexture:loc('hasTexture'),moon:loc('moon')};
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

 let loaded=false,site=SITES[0],zoom=1,lat=-73,lon=25;
 let sunlight=norm([0.5,0.32,-0.75]),w=0,h=0,dpr=1,frame=0;
 let origin=null,dragging=false,moved=false;
 const ctx=canvas.getContext('2d');
 const axes=()=>{
   const center=spherical(lat,lon),east=[-Math.sin(lon*D),Math.cos(lon*D),0];
   const north=[-Math.sin(lat*D)*Math.cos(lon*D),-Math.sin(lat*D)*Math.sin(lon*D),Math.cos(lat*D)];
   return {center,east,north};
 };
 const project=(point)=>{
   const {center,east,north}=axes(),normal=spherical(point.lat,point.lon),visible=dot(normal,center)>0;
   const r=h*0.5*0.87*zoom;
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
   const overlays=points.map(point=>({point,pos:project(point)})).filter(x=>x.pos.visible);
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
   ctx.save();ctx.textAlign='center';ctx.fillStyle='rgba(185,210,218,0.65)';ctx.font='10px "DM Mono",monospace';
   ctx.fillText('DRAG TO ORBIT  ·  CLICK TO INSPECT',w/2,h-23);ctx.restore();
 }
 const request=()=>{if(!frame)frame=requestAnimationFrame(redraw);};
 function size(){
   w=stage.clientWidth;h=stage.clientHeight;dpr=Math.min(devicePixelRatio||1,2);
   if(!w||!h)return;
   for(const el of [canvas,background]){el.width=Math.max(1,Math.round(w*dpr));el.height=Math.max(1,Math.round(h*dpr));el.style.width=w+'px';el.style.height=h+'px';}
   request();
 }
 function nearest(x,y){
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
   origin={x:e.clientX,y:e.clientY,lat,lon};moved=false;dragging=true;canvas.setPointerCapture(e.pointerId);
 });
 canvas.addEventListener('pointermove',e=>{
   const point=where(e);
   if(dragging&&origin){
     const dx=e.clientX-origin.x,dy=e.clientY-origin.y;
     if(Math.hypot(dx,dy)>4)moved=true;
     if(moved){lon=wrap(origin.lon-dx*0.3/zoom);lat=clamp(origin.lat+dy*0.24/zoom,-89,60);request();}
     onHover(null,e);
   }else{
     const near=nearest(point.x,point.y);canvas.style.cursor=near?'pointer':worldAt(point.x,point.y)?'grab':'default';onHover(near,e);
   }
 });
 const finish=e=>{dragging=false;origin=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);};
 canvas.addEventListener('pointerup',finish);canvas.addEventListener('pointercancel',finish);
 canvas.addEventListener('pointerleave',()=>onHover(null));
 canvas.addEventListener('click',e=>{
   if(moved){moved=false;return;}
   const pt=where(e),chosen=nearest(pt.x,pt.y);
   if(chosen){onPick(chosen);return;}
   const coordinate=worldAt(pt.x,pt.y);
   if(!coordinate)return;
   onPick({id:'custom',name:'Custom waypoint',region:'User-defined study coordinate',...coordinate,tag:'Custom study',kind:'Exploratory',accent:'#d8f1cf',custom:true,detail:'Coordinates selected on the visual globe. Imagery is not a slope or hazard assessment.'});
 });
 canvas.addEventListener('wheel',e=>{
   if(!worldAt(where(e).x,where(e).y))return;
   e.preventDefault();zoom=clamp(zoom+(e.deltaY<0?0.1:-0.1),0.8,2.1);request();
 },{passive:false});
 canvas.tabIndex=0;
 canvas.addEventListener('keydown',e=>{
   const k=e.key;
   if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-'].includes(k))return;
   e.preventDefault();
   if(k==='ArrowLeft')lon=wrap(lon+8);if(k==='ArrowRight')lon=wrap(lon-8);
   if(k==='ArrowUp')lat=clamp(lat+6,-89,60);if(k==='ArrowDown')lat=clamp(lat-6,-89,60);
   if(k==='+')zoom=clamp(zoom+0.1,0.8,2.1);if(k==='-')zoom=clamp(zoom-0.1,0.8,2.1);
   request();
 });
 const img=new Image();
 img.crossOrigin='anonymous';img.decoding='async';
 img.onload=()=>{
   try{
     gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
     gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
     gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
     gl.generateMipmap(gl.TEXTURE_2D);
     loaded=true;request();
   }catch(e){console.warn('LROC map not available; using procedural texture.',e);}
 };
 img.onerror=()=>console.warn('NASA globe imagery could not load; procedural visual fallback is active.');
 img.src='https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg';
 if(typeof ResizeObserver!=='undefined')new ResizeObserver(size).observe(stage);
 else window.addEventListener('resize',size);
 size();
 return {
   render(newSite=site){site=newSite;if(!newSite.custom)lon=wrap(newSite.lon);request();},
   zoomBy(delta){zoom=clamp(zoom+delta,0.8,2.1);request();return Math.round(zoom*100);},
   resetView(){lat=-73;lon=wrap(site.lon);zoom=1;request();return 100;},
   setSun(obs,focus=site){
     const az=obs.sun.azimuth*D,el=obs.sun.elevation*D,phi=focus.lat*D,theta=focus.lon*D;
     const east=[-Math.sin(theta),Math.cos(theta),0];
     const north=[-Math.sin(phi)*Math.cos(theta),-Math.sin(phi)*Math.sin(theta),Math.cos(phi)];
     const up=spherical(focus.lat,focus.lon);
     sunlight=norm(add(add(up.map(x=>x*Math.sin(el)),north,Math.cos(el)*Math.cos(az)),east,Math.cos(el)*Math.sin(az)));
     request();
   }
 };
}
