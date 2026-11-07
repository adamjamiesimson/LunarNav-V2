/**
 * Relief geometry shared by the data bake, the WebGL globe shader and the
 * surface-view foundations. The GLSL in src/globe.js mirrors these formulas;
 * they live here so the displaced-surface geometry can be tested without a GPU.
 *
 * All heights are metres above/below the 1737.4 km mean lunar radius.
 */
export const MOON_RADIUS_M=1737400;
/** Half-width of the 60°S south-polar stereographic domain in metres. */
export const POLAR_DOMAIN_M=931200;

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

/** Polar stereographic texture coordinates (pole at the texture centre). */
export function polarReliefUV(lat,lon,domainM=POLAR_DOMAIN_M){
  const r=2*MOON_RADIUS_M*Math.tan((90+lat)*Math.PI/360);
  const lonR=lon*Math.PI/180;
  return {u:(r*Math.sin(lonR)+domainM)/(2*domainM),v:(domainM-r*Math.cos(lonR))/(2*domainM),radiusM:r};
}

/** Equirectangular texture coordinates for the global relief grid. */
export function globalReliefUV(lat,lon){
  return {u:(((lon+180)%360)+360)%360/360,v:(90-lat)/180};
}

/**
 * Bilinear height lookup in metres. Grid encoding: values are unsigned
 * 16-bit codes where metres = offsetM + code/65535*rangeM.
 */
export function decodeHeight(code,offsetM,rangeM){return offsetM+code/65535*rangeM;}
export function sampleGrid(grid,u,v){
  const x=clamp(u,0,1)*(grid.width-1),y=clamp(v,0,1)*(grid.height-1);
  const x0=Math.floor(x),y0=Math.floor(y);
  const x1=Math.min(grid.width-1,x0+1),y1=Math.min(grid.height-1,y0+1);
  const fx=x-x0,fy=y-y0;
  const h=(a,b)=>grid.get(a,b);
  return (h(x0,y0)*(1-fx)+h(x1,y0)*fx)*(1-fy)+(h(x0,y1)*(1-fx)+h(x1,y1)*fx)*fy;
}

/** Radius of the displaced surface along a direction (metres). */
export function displacedRadiusM(heightM,exaggeration=1){return MOON_RADIUS_M+exaggeration*heightM;}

/**
 * CPU reference for the shader's terrain-aware ray intersection: walk in from
 * an outer bounding sphere and bisect the first crossing of the displaced
 * surface, so ridges and crater walls change the silhouette for real.
 * `heightAt(direction)` must return metres for a unit direction vector.
 */
export function intersectDisplacedSphere(origin,dir,{heightAt,exaggeration=1,heightMinM=-12000,heightMaxM=12000,step=0.002,bisect=9}={}){
  const len=v=>Math.hypot(v[0],v[1],v[2]);
  const radiusAt=n=>(MOON_RADIUS_M+exaggeration*heightAt(n))/MOON_RADIUS_M; // scene units, moon radius = 1
  const bound=(1+Math.max(0,exaggeration*heightMaxM)/MOON_RADIUS_M);
  // Ray-sphere entry against the outer bounding sphere.
  const b=origin[0]*dir[0]+origin[1]*dir[1]+origin[2]*dir[2];
  const c=len(origin)**2-bound*bound;
  const disc=b*b-c;
  if(disc<0)return null;
  const tEnter=Math.max(0,-b-Math.sqrt(disc));
  const f=t=>{
    const p=[origin[0]+t*dir[0],origin[1]+t*dir[1],origin[2]+t*dir[2]];
    const d=len(p)||1e-9;
    const n=[p[0]/d,p[1]/d,p[2]/d];
    return d-radiusAt(n);
  };
  const tMax=-b+Math.sqrt(disc);
  let t=tEnter;
  if(f(t)<=0)return t; // started inside the displaced surface
  for(;t<tMax;t+=step){
    if(f(t+step)<=0){
      let lo=t,hi=t+step;
      for(let i=0;i<bisect;i++){
        const mid=0.5*(lo+hi);
        if(f(mid)>0)lo=mid;else hi=mid;
      }
      return 0.5*(lo+hi);
    }
  }
  return null;
}

/**
 * Surface normal of the displaced geometry from the height gradient
 * (central differences), expressed in the lunar-fixed frame.
 */
export function displacedNormal(dir,heightAt,{exaggeration=1,epsilon=1e-3}={}){
  const len=v=>Math.hypot(v[0],v[1],v[2]);
  const norm=v=>{const d=len(v)||1;return [v[0]/d,v[1]/d,v[2]/d];};
  const n=norm(dir);
  // Tangent frame around n.
  const ref=Math.abs(n[2])<0.9?[0,0,1]:[1,0,0];
  const e1=norm([n[1]*ref[2]-n[2]*ref[1],n[2]*ref[0]-n[0]*ref[2],n[0]*ref[1]-n[1]*ref[0]]);
  const e2=[n[1]*e1[2]-n[2]*e1[1],n[2]*e1[0]-n[0]*e1[2],n[0]*e1[1]-n[1]*e1[0]];
  const r=n1=>(MOON_RADIUS_M+exaggeration*heightAt(norm(n1)))/MOON_RADIUS_M;
  const p=(e,k)=>[n[0]+k*e[0],n[1]+k*e[1],n[2]+k*e[2]];
  const r1=r(p(e1,epsilon)),r0=r(p(e1,-epsilon));
  const s1=r(p(e2,epsilon)),s0=r(p(e2,-epsilon));
  // Gradient of the displaced radius projected onto the tangent plane.
  const g1=(r1-r0)/(2*epsilon),g2=(s1-s0)/(2*epsilon);
  return norm([n[0]-g1*e1[0]-g2*e2[0],n[1]-g1*e1[1]-g2*e2[1],n[2]-g1*e1[2]-g2*e2[2]]);
}
