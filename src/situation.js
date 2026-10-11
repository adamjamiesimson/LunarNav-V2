/**
 * Provenance-aware lunar situation reports and the local sky diagram.
 * The Moon globe is illustrative; only azimuth-based horizon lines incorporate
 * loaded LOLA data. No surface-lighting or antenna link budget is implied.
 */
import {horizonAt} from './mission.js';
import {ephemeris} from './astro.js';
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
export const fmtMargin=x=>(x>=0?'+':'')+x.toFixed(2)+'°';

export function inspectSituation(obs,profile=null){
  if(!obs?.sun||!obs?.earth)throw Error('Missing celestial observations');
  const sunBarrier=horizonAt(profile,obs.sun.azimuth);
  const earthBarrier=horizonAt(profile,obs.earth.azimuth);
  const sunMargin=obs.sun.elevation-sunBarrier,earthMargin=obs.earth.elevation-earthBarrier;
  const sunVisible=sunMargin>0,earthVisible=earthMargin>0;
  const terrain=Boolean(profile);
  const combined=sunVisible&&earthVisible?'DUAL VISIBILITY':
    sunVisible?'SUN ONLY':earthVisible?'EARTH ONLY':'BOTH OBSTRUCTED';
  const source=terrain?(profile.verifiedSource===true?'20 KM LOLA HORIZON':'USER-SUPPLIED / UNVERIFIED DEM'):'0° GEOMETRIC HORIZON';
  return {terrain,source,
    sunBarrier,earthBarrier,sunMargin,earthMargin,sunVisible,earthVisible,combined,
    nearBoundary:Math.min(Math.abs(sunMargin),Math.abs(earthMargin))<0.5};
}
function plotPosition(azimuth,elevation){
  const angle=azimuth*Math.PI/180;
  const radius=102*(90-clamp(elevation,0,90))/90;
  return {x:140+radius*Math.sin(angle),y:140-radius*Math.cos(angle)};
}
export function buildSkyDiagram(obs,profile=null){
  const situation=inspectSituation(obs,profile);
  const trace=(body,color,label,visible,barrier)=>{
    const point=plotPosition(body.azimuth,body.elevation);
    const opacity=visible?1:0.48;
    return '<g opacity="'+opacity+'"><circle cx="'+point.x.toFixed(3)+'" cy="'+point.y.toFixed(3)+
      '" r="9" fill="'+(visible?color:'#0f1b22')+'" stroke="'+color+
      '" stroke-width="2" stroke-dasharray="'+(visible?'none':'3 3')+'"/>'+
      '<text x="'+(point.x+14).toFixed(3)+'" y="'+(point.y+3).toFixed(3)+
      '" fill="'+color+'" font-family="DM Mono,monospace" font-size="9">'+label+'</text>'+
      '<title>'+label+': '+body.elevation.toFixed(2)+' deg elevation; horizon '+barrier.toFixed(2)+
      ' deg; '+(visible?'visible':'obstructed')+'</title></g>';
  };
  let skyline='';
  if(profile&&Array.isArray(profile.azimuthDeg)&&profile.azimuthDeg.length>=8){
    const points=profile.azimuthDeg.map(az=>{
      const point=plotPosition(az,horizonAt(profile,az));
      return point.x.toFixed(2)+','+point.y.toFixed(2);
    }).join(' ');
    skyline='<polygon points="'+points+'" fill="rgba(213,168,116,.07)" stroke="#d7ae7f" stroke-width="2" stroke-linejoin="round"/>'+
      '<text x="140" y="285" text-anchor="middle" fill="#d9b386" font-family="DM Mono,monospace" font-size="8">'+
      (profile.verifiedSource===true?'GOLD = LOCAL LOLA HORIZON':'GOLD = UNVERIFIED DEM HORIZON')+'</text>';
  }
  const grid='<defs><radialGradient id="mission-sky-bg"><stop offset="0" stop-color="#203342"/><stop offset="1" stop-color="#0d1824"/></radialGradient></defs>'+
    '<circle cx="140" cy="140" r="102" fill="url(#mission-sky-bg)" stroke="#526874"/>'+
    '<circle cx="140" cy="140" r="68" fill="none" stroke="#405563" stroke-dasharray="3 6"/>'+
    '<circle cx="140" cy="140" r="34" fill="none" stroke="#405563" stroke-dasharray="3 6"/>'+
    '<path d="M140 38V242 M38 140H242" stroke="#466075" stroke-dasharray="3 6"/>'+
    '<text x="140" y="24" text-anchor="middle" fill="#b6c7cf" font-size="10">N</text>'+
    '<text x="140" y="262" text-anchor="middle" fill="#b6c7cf" font-size="10">S</text>'+
    '<text x="24" y="143" text-anchor="middle" fill="#b6c7cf" font-size="10">W</text>'+
    '<text x="256" y="143" text-anchor="middle" fill="#b6c7cf" font-size="10">E</text>';
  return '<svg viewBox="0 0 280 290" role="img" aria-label="Local sky visibility, with Sun and Earth positions'+
    (profile?(profile.verifiedSource===true?' and NASA-derived local terrain horizon':' and user-supplied unverified terrain horizon'):' and geometric horizon')+'">'+grid+skyline+
    trace(obs.sun,'#f1c58b','SUN',situation.sunVisible,situation.sunBarrier)+
    trace(obs.earth,'#94d9e5','EARTH',situation.earthVisible,situation.earthBarrier)+
    '<circle cx="140" cy="140" r="3" fill="#d8f0f2"/></svg>';
}

/** Find the next sampled transition of local Sun or Earth horizon visibility.
 * 30-minute bracket sampling, refined to approximately one minute. This is
 * screening precision, NOT physical or ephemeris accuracy, and it deliberately
 * does not estimate remote RF communication link viability.
 */
export function findNextHorizonEvent({startUTC,site,durationHours,offsetHours=0,profile=null,
  stepMinutes=30}={}){
  const origin=new Date(startUTC).getTime();
  if(!Number.isFinite(origin)||!site||!Number.isFinite(site.lat)||!Number.isFinite(site.lon)||
     !(durationHours>0&&durationHours<=24*60)||!(offsetHours>=0&&offsetHours<=durationHours)||
     !(stepMinutes>=5&&stepMinutes<=120))throw Error('Invalid mission horizon search parameters');
  const stateAt=minute=>inspectSituation(
    ephemeris(new Date(origin+minute*60000),site.lat,site.lon),profile);
  const maximum=durationHours*60;
  let prevMinute=offsetHours*60;
  let prior=stateAt(prevMinute);
  const different=(a,b)=>a.sunVisible!==b.sunVisible||a.earthVisible!==b.earthVisible;
  for(let nextMinute=prevMinute+stepMinutes;nextMinute<=maximum+stepMinutes;nextMinute+=stepMinutes){
    const right=Math.min(maximum,nextMinute);
    if(right<=prevMinute)break;
    const current=stateAt(right);
    if(different(current,prior)){
      let low=prevMinute,high=right;
      const baseline=prior;
      // Binary search first changed side of a bracket; no false subminute claim.
      for(let i=0;i<10;i++){
        const mid=(low+high)/2;
        if(different(stateAt(mid),baseline))high=mid;else low=mid;
      }
      const targetMinute=Math.min(maximum,Math.ceil(high/30)*30);
      const after=stateAt(targetMinute);
      const type=after.sunVisible!==baseline.sunVisible && after.earthVisible!==baseline.earthVisible?
        'SUN + EARTH':after.sunVisible!==baseline.sunVisible?'SUN':'EARTH';
      return {offsetHours:targetMinute/60,eventType:type,
        eventUTC:new Date(origin+targetMinute*60000).toISOString(),
        visibleAfter:{sun:after.sunVisible,earth:after.earthVisible},
        sampleResolutionMinutes:stepMinutes,
        warning:'Modeled horizon crossing; angular and terrain uncertainties not included'};
    }
    prior=current;prevMinute=right;
    if(right===maximum)break;
  }
  return null;
}
