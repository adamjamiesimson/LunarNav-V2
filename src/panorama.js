/**
 * Panoramic surface view: a 360° horizon panorama at any waypoint, ray-marched
 * from the same NASA DEM heights the 3D globe displaces (native waypoint patch
 * first, DEM grid beyond). Sun and Earth are drawn at their real
 * azimuth/elevation from the shared ephemeris. Terrain is shaded by distance
 * and slope; there are no invented textures or lighting effects.
 */
import {MOON_RADIUS_M} from './relief.js';

const DEG=180/Math.PI,RAD=Math.PI/180;
export const ELEV_BOTTOM=-35,ELEV_TOP=55;
export const AZIMUTH_LABELS=[[0,'N'],[45,'NE'],[90,'E'],[135,'SE'],[180,'S'],[225,'SW'],[270,'W'],[315,'NW']];

/** Great-circle destination point on a sphere of lunar radius. */
export function destinationPoint(lat,lon,azimuthDeg,distanceKm){
  const delta=distanceKm*1000/MOON_RADIUS_M;
  const theta=azimuthDeg*RAD,phi1=lat*RAD,lam1=lon*RAD;
  const phi2=Math.asin(Math.sin(phi1)*Math.cos(delta)+Math.cos(phi1)*Math.sin(delta)*Math.cos(theta));
  const lam2=lam1+Math.atan2(Math.sin(theta)*Math.sin(delta)*Math.cos(phi1),
    Math.cos(delta)-Math.sin(phi1)*Math.sin(phi2));
  return {lat:phi2*DEG,lon:((lam2*DEG+540)%360)-180};
}

/** Sample distances: dense near the observer, growing outward. */
export function panoramaDistances(maxDistanceKm=45){
  const out=[];let d=0.08;
  while(d<maxDistanceKm){out.push(d);d*=1.13;}
  out.push(maxDistanceKm);
  return out;
}

/**
 * Ray-march one azimuth ray per bin: for every sample distance record the
 * apparent elevation angle of the terrain above the local horizontal, with
 * the spherical curvature dip subtracted. The maximum angle is that
 * azimuth's horizon (silhouette), with the distance where terrain blocks
 * the sky recorded for shading and for body obstruction.
 */
export function computePanoramaColumns({heightAt,site,azimuthBins=720,maxDistanceKm=45,observerHeightM=1.7}={}){
  if(typeof heightAt!=='function')throw Error('A terrain height sampler is required');
  if(azimuthBins<24||azimuthBins>1440)throw Error('Invalid panorama azimuth bins');
  const h0=(heightAt(site.lat,site.lon)??0)+observerHeightM;
  const distances=panoramaDistances(maxDistanceKm);
  const columns=[];
  for(let a=0;a<azimuthBins;a++){
    const azimuth=a*360/azimuthBins;
    const samples=[];
    let horizonDeg=-90,hitDistanceKm=0,hitHeightM=0,slope=0,valid=false;
    for(const dKm of distances){
      const p=destinationPoint(site.lat,site.lon,azimuth,dKm);
      const h=heightAt(p.lat,p.lon);
      if(h==null||!Number.isFinite(h))continue; // outside the DEM window
      valid=true;
      const angleDeg=Math.atan((h-h0)/(dKm*1000))*DEG-(dKm*1000/(2*MOON_RADIUS_M))*DEG;
      samples.push({dKm,angleDeg,heightM:h});
      if(angleDeg>horizonDeg){horizonDeg=angleDeg;hitDistanceKm=dKm;hitHeightM=h;}
    }
    if(hitDistanceKm>0){
      // Local slope at the silhouette hit: up-slopes face the observer.
      const near=destinationPoint(site.lat,site.lon,azimuth,hitDistanceKm*0.94);
      const far=destinationPoint(site.lat,site.lon,azimuth,hitDistanceKm*1.06);
      const hn=heightAt(near.lat,near.lon),hf=heightAt(far.lat,far.lon);
      if(Number.isFinite(hn)&&Number.isFinite(hf))
        slope=(hf-hn)/(Math.max(0.02,hitDistanceKm*0.12)*1000);
    }
    columns.push({azimuthDeg:azimuth,samples,horizonDeg:valid?horizonDeg:null,hitDistanceKm,hitHeightM,slope});
  }
  return {observerHeightM:h0,columns,maxDistanceKm};
}

/** Nearest sample along a column whose angle reaches the elevation (sky blockers). */
export function distanceForElevation(column,elevationDeg){
  for(const s of column.samples)if(s.angleDeg>=elevationDeg)return s.dKm;
  return null;
}

/** Horizon (silhouette) angle at an azimuth, from the nearest column. */
export function horizonAtAzimuth(panorama,azimuthDeg){
  const bins=panorama.columns.length;
  const index=Math.round((((azimuthDeg%360)+360)%360)/360*bins)%bins;
  const horizon=panorama.columns[index].horizonDeg;
  return horizon==null?-90:horizon;
}

/** Body status relative to the ray-marched horizon: real terrain obstruction. */
export function bodyStatus(panorama,body){
  if(body.elevation<0)return 'Below horizon';
  return body.elevation<horizonAtAzimuth(panorama,body.azimuth)?'Behind terrain':'Above horizon';
}

const SKY=[9,13,16],SKY_HORIZON=[19,26,31],SILHOUETTE=[201,155,82];
function elevationToY(elevationDeg,height){
  return Math.round((ELEV_TOP-elevationDeg)/(ELEV_TOP-ELEV_BOTTOM)*height);
}
function azimuthToX(azimuthDeg,width,pan){
  return (((azimuthDeg-pan)%360)+360)%360/360*width;
}

/**
 * Render a computed panorama onto a canvas: terrain fill, silhouette edge,
 * elevation/azimuth grid, and Sun/Earth markers. Drag pans the view.
 */
export function createPanoramaView(canvas,{site,panorama,obs}={}){
  const ctx=canvas.getContext('2d');
  const W=canvas.width,H=canvas.height;
  const image=ctx.createImageData(W,H);
  let pan=0,raf=0,pointer=null;
  const colCount=panorama.columns.length;

  function drawTerrain(){
    const data=image.data;
    for(let y=0;y<H;y++){
      const elevation=ELEV_TOP-(y+0.5)/H*(ELEV_TOP-ELEV_BOTTOM);
      const skyMix=Math.max(0,Math.min(1,(elevation+5)/25));
      const sr=SKY[0]+(SKY_HORIZON[0]-SKY[0])*(1-skyMix),
        sg=SKY[1]+(SKY_HORIZON[1]-SKY[1])*(1-skyMix),
        sb=SKY[2]+(SKY_HORIZON[2]-SKY[2])*(1-skyMix);
      for(let x=0;x<W;x++){
        const azimuth=((x+0.5)/W*360+pan)%360;
        const column=panorama.columns[Math.floor(azimuth/360*colCount)%colCount];
        const o=(y*W+x)*4;
        const horizon=column.horizonDeg;
        if(horizon==null||elevation>horizon){
          data[o]=sr;data[o+1]=sg;data[o+2]=sb;data[o+3]=255;
          continue;
        }
        if(horizon-elevation<0.35&&column.hitDistanceKm>0){
          data[o]=SILHOUETTE[0];data[o+1]=SILHOUETTE[1];data[o+2]=SILHOUETTE[2];data[o+3]=255;
          continue;
        }
        const dKm=distanceForElevation(column,elevation)??(column.hitDistanceKm||1);
        // Distance shading: near terrain darker, far terrain brighter toward
        // the horizon; up-slopes facing the observer darkened further.
        const base=0.30+0.45*Math.max(0,Math.min(1,dKm/24));
        const shade=Math.max(0.12,Math.min(1,base*(1-0.30*Math.max(-1,Math.min(1,column.slope)))));
        data[o]=Math.round(shade*232);data[o+1]=Math.round(shade*238);data[o+2]=Math.round(shade*244);data[o+3]=255;
      }
    }
    ctx.putImageData(image,0,0);
  }

  function drawGrid(){
    ctx.font='11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline='middle';
    for(const elevation of [-30,-15,0,15,30,45]){
      const y=elevationToY(elevation,H);
      ctx.beginPath();
      ctx.setLineDash(elevation===0?[]:[4,5]);
      ctx.strokeStyle=elevation===0?'rgba(230,234,236,0.35)':'rgba(111,166,181,0.24)';
      ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();
      ctx.fillStyle=elevation===0?'rgba(230,234,236,0.75)':'rgba(141,150,155,0.85)';
      ctx.fillText((elevation>0?'+':'')+elevation+'°',10,y-9);
    }
    ctx.setLineDash([]);
    for(const [az,label] of AZIMUTH_LABELS){
      const x=azimuthToX(az,W,pan);
      ctx.strokeStyle='rgba(230,234,236,0.28)';
      ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,10);ctx.moveTo(x,H-10);ctx.lineTo(x,H);ctx.stroke();
      ctx.fillStyle='rgba(230,234,236,0.8)';ctx.textAlign='center';
      ctx.fillText(label+' '+az+'°',x,H-22);
      ctx.textAlign='left';
    }
  }

  function drawBody(body,color,radius,label){
    const horizon=horizonAtAzimuth(panorama,body.azimuth);
    const obstructed=body.elevation<0||body.elevation<horizon;
    const shown=Math.max(ELEV_BOTTOM+3,obstructed?Math.max(body.elevation,ELEV_BOTTOM+3):body.elevation);
    const x=azimuthToX(body.azimuth,W,pan),y=elevationToY(shown,H);
    ctx.beginPath();
    if(obstructed){ctx.setLineDash([3,3]);ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.arc(x,y,radius,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);}
    else{ctx.fillStyle=color;ctx.arc(x,y,radius,0,Math.PI*2);ctx.fill();ctx.strokeStyle='rgba(230,234,236,0.7)';ctx.lineWidth=1;ctx.stroke();}
    ctx.fillStyle='rgba(230,234,236,0.9)';
    ctx.font='11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign='center';ctx.textBaseline='bottom';
    const status=obstructed?(body.elevation<0?'Below horizon':'Behind terrain'):body.elevation.toFixed(1)+'° EL';
    ctx.fillText(label+' · '+body.azimuth.toFixed(0)+'° AZ · '+status,x,y-radius-5);
    ctx.textAlign='left';ctx.textBaseline='middle';
  }

  function drawBodies(){
    if(obs?.earth)drawBody(obs.earth,'#6FA6B5',7,'Earth');
    if(obs?.sun)drawBody(obs.sun,'#C99B52',10,'Sun');
  }

  function redraw(){
    drawTerrain();
    drawGrid();
    drawBodies();
  }
  function schedule(){if(!raf)raf=requestAnimationFrame(()=>{raf=0;redraw();});}
  function onDown(e){pointer={x:e.clientX};canvas.setPointerCapture?.(e.pointerId);canvas.style.cursor='grabbing';}
  function onMove(e){
    if(!pointer)return;
    pan=(pan-(e.clientX-pointer.x)*0.22)%360;
    pointer={x:e.clientX};
    schedule();
  }
  function onUp(){pointer=null;canvas.style.cursor='grab';}
  canvas.style.cursor='grab';
  canvas.addEventListener('pointerdown',onDown);
  canvas.addEventListener('pointermove',onMove);
  canvas.addEventListener('pointerup',onUp);
  canvas.addEventListener('pointercancel',onUp);
  redraw();
  return {
    redraw,
    setObs(next){obs=next;redraw();},
    get pan(){return pan;},
    destroy(){
      if(raf)cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown',onDown);
      canvas.removeEventListener('pointermove',onMove);
      canvas.removeEventListener('pointerup',onUp);
      canvas.removeEventListener('pointercancel',onUp);
    }
  };
}

/* ---- first-person surface view camera (local east/north/up frame) ---- */

/** Direction vector from azimuth/elevation (0°=north, east positive). */
export function directionFromAzEl(azimuthDeg,elevationDeg){
  const az=azimuthDeg*RAD,el=elevationDeg*RAD;
  return {x:Math.cos(el)*Math.sin(az),y:Math.cos(el)*Math.cos(az),z:Math.sin(el)};
}

/** Camera basis for yaw/pitch (yaw 0 looks north). */
export function cameraBasis(yawDeg,pitchDeg){
  const y=yawDeg*RAD,p=pitchDeg*RAD;
  return {
    forward:{x:Math.sin(y)*Math.cos(p),y:Math.cos(y)*Math.cos(p),z:Math.sin(p)},
    right:{x:Math.cos(y),y:-Math.sin(y),z:0},
    up:{x:-Math.sin(y)*Math.sin(p),y:-Math.cos(y)*Math.sin(p),z:Math.cos(p)}
  };
}

/**
 * Project a local direction into normalised screen coordinates
 * (0..1, y down) for the marker labels drawn over the WebGL view.
 */
export function projectDirection(dir,camera){
  const {forward,right,up}=cameraBasis(camera.yawDeg,camera.pitchDeg);
  const fz=dir.x*forward.x+dir.y*forward.y+dir.z*forward.z;
  const fx=dir.x*right.x+dir.y*right.y+dir.z*right.z;
  const fy=dir.x*up.x+dir.y*up.y+dir.z*up.z;
  if(fz<=1e-4)return {visible:false,x:0,y:0};
  const tanF=Math.tan(camera.fovDeg/2*RAD);
  return {visible:true,x:0.5+fx/fz/(2*tanF*camera.aspect),y:0.5-fy/fz/(2*tanF)};
}
