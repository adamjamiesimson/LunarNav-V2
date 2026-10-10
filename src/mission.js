/**
 * First-order power and geometric direct-to-Earth access screening.
 *
 * No terrain-dependent availability is applied unless an independently loaded
 * DEM-derived horizon profile is supplied; no link budget or battery chemistry.
 * Numerical integration is piecewise constant over the input UTC sample steps.
 */
const DEG=Math.PI/180;
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const finite=(v,min,max,name)=>{
  const n=Number(v);
  if(!Number.isFinite(n)||n<min||n>max)throw new Error('Invalid '+name);
  return n;
};
export const DEFAULT_ENGINEERING={
  areaM2:12,efficiencyPct:28,deratePct:80,
  loadW:100,batteryWh:6000,
  earthCutoffDeg:5,
  startingChargePct:100
};
export function validateEngineering(input={}){
  return {
    areaM2:finite(input.areaM2??12,0,2000,'array area'),
    efficiencyPct:finite(input.efficiencyPct??28,0,60,'cell efficiency'),
    deratePct:finite(input.deratePct??80,0,100,'system derating'),
    loadW:finite(input.loadW??100,0,50000,'continuous load'),
    batteryWh:finite(input.batteryWh??6000,0,1000000,'usable battery'),
    earthCutoffDeg:finite(input.earthCutoffDeg??5,0,90,'antenna elevation cutoff'),
    startingChargePct:finite(input.startingChargePct??100,0,100,'battery initial charge')
  };
}
export function horizonAt(profile,azimuth){
  if(!profile || !Array.isArray(profile.azimuthDeg) || !Array.isArray(profile.elevationDeg) ||
      profile.azimuthDeg.length<2 || profile.azimuthDeg.length!==profile.elevationDeg.length) return 0;
  const az=((azimuth%360)+360)%360;
  const n=profile.azimuthDeg.length;
  const step=360/n;
  const i=Math.floor(az/step)%n,alpha=(az-i*step)/step;
  return Math.max(0,profile.elevationDeg[i]*(1-alpha)+profile.elevationDeg[(i+1)%n]*alpha);
}
export function simulateMission(samples,settings={},terrainProfile=null){
  const p=validateEngineering(settings);
  if(!Array.isArray(samples)||samples.length<2)throw new Error('At least two timestamped samples required');
  const capacity=p.batteryWh;
  let charge=capacity*p.startingChargePct/100;
  let lowest=capacity?100:0,generatedWh=0,consumedWh=0,unmetWh=0,unmetHours=0;
  let solarHours=0,earthHours=0,dualHours=0,firstBrownout=null,longestAccessGap=0,accessGap=0;
  const timeline=[];
  for(let i=0;i<samples.length-1;i++){
    const r=samples[i],next=samples[i+1];
    const hours=(Date.parse(next.time)-Date.parse(r.time))/3600000;
    if(!(hours>0&&hours<=24))throw new Error('Invalid or unordered sample timestamps');
    const sunEl=r.sun.elevation,earthEl=r.earth.elevation;
    const sunBarrier=horizonAt(terrainProfile,r.sun.azimuth),earthBarrier=horizonAt(terrainProfile,r.earth.azimuth);
    const sunVisible=sunEl>sunBarrier;
    // This is Earth above a geometric antenna elevation mask, NOT a radio-link budget.
    const earthVisible=earthEl>Math.max(p.earthCutoffDeg,earthBarrier);
    const solarW=sunVisible?1361*p.areaM2*(p.efficiencyPct/100)*(p.deratePct/100)*Math.max(0,Math.sin(sunEl*DEG)):0;
    // Simple flat/horizontal fixed panel. No tracking, eclipse or low-angle optical losses.
    const gain=solarW*hours,need=p.loadW*hours;
    const available=charge+gain-need;
    if(available<0){
      unmetWh+=-available;
      if(p.loadW>solarW){unmetHours+=Math.min(hours,(-available)/(p.loadW-solarW));}
      if(!firstBrownout)firstBrownout=r.time;
    }
    charge=clamp(available,0,capacity);
    lowest=Math.min(lowest,capacity?100*charge/capacity:0);
    generatedWh+=gain;consumedWh+=need;
    if(sunVisible)solarHours+=hours;
    if(earthVisible){earthHours+=hours;accessGap=0;}
    else{accessGap+=hours;longestAccessGap=Math.max(longestAccessGap,accessGap);}
    if(sunVisible&&earthVisible)dualHours+=hours;
    timeline.push({time:r.time,socPct:capacity?charge*100/capacity:0,solarW,sunVisible,earthVisible,hours,sunHorizonDeg:sunBarrier,earthHorizonDeg:earthBarrier});
  }
  const totalHours=timeline.reduce((s,x)=>s+x.hours,0);
  return {
    settings:p,totalHours,generatedWh,consumedWh,unmetWh,unmetHours,
    minimumSocPct:lowest,endingSocPct:capacity?charge*100/capacity:0,
    solarAccessPct:100*solarHours/totalHours,earthAccessPct:100*earthHours/totalHours,
    dualAccessPct:100*dualHours/totalHours,longestAccessGapHours:longestAccessGap,
    firstBrownout,terrainApplied:Boolean(terrainProfile),timeline
  };
}
