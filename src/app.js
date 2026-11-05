import {ephemeris,sampleWindow,summarize,rankedSites,longestDualWindow} from './astro.js';
import {TIMELINE as TL,indicatorX,fractionToOffset,timelineFractionFromSVGPoint,horizontalCTM,clientXToSVGX} from './timeline.js';
import {SITES,fmtCoord} from './sites.js';
import {createMap} from './globe.js';
import {simulateMission,DEFAULT_ENGINEERING} from './mission.js';
import {estimateSurfaceTraverse} from './travel.js';
import {estimateEarthMoonTransit} from './transit.js';
import {loadLolaTerrain} from './terrain.js';
import {findMissionWindows,compareFinderModels} from './finder.js';
import {inspectSituation,buildSkyDiagram,fmtMargin,findNextHorizonEvent} from './situation.js';
import {loadBundledTerrain} from './terrain-cache.js';
import {PAGE_ROUTES,PAGE_TITLES,routeFromURL,buildPageURL} from './router.js';
import {initOnboarding} from './onboarding.js';
import {initMissionAssistant,refreshAssistantContext} from './assistant.js';
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const fmtPct=n=>`${n.toFixed(1)}%`;
const fmtDeg=n=>`${n>=0?'+':''}${n.toFixed(2)}°`;
const fmtUTC=iso=>String(iso).slice(0,16).replace('T',' ')+' UTC';
const longDate=date=>date.toLocaleString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).toUpperCase()+' UTC';
const shortDate=date=>date.toLocaleDateString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric'}).toUpperCase();
const escapeHTML=str=>String(str).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const params=new URLSearchParams(location.search);
const startSite=SITES.find(x=>x.id===params.get('site'))||SITES[0];
const startDays=[3,7,14,28].includes(Number(params.get('days')))?Number(params.get('days')):7;
const startDate=/^\d{4}-\d{2}-\d{2}$/.test(params.get('date')||'')?params.get('date'):'2026-11-14';
const state={site:startSite,date:startDate,time:'12:00',days:startDays,offset:0,base:null,samples:[],ranking:[],playing:false,terrain:null,engineering:{...DEFAULT_ENGINEERING},simulation:null};
let currentPage=routeFromURL(location.pathname,location.hash);
const terrainProfiles=new Map();
const terrainKey=site=>site.id+'|'+site.lat.toFixed(6)+'|'+site.lon.toFixed(6);
const getCachedTerrain=site=>terrainProfiles.get(terrainKey(site))||null;
let terrainBatchLoading=false;
let playTimer,toastTimer;
const siteSelect=$('#site-select');
SITES.forEach(site=>siteSelect.add(new Option(`${site.name}  ·  ${site.tag}`,site.id)));
siteSelect.value=state.site.id;
$('#mission-date').value=state.date;
document.querySelectorAll('#duration button').forEach(b=>b.classList.toggle('selected',Number(b.dataset.days)===state.days));


/** Keep current-site settings shareable across distinct page URLs. */
function selectionQuery(){
  const p=new URLSearchParams();
  if(!state.site.custom)p.set('site',state.site.id);
  p.set('date',state.date);p.set('days',String(state.days));
  return p.toString();
}
function showPage(page,{scroll=true}={}){
  currentPage=PAGE_ROUTES[page]?page:'home';
  for(const element of document.querySelectorAll('[data-view]')){
    const active=element.dataset.view===currentPage;
    element.hidden=!active;
    element.setAttribute('aria-hidden',String(!active));
  }
  for(const element of document.querySelectorAll('[data-route]')){
    const active=element.dataset.route===currentPage;
    if(element.classList.contains('nav-link'))element.classList.toggle('active',active);
    if(active && element.classList.contains('nav-link'))element.setAttribute('aria-current','page');
    else element.removeAttribute('aria-current');
  }
  document.body.dataset.page=currentPage;
  document.title=(currentPage==='home'?'LunarNav — Lunar Mission Control':PAGE_TITLES[currentPage]+' — LunarNav');
  if(scroll)window.scrollTo(0,0);
  // Repaint the globe after its container becomes visible again.
  if(currentPage==='explore'&&state.base){
    requestAnimationFrame(()=>{map.render(state.site);drawTimeline();updateInspection();});
  }
}
function navigatePage(page,{replace=false}={}){
  if(!PAGE_ROUTES[page])return;
  if(currentPage!==page)stopPlay();
  const path=buildPageURL(page,page==='home'?'':selectionQuery());
  if(replace)history.replaceState({page},'',path);
  else if(location.pathname+location.search!==path)history.pushState({page},'',path);
  showPage(page);
}

function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2800);}
/** Write a CSV from row arrays (every cell quoted). */
function downloadCSV(filename,rows){const cell=v=>'"'+String(v).replaceAll('"','""')+'"';const text=rows.map(r=>r.map(cell).join(',')).join('\n');const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);}
function updateURL(){if(state.site.custom||currentPage==='home')return;history.replaceState({page:currentPage},'',buildPageURL(currentPage,selectionQuery()));}
const map=createMap($('#moon-map'),{onPick:selectSite,onHover:(site,e)=>{const tip=$('#map-tooltip');if(!site){tip.hidden=true;return;}tip.hidden=false;tip.textContent=`${site.name} · ${fmtCoord(site.lat,site.lon)}`;const rect=$('#map-stage').getBoundingClientRect();tip.style.left=`${Math.min(rect.width-235,Math.max(12,e.clientX-rect.left+16))}px`;tip.style.top=`${Math.max(12,e.clientY-rect.top-20)}px`;}});
function selectSite(site){stopPlay();state.site=site;if(site.custom&&!siteSelect.querySelector('[value="custom"]'))siteSelect.add(new Option('Custom waypoint  ·  Map-selected','custom'));siteSelect.value=site.id;updateAnalysis();toast(`${site.name} selected`);}
function refreshMissionContext(){
  const label=state.site.name+' · '+state.date+' '+state.time+' UTC · '+state.days+' days';
  $('#engineering-context').textContent=label;
  $('#compare-context').textContent=label;
  const travelDate=$('#travel-date');
  if(travelDate){travelDate.value=state.date;$('#travel-time').value=state.time;populateTravelDestinations();}
  const transitDateInput=$('#transit-date');
  if(transitDateInput){transitDateInput.value=state.date;$('#transit-time').value=state.time;}
  $('#transit-destination-tag').textContent='DESTINATION: '+state.site.name.toUpperCase();
  refreshAssistantContext();
}
function updateSelected(){const site=state.site;$('#selected-name').textContent=site.name;$('#selected-tag').textContent=site.tag;$('#selected-coord').textContent=fmtCoord(site.lat,site.lon);$('#selected-type').textContent=site.kind;$('#site-source').href=site.source||'https://science.nasa.gov/moon/';$('#site-source').style.display=site.custom?'none':'';$('#map-site-name').textContent=site.name.toUpperCase();$('#map-coordinate').textContent=fmtCoord(site.lat,site.lon);$('.site-dot').style.background=site.accent;map.render(site);}
function readDate(){const date=$('#mission-date').value;const time=$('#mission-time').value;if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d\d:\d\d$/.test(time))throw new Error('Enter a valid UTC date and time.');const base=new Date(`${date}T${time}:00Z`);if(!Number.isFinite(base.getTime()))throw new Error('Invalid UTC date.');return {date,time,base};}
function updateAnalysis(){try{state.terrain=getCachedTerrain(state.site);const x=readDate();state.date=x.date;state.time=x.time;state.base=x.base;state.offset=0;state.samples=sampleWindow({start:state.base,lat:state.site.lat,lon:state.site.lon,days:state.days,stepHours:2});state.ranking=rankedSites(SITES,state.base,state.days);$('#time-scrubber').max=String(state.days*24);$('#celestial-scrubber').max=String(state.days*24);$('#time-scrubber').value='0';$('#metric-days').textContent=`${state.days} DAYS`;$('#end-label').textContent=`+${state.days} DAYS`;$('#timeline-start').textContent=shortDate(state.base);$('#timeline-end').textContent=shortDate(new Date(state.base.getTime()+state.days*86400000));updateSelected();refreshMissionContext();updateMetrics();drawTimeline();drawComparison();updateInspection();updateMissionPanels();updateURL();}catch(e){toast(e.message||'Could not calculate the mission window.');}}
function updateMetrics(){const stats=summarize(state.samples);$('#dual-value').textContent=stats.dual.toFixed(1);$('#sun-value').textContent=fmtPct(stats.sun);$('#earth-value').textContent=fmtPct(stats.earth);$('#blackout-value').textContent=stats.longestBlackoutHours.toFixed(0)+' h';$('#sun-bar').style.width=`${stats.sun}%`;$('#earth-bar').style.width=`${stats.earth}%`;$('#metric-ring').style.setProperty('--metric-pct',`${stats.dual}%`);const best=longestDualWindow(state.samples);$('#best-window-length').textContent=best.hours?`${best.hours.toFixed(0)} hours`:'No dual-access window';$('#best-window-dates').textContent=best.start?`${shortDate(new Date(best.start))} → ${shortDate(new Date(best.end))} (UTC)`:'No continuous overlap detected in sampled period';}
const {W,H,L,R,Y,rowGap,rowH}=TL;
function drawTimeline(){const list=state.samples.slice(0,-1),N=list.length;const rows=[['SUNLIGHT',x=>x.sun.visible,'sun'],['EARTH LINK',x=>x.earth.visible,'earth'],['DUAL WINDOW',x=>x.dual,'dual']];const width=W-L-R;let svg=`<svg class="timeline-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mission visibility timeline"><g id="timeline-track">`;
  for(let d=0;d<=state.days;d++){const x=L+width*d/state.days;svg+=`<line x1="${x}" x2="${x}" y1="6" y2="${Y+rowGap*2+rowH+7}" stroke="rgba(255,255,255,${d===0||d===state.days?'.16':'.07'})" stroke-dasharray="3 5"/>`;if(d<state.days)svg+=`<text x="${x+4}" y="${H-6}" fill="#98A2A8" font-size="10" font-family="monospace">${d===0?'D01':d%2===0||state.days<=7?'D'+String(d+1).padStart(2,'0'):''}</text>`;}
  rows.forEach(([label,pred,kind],i)=>{const y=Y+i*rowGap;svg+=`<text x="0" y="${y+12}" fill="#98A2A8" font-size="11" font-family="monospace">${label}</text><rect x="${L}" y="${y}" width="${width}" height="${rowH}" rx="2" fill="#242A2F"/>`;list.forEach((point,j)=>{if(pred(point))svg+=`<rect x="${(L+width*j/N).toFixed(2)}" y="${y}" width="${(width/N+.3).toFixed(2)}" height="${rowH}" fill="${kind==='sun'?'#C99B52':kind==='earth'?'#6FA6B5':'#63A07A'}" />`;});});
  svg+=`</g><line id="time-indicator" x1="${L}" x2="${L}" y1="4" y2="${Y+rowGap*2+rowH+3}" stroke="#E6EAEC" stroke-width="1.5"/><path id="indicator-triangle" d="M${L-4} 4 L${L+4} 4 L${L} 11 Z" fill="#E6EAEC"/><path id="indicator-handle" d="M${L-11} 11 a11 11 0 0 0 22 0 Z" fill="rgba(255,255,255,.12)" stroke="#E6EAEC" stroke-width="1"/><rect id="timeline-hit" x="${L}" y="4" width="${width}" height="100" fill="transparent" style="cursor:crosshair" touch-action="none"/></svg>`;
  $('#timeline-graph').innerHTML=svg;
  $('#timeline-hit').addEventListener('pointerdown',onTimelinePointerDown);
  const tri=$('#indicator-triangle'),handle=$('#indicator-handle');
  for(const element of [tri,handle]){
    element.setAttribute('role','slider');
    element.setAttribute('tabindex','0');
    element.setAttribute('aria-label','UTC inspection time');
    element.setAttribute('aria-valuetext','0 hours from mission start');
    element.style.cursor='col-resize';
  }
  for(const id of ['indicator-triangle','indicator-handle']){
    const el=document.getElementById(id);
    el.addEventListener('pointerdown',onTimelinePointerDown);
    el.addEventListener('keydown',onIndicatorKeyDown);
  }
  updateIndicator();}
let activeIndicatorPointerId=null;
function onTimelinePointerDown(e){
  if(e.target.closest?.('#timeline-track'))return; // Clicks on the track itself begin a jump below.
  if(e.pointerType==='mouse'&&e.button!==0)return;
  e.preventDefault(); // Must be paired with touch-action:none to stop page scroll while dragging.
  const svg=document.querySelector('#timeline-graph svg');
  if(!svg)return;
  activeIndicatorPointerId=e.pointerId;
  const target=e.currentTarget||e.target;
  try{target.setPointerCapture(e.pointerId);}catch{/* Capture is best-effort; pointermove still surfaces on the target. */}
  target.addEventListener('pointermove',onIndicatorPointerMove);
  target.addEventListener('pointerup',onIndicatorPointerUp);
  target.addEventListener('pointercancel',onIndicatorPointerCancel);
  applyIndicatorClientX(e.clientX);
}
function applyIndicatorClientX(clientX){
  const svg=document.querySelector('#timeline-graph svg');
  const ctm=horizontalCTM(svg);
  if(!ctm)return null;
  const x=clientXToSVGX(clientX,ctm);
  const total=state.days*24;
  const offset=fractionToOffset(timelineFractionFromSVGPoint({x}),total);
  if(!Number.isFinite(offset))return null;
  setOffset(offset);
  return offset;
}
function onIndicatorPointerMove(e){
  if(e.pointerId!==activeIndicatorPointerId)return;
  e.preventDefault();
  applyIndicatorClientX(e.clientX);
}
function onIndicatorPointerUp(e){
  if(e.pointerId!==activeIndicatorPointerId)return;
  finishIndicatorDrag(e.currentTarget||e.target);
}
function onIndicatorPointerCancel(e){
  if(e.pointerId!==activeIndicatorPointerId)return;
  finishIndicatorDrag(e.currentTarget||e.target);
}
function finishIndicatorDrag(target){
  const pointerId=activeIndicatorPointerId;
  activeIndicatorPointerId=null;
  if(!target)return;
  target.removeEventListener('pointermove',onIndicatorPointerMove);
  target.removeEventListener('pointerup',onIndicatorPointerUp);
  target.removeEventListener('pointercancel',onIndicatorPointerCancel);
  try{target.releasePointerCapture?.(pointerId);}catch{/* No captive pointer to release. */}
  const slider=document.querySelector('#timeline-graph [role="slider"]');
  if(slider)slider.setAttribute('aria-valuenow',String(Math.round(state.offset)));
}
function onIndicatorKeyDown(e){
  if(!['ArrowLeft','ArrowRight'].includes(e.key))return;
  e.preventDefault();
  stopPlay();
  const step=e.key==='ArrowLeft'?-1:1;
  setOffset(state.offset+step);
}
function updateIndicator(){const x=indicatorX(state.offset,state.days*24);const l=$('#time-indicator');const tri=$('#indicator-triangle');const handle=$('#indicator-handle');if(l){l.setAttribute('x1',x);l.setAttribute('x2',x);}if(tri)tri.setAttribute('d',`M${x-4} 4 L${x+4} 4 L${x} 11 Z`);if(handle)handle.setAttribute('d',`M${x-11} 11 a11 11 0 0 0 22 0 Z`);if(document.querySelector('#timeline-graph [role="slider"]'))document.querySelector('#timeline-graph [role="slider"]').setAttribute('aria-valuenow',String(Math.round(state.offset)));}
function updateInspection(){
  const date=new Date(state.base.getTime()+state.offset*3600000);
  const obs=ephemeris(date,state.site.lat,state.site.lon);
  const view=inspectSituation(obs,state.terrain);
  map.setSun?.(obs,state.site); // Geometric globe lighting, not DEM shadows.
  $('#condition-date').textContent=longDate(date);
  $('#sun-elevation').textContent=fmtDeg(obs.sun.elevation);
  $('#earth-elevation').textContent=fmtDeg(obs.earth.elevation);
  const sun=$('#sun-state'),earth=$('#earth-state');
  sun.textContent=view.sunVisible?'CLEAR':'BELOW LOCAL HORIZON';
  earth.textContent=view.earthVisible?'IN VIEW':'OBSTRUCTED';
  sun.classList.toggle('muted',!view.sunVisible);
  earth.classList.toggle('muted',!view.earthVisible);
  $('#sky-plot').innerHTML=buildSkyDiagram(obs,state.terrain);
  $('#horizon-label').textContent=view.source;
  $('#sky-horizon-note').textContent=view.terrain?'Gold = local DEM-derived skyline':'Circle = 0° geometric horizon';
  $('#mission-verdict').textContent=view.combined;
  $('#mission-verdict').dataset.visibility=view.sunVisible&&view.earthVisible?'both':
    view.sunVisible||view.earthVisible?'partial':'none';
  $('#mission-source').textContent=view.source+' · '+state.site.name;
  $('#mission-sun-margin').textContent=fmtMargin(view.sunMargin);
  $('#mission-earth-margin').textContent=fmtMargin(view.earthMargin);
  $('#mission-caution').textContent=view.nearBoundary
    ?'Near a modeled horizon: small angular errors can change visibility. Experimental screening only.'
    :'Margins are geometric angles, not radio link or mission safety assurances.';
  $('#hud-clock').textContent=date.toISOString().slice(5,16).replace('T',' · ')+' UTC';
  $('#hud-sun').textContent=fmtMargin(view.sunMargin);
  $('#hud-earth').textContent=fmtMargin(view.earthMargin);
  $('#hud-status').textContent=view.combined;
  $('#hud-horizon').textContent=view.source+' · SITE LOS (NOT RADIO LINK BUDGET)';
  $('#scrub-time-label').textContent='DAY '+String(Math.floor(state.offset/24)+1).padStart(2,'0')+
    ' · '+date.toISOString().slice(11,16);
  $('#time-scrubber').value=String(state.offset);
  const celestialSlider=$('#celestial-scrubber');
  if(celestialSlider)celestialSlider.value=String(state.offset);
  const celestialClock=$('#celestial-clock');
  if(celestialClock)celestialClock.textContent=date.toISOString().slice(0,16).replace('T','  ')+' UTC';
  updateIndicator();
}
function setOffset(v){state.offset=Math.max(0,Math.min(state.days*24,Number(v)||0));updateInspection();}
function drawComparison(){const entries=state.ranking;$('#site-comparison').innerHTML=entries.map((entry,i)=>{const {site,stats}=entry,active=site.id===state.site.id;return `<button type="button" class="compare-card ${active?'active':''}" data-site="${site.id}" aria-label="Inspect ${escapeHTML(site.name)}"><div class="compare-top"><span class="compare-rank">${String(i+1).padStart(2,'0')}</span><span class="compare-indicator" style="--site-color:${site.accent}"></span><span class="compare-type">${escapeHTML(site.tag.toUpperCase())}</span><span class="compare-arrow">↗</span></div><h3>${escapeHTML(site.name)}</h3><p>${escapeHTML(fmtCoord(site.lat,site.lon))}</p><div class="compare-score"><strong>${stats.dual.toFixed(1)}<span>%</span></strong><small>DUAL ACCESS</small></div><div class="compare-progress"><span style="width:${stats.dual}%"></span></div><div class="compare-meta"><span>Sun ${stats.sun.toFixed(0)}%</span><span>Earth ${stats.earth.toFixed(0)}%</span></div></button>`;}).join('');$$('.compare-card').forEach(b=>b.addEventListener('click',()=>{const s=SITES.find(x=>x.id===b.dataset.site);selectSite(s);navigatePage('explore');}));}
function generateCSV(){const rows=[['utc','site','latitude_deg','longitude_deg_east','sun_azimuth_deg','sun_elevation_deg','sun_visible_flat_horizon','earth_azimuth_deg','earth_elevation_deg','earth_visible_flat_horizon','both_visible']];state.samples.forEach(r=>rows.push([r.time,state.site.name,state.site.lat,state.site.lon,r.sun.azimuth.toFixed(4),r.sun.elevation.toFixed(4),r.sun.visible,r.earth.azimuth.toFixed(4),r.earth.elevation.toFixed(4),r.earth.visible,r.dual]));downloadCSV(`lunarnav-${state.site.id}-${state.date}-${state.days}d.csv`,rows);toast('Mission timeline CSV exported');}
function briefText(){const {site,date,time,days}=state;const q=summarize(state.samples);const best=longestDualWindow(state.samples);return `LUNARNAV V2 — LUNAR MISSION SCREENING BRIEF\nGenerated: ${new Date().toISOString()}\nSite: ${site.name} (${site.kind})\nCoordinates: ${fmtCoord(site.lat,site.lon)}\nPeriod: ${date} ${time} UTC + ${days} days\n\nSun visible: ${fmtPct(q.sun)}\nEarth visible: ${fmtPct(q.earth)}\nSun + Earth together: ${fmtPct(q.dual)}\nLongest sampled Earth blackout: ${q.longestBlackoutHours.toFixed(0)} hours\nLongest continuous dual-access period: ${best.hours.toFixed(0)} hours (${best.start||'none'} to ${best.end||'none'})\n\nMETHOD: analytical ephemeris; spherical geometric horizon; two-hour samples. No terrain occlusion, link-budget analysis, solar power calculation, or landing hazard validation. For research screening only — not for flight operations.\nSource reference: ${site.source||'User-selected coordinates'}\n`;} 
function openBrief(){const q=summarize(state.samples);const best=longestDualWindow(state.samples);$('#brief-content').innerHTML=`<div class="report-kicker">LUNAR SOUTH POLE / PLANNING REPORT</div><h3>${escapeHTML(state.site.name)}</h3><p class="report-coordinates">${escapeHTML(fmtCoord(state.site.lat,state.site.lon))}</p><div class="report-grid"><div><small>MISSION WINDOW</small><strong>${state.days} days</strong></div><div><small>START TIME (UTC)</small><strong>${escapeHTML(state.date)} ${escapeHTML(state.time)}</strong></div><div><small>SUN VISIBILITY</small><strong>${fmtPct(q.sun)}</strong></div><div><small>EARTH VISIBILITY</small><strong>${fmtPct(q.earth)}</strong></div><div><small>DUAL ACCESS</small><strong>${fmtPct(q.dual)}</strong></div><div><small>MAX EARTH BLACKOUT</small><strong>${q.longestBlackoutHours.toFixed(0)} h</strong></div><div><small>BEST CONTINUOUS OVERLAP</small><strong>${best.hours.toFixed(0)} h</strong></div></div><p class="report-warning">SCIENTIFIC LIMITATIONS — Analytical geometry with a 0° spherical horizon. Does not account for lunar terrain shadows, spacecraft communications link margin, solar power budget, landing hazards or flight validation. Values are screening estimates only.</p>`;$('#brief-dialog').showModal();}
function stopPlay(){
  state.playing=false;
  if(playTimer!==undefined)cancelAnimationFrame(playTimer);
  playTimer=undefined;
  const b=$('#replay-btn');if(b)b.textContent='▶ Replay window';
  const celestial=$('#celestial-play');if(celestial){celestial.textContent='▶ Simulate';celestial.setAttribute('aria-pressed','false');}
}
function togglePlay(){
  if(state.playing){stopPlay();return;}
  state.playing=true;
  const replay=$('#replay-btn');if(replay)replay.textContent='Ⅱ Pause replay';
  const celestial=$('#celestial-play');celestial.textContent='Ⅱ Pause';celestial.setAttribute('aria-pressed','true');
  let last=performance.now();
  let simulationOffset=state.offset;
  const tick=now=>{
    if(!state.playing)return;
    // Clamp long frames so a backgrounded tab cannot skip large mission intervals.
    const seconds=Math.min(0.08,Math.max(0,(now-last)/1000));
    last=now;
    const speed=Number($('#celestial-speed').value)||24; // Simulated hours per second
    const maximum=state.days*24;
    simulationOffset=(simulationOffset+seconds*speed)%maximum;
    setOffset(simulationOffset);
    playTimer=requestAnimationFrame(tick);
  };
  playTimer=requestAnimationFrame(tick);
}


function engineeringInputs(){
  const get=id=>Number($('#'+id).value);
  return {
    areaM2:get('eng-area'),efficiencyPct:get('eng-efficiency'),loadW:get('eng-load'),
    batteryWh:get('eng-battery'),earthCutoffDeg:get('eng-earthcutoff'),deratePct:get('eng-derate'),
    startingChargePct:100
  };
}
function updateMissionPanels(){
  try{
    const sim=simulateMission(state.samples,state.engineering,state.terrain);
    state.simulation=sim;
    $('#eng-min-soc').textContent=sim.minimumSocPct.toFixed(1)+'%';
    $('#eng-unmet').textContent=sim.unmetHours.toFixed(1)+' h';
    $('#eng-earth').textContent=sim.earthAccessPct.toFixed(1)+'%';
    $('#eng-energy').textContent=(sim.generatedWh/1000).toFixed(1)+' kWh';
    $('#eng-ending').textContent=sim.endingSocPct.toFixed(1)+'% END';
    $('#model-horizon-tag').textContent=sim.terrainApplied?(state.terrain?.verifiedSource===true?'NASA-DERIVED HORIZON':'USER DEM · UNVERIFIED'):'FLAT HORIZON';
    const width=920,height=90,points=sim.timeline.map((t,i)=>{
      const x=20+i*(width-40)/Math.max(1,sim.timeline.length-1);
      const y=height-10-(height-23)*t.socPct/100;
      return [x,y];
    });
    const line=points.map(v=>v.map(n=>n.toFixed(1)).join(',')).join(' ');
    $('#eng-charge-chart').innerHTML='<svg viewBox="0 0 920 90" role="presentation" preserveAspectRatio="none">'+
      '<line x1="0" y1="79" x2="920" y2="79" stroke="#333B41"/>'+
      '<line x1="0" y1="12" x2="920" y2="12" stroke="#333B41" stroke-dasharray="3 5"/>'+
      '<polyline fill="none" stroke="#63A07A" stroke-width="2" stroke-linejoin="round" points="'+line+'"/>'+
      '</svg>';
    $('#eng-summary').textContent=sim.unmetHours>0
      ?'CAUTION · This configuration runs out of modeled energy for '+sim.unmetHours.toFixed(1)+' hours. Increase storage or generation, or reduce the load.'
      :'NO MODELED ENERGY DEFICIT · Under the stated idealizations, battery charge stays non-negative. This is not a flight-readiness assessment.';
    updateTerrainPanel();
  }catch(e){
    state.simulation=null;
    $('#eng-summary').textContent='Cannot evaluate this configuration: '+e.message;
  }
}
function updateTerrainPanel(){
  const p=state.terrain;
  $('#terrain-badge').textContent=p?'DEM APPLIED':'NOT LOADED';
  if(!p){
    $('#terrain-status').textContent='No DEM applied. Feasibility uses a level geometric horizon until NASA elevation data loads successfully.';
    $('#terrain-plot').innerHTML='<div class="terrain-empty">WAITING FOR ELEVATION DATA <span>—</span> FLAT HORIZON</div>';
    return;
  }
  $('#terrain-status').textContent=(p.provenance||p.source)+' · '+state.site.name+' · '+p.resolutionM.toFixed(0)+' m/pixel · '+p.radiusKm+' km search · '+p.coveragePct.toFixed(0)+'% coverage. Not flight validated.';
  const points=p.elevationDeg.map((v,i)=>{
    const x=10+i*890/(p.elevationDeg.length-1),y=73-Math.min(60,v*13);
    return x.toFixed(1)+','+y.toFixed(1);
  }).join(' ');
  $('#terrain-plot').innerHTML='<svg viewBox="0 0 910 90" preserveAspectRatio="none" role="presentation">'+
    '<line x1="0" y1="73" x2="910" y2="73" stroke="#333B41"/>'+
    '<polyline fill="none" stroke="#C99B52" stroke-width="2" points="'+points+'"/>'+
    '<text x="12" y="16" fill="#98A2A8" font-size="11">AZ 0° → 360° · TERRAIN HORIZON ABOVE IDEAL</text></svg>';
}
async function requestTerrain(file=null){
  if($('#terrain-load').disabled)return;
  const lat=state.site.lat,lon=state.site.lon;
  $('#terrain-load').disabled=true;
  $('#terrain-badge').textContent='LOADING…';
  $('#terrain-status').textContent='Preparing NASA LOLA GeoTIFF (40 km local patch)…';
  try{
    const profile=await loadLolaTerrain(state.site,{file,onProgress:s=>$('#terrain-status').textContent=s});
    if(state.site.lat!==lat||state.site.lon!==lon){
      toast('Site changed while loading terrain; reload for the current site.');
      return;
    }
    terrainProfiles.set(terrainKey(state.site),profile);
    state.terrain=profile;
    updateMissionPanels();
    if(state.base)updateInspection();
    updateFinderCoverage();
    toast('Terrain loaded for '+state.site.name+' · '+profile.provenance);
  }catch(e){
    state.terrain=null;
    updateMissionPanels();
    $('#terrain-status').textContent='Could not load DEM: '+e.message+'. Flat-horizon model remains in effect. Try a local LOLA 80S GeoTIFF.';
    toast('Terrain unavailable; no simulated terrain was substituted.');
  }finally{
    $('#terrain-load').disabled=false;
    if(state.terrain)$('#terrain-badge').textContent='DEM APPLIED';
    else $('#terrain-badge').textContent='NOT LOADED';
  }
}
function exportEngineeringCSV(){
  const sim=state.simulation;if(!sim){toast('Fix engineering inputs first');return;}
  const rows=[['UTC','site','terrain_applied','solar_elevation_deg','solar_horizon_deg','solar_generation_W','sun_exposed','earth_geometric_access','earth_horizon_deg','battery_SOC_pct']];
  sim.timeline.forEach((s,i)=>{
    const obs=state.samples[i];
    rows.push([s.time,state.site.name,sim.terrainApplied,obs.sun.elevation.toFixed(3),s.sunHorizonDeg.toFixed(3),s.solarW.toFixed(2),s.sunVisible,s.earthVisible,s.earthHorizonDeg.toFixed(3),s.socPct.toFixed(2)]);
  });
  downloadCSV('lunarnav-engineering-'+state.date+'-'+state.site.id+'.csv',rows);
  toast('Engineering simulation CSV exported');
}



function coverageEntries(){
  return SITES.map(site=>({site,terrain:getCachedTerrain(site)})).filter(entry=>Boolean(entry.terrain));
}
function updateFinderCoverage(){
  const available=coverageEntries();
  $('#finder-terrain-count').textContent=available.length+' of '+SITES.length+' terrain profiles ready';
  if($('#finder-mode').value==='terrain' && available.length<2){
    $('#finder-data-status').textContent='Terrain comparison needs at least two valid loaded DEM profiles. Load NASA data or import a compatible GeoTIFF for two sites in the planner.';
  }
}
async function tryLoadAllTerrain(){
  if(terrainBatchLoading||$('#terrain-load').disabled)return;
  terrainBatchLoading=true;$('#finder-load-all').disabled=true;
  const failures=[];
  try{
    for(const site of SITES){
      if(getCachedTerrain(site))continue;
      $('#finder-data-status').textContent='Requesting NASA 80m LOLA DEM: '+site.name+'…';
      try{
        const profile=await loadLolaTerrain(site,{onProgress:message=>{
          $('#finder-data-status').textContent=site.name+' · '+message;
        }});
        terrainProfiles.set(terrainKey(site),profile);
        if(state.site.id===site.id&&state.site.lat===site.lat&&state.site.lon===site.lon){
          state.terrain=profile;updateMissionPanels();
        }
      }catch(error){
        failures.push(site.name+': '+error.message);
      }
      updateFinderCoverage();
    }
    const count=coverageEntries().length;
    $('#finder-data-status').textContent=failures.length
      ?'Loaded '+count+' sites. '+failures.length+' failed (NASA/CDN or projection): '+failures.slice(0,2).join(' | ')+
         (failures.length>2?'…':'')+'. Only successfully loaded sites can participate.'
      :'Loaded '+count+' NASA terrain profiles. Select loaded terrain mode and run the finder.';
    if($('#finder-mode').value==='terrain'&&count>=2)runFinder();
  }finally{terrainBatchLoading=false;$('#finder-load-all').disabled=false;}
}


async function hydrateBundledTerrain(){
  try{
    const entries=await loadBundledTerrain(SITES);
    let accepted=0;
    for(const {site,profile} of entries){
      if(getCachedTerrain(site))continue; // User-loaded profiles take precedence.
      terrainProfiles.set(terrainKey(site),profile);
      accepted++;
    }
    if(accepted&&!state.terrain){
      state.terrain=getCachedTerrain(state.site);
      if(state.terrain){updateMissionPanels();if(state.base)updateInspection();}
    }
    updateFinderCoverage();
    const total=coverageEntries().length;
    $('#finder-data-status').textContent=accepted
      ?'Ready: '+total+' terrain-covered sites; '+accepted+' restored from NASA-derived bundled data (20 km experimental local horizons).'
      :'No bundled terrain profiles yet. The geometric Finder works; NASA terrain remains optional.';
    if($('#finder-mode').value==='terrain'&&total>=2)runFinder();
  }catch(error){
    $('#finder-data-status').textContent='Bundled terrain unavailable: '+error.message+'. Geometric results remain usable.';
    updateFinderCoverage();
  }
}
function renderFinderImpact(result,baseline){
  const section=$('#finder-impact'),items=$('#finder-impact-items');
  if(result.terrainMode!=='terrain'||!baseline){
    section.hidden=true;items.replaceChildren();return;
  }
  const effects=compareFinderModels(baseline,result);
  const best=result.bestBySite.map(({site,best})=>
    effects.find(e=>e.siteId===site.id&&e.startDate===best.startDate)).filter(Boolean);
  section.hidden=false;
  const fmt=n=>(n>0?'+':'')+n.toFixed(1)+' pp';
  items.innerHTML=best.map(e=>
    '<div class="finder-impact-card"><div class="finder-impact-label"><strong>'+escapeHTML(e.siteName)+
    '</strong><small>'+e.startDate+' · '+e.windowDays+' DAYS</small></div>'+
    '<div><small>SIMULTANEOUS ACCESS</small><strong>'+e.flatDualPct.toFixed(1)+'% → '+e.terrainDualPct.toFixed(1)+'%</strong>'+
    '<span class="finder-impact-delta">'+fmt(e.deltaDualPp)+'</span></div>'+
    '<div><small>SUNLIGHT</small><strong>'+e.flatSunPct.toFixed(1)+'% → '+e.terrainSunPct.toFixed(1)+'%</strong>'+
    '<span class="finder-impact-delta">'+fmt(e.deltaSunPp)+'</span></div>'+
    '<div><small>EARTH VISIBLE</small><strong>'+e.flatEarthPct.toFixed(1)+'% → '+e.terrainEarthPct.toFixed(1)+'%</strong>'+
    '<span class="finder-impact-delta">'+fmt(e.deltaEarthPp)+'</span></div></div>').join('');
}

let finderRequest=0;
function finderOpen(siteId,iso,days){
  const site=SITES.find(s=>s.id===siteId);
  if(!site)return;
  stopPlay();
  state.site=site;
  state.days=days;
  $('#mission-date').value=iso;
  // Finder windows are scanned from 12:00 UTC starts.
  $('#mission-time').value='12:00';
  document.querySelectorAll('#duration button').forEach(b=>b.classList.toggle('selected',Number(b.dataset.days)===days));
  siteSelect.value=site.id;
  updateAnalysis();
  navigatePage('explore');
  toast('Opened '+site.name+' · '+iso+' · '+days+' days (12:00 UTC)');
}
function finderPreview(result){
  const {matrix,searchDays,windowDays,stepHours,priority}=result;
  const cols=searchDays;
  const scores=matrix.flatMap(m=>m.windows.map(w=>w.score));
  const top=Math.max(0.01,...scores),low=Math.min(...scores);
  const span=Math.max(1,top-low);
  const width=Math.max(700,190+cols*25);
  let html='<div class="finder-table" style="--day-count:'+cols+';min-width:'+width+'px">';
  html+='<div class="finder-table-heading"><div>LANDING SITE</div>'+
    matrix[0].windows.map((w,i)=>'<span class="finder-date-label" title="'+w.startDate+'">'+
      (i===0||i%5===0?w.startDate.slice(5):'·')+'</span>').join('')+'</div>';
  for(const entry of matrix){
    html+='<div class="finder-table-row"><div class="finder-site-label"><strong>'+escapeHTML(entry.site.name)+
      '</strong><small>'+escapeHTML(fmtCoord(entry.site.lat,entry.site.lon))+'</small></div>';
    html+=entry.windows.map(w=>{
      const alpha=(0.18+0.77*((w.score-low)/span)).toFixed(3);
      const short=w.startDate.slice(5);
      const label=entry.site.name+' '+w.startDate+': '+w.dualPct.toFixed(1)+'% dual access, '+w.sunPct.toFixed(1)+'% Sun, '+w.earthPct.toFixed(1)+'% Earth, '+w.longestDarknessHours+' h longest darkness';
      return '<button type="button" class="finder-day" title="'+escapeHTML(label)+'" aria-label="'+escapeHTML(label)+
        '" data-site="'+escapeHTML(entry.site.id)+'" data-date="'+w.startDate+
        '" style="--heat:'+alpha+';"><span class="sr-only">'+short+'</span></button>';
    }).join('');
    html+='</div>';
  }
  html+='</div>';
  $('#finder-heatmap').innerHTML=html;
  $('#finder-caption').textContent=matrix.length+' '+(result.terrainMode==='terrain'?'terrain-covered':'geometric')+' sites × '+searchDays+' UTC start dates · '+windowDays+'-day missions · '+stepHours+'-hour sampling';
  $('#finder-model-badge').textContent=result.terrainMode==='terrain'?'LOADED LOCAL HORIZONS · EXPERIMENTAL':'GEOMETRIC HORIZON · EXPERIMENTAL';
  const chosen=[],used={};
  for(const w of result.ranked){
    if(chosen.length===6)break;
    const prior=used[w.siteId]||[];
    if(prior.length>=2 || prior.some(date=>Math.abs((Date.parse(date)-Date.parse(w.startDate))/86400000)<3))continue;
    chosen.push(w);
    used[w.siteId]=[...prior,w.startDate];
  }
  $('#finder-top').innerHTML=chosen.map((w,i)=>{
    const scoreLabel=priority==='sun'?'Sun access':priority==='earth'?'Earth visibility':'Balanced score';
    return '<button type="button" class="finder-window-card" data-site="'+escapeHTML(w.siteId)+'" data-date="'+w.startDate+
      '"><span class="finder-ranking">#'+String(i+1).padStart(2,'0')+'</span><div class="finder-window-main">'+
      '<strong>'+escapeHTML(w.siteName)+'</strong><span>START '+w.startDate+' · '+windowDays+' DAYS</span>'+
      '<div class="finder-window-details">☀ '+w.sunPct.toFixed(1)+'% Sun <b>·</b> ◉ '+w.earthPct.toFixed(1)+'% Earth <b>·</b> '+
      w.longestDarknessHours+'h longest dark</div></div><div class="finder-window-score"><strong>'+w.score.toFixed(1)+
      '</strong><small>'+scoreLabel+'</small></div><span aria-hidden="true" class="finder-window-arrow">↗</span></button>';
  }).join('');
  $('#finder-shell-status').textContent='Ranking: '+result.scoring+'; '+(result.terrainMode==='terrain'?'loaded DEM azimuth horizons for all displayed sites':'geometric flat 0° horizon')+'; UTC noon starts. No landing safety or RF link budgets.';
  renderFinderImpact(result,state.finderBaseline||null);
  for(const element of document.querySelectorAll('[data-date][data-site]')){
    element.addEventListener('click',()=>finderOpen(element.dataset.site,element.dataset.date,windowDays));
  }
}
function runFinder(){
  const startDate=$('#finder-date').value;
  const searchDays=Number($('#finder-range').value);
  const windowDays=Number($('#finder-duration').value);
  const priority=$('#finder-priority').value;
  const terrainMode=$('#finder-mode').value;
  const token=++finderRequest;
  $('#finder-run').disabled=true;
  $('#finder-caption').textContent='Scanning dates and sites…';
  // Give the browser a chance to repaint the loading state before calculating.
  requestAnimationFrame(()=>{
    if(token!==finderRequest)return;
    try{
      const entries=coverageEntries();
      if(terrainMode==='terrain'&&entries.length<2)throw Error('Load terrain profiles for at least two sites. Cannot rank unavailable DEM as flat terrain.');
      const sites=terrainMode==='terrain'?entries.map(entry=>entry.site):SITES;
      const terrainById=Object.fromEntries(entries.map(entry=>[entry.site.id,entry.terrain]));
      const result=findMissionWindows({
        sites,startDate,searchDays,windowDays,stepHours:4,priority,
        terrainMode,terrainProfiles:terrainMode==='terrain'?terrainById:null
      });
      state.finder=result;
      state.finderBaseline=terrainMode==='terrain'?findMissionWindows({
        sites,startDate,searchDays,windowDays,stepHours:4,priority,terrainMode:'flat'
      }):null;
      finderPreview(result);
    }catch(error){
      $('#finder-caption').textContent=error.message||'Finder could not calculate windows.';
      $('#finder-heatmap').textContent='';
      $('#finder-top').textContent='';
      state.finder=null;state.finderBaseline=null;
      $('#finder-impact').hidden=true;
    }finally{$('#finder-run').disabled=false;}
  });
}
function exportFinderCSV(){
  if(!state.finder)return toast('Run the window finder first');
  const rows=[['site','start_utc','duration_days','sun_pct','earth_pct','dual_pct','max_dark_hours',
    'max_earth_gap_hours','longest_dual_hours','rank_score','priority','sampling_hours',
    'horizon','data_source','baseline_sun_pct','baseline_earth_pct','baseline_dual_pct',
    'delta_sun_pp','delta_earth_pp','delta_dual_pp']];
  const differences=state.finderBaseline
    ?new Map(compareFinderModels(state.finderBaseline,state.finder).map(e=>[e.siteId+'|'+e.startDate,e]))
    :new Map();
  state.finder.ranked.forEach(w=>{
    const diff=differences.get(w.siteId+'|'+w.startDate);
    const site=SITES.find(s=>s.id===w.siteId),profile=site?getCachedTerrain(site):null;
    rows.push([
      w.siteName,w.startDate,w.windowDays,w.sunPct.toFixed(2),w.earthPct.toFixed(2),
      w.dualPct.toFixed(2),w.longestDarknessHours,w.longestEarthBlackoutHours,
      w.longestDualHours,w.score.toFixed(2),state.finder.priority,state.finder.stepHours,
      state.finder.terrainMode==='terrain'?'experimental NASA LOLA 20km local horizon':'spherical 0deg geometric horizon',
      state.finder.terrainMode==='terrain'?(profile?.provenance||'missing source'):'analytical-screening-v1',
      diff?.flatSunPct.toFixed(2)??'',diff?.flatEarthPct.toFixed(2)??'',diff?.flatDualPct.toFixed(2)??'',
      diff?.deltaSunPp.toFixed(2)??'',diff?.deltaEarthPp.toFixed(2)??'',diff?.deltaDualPp.toFixed(2)??''
    ]);
  });
  downloadCSV('lunarnav-windows-'+state.finder.startDate+'-'+state.finder.searchDays+'d.csv',rows);
  toast('All windows exported, with matched terrain differences where available');
}

// ---- Surface traverse planner ----
const travelDestination=$('#travel-destination');
const populateTravelDestinations=()=>{
  if(state.site.custom)return;
  travelDestination.innerHTML=SITES.filter(s=>s.id!==state.site.id)
    .map(site=>`<option value="${site.id}">${escapeHTML(site.name)}  ·  ${escapeHTML(fmtCoord(site.lat,site.lon))}</option>`).join('');
};
function syncTravelFromMission(){
  $('#travel-date').value=state.date;
  $('#travel-time').value=state.time;
  $('#travel-origin-name').textContent=state.site.name+' · '+fmtCoord(state.site.lat,state.site.lon);
  populateTravelDestinations();
  $('#travel-horizon-tag').textContent=state.terrain?'GEODESIC · '+state.terrain.source.toUpperCase():'GEODESIC · FLAT HORIZON';
}
let travelEstimate=null;
function runTravelEstimate(){
  const origin=state.site;
  const target=SITES.find(s=>s.id===travelDestination.value);
  if(!target){toast('Select a destination site');return;}
  const date=$('#travel-date').value,time=$('#travel-time').value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d\d:\d\d$/.test(time)){toast('Enter a valid UTC departure date and time.');return;}
  const departUTC=`${date}T${time}:00Z`;
  const speed=Number($('#travel-speed').value)||10;
  const delay=Number($('#travel-delay').value)||0;
  try{
    travelEstimate=estimateSurfaceTraverse({
      originLat:origin.lat,originLon:origin.lon,
      destinationLat:target.lat,destinationLon:target.lon,
      departUTC,speedKph:speed,delayHours:delay,
      profile:origin.id===state.site.id?getCachedTerrain(origin):terrainProfiles.get(terrainKey(origin))||null
    });
    renderTravelResults(travelEstimate,origin,target);
    toast('Surface traverse estimated');
  }catch(e){toast(e.message||'Could not estimate the traverse.');}
}
function renderTravelResults(estimate,origin,target){
  const v=estimate.visibility;
  const sunLabel=s=>s?`${Number.isFinite(s)?s.toFixed(0):'—'}% illuminated`:'Sampling unavailable';
  $('#travel-results').innerHTML=
    `<div class="travel-summary"><div><small>ROUTE</small><strong>${escapeHTML(origin.name)} → ${escapeHTML(target.name)}</strong><span>${escapeHTML(fmtCoord(origin.lat,origin.lon))} → ${escapeHTML(fmtCoord(target.lat,target.lon))}</span></div>
     <div><small>SURFACE DISTANCE</small><strong>${estimate.distanceKm.toFixed(1)} km</strong><span>Great-circle geodesic estimate</span></div>
     <div><small>DRIVING TIME</small><strong>${estimate.drivingHours.toFixed(1)} h</strong><span>at ${estimate.speedKph} km/h average</span></div>
     <div><small>TRAVERSE TOTAL</small><strong>${estimate.totalHours.toFixed(1)} h</strong><span>incl. ${estimate.delayHours.toFixed(1)} h operational delay</span></div></div>
     <div class="travel-schedule"><div><small>DEPARTURE (UTC)</small><strong>${fmtUTC(estimate.departureUTC)}</strong></div><div><small>ARRIVAL (UTC)</small><strong>${fmtUTC(estimate.arrivalUTC)}</strong></div></div>
     <div class="travel-visibility"><div><span>SUN VISIBILITY</span><strong>${v.sunIlluminatedPct.toFixed(0)}%</strong><small>${v.anyLimitedSolar?'some limited solar exposure along route':'continuous modeled illumination along route'}${estimate.terrainProfileApplied?' · origin terrain horizon applied':' · flat horizon'}</small></div>
     <div><span>EARTH VISIBILITY</span><strong>${v.earthVisiblePct.toFixed(0)}%</strong><small>${v.anyEarthLimited?'some Earth geometric outages along route':'continuous geometric Earth visibility along route'}</small></div></div>
     <p class="travel-caveat">${escapeHTML(estimate.limitation)} ${v.terrainApplied?'Loaded terrain at the origin was applied to horizon screening; terrain along the path itself was not sampled.':''}</p>`;
}
$('#travel-run').addEventListener('click',runTravelEstimate);
$('#travel-sync').addEventListener('click',()=>{syncTravelFromMission();toast('Travel inputs synced to the current mission configuration');});
$('#travel-speed').addEventListener('input',()=>{if(travelEstimate)runTravelEstimate();});
$('#travel-delay').addEventListener('input',()=>{if(travelEstimate)runTravelEstimate();});
$('#travel-date').addEventListener('change',()=>{if(travelEstimate)runTravelEstimate();});
$('#travel-time').addEventListener('change',()=>{if(travelEstimate)runTravelEstimate();});
$('#travel-destination').addEventListener('change',()=>{if(travelEstimate)runTravelEstimate();});
syncTravelFromMission();

// ---- Earth-to-Moon transit estimator ----
const transitMode=$('#transit-mode');
const transitProfile=$('#transit-profile');
const transitCustomHours=$('#transit-custom-hours');
const transitDate=$('#transit-date');
const transitTime=$('#transit-time');
function syncTransitFromMission(){
  transitDate.value=state.date;
  transitTime.value=state.time;
  $('#transit-destination-tag').textContent='DESTINATION: '+state.site.name.toUpperCase();
  if(!transitMode.value)transitMode.value='depart';
}
let transitEstimate=null;
function runTransitEstimate(){
  const date=transitDate.value,time=transitTime.value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d\d:\d\d$/.test(time)){toast('Enter a valid UTC date and time.');return;}
  const mode=transitMode.value==='land'?'land':'depart';
  const profile=transitProfile.value==='extended'?'extended':transitProfile.value==='custom'?'custom':'direct';
  const referenceHours=profile==='custom'?(Number(transitCustomHours.value)||100):null;
  try{
    transitEstimate=estimateEarthMoonTransit({
      destination:{id:state.site.id,name:state.site.name,lat:state.site.lat,lon:state.site.lon},
      profile,
      referenceHours,
      scheduleMode:mode,
      departUTC:mode==='depart'?`${date}T${time}:00Z`:null,
      landingUTC:mode==='land'?`${date}T${time}:00Z`:null
    });
    renderTransitResults(transitEstimate);
    toast('Earth-to-Moon transit estimated');
  }catch(e){toast(e.message||'Could not estimate the transit.');}
}
function renderTransitResults(estimate){
  const dest=estimate.destination;
  const destLabel=dest?`${dest.name}  ·  ${fmtCoord(dest.lat,dest.lon)}`:'Selected landing site';
  $('#transit-results').innerHTML=
    `<div class="transit-summary">
       <div><small>DESTINATION</small><strong>${escapeHTML(dest?dest.name:'Selected site')}</strong><span>${escapeHTML(fmtCoord(dest.lat,dest.lon))}</span></div>
       <div><small>TRANSIT PROFILE</small><strong>${escapeHTML(estimate.profileLabel)}</strong><span>${escapeHTML(estimate.totalTransitLabel)} total</span></div>
       <div><small>EARTH DEPARTURE</small><strong>${fmtUTC(estimate.departureUTC)}</strong><span>${estimate.scheduleMode==='land'?'Back-calculated from landing':'Chosen departure'}</span></div>
       <div><small>LUNAR ARRIVAL</small><strong>${fmtUTC(estimate.arrivalUTC)}</strong><span>${estimate.scheduleMode==='land'?'Target landing':'Arrival after transit'}</span></div>
     </div>
     <div class="transit-schedule">
       <div><small>LUNAR ORBIT INSERTION</small><strong>${fmtUTC(estimate.phases.find(p=>p.kind==='insertion').endUTC)}</strong><span>Approx. LOI event</span></div>
       <div><small>DESCENT START</small><strong>${fmtUTC(estimate.phases.find(p=>p.kind==='descent').startUTC)}</strong><span>Approx. powered descent</span></div>
     </div>
     <div class="transit-phases">
       ${estimate.phases.map(p=>`<div class="transit-phase-row"><span class="transit-phase">${escapeHTML(p.phase)}</span><span class="transit-phase-labels">${p.kind.toUpperCase()}</span><span class="transit-phase-time">${p.durationHours.toFixed(1)} h</span><span class="transit-phase-time">${fmtUTC(p.startUTC)}</span></div>`).join('')}
     </div>
     <p class="transit-limitation">${escapeHTML(estimate.limitation)}</p>`;
}
$('#transit-run').addEventListener('click',runTransitEstimate);
$('#transit-sync').addEventListener('click',()=>{syncTransitFromMission();toast('Transit inputs synced to the current mission configuration');});
$('#transit-mode').addEventListener('change',()=>{if(transitEstimate)runTransitEstimate();});
$('#transit-profile').addEventListener('change',()=>{
  $('#transit-custom-hours').disabled=$('#transit-profile').value!=='custom';
  const profile=$('#transit-profile').value;
  $('#transit-profile-tag').textContent={
    direct:'REFERENCE ~3.5 DAYS · NOT A TRAJECTORY SOLVER',
    extended:'REFERENCE ~7.5 DAYS · LOW-ENERGY FAMILY',
    custom:'CUSTOM DURATION · OPERATOR-SUPPLIED'
  }[profile]||'REFERENCE DURATIONS';
  if(transitEstimate)runTransitEstimate();
});
$('#transit-custom-hours').addEventListener('input',()=>{if(transitEstimate&&$('#transit-profile').value==='custom')runTransitEstimate();});
$('#transit-date').addEventListener('change',()=>{if(transitEstimate)runTransitEstimate();});
$('#transit-time').addEventListener('change',()=>{if(transitEstimate)runTransitEstimate();});
syncTransitFromMission();
$('#transit-hint').textContent='Direct transfer reference ~3.5 days. Extended low-energy references ~7.5 days. Destination auto-uses your selected landing site.';

// Events
siteSelect.addEventListener('change',()=>{const s=SITES.find(x=>x.id===siteSelect.value);if(s)selectSite(s);});
document.querySelectorAll('#duration button').forEach(b=>b.addEventListener('click',()=>{state.days=Number(b.dataset.days);document.querySelectorAll('#duration button').forEach(x=>x.classList.toggle('selected',x===b));stopPlay();updateAnalysis();}));
$('#analyze-btn').addEventListener('click',()=>{stopPlay();updateAnalysis();toast('Mission window recalculated');});
$('#mission-date').addEventListener('change',()=>{stopPlay();updateAnalysis();});
$('#mission-time').addEventListener('change',()=>{stopPlay();updateAnalysis();});
$('#time-scrubber').addEventListener('input',e=>{stopPlay();setOffset(e.target.value);});
$('#time-back').addEventListener('click',()=>{
  stopPlay();setOffset(state.offset-6);
  $('#time-event-note').textContent='Moved to '+new Date(state.base.getTime()+state.offset*3600000).toISOString().slice(0,16).replace('T',' ')+' UTC';
});
$('#time-next').addEventListener('click',()=>{
  stopPlay();setOffset(state.offset+6);
  $('#time-event-note').textContent='Moved to '+new Date(state.base.getTime()+state.offset*3600000).toISOString().slice(0,16).replace('T',' ')+' UTC';
});
$('#time-event').addEventListener('click',()=>{
  stopPlay();
  const upcoming=findNextHorizonEvent({
    startUTC:state.base,site:state.site,durationHours:state.days*24,
    offsetHours:state.offset,profile:state.terrain
  });
  if(!upcoming){
    $('#time-event-note').textContent='No further sampled Sun/Earth horizon changes in this window.';
    toast('No more modeled horizon events in this window');return;
  }
  setOffset(upcoming.offsetHours);
  $('#time-event-note').textContent=upcoming.eventType+' crossing · '+
    upcoming.eventUTC.slice(0,16).replace('T',' ')+' UTC · approximate (model + 30-min display)';
  toast('Jumped to modeled '+upcoming.eventType+' horizon event');
});
const celestialViewBtn=$('#celestial-view');
if(!map.setCelestialVisible){
  celestialViewBtn.disabled=true;celestialViewBtn.setAttribute('aria-pressed','false');
  celestialViewBtn.title='Earth and Sun markers require WebGL';
}
celestialViewBtn.addEventListener('click',()=>{
  const enabled=map.setCelestialVisible?.(celestialViewBtn.getAttribute('aria-pressed')!=='true');
  if(enabled===undefined){toast('3D sky view requires WebGL');return;}
  celestialViewBtn.setAttribute('aria-pressed',String(enabled));
  celestialViewBtn.setAttribute('aria-label',enabled?'Hide Sun and Earth in the lunar globe':'Show Sun and Earth in the lunar globe');
  celestialViewBtn.querySelector('span').textContent=enabled?'Bodies on':'Bodies off';
});
$('#celestial-scrubber').addEventListener('input',event=>{stopPlay();setOffset(event.target.value);});
$('#celestial-play').addEventListener('click',togglePlay);
$('#celestial-reset').addEventListener('click',()=>{map.resetBodies?.();toast('Earth and Sun spins reset');});
$('#zoom-in').addEventListener('click',()=>$('#zoom-label').textContent=map.zoomBy(.2)+'%');
$('#zoom-out').addEventListener('click',()=>$('#zoom-label').textContent=map.zoomBy(-.2)+'%');

$('#focus-site').addEventListener('click',()=>{
  const level=map.focusSite?.();
  if(Number.isFinite(level))$('#zoom-label').textContent=level+'%';
  $('#focus-site').setAttribute('aria-pressed','true');
  $('#moon-map').focus({preventScroll:true});
});
$('#reset-view')?.addEventListener('click',()=>{
  const level=map.resetView?.();
  if(Number.isFinite(level))$('#zoom-label').textContent=level+'%';
  $('#focus-site').setAttribute('aria-pressed','false');
});
function setImmersive(enabled){
  document.body.classList.toggle('globe-immersive',enabled);
  $('#expand-globe').setAttribute('aria-pressed',String(enabled));
  $('#expand-globe').setAttribute('aria-label',enabled?'Exit immersive lunar globe':'Expand lunar globe');
  $('#expand-globe').textContent=enabled?'✕':'⛶';
  if(enabled)$('#moon-map').focus({preventScroll:true});
  else $('#expand-globe').focus({preventScroll:true});
}
$('#expand-globe').addEventListener('click',()=>setImmersive(!document.body.classList.contains('globe-immersive')));
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&document.body.classList.contains('globe-immersive'))setImmersive(false);
});
$('#hero-explore').addEventListener('click',()=>{
  $('#map-stage').scrollIntoView({behavior:'smooth',block:'center'});
  const level=map.focusSite?.();
  if(Number.isFinite(level))$('#zoom-label').textContent=level+'%';
  $('#focus-site').setAttribute('aria-pressed','true');
});
$('#hero-find').addEventListener('click',()=>navigatePage('windows'));

$('#download-csv').addEventListener('click',generateCSV);
$('#brief-btn').addEventListener('click',openBrief);
$('#copy-brief').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(briefText());toast('Mission briefing copied');}catch{toast('Clipboard unavailable; use Print / save PDF');}});
$('#print-brief').addEventListener('click',()=>window.print());
$('#share-btn').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(location.href);toast('Shareable mission link copied');}catch{toast('Copy this page URL to share');}});
$('#notice-method').addEventListener('click',()=>navigatePage('science'));
$('#footer-method').addEventListener('click',()=>navigatePage('science'));
$('#science-detail').addEventListener('click',()=>$('#method-dialog').showModal());
$$('[data-close]').forEach(x=>x.addEventListener('click',()=>$('#'+x.dataset.close).close()));
$$('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d)d.close();}));
document.addEventListener('click',event=>{
  const anchor=event.target.closest?.('a[data-route]');
  if(!anchor||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  event.preventDefault();
  navigatePage(anchor.dataset.route);
});
window.addEventListener('popstate',()=>{
  const params=new URLSearchParams(location.search);
  const site=SITES.find(s=>s.id===params.get('site'));
  const days=Number(params.get('days'));
  let changed=false;
  if(site&&site.id!==state.site.id){state.site=site;siteSelect.value=site.id;changed=true;}
  if([3,7,14,28].includes(days)&&days!==state.days){state.days=days;document.querySelectorAll('#duration button').forEach(b=>b.classList.toggle('selected',Number(b.dataset.days)===days));changed=true;}
  const date=params.get('date');
  if(date&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&date!==state.date){$('#mission-date').value=date;changed=true;}
  const page=routeFromURL(location.pathname,location.hash);
  showPage(page);
  if(changed)updateAnalysis();
});
$('#timeline-graph').insertAdjacentHTML('beforebegin','<button class="replay-button" id="replay-btn" type="button">▶ Replay window</button>');
$('#replay-btn').addEventListener('click',togglePlay);

for(const id of ['eng-area','eng-efficiency','eng-load','eng-battery','eng-earthcutoff','eng-derate']){
  $('#'+id).addEventListener('input',()=>{
    state.engineering=engineeringInputs();updateMissionPanels();
  });
}
$('#terrain-load').addEventListener('click',()=>requestTerrain());
$('#terrain-file').addEventListener('change',e=>{
  if(e.target.files?.[0])requestTerrain(e.target.files[0]);
  e.target.value='';
});
$('#export-model').addEventListener('click',exportEngineeringCSV);
$('#finder-date').value=state.date;
$('#finder-duration').value=[3,7,14].includes(state.days)?String(state.days):'7';
$('#finder-run').addEventListener('click',runFinder);
$('#finder-mode').addEventListener('change',()=>{updateFinderCoverage();runFinder();});
$('#finder-load-all').addEventListener('click',tryLoadAllTerrain);
$('#finder-open-terrain').addEventListener('click',()=>{
  navigatePage('engineering');
  toast('Select a site above, then load NASA terrain or import its 80m GeoTIFF.');
});
$('#finder-export').addEventListener('click',exportFinderCSV);
showPage(currentPage,{scroll:false});
updateAnalysis();
updateFinderCoverage();
runFinder();
hydrateBundledTerrain();
initOnboarding({
  navigateView:page=>showPage(page,{scroll:true}),
  getPage:()=>currentPage
});

// ---- Gemini mission assistant ----
function assistantContext(){
  const inspectionUTC = state.base
    ? new Date(state.base.getTime() + state.offset * 3600000).toISOString()
    : null;
  const stats = (state && state.samples && state.samples.length)
    ? summarize(state.samples)
    : null;
  const best = (state && state.samples && state.samples.length)
    ? longestDualWindow(state.samples)
    : null;
  return {
    site: state.site || null,
    date: state.date, time: state.time, days: state.days, offset: state.offset,
    inspectionUTC, route: currentPage, isCustom: Boolean(state.site?.custom),
    terrain: state.terrain || null,
    simulation: state.simulation || null,
    missionSummary: stats ? {
      sunPct: stats.sun, earthPct: stats.earth, dualPct: stats.dual,
      longestBlackoutHours: stats.longestBlackoutHours,
      bestDualHours: best && best.hours ? best.hours : 0
    } : null,
    finder: state.finder || null,
    terrainProfiles: Object.fromEntries(terrainProfiles.entries()),
    transit: (typeof transitEstimate !== 'undefined' && transitEstimate) ? {
      model: transitEstimate.model,
      profile: transitEstimate.profile,
      profileLabel: transitEstimate.profileLabel,
      destination: transitEstimate.destination,
      totalTransitHours: transitEstimate.totalTransitHours,
      departureUTC: transitEstimate.departureUTC,
      arrivalUTC: transitEstimate.arrivalUTC,
      scheduleMode: transitEstimate.scheduleMode
    } : null
  };
}
initMissionAssistant({
  root: $('#assistant-root'),
  fab: $('#assistant-fab'),
  panel: $('#assistant-panel'),
  messages: $('#assistant-messages'),
  input: $('#assistant-input'),
  send: $('#assistant-send'),
  close: $('#assistant-close'),
  newConversation: $('#assistant-new'),
  context: $('#assistant-context'),
  toolsEl: $('#assistant-tools'),
  contextText: $('#assistant-context-text'),
  getContext: assistantContext
});
refreshAssistantContext();

