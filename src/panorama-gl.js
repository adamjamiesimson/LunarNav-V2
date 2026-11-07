/**
 * True first-person surface panorama: a Google-Street-View-style look-around
 * at any waypoint, generated from the same NASA DEM heights the 3D globe
 * displaces (native waypoint patch near field, baked grid beyond). Each pixel
 * is a ray marched against the displaced terrain; the terrain is lit by the
 * real Sun direction from the shared ephemeris (Earth adds a faint fill), and
 * the Sun (0.53°) and Earth (1.98°) discs sit at their real azimuth/elevation,
 * occluded by terrain. The star field is decorative and labelled as such.
 */
import {directionFromAzEl,projectDirection,horizonAtAzimuth} from './panorama.js';

const RAD=Math.PI/180;

const VERTEX=`
attribute vec2 aPos;
void main(){gl_Position=vec4(aPos,0.0,1.0);}
`;

const FRAGMENT=`
precision highp float;
uniform vec2 uRes;
uniform vec3 uCamDir,uCamRight,uCamUp,uSunDir,uEarthDir;
uniform float uTanFov,uLat,uLon,uGridMode,uHasPatch,uHasEarth;
uniform vec4 uGridCfg,uPatchCfg,uPatchGeo;
uniform sampler2D uGrid,uPatch;

float hDecode(vec3 c,vec4 cfg){
  float code=floor(c.r*255.0+0.5)*16.0+floor(c.g*255.0+0.5)/16.0;
  return cfg.y+code/4095.0*cfg.x;
}
float gridHeight(float lat,float lon){
  if(uGridMode>1.5){
    vec2 guv=vec2(fract((lon+3.14159265)/6.2831853),(1.5707963-lat)/3.14159265);
    return hDecode(texture2D(uGrid,guv).rgb,uGridCfg);
  }
  float rS=2.0*1737400.0*tan((1.5707963+lat)*0.5);
  float rN=2.0*1737400.0*tan((1.5707963-lat)*0.5);
  float r=uGridMode<0.5?rS:rN;
  vec2 uv=uGridMode<0.5
    ? vec2((r*sin(lon)+931200.0)/1862400.0,(931200.0-r*cos(lon))/1862400.0)
    : vec2((r*sin(lon)+931200.0)/1862400.0,(r*cos(lon)+931200.0)/1862400.0);
  return hDecode(texture2D(uGrid,uv).rgb,uGridCfg);
}
float terrainH(float x,float y){
  float lat=uLat+y/1737400.0;
  float lon=uLon+x/(1737400.0*max(0.05,cos(uLat)));
  float base=gridHeight(lat,lon);
  if(uHasPatch>0.5){
    float rS=2.0*1737400.0*tan((1.5707963+lat)*0.5);
    vec2 puv=vec2((rS*sin(lon)-uPatchGeo.x)/uPatchGeo.z,(uPatchGeo.y-rS*cos(lon))/uPatchGeo.w);
    if(puv.x>0.0&&puv.x<1.0&&puv.y>0.0&&puv.y<1.0){
      float ph=hDecode(texture2D(uPatch,puv).rgb,uPatchCfg);
      float edge=min(min(puv.x,1.0-puv.x),min(puv.y,1.0-puv.y));
      return mix(base,ph,smoothstep(0.0,0.08,edge));
    }
  }
  return base;
}
float groundZ(float x,float y){return terrainH(x,y)-(x*x+y*y)/3474800.0;}
float starField(vec3 d){
  vec3 p=d*230.0;
  vec3 id=floor(p),f=fract(p)-0.5;
  float h=fract(sin(dot(id,vec3(12.9898,78.233,45.164)))*43758.5453);
  if(h<0.985)return 0.0;
  vec3 off=vec3(fract(h*57.31),fract(h*127.7),fract(h*311.7))-0.5;
  return smoothstep(0.10,0.0,length(f-off*0.7))*(0.25+0.75*fract(h*811.7));
}
/* Procedural micro-relief (ARTISTIC): regolith rolls, mounds, pebbles and
 * shallow dips in metres. Applied only near the camera so it never invents
 * distant landforms: the real DEM owns the silhouette. */
float hash21(vec2 p){
  p=fract(p*vec2(123.34,456.21));
  p+=dot(p,p+45.32);
  return fract(p.x*p.y);
}
float vnoise(vec2 p){
  vec2 i=floor(p),f=fract(p);
  vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash21(i),hash21(i+vec2(1.0,0.0)),u.x),
             mix(hash21(i+vec2(0.0,1.0)),hash21(i+vec2(1.0,1.0)),u.x),u.y);
}
float fbm(vec2 p){
  float v=0.0,a=0.5;
  for(int i=0;i<4;i++){v+=a*vnoise(p);p=p*2.03+vec2(17.3,9.1);a*=0.5;}
  return v;
}
float detailRoll(vec2 p){
  float d=(fbm(p*0.042)-0.5)*3.6;                              // ~24 m rolls
  d+=(fbm(p*0.17)-0.5)*0.9;                                    // ~6 m mounds
  d-=smoothstep(0.58,0.78,fbm(p*0.09+vec2(41.7,23.3)))*1.2;    // shallow dips
  return d;
}
float detailFull(vec2 p){
  float d=detailRoll(p);
  d+=(fbm(p*0.55)-0.5)*0.26;     // ~1.8 m rocks and pits
  d+=(vnoise(p*1.9)-0.5)*0.07;   // pebbles
  return d;
}
void main(){
  vec2 ndc=(gl_FragCoord.xy/uRes)*2.0-1.0;
  float aspect=uRes.x/uRes.y;
  vec3 dir=normalize(uCamDir+uCamRight*(ndc.x*uTanFov*aspect)+uCamUp*(ndc.y*uTanFov));
  float eyeZ=terrainH(0.0,0.0)+1.7;
  vec3 eye=vec3(0.0,0.0,eyeZ);
  float t=0.3,last=0.3,hitT=-1.0,lastDz=1e9;
  for(int i=0;i<420;i++){
    vec3 p=eye+dir*t;
    float micro=t<400.0?detailRoll(p.xy)*exp(-t/220.0):0.0;
    float g=groundZ(p.x,p.y)+micro;
    float dz=p.z-g;
    if(dz<=0.0){
      float a=last,b=t;
      for(int j=0;j<9;j++){
        float m=0.5*(a+b);vec3 pm=eye+dir*m;
        float mm=m<400.0?detailRoll(pm.xy)*exp(-m/220.0):0.0;
        if(pm.z<=groundZ(pm.x,pm.y)+mm)b=m;else a=m;
      }
      hitT=b;break;
    }
    last=t;lastDz=dz;
    // Step sizing prevents the vertical-stripe ("cliff") artifact at grazing
    // angles: shrink when the ray hugs the terrain so ridges are never
    // tunneled through; grow when it flies high above (with distance the
    // curvature term makes the ray gain height quickly).
    t+=clamp(dz*1.15,max(2.5,t*0.0035),t*0.12);
    if(t>140000.0)break;
  }
  // A ray that exhausted its budget while still grazing the surface is
  // looking along distant terrain (the silhouette band): render terrain at
  // the last sample instead of punching a see-through sky gap. Rays with
  // real clearance (open sky) keep their large dz and stay sky.
  if(hitT<0.0&&lastDz<max(45.0,t*0.02))hitT=t;
  vec3 col;
  if(hitT<0.0){
    col=vec3(0.011,0.014,0.018)+vec3(0.55,0.58,0.62)*starField(dir)*0.4; // decorative
    float sunAng=acos(clamp(dot(dir,uSunDir),-1.0,1.0));
    if(sunAng<0.00465)col=vec3(1.0,0.96,0.88); // real solar angular size 0.53 deg
    col+=vec3(1.0,0.83,0.55)*exp(-max(0.0,sunAng-0.00465)*40.0)*0.26;
    if(uHasEarth>0.5){
      float earthAng=acos(clamp(dot(dir,uEarthDir),-1.0,1.0));
      float earthR=0.0166; // Earth subtends ~1.98 deg from the Moon
      if(earthAng<earthR){
        float limb=sqrt(max(0.0,1.0-pow(earthAng/earthR,2.0)));
        col=vec3(0.24,0.36,0.44)+vec3(0.20,0.24,0.22)*limb;
      }
    }
  }else{
    vec3 p=eye+dir*hitT;
    float e=max(1.5,hitT*0.006);
    float hx=groundZ(p.x+e,p.y)-groundZ(p.x-e,p.y);
    float hy=groundZ(p.x,p.y+e)-groundZ(p.x,p.y-e);
    vec3 n=normalize(vec3(-hx/(2.0*e),-hy/(2.0*e),1.0));
    // Micro-relief shading (ARTISTIC): pebble-to-mound normal perturbation,
    // faded with distance so the far field keeps the real DEM shape.
    float dw=exp(-hitT/140.0);
    if(dw>0.01){
      float de=max(0.06,hitT*0.0012);
      float ddx=detailFull(p.xy+vec2(de,0.0))-detailFull(p.xy-vec2(de,0.0));
      float ddy=detailFull(p.xy+vec2(0.0,de))-detailFull(p.xy-vec2(0.0,de));
      n=normalize(n+vec3(-ddx/(2.0*de),-ddy/(2.0*de),0.0)*dw);
    }
    float lam=max(0.0,dot(n,uSunDir));
    float earthL=max(0.0,dot(n,uEarthDir));
    // Regolith albedo (ARTISTIC): macro mottling that persists to distance,
    // local mottle and rare bright ejecta specks near the camera.
    float macro=(fbm(p.xy*0.006)-0.5)*0.22;
    float mottle=(fbm(p.xy*0.08)-0.5)*0.18*dw;
    float speck=step(0.972,hash21(floor(p.xy*16.0)))*0.12*exp(-hitT/45.0);
    float alb=max(0.05,0.46+macro+mottle+speck);
    col=vec3(alb*0.97,alb,alb*1.05)*(0.035+0.95*lam)+vec3(0.14,0.20,0.24)*earthL*(uHasEarth>0.5?0.5:0.0);
  }
  gl_FragColor=vec4(col,1.0);
}
`;

function compile(gl,type,source){
  const shader=gl.createShader(type);
  gl.shaderSource(shader,source);
  gl.compileShader(shader);
  if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))
    throw Error('panorama shader: '+gl.getShaderInfoLog(shader));
  return shader;
}
function program(gl){
  const p=gl.createProgram();
  gl.attachShader(p,compile(gl,gl.VERTEX_SHADER,VERTEX));
  gl.attachShader(p,compile(gl,gl.FRAGMENT_SHADER,FRAGMENT));
  gl.linkProgram(p);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS))
    throw Error('panorama program: '+gl.getProgramInfoLog(p));
  return p;
}
function loadTexture(gl,url){
  return new Promise((resolve,reject)=>{
    const texture=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([8,10,12,255]));
    const img=new Image();
    img.onload=()=>{
      gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      resolve(texture);
    };
    img.onerror=()=>reject(Error('relief grid unavailable: '+url));
    img.src=url;
  });
}

const GRID_FILES={
  south:'/assets/moon-relief.png',
  north:'/assets/moon-relief-north.png',
  global:'/assets/moon-relief-global.png'
};

/**
 * Build the interactive surface view. Throws when WebGL is unavailable so the
 * caller can fall back to the cylindrical panorama.
 */
export async function createSurfaceView(canvas,{site,obs,patch=null,hud=null,
  onHeading=null,bodyLabel=null,maxDevicePixelRatio=1.25}={}){
  const gl=canvas.getContext('webgl',{antialias:true,alpha:false});
  if(!gl)throw Error('WebGL unavailable for the surface view');
  const prog=program(gl);
  gl.useProgram(prog);
  const buffer=gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  const aPos=gl.getAttribLocation(prog,'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
  const loc=name=>gl.getUniformLocation(prog,name);
  const u={res:loc('uRes'),camDir:loc('uCamDir'),camRight:loc('uCamRight'),camUp:loc('uCamUp'),
    sunDir:loc('uSunDir'),earthDir:loc('uEarthDir'),tanFov:loc('uTanFov'),lat:loc('uLat'),lon:loc('uLon'),
    gridMode:loc('uGridMode'),gridCfg:loc('uGridCfg'),grid:loc('uGrid'),
    hasPatch:loc('uHasPatch'),patchCfg:loc('uPatchCfg'),patchGeo:loc('uPatchGeo'),patch:loc('uPatch'),
    hasEarth:loc('uHasEarth')};

  const meta=await fetch('data/relief.json').then(r=>{
    if(!r.ok)throw Error('relief metadata unavailable');
    return r.json();
  });
  const polar=Math.abs(site.lat)>=60;
  const gridKey=polar?(site.lat>0?'north':'south'):'global';
  const block=gridKey==='south'?meta:(meta[gridKey]||null);
  if(!block||block.heightMinM==null)throw Error('relief metadata missing the '+gridKey+' grid');
  const gridTexture=await loadTexture(gl,GRID_FILES[gridKey]);
  const gridMode=gridKey==='global'?2:(gridKey==='north'?1:0);
  const gridCfg=[(block.heightMaxM-block.heightMinM)||1,block.heightMinM,0,1];

  let patchTexture=null,patchCfg=[1,0,0,0],patchGeo=[0,0,1,1];
  function uploadPatch(patch){
    if(!patch||!patch.data){patchCfg[3]=0;return;}
    const {data,width,height,originX,originY,resolutionX,resolutionY,minM,maxM}=patch;
    const range=(maxM-minM)||1;
    const codes=new Uint8Array(width*height*3);
    for(let i=0;i<data.length;i++){
      const v=Math.max(0,Math.min(4095,Math.round(((Number(data[i])||0)-minM)/range*4095)));
      codes[i*3]=v>>4;codes[i*3+1]=(v&15)<<4;
    }
    if(!patchTexture)patchTexture=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,patchTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,codes);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    patchCfg=[range,minM,1/Math.max(width,height),1];
    patchGeo=[originX,originY,width*resolutionX,height*Math.abs(resolutionY)];
  }
  uploadPatch(patch);

  let yaw=0,pitch=2,fov=75,pointer=null,raf=0;
  const camera=()=>({yawDeg:yaw,pitchDeg:pitch,fovDeg:fov,aspect:canvas.width/Math.max(1,canvas.height)});
  const bodyDir=body=>body?directionFromAzEl(body.azimuth,body.elevation):null;

  function drawHUD(){
    if(!hud)return;
    const ctx=hud.getContext('2d');
    const w=hud.width,h=hud.height;
    ctx.clearRect(0,0,w,h);
    ctx.font='11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline='middle';
    // Compass strip: real azimuth ticks projected through the camera.
    for(let az=0;az<360;az+=15){
      const p=projectDirection(directionFromAzEl(az,0),camera());
      if(!p.visible||p.x<-0.05||p.x>1.05)continue;
      const x=p.x*w,y=p.y*h;
      const major=az%45===0;
      ctx.strokeStyle='rgba(230,234,236,'+(major?0.5:0.25)+')';
      ctx.beginPath();ctx.moveTo(x,y-12);ctx.lineTo(x,y-(major?26:18));ctx.stroke();
      if(major){
        const names={0:'N',45:'NE',90:'E',135:'SE',180:'S',225:'SW',270:'W',315:'NW'};
        ctx.fillStyle='rgba(230,234,236,0.85)';
        ctx.textAlign='center';
        ctx.fillText(names[az]+' '+az+'°',x,y-36);
        ctx.textAlign='left';
      }
    }
    // Centre reticle.
    ctx.strokeStyle='rgba(230,234,236,0.35)';
    ctx.beginPath();
    ctx.moveTo(w/2-8,h/2);ctx.lineTo(w/2-2,h/2);
    ctx.moveTo(w/2+2,h/2);ctx.lineTo(w/2+8,h/2);
    ctx.moveTo(w/2,h/2-8);ctx.lineTo(w/2,h/2-2);
    ctx.moveTo(w/2,h/2+2);ctx.lineTo(w/2,h/2+8);
    ctx.stroke();
    // Body labels at their projected positions.
    for(const [body,color] of [[obs?.earth,'#9BC4D0'],[obs?.sun,'#E4C084']]){
      if(!body)continue;
      const p=projectDirection(bodyDir(body),camera());
      if(!p.visible||p.x<-0.1||p.x>1.1||p.y<-0.1||p.y>1.1)continue;
      const x=p.x*w,y=p.y*h;
      ctx.strokeStyle=color;ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,y-26);ctx.stroke();
      ctx.fillStyle=color;ctx.textAlign='center';
      const name=body===obs.sun?'SUN':'EARTH';
      const status=bodyLabel?bodyLabel(body):'';
      ctx.fillText(name+' · '+body.azimuth.toFixed(0)+'° AZ · '+body.elevation.toFixed(1)+'° EL',x,y-34);
      if(status)ctx.fillText(status,x,y-20);
      ctx.textAlign='left';
    }
    ctx.lineWidth=1;
  }

  function render(){
    const dpr=Math.min(window.devicePixelRatio||1,maxDevicePixelRatio);
    const w=Math.max(2,Math.round(canvas.clientWidth*dpr)),h=Math.max(2,Math.round(canvas.clientHeight*dpr));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;if(hud){hud.width=w;hud.height=h;}}
    const {forward,right,up}=(()=>{const y=yaw*RAD,p=pitch*RAD;
      return {forward:{x:Math.sin(y)*Math.cos(p),y:Math.cos(y)*Math.cos(p),z:Math.sin(p)},
        right:{x:Math.cos(y),y:-Math.sin(y),z:0},
        up:{x:-Math.sin(y)*Math.sin(p),y:-Math.cos(y)*Math.sin(p),z:Math.cos(p)}};})();
    gl.viewport(0,0,w,h);
    gl.uniform2f(u.res,w,h);
    gl.uniform3f(u.camDir,forward.x,forward.y,forward.z);
    gl.uniform3f(u.camRight,right.x,right.y,right.z);
    gl.uniform3f(u.camUp,up.x,up.y,up.z);
    gl.uniform1f(u.tanFov,Math.tan(fov/2*RAD));
    gl.uniform1f(u.lat,site.lat*RAD);
    gl.uniform1f(u.lon,site.lon*RAD);
    gl.uniform1f(u.gridMode,gridMode);
    gl.uniform4fv(u.gridCfg,gridCfg);
    gl.uniform1f(u.hasPatch,patchTexture?1:0);
    gl.uniform4fv(u.patchCfg,patchCfg);
    gl.uniform4fv(u.patchGeo,patchGeo);
    const sun=bodyDir(obs?.sun),earth=bodyDir(obs?.earth);
    if(sun)gl.uniform3f(u.sunDir,sun.x,sun.y,sun.z);
    if(earth){gl.uniform3f(u.earthDir,earth.x,earth.y,earth.z);gl.uniform1f(u.hasEarth,1);}
    else gl.uniform1f(u.hasEarth,0);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,gridTexture);gl.uniform1i(u.grid,0);
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,patchTexture||gridTexture);gl.uniform1i(u.patch,1);
    gl.drawArrays(gl.TRIANGLES,0,3);
    drawHUD();
    if(onHeading)onHeading(((yaw%360)+360)%360);
  }
  function schedule(){if(!raf)raf=requestAnimationFrame(()=>{raf=0;render();});}

  const onDown=e=>{pointer={x:e.clientX,y:e.clientY};canvas.setPointerCapture?.(e.pointerId);canvas.style.cursor='grabbing';};
  const onMove=e=>{
    if(!pointer)return;
    yaw+=(e.clientX-pointer.x)*0.22;
    pitch=Math.max(-89,Math.min(89,pitch-(e.clientY-pointer.y)*0.22));
    pointer={x:e.clientX,y:e.clientY};
    schedule();
  };
  const onUp=()=>{pointer=null;canvas.style.cursor='grab';};
  const onWheel=e=>{e.preventDefault();fov=Math.max(35,Math.min(100,fov+e.deltaY*0.05));schedule();};
  const onKey=e=>{
    const step=e.shiftKey?10:4;
    if(e.key==='ArrowLeft')yaw-=step;
    else if(e.key==='ArrowRight')yaw+=step;
    else if(e.key==='ArrowUp')pitch=Math.min(89,pitch+step);
    else if(e.key==='ArrowDown')pitch=Math.max(-89,pitch-step);
    else if(e.key==='+'||e.key==='=')fov=Math.max(35,fov-5);
    else if(e.key==='-')fov=Math.min(100,fov+5);
    else if(e.key==='r'||e.key==='R'){yaw=0;pitch=2;fov=75;}
    else return;
    e.preventDefault();schedule();
  };
  const onDbl=()=>{yaw=0;pitch=2;fov=75;schedule();};
  const onResize=()=>schedule();
  // The overlay starts hidden (zero-size canvas): re-render as soon as it
  // gains real size, so the first frame is never a stretched empty buffer.
  const observer=typeof ResizeObserver==='function'?new ResizeObserver(()=>schedule()):null;
  observer?.observe(canvas);
  canvas.style.cursor='grab';
  canvas.tabIndex=0;
  canvas.addEventListener('pointerdown',onDown);
  canvas.addEventListener('pointermove',onMove);
  canvas.addEventListener('pointerup',onUp);
  canvas.addEventListener('pointercancel',onUp);
  canvas.addEventListener('wheel',onWheel,{passive:false});
  canvas.addEventListener('dblclick',onDbl);
  canvas.addEventListener('keydown',onKey);
  window.addEventListener('resize',onResize);
  render();
  return {
    redraw:render,
    setObs(next){obs=next;render();},
    setPatch(next){uploadPatch(next);render();},
    get camera(){return {yawDeg:yaw,pitchDeg:pitch,fovDeg:fov};},
    destroy(){
      if(raf)cancelAnimationFrame(raf);
      observer?.disconnect();
      canvas.removeEventListener('pointerdown',onDown);
      canvas.removeEventListener('pointermove',onMove);
      canvas.removeEventListener('pointerup',onUp);
      canvas.removeEventListener('pointercancel',onUp);
      canvas.removeEventListener('wheel',onWheel);
      canvas.removeEventListener('dblclick',onDbl);
      canvas.removeEventListener('keydown',onKey);
      window.removeEventListener('resize',onResize);
    }
  };
}
