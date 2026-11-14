// Decoding colour-coded elevation maps into heights. Only usable when the map
// ships a documented legend (colour ramp + elevation range) and a georeference.
// If the original numerical DEM exists, use that instead; this is for maps
// whose only accessible source is the rendered image. Hillshade images don't
// count: their brightness is terrain shading, not elevation.
const hex2rgb=hex=>{
  const m=/^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if(!m)throw Error('Invalid legend colour: '+hex);
  const n=parseInt(m[1],16);
  return [n>>16,(n>>8)&255,n&255];
};

// imageData: {data:Uint8ClampedArray|Uint8Array,width,height}
// stops: legend swatches [{color:'#rrggbb',heightM:Number},...] (2+, any order)
// tolerance: max RGB distance to the legend before a pixel becomes NoData
// georef: required; echoed back so the caller can't lose the projection
export function decodeColorElevation(imageData,{stops,tolerance=24,georef=null}={}){
  if(!imageData||!imageData.data||!imageData.width||!imageData.height)throw Error('Invalid image data');
  if(!Array.isArray(stops)||stops.length<2)throw Error('A documented elevation legend with at least two colour stops is required');
  if(!georef)throw Error('A documented projection and spatial extent (georef) is required for a quantitative decode');
  const ramp=stops.map(s=>{
    const rgb=Array.isArray(s.color)?s.color:hex2rgb(s.color);
    const heightM=Number(s.heightM);
    if(rgb.length!==3||rgb.some(v=>!Number.isFinite(v))||!Number.isFinite(heightM))
      throw Error('Legend stops need a colour and a heightM value');
    return {rgb,heightM};
  }).sort((a,b)=>a.heightM-b.heightM);
  if(ramp[ramp.length-1].heightM<=ramp[0].heightM)throw Error('Legend elevation range must be increasing');
  const heights=new Float32Array(imageData.width*imageData.height).fill(NaN);
  let matched=0,min=Infinity,max=-Infinity;
  for(let i=0;i<imageData.width*imageData.height;i++){
    const r=imageData.data[i*4],g=imageData.data[i*4+1],b=imageData.data[i*4+2];
    // Distance to the legend ramp (polyline through the stops) so continuous
    // ramps decode their intermediate colours. Anything off the ramp gets
    // masked as NoData rather than turned into a made-up elevation.
    let bestDist=Infinity,bestH=null;
    for(let s=0;s<ramp.length-1;s++){
      const a=ramp[s],c=ramp[s+1];
      const vx=c.rgb[0]-a.rgb[0],vy=c.rgb[1]-a.rgb[1],vz=c.rgb[2]-a.rgb[2];
      const den=vx*vx+vy*vy+vz*vz;
      const t=den>0?Math.max(0,Math.min(1,((r-a.rgb[0])*vx+(g-a.rgb[1])*vy+(b-a.rgb[2])*vz)/den)):0;
      const px=a.rgb[0]+t*vx,py=a.rgb[1]+t*vy,pz=a.rgb[2]+t*vz;
      const d=Math.hypot(r-px,g-py,b-pz);
      if(d<bestDist){bestDist=d;bestH=a.heightM+t*(c.heightM-a.heightM);}
    }
    if(bestDist>tolerance)continue; // off-ramp colour (e.g. hillshade) -> NoData
    heights[i]=bestH;matched++;
    if(bestH<min)min=bestH;if(bestH>max)max=bestH;
  }
  if(!matched)throw Error('No pixels match the supplied legend; the map is not a usable quantitative source');
  return {heights,coveragePct:100*matched/heights.length,minM:min,maxM:max,georef};
}
