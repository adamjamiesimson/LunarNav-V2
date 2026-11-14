import {ephemeris,sampleWindow,summarize,longestDualWindow} from './astro.js';
import {TIMELINE as TL,indicatorX,fractionToOffset,timelineFractionFromSVGPoint,horizontalCTM,clientXToSVGX} from './timeline.js';
import {SITES,fmtCoord} from './sites.js';
import {createMap} from './globe.js';
import {simulateMission,DEFAULT_ENGINEERING} from './mission.js';
import {estimateSurfaceTraverse} from './travel.js';
import {estimateEarthMoonTransit} from './transit.js';
import {loadLolaTerrain} from './terrain.js';
import {findMissionWindows,compareFinderModels} from './finder.js';
import {windowMetrics,comparisonRows} from './compare.js';
import {inspectSituation,buildSkyDiagram,fmtMargin,findNextHorizonEvent} from './situation.js';
import {loadBundledTerrain} from './terrain-cache.js';
import {deriveGridHorizon,deriveSldemPatch,loadSiteHeights} from './grid-terrain.js';
import {computePanoramaColumns,createPanoramaView,bodyStatus} from './panorama.js';
import {createSurfaceView} from './panorama-gl.js';
import {PAGE_ROUTES,PAGE_TITLES,routeFromURL,buildPageURL} from './router.js';
import {initOnboarding} from './onboarding.js';
import {initMissionAssistant,refreshAssistantContext} from './assistant.js';
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const fmtPct=n=>`${n.toFixed(1)}%`;
const fmtDeg=n=>`${n>=0?'+':''}${n.toFixed(2)}°`;
const fmtUTC=iso=>String(iso).slice(0,16).replace('T',' ')+' UTC';
const longDate=date=>date.toLocaleString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})+' UTC';
const shortDate=date=>date.toLocaleDateString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric'});
const escapeHTML=str=>String(str).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
// The Sun completes one apparent circuit around the Moon in a synodic month
// (measured 707–710 h in this ephemeris); 714 h always covers the full orbit.
const SUN_CIRCUIT_HOURS=714;
const params=new URLSearchParams(location.search);
const startSite=SITES.find(x=>x.id===params.get('site'))||SITES[0];
const startDays=[3,7,14,28].includes(Number(params.get('days')))?Number(params.get('days')):7;
const startDate=/^\d{4}-\d{2}-\d{2}$/.test(params.get('date')||'')?params.get('date'):'2026-11-14';
const state={site:startSite,date:startDate,time:'12:00',days:startDays,offset:0,base:null,samples:[],playing:false,terrain:null,engineering:{...DEFAULT_ENGINEERING},simulation:null,customSite:null};
let currentPage=routeFromURL(location.pathname,location.hash);
const terrainProfiles=new Map();
const terrainAttempted=new Set();
let terrainRequestSeq=0,terrainController=null;
function cancelTerrainRequest(){
  terrainRequestSeq++;terrainController?.abort();terrainController=null;
  $('#terrain-load').disabled=false;
}
function cacheTerrain(site,profile){
  terrainProfiles.set(terrainKey(site),profile);
  const customKeys=[...terrainProfiles.keys()].filter(key=>key.startsWith('custom|'));
  while(customKeys.length>6)terrainProfiles.delete(customKeys.shift());
}
function refreshTerrainResults(){
  const offset=state.offset;
  state.terrain=getCachedTerrain(state.site);
  state.samples=sampleWindow({start:state.base,lat:state.site.lat,lon:state.site.lon,days:state.days,stepHours:2,profile:state.terrain});
  updateMetrics();drawTimeline();updateMissionPanels();
  setOffset(offset);updateFinderCoverage();updateModelNotes();renderComparePanel();renderDateComparison();runFinder();refreshAssistantContext();
}
function profilesBySite(){return Object.fromEntries(SITES.map(site=>[site.id,getCachedTerrain(site)]).filter(([,profile])=>profile));}
const terrainKey=site=>site.id+'|'+site.lat.toFixed(6)+'|'+site.lon.toFixed(6);
const getCachedTerrain=site=>terrainProfiles.get(terrainKey(site))||null;
let playTimer,toastTimer;
const siteSelect=$('#site-select');
SITES.forEach(site=>siteSelect.add(new Option(`${site.name}: ${site.kind}`,site.id)));
siteSelect.value=state.site.id;
$('#mission-date').value=state.date;
document.querySelectorAll('#duration button').forEach(b=>b.classList.toggle('selected',Number(b.dataset.days)===state.days));

// Navigation is registered first: if any later boot step fails, the site must
// stay usable rather than freezing on the landing page.
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
  if(site&&site.id!==state.site.id){cancelTerrainRequest();state.site=site;siteSelect.value=site.id;changed=true;}
  if([3,7,14,28].includes(days)&&days!==state.days){state.days=days;document.querySelectorAll('#duration button').forEach(b=>b.classList.toggle('selected',Number(b.dataset.days)===days));changed=true;}
  const date=params.get('date');
  if(date&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&date!==state.date){$('#mission-date').value=date;changed=true;}
  const page=routeFromURL(location.pathname,location.hash);
  showPage(page);
  if(changed)updateAnalysis();
});


/** Keep current-site settings shareable across distinct page URLs. */
function selectionQuery(){
  const p=new URLSearchParams();
  if(!state.site.custom)p.set('site',state.site.id);
  p.set('date',state.date);p.set('days',String(state.days));
  return p.toString();
}
function showPage(page,{scroll=true}={}){
  currentPage=PAGE_ROUTES[page]?page:'explore';
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
  document.title=PAGE_TITLES[currentPage]+' | LunarNav';
  if(scroll)window.scrollTo(0,0);
  // Repaint the globe after its container becomes visible again.
  if(currentPage==='explore'&&state.base){
    requestAnimationFrame(()=>{map.render(state.site);drawTimeline();updateInspection();});
  }
}
function navigatePage(page,{replace=false}={}){
  if(!PAGE_ROUTES[page])return;
  if(currentPage!==page)stopPlay();
  const path=buildPageURL(page,selectionQuery());
  if(replace)history.replaceState({page},'',path);
  else if(location.pathname+location.search!==path)history.pushState({page},'',path);
  showPage(page);
}

function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2800);}
/** Write a CSV from row arrays (every cell quoted). */
function downloadCSV(filename,rows){const cell=v=>'"'+String(v).replaceAll('"','""')+'"';const text=rows.map(r=>r.map(cell).join(',')).join('\n');const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);}
function updateURL(){if(state.site.custom)return;history.replaceState({page:currentPage},'',buildPageURL(currentPage,selectionQuery()));}
let map;
try{
map=createMap($('#moon-map'),{onPick:selectSite,onHover:(site,e)=>{const tip=$('#map-tooltip');if(!site){tip.hidden=true;return;}tip.hidden=false;tip.textContent=`${site.name}: ${site.kind}: ${fmtCoord(site.lat,site.lon)}`;const rect=$('#map-stage').getBoundingClientRect();tip.style.left=`${Math.min(rect.width-235,Math.max(12,e.clientX-rect.left+16))}px`;tip.style.top=`${Math.max(12,e.clientY-rect.top-20)}px`;}});
}catch(error){
  // The globe must never take the whole app down; everything else keeps working.
  console.warn('Globe unavailable:',error);
  map={render(){},zoomBy:()=>100,resetView:()=>100,focusSite:()=>135};
}
function selectSite(site){cancelTerrainRequest();stopPlay();state.site=site;if(site.custom){state.customSite=site;if(!siteSelect.querySelector('[value="custom"]'))siteSelect.add(new Option('Custom waypoint: Map-selected','custom'));}siteSelect.value=site.id;updateAnalysis();toast(`${site.name} selected`);maybeAutoTerrain();}
/** Custom waypoints get real NASA terrain automatically: picking a point on the
 * globe is an explicit request for its local horizon, so one DEM patch read is
 * proportionate. Failures are remembered so the session never retries in vain. */
function maybeAutoTerrain(){
  const site=state.site;
  if(getCachedTerrain(site))return;
  const key=terrainKey(site);
  if(terrainAttempted.has(key))return;
  terrainAttempted.add(key);
  // Instant horizon from the bundled NASA relief grids (offline, whole globe).
  // No automatic network load: "Load NASA terrain" stays the explicit path for
  // a native-resolution refinement, so rapid clicking can never race a download.
  deriveGridHorizon(site).then(profile=>{
    if(terrainKey(state.site)!==key||getCachedTerrain(site)&&!getCachedTerrain(site).gridDerived)return;
    cacheTerrain(site,profile);
    refreshTerrainResults();
    $('#terrain-status').textContent='Local sky horizon derived from the baked NASA grid ('+
      (profile.resolutionM>=1000?(profile.resolutionM/1000).toFixed(1)+' km':Math.round(profile.resolutionM)+' m')+').';
  }).catch(()=>{
    if(terrainKey(state.site)!==key)return;
    updateModelNotes();
    toast('No terrain grid covers this location; flat-horizon model in use.');
  });
}
function refreshMissionContext(){
  const label=state.site.name+': '+state.date+' '+state.time+' UTC: '+state.days+' days';
  $('#engineering-context').textContent=label;
  $('#finder-date').value=state.date;
  $('#planning-time').value=state.time;
  $('#finder-duration').value=String(state.days);
  const travelDate=$('#travel-date');
  if(travelDate){travelDate.value=state.date;$('#travel-time').value=state.time;populateTravelDestinations();}
  const transitDateInput=$('#transit-date');
  if(transitDateInput){transitDateInput.value=state.date;$('#transit-time').value=state.time;}
  $('#transit-destination-tag').textContent=state.site.name;
  refreshAssistantContext();
}
function updateSelected(){const site=state.site;$('#selected-name').textContent=site.name;$('#selected-tag').textContent=site.tag;$('#selected-coord').textContent=fmtCoord(site.lat,site.lon);$('#selected-type').textContent=site.kind;$('#site-source').href=site.source||'https://science.nasa.gov/moon/';$('#site-source').style.display=site.custom?'none':'';$('#map-site-name').textContent=site.name;$('#map-coordinate').textContent=fmtCoord(site.lat,site.lon);$('.site-dot').style.background=site.accent;map.render(site);}
function readDate(){const date=$('#mission-date').value;const time=$('#mission-time').value;if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d\d:\d\d$/.test(time))throw new Error('Enter a valid UTC date and time.');const base=new Date(`${date}T${time}:00Z`);if(!Number.isFinite(base.getTime()))throw new Error('Invalid UTC date.');return {date,time,base};}
function updateAnalysis(){try{state.terrain=getCachedTerrain(state.site);const x=readDate();state.date=x.date;state.time=x.time;state.base=x.base;state.offset=0;state.samples=sampleWindow({start:state.base,lat:state.site.lat,lon:state.site.lon,days:state.days,stepHours:2,profile:state.terrain});$('#time-scrubber').max=String(state.days*24);$('#celestial-scrubber').max=String(SUN_CIRCUIT_HOURS);$('#time-scrubber').value='0';$('#metric-days').textContent=`${state.days} days`;$('#end-label').textContent=`+${state.days} days`;$('#timeline-start').textContent=shortDate(state.base);$('#timeline-end').textContent=shortDate(new Date(state.base.getTime()+state.days*86400000));updateSelected();refreshMissionContext();updateMetrics();drawTimeline();updateModelNotes();renderComparePanel();renderDateComparison();updateInspection();updateMissionPanels();updateURL();runFinder();}catch(e){toast(e.message||'Could not calculate the mission window.');}}
function updateMetrics(){const stats=summarize(state.samples);$('#dual-value').textContent=stats.dual.toFixed(1);$('#sun-value').textContent=fmtPct(stats.sun);$('#earth-value').textContent=fmtPct(stats.earth);$('#blackout-value').textContent=stats.longestBlackoutHours.toFixed(0)+' h';$('#sun-bar').style.width=`${stats.sun}%`;$('#earth-bar').style.width=`${stats.earth}%`;const best=longestDualWindow(state.samples);$('#best-window-length').textContent=best.hours?`${best.hours.toFixed(0)} hours`:'No dual-access window';$('#best-window-dates').textContent=best.start?`${shortDate(new Date(best.start))} → ${shortDate(new Date(best.end))} (UTC)`:'';}
const {W,H,L,R,Y,rowGap,rowH}=TL;
function drawTimeline(){const list=state.samples.slice(0,-1),N=list.length;const rows=[['Sun',x=>x.sun.visible,'sun'],['Earth',x=>x.earth.visible,'earth'],['Both',x=>x.dual,'dual']];const width=W-L-R;let svg=`<svg class="timeline-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mission visibility timeline"><g id="timeline-track">`;
  for(let d=0;d<=state.days;d++){const x=L+width*d/state.days;svg+=`<line x1="${x}" x2="${x}" y1="6" y2="${Y+rowGap*2+rowH+7}" stroke="rgba(255,255,255,${d===0||d===state.days?'.16':'.07'})" stroke-dasharray="3 5"/>`;if(d<state.days)svg+=`<text class="timeline-day-label" x="${x+4}" y="${H-6}" fill="var(--muted)" font-size="10" font-family="monospace">${d===0?'D01':d%2===0||state.days<=7?'D'+String(d+1).padStart(2,'0'):''}</text>`;}
  rows.forEach(([label,pred,kind],i)=>{const y=Y+i*rowGap;svg+=`<text class="timeline-row-label" x="0" y="${y+12}" fill="var(--muted)" font-size="13">${label}</text><rect x="${L}" y="${y}" width="${width}" height="${rowH}" rx="2" fill="var(--panel-alt)"/>`;list.forEach((point,j)=>{if(pred(point))svg+=`<rect x="${(L+width*j/N).toFixed(2)}" y="${y}" width="${(width/N+.3).toFixed(2)}" height="${rowH}" fill="var(--${kind})" />`;});});
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
/* ---- panoramic surface view ---- */
let panoramaView=null,panoramaColumns=null;
function panoramaBodyLine(obs,pano){
  const part=(label,body)=>label+' '+Math.round(body.azimuth)+'° azimuth, '+body.elevation.toFixed(1)+'° elevation: '+bodyStatus(pano,body);
  return part('Sun',obs.sun)+': '+part('Earth',obs.earth);
}
async function openPanorama(){
  const overlay=$('#panorama-overlay'),btn=$('#panorama-open');
  if(!overlay||!map.panoramaZoom)return;
  btn.disabled=true;
  // Fly from orbit toward the waypoint; the panorama fades in on arrival.
  map.panoramaZoom({lat:state.site.lat,lon:state.site.lon},async()=>{
    try{
      const site=state.site;
      const heights=await loadSiteHeights(site,{radiusKm:45,patch:state.terrain?.patch||null});
      const pano=computePanoramaColumns({heightAt:heights.heightAt,site,azimuthBins:720,maxDistanceKm:45,observerHeightM:5});
      const obs=ephemeris(new Date(state.base.getTime()+state.offset*3600000),site.lat,site.lon);
      panoramaColumns=pano;
      const nativePatch=state.terrain?.patch||null;
      try{
        // First-person 3D surface view (WebGL ray march). Falls back to the
        // cylindrical panorama where WebGL is unavailable.
        panoramaView=await createSurfaceView($('#panorama-canvas'),{
          site,obs,patch:nativePatch,hud:$('#panorama-hud'),
          onHeading:h=>{const el=$('#panorama-heading');if(el)el.textContent='Heading '+Math.round(h)+'°';},
          bodyLabel:body=>bodyStatus(pano,body)
        });
      }catch{
        try{
          panoramaView=createPanoramaView($('#panorama-canvas'),{site,panorama:pano,obs});
          toast('3D unavailable. Showing the 2D panorama.');
        }catch(fallbackError){
          throw Error('Could not render the surface panorama.',{cause:fallbackError});
        }
      }
      $('#panorama-title').textContent=site.name;
      const gridLabel=fmtCoord(site.lat,site.lon)+': '+Math.round(heights.resolutionM)+' m terrain grid';
      $('#panorama-subtitle').textContent=gridLabel+(nativePatch?' + native terrain':'');
      $('#panorama-bodies').textContent=panoramaBodyLine(obs,pano);
      overlay.hidden=false;
      // Redraw once the overlay has real layout: the view was built while the
      // overlay was hidden (zero-size canvas), so its first frame is invalid.
      requestAnimationFrame(()=>{overlay.classList.add('visible');panoramaView?.redraw?.();});
      // Sharpen the near field: auto-load the native-resolution terrain patch
      // for this area (the same NASA data "Load NASA terrain" fetches) and
      // blend it in when it arrives. The grid view shows immediately.
      if(!nativePatch&&panoramaView?.setPatch){
        const view=panoramaView;
        Promise.resolve().then(()=>Math.abs(site.lat)<60?deriveSldemPatch(site):loadLolaTerrain(site,{}))
          .then(profile=>{
            if(!profile?.patch||panoramaView!==view)return;
            view.setPatch(profile.patch);
            const gsm=Math.round(profile.patch.groundSampleM||Math.abs(profile.patch.resolutionY));
            $('#panorama-subtitle').textContent=gridLabel+' + '+gsm+' m native terrain';
          })
          .catch(()=>{/* Keep the bundled terrain when refinement is unavailable. */});
      }
    }catch(e){toast('Could not open the panorama. '+(e.message||'Terrain unavailable.'));}
    btn.disabled=false;
  });
}
function closePanorama(){
  const overlay=$('#panorama-overlay');
  if(!overlay)return;
  overlay.classList.remove('visible');
  overlay.hidden=true;
  panoramaView?.destroy();panoramaView=null;panoramaColumns=null;
  map.resetView?.();
}
function updateInspection(){
  const date=new Date(state.base.getTime()+state.offset*3600000);
  const obs=ephemeris(date,state.site.lat,state.site.lon);
  const view=inspectSituation(obs,state.terrain);
  map.setSun?.(obs,state.site); // Geometric globe lighting, not DEM shadows.
  if(panoramaView&&panoramaColumns){
    panoramaView.setObs(obs);
    $('#panorama-bodies').textContent=panoramaBodyLine(obs,panoramaColumns);
  }
  $('#condition-date').textContent=longDate(date);
  $('#sun-elevation').textContent=fmtDeg(obs.sun.elevation);
  $('#earth-elevation').textContent=fmtDeg(obs.earth.elevation);
  const sun=$('#sun-state'),earth=$('#earth-state');
  sun.textContent=view.sunVisible?'Clear':'Below horizon';
  earth.textContent=view.earthVisible?'In view':'Obstructed';
  sun.classList.toggle('muted',!view.sunVisible);
  earth.classList.toggle('muted',!view.earthVisible);
  $('#sky-plot').innerHTML=buildSkyDiagram(obs,state.terrain);
  const source=horizonBadgeText(state.terrain);
  $('#horizon-label').textContent=source;
  $('#sky-horizon-note').textContent=view.terrain?'Terrain outline':'0° reference circle';
  $('#mission-verdict').textContent=view.combined[0]+view.combined.slice(1).toLowerCase();
  $('#mission-verdict').dataset.visibility=view.sunVisible&&view.earthVisible?'both':
    view.sunVisible||view.earthVisible?'partial':'none';
  $('#mission-source').textContent=source+': '+state.site.name;
  $('#mission-sun-margin').textContent=fmtMargin(view.sunMargin);
  $('#mission-earth-margin').textContent=fmtMargin(view.earthMargin);
  $('#mission-caution').textContent=view.nearBoundary
    ?'Near the modeled horizon. Small angular errors can change visibility.'
    :'';
  $('#scrub-time-label').textContent='Day '+String(Math.floor(state.offset/24)+1)+
    ': '+date.toISOString().slice(11,16);
  $('#time-scrubber').value=String(state.offset);
  const celestialSlider=$('#celestial-scrubber');
  if(celestialSlider)celestialSlider.value=String(state.offset);
  const celestialClock=$('#celestial-clock');
  if(celestialClock)celestialClock.textContent=date.toISOString().slice(0,16).replace('T','  ')+' UTC';
  updateIndicator();
}
function setOffset(v){state.offset=Math.max(0,Math.min(SUN_CIRCUIT_HOURS,Number(v)||0));updateInspection();}
/** Every results panel states which horizon model produced its numbers. */
function horizonBadgeText(profile){
  if(!profile)return 'Flat 0° horizon';
  const res=profile.resolutionM>=1000?(profile.resolutionM/1000).toFixed(1)+' km':Math.round(profile.resolutionM)+' m';
  return (profile.verifiedSource?'NASA terrain':'User DEM: unverified')+': '+res+': '+profile.radiusKm+' km';
}
function updateModelNotes(){
  const text=horizonBadgeText(state.terrain);
  for(const id of ['timeline-model','metrics-model']){const el=$('#'+id);if(el){el.textContent=text;el.classList.toggle('flat',!state.terrain);}}
}

// ---- Side-by-side comparison of sites and mission dates ----
function compareEntries(){
  const terrainMode=$('#finder-mode').value==='terrain';
  const entries=SITES.filter(site=>!terrainMode||getCachedTerrain(site)).map(site=>{
    const profile=terrainMode?getCachedTerrain(site):null;
    return {site,name:site.name,kind:site.kind,profile,
      metrics:windowMetrics({start:state.base,days:state.days,lat:site.lat,lon:site.lon,profile})};
  });
  // The custom waypoint picked on the 3D globe joins the comparison as an
  // extra column, labelled as the user's own selection. Its metrics use the
  // same window and horizon rules as every preset site.
  const custom=state.customSite;
  if(custom&&(!terrainMode||getCachedTerrain(custom))){
    const profile=terrainMode?getCachedTerrain(custom):null;
    entries.push({site:custom,custom:true,name:'Custom waypoint',kind:'Selected by you on the 3D globe',profile,
      metrics:windowMetrics({start:state.base,days:state.days,lat:custom.lat,lon:custom.lon,profile})});
  }
  return entries;
}
function compareTableHTML(entries,rows){
  return '<table class="metric-table"><thead><tr><th scope="col">Metric</th>'+entries.map(e=>{
    const name=e.custom
      ?'<button type="button" class="planning-site" data-custom="1" aria-label="Inspect '+escapeHTML(e.name)+'">'+escapeHTML(e.name)+' ↗</button>'
      :e.site?'<button type="button" class="planning-site" data-site="'+e.site.id+'" aria-label="Inspect '+escapeHTML(e.name)+'">'+escapeHTML(e.name)+' ↗</button>':escapeHTML(e.name);
    const model=e.profile?'Terrain: '+(e.profile.resolutionM>=1000?(e.profile.resolutionM/1000).toFixed(1)+' km':Math.round(e.profile.resolutionM)+' m'):'Flat 0°';
    return '<th scope="col">'+name+'<small>'+escapeHTML(e.kind)+'<br>'+model+'</small></th>';
  }).join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr><th scope="row">'+r.label+'</th>'+r.values.map(v=>'<td>'+v.value.toFixed(v.digits)+' '+v.unit+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
}
function compareTimelineSVG(entries){
  const W=960,L=150,R=12,rowH=30,gap=8,axisH=16,days=entries[0].metrics.days,span=W-L-R;
  const H=entries.length*(rowH+gap)+axisH;
  let svg=`<svg viewBox="0 0 ${W} ${H}" class="compare-svg" role="img" aria-label="Illumination and geometric Earth visibility for each compared site">`;
  for(let d=0;d<=days;d++){const x=L+span*d/days;svg+=`<line x1="${x}" x2="${x}" y1="0" y2="${H-axisH}" stroke="rgba(255,255,255,${d===0||d===days?'.16':'.07'})"/><text x="${d===days?x:x+3}" y="${H-3}" text-anchor="${d===days?'end':'start'}" fill="var(--muted)" font-size="10">D${String(d).padStart(2,'0')}</text>`;}
  entries.forEach((e,i)=>{
    const y=i*(rowH+gap),intervals=e.metrics.samples.slice(0,-1),bar=span/intervals.length+.3;
    svg+=`<text x="0" y="${y+14}" fill="#E6EAEC" font-size="11">${escapeHTML(e.name.slice(0,20))}</text>`+
      `<rect x="${L}" y="${y+2}" width="${span}" height="8" fill="var(--panel-alt)"/>`+
      `<rect x="${L}" y="${y+14}" width="${span}" height="8" fill="var(--panel-alt)"/>`;
    intervals.forEach((s,j)=>{const x=L+span*j/intervals.length;
      if(s.sun.visible)svg+=`<rect x="${x.toFixed(1)}" y="${y+2}" width="${bar.toFixed(1)}" height="8" fill="var(--sun)"/>`;
      if(s.earth.visible)svg+=`<rect x="${x.toFixed(1)}" y="${y+14}" width="${bar.toFixed(1)}" height="8" fill="var(--earth)"/>`;});
  });
  return svg+'</svg><div class="compare-legend"><span><i class="sun-color"></i> Sun above horizon</span><span><i class="earth-color"></i> Geometric Earth view</span></div>';
}
function renderComparePanel(){
  const entries=compareEntries(),terrainMode=$('#finder-mode').value==='terrain';
  const badge=$('#compare-model');
  badge.textContent=terrainMode?'Loaded terrain: '+entries.length+' sites':'Flat 0° horizon: '+entries.length+' sites';
  badge.classList.toggle('flat',!terrainMode);
  if(entries.length<2){
    $('#compare-table').innerHTML='<p class="empty-note">Load terrain for at least two sites in Engineering or select the geometric horizon.</p>';
    $('#compare-timeline').innerHTML='';return;
  }
  $('#compare-table').innerHTML=compareTableHTML(entries,comparisonRows(entries));
  $('#compare-timeline').innerHTML=compareTimelineSVG(entries);
  for(const button of $$('#compare-table .planning-site'))button.addEventListener('click',()=>{
    const site=button.dataset.custom?state.customSite:SITES.find(site=>site.id===button.dataset.site);
    if(!site)return;
    selectSite(site);navigatePage('explore');
  });
}
function renderDateComparison(){
  const site=SITES.find(s=>s.id===$('#date-compare-site').value)||state.site;
  const a=$('#date-compare-a').value,b=$('#date-compare-b').value,table=$('#date-compare-table');
  const badge=$('#date-compare-model'),terrainMode=$('#finder-mode').value==='terrain';
  const profile=terrainMode?getCachedTerrain(site):null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(a)||!/^\d{4}-\d{2}-\d{2}$/.test(b)){
    table.innerHTML='<p class="empty-note">Pick two valid UTC dates.</p>';badge.textContent='Select dates';return;
  }
  if(terrainMode&&!profile){table.innerHTML='<p class="empty-note">No terrain profile for this site. Load one in Engineering or choose the flat horizon.</p>';badge.textContent='No terrain';return;}
  const entries=[['A',a],['B',b]].map(([label,date])=>({
    name:'Date '+label+': '+date,kind:site.name,profile,
    metrics:windowMetrics({start:new Date(date+'T'+state.time+':00Z'),days:state.days,lat:site.lat,lon:site.lon,profile})
  }));
  table.innerHTML=compareTableHTML(entries,comparisonRows(entries));
  badge.textContent=horizonBadgeText(profile);badge.classList.toggle('flat',!profile);
}
function generateCSV(){const model=state.terrain?'NASA LOLA 20km terrain horizon':'flat 0deg geometric horizon';const rows=[['utc','site','latitude_deg','longitude_deg_east','horizon_model','sun_azimuth_deg','sun_elevation_deg','sun_visible_horizon','earth_azimuth_deg','earth_elevation_deg','earth_visible_horizon','both_visible']];state.samples.forEach(r=>rows.push([r.time,state.site.name,state.site.lat,state.site.lon,model,r.sun.azimuth.toFixed(4),r.sun.elevation.toFixed(4),r.sun.visible,r.earth.azimuth.toFixed(4),r.earth.elevation.toFixed(4),r.earth.visible,r.dual]));downloadCSV(`lunarnav-${state.site.id}-${state.date}-${state.days}d.csv`,rows);toast('Mission timeline CSV exported');}
function briefText(){const {site,date,time,days}=state;const q=summarize(state.samples);const best=longestDualWindow(state.samples);const horizon=state.terrain?'NASA LOLA 20 km terrain horizon ('+(state.terrain.azimuthDeg.length)+' azimuth bins)':'flat 0 deg geometric horizon (no terrain profile loaded)';return `LunarNav: Mission screening brief\nGenerated: ${new Date().toISOString()}\nSite: ${site.name} (${site.kind})\nCoordinates: ${fmtCoord(site.lat,site.lon)}\nPeriod: ${date} ${time} UTC + ${days} days\nHorizon model: ${horizon}\n\nSun visible: ${fmtPct(q.sun)}\nGeometric Earth visible: ${fmtPct(q.earth)}\nSun + Earth together: ${fmtPct(q.dual)}\nLongest sampled Earth blackout: ${q.longestBlackoutHours.toFixed(0)} hours\nLongest continuous dual-access period: ${best.hours.toFixed(0)} hours (${best.start||'none'} to ${best.end||'none'})\n\nMETHOD: analytical ephemeris; ${horizon}; two-hour samples. Geometric Earth visibility is line-of-sight geometry, NOT a radio link budget. No terrain occlusion beyond the sampled horizon, solar power guarantee or landing hazard validation. For research screening only. Not for flight operations.\nSource reference: ${site.source||'User-selected coordinates'}\n`;}
function openBrief(){const q=summarize(state.samples);const best=longestDualWindow(state.samples);const horizon=escapeHTML(horizonBadgeText(state.terrain));$('#brief-content').innerHTML=`<h3>${escapeHTML(state.site.name)}</h3><p class="report-coordinates">${escapeHTML(fmtCoord(state.site.lat,state.site.lon))}: ${escapeHTML(state.site.kind)}</p><div class="report-grid"><div><small>Mission duration</small><strong>${state.days} days</strong></div><div><small>Start time (UTC)</small><strong>${escapeHTML(state.date)} ${escapeHTML(state.time)}</strong></div><div><small>Horizon model</small><strong>${horizon}</strong></div><div><small>Sunlight</small><strong>${fmtPct(q.sun)}</strong></div><div><small>Geometric Earth visibility</small><strong>${fmtPct(q.earth)}</strong></div><div><small>Sun and Earth together</small><strong>${fmtPct(q.dual)}</strong></div><div><small>Longest Earth blackout</small><strong>${q.longestBlackoutHours.toFixed(0)} h</strong></div><div><small>Longest continuous overlap</small><strong>${best.hours.toFixed(0)} h</strong></div></div><p class="report-warning">Research screening only. Earth visibility measures line of sight. Flight decisions require separate checks for communications, power, landing hazards and terrain beyond the sampled horizon.</p>`;$('#brief-dialog').showModal();}
function stopPlay(){
  state.playing=false;
  if(playTimer!==undefined)cancelAnimationFrame(playTimer);
  playTimer=undefined;
  const celestial=$('#celestial-play');if(celestial){celestial.textContent='Play';celestial.setAttribute('aria-pressed','false');}
}
function togglePlay(spanHours=state.days*24){
  if(state.playing){stopPlay();return;}
  state.playing=true;
  const celestial=$('#celestial-play');celestial.textContent='Pause';celestial.setAttribute('aria-pressed','true');
  let last=performance.now();
  let simulationOffset=state.offset;
  const tick=now=>{
    if(!state.playing)return;
    // Clamp long frames so a backgrounded tab cannot skip large mission intervals.
    const seconds=Math.min(0.08,Math.max(0,(now-last)/1000));
    last=now;
    const speed=Number($('#celestial-speed').value)||24; // Simulated hours per second
    const maximum=spanHours;
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
    $('#eng-ending').textContent=sim.endingSocPct.toFixed(1)+'% at end';
    $('#model-horizon-tag').textContent=sim.terrainApplied?(state.terrain?.verifiedSource===true?'NASA terrain horizon':'User DEM: unverified'):'Flat 0° horizon';
    const width=920,height=90,points=sim.timeline.map((t,i)=>{
      const x=20+i*(width-40)/Math.max(1,sim.timeline.length-1);
      const y=height-10-(height-23)*t.socPct/100;
      return [x,y];
    });
    const line=points.map(v=>v.map(n=>n.toFixed(1)).join(',')).join(' ');
    $('#eng-charge-chart').innerHTML='<svg viewBox="0 0 920 90" role="presentation" preserveAspectRatio="none">'+
      '<line x1="0" y1="79" x2="920" y2="79" stroke="var(--line)"/>'+
      '<line x1="0" y1="12" x2="920" y2="12" stroke="var(--line)" stroke-dasharray="3 5"/>'+
      '<polyline fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" points="'+line+'"/>'+
      '</svg>';
    $('#eng-summary').textContent=sim.unmetHours>0
      ?'The modeled system falls short of the payload load for '+sim.unmetHours.toFixed(1)+' hours. Increase storage or generation. You can also reduce the load.'
      :'The model meets the payload load throughout the mission.';
    updateTerrainPanel();
  }catch(e){
    state.simulation=null;
    $('#eng-summary').textContent='Cannot evaluate this configuration: '+e.message;
  }
}
function updateTerrainPanel(){
  const p=state.terrain;
  map.setTerrainRose?.(p||null);
  map.setTerrainPatch?.(p?.patch||null);
  $('#terrain-badge').textContent=p?'Terrain applied':'Flat 0° horizon';
  if(!p){
    $('#terrain-status').textContent='Calculations use a flat 0° horizon until a terrain profile is available.';
    $('#terrain-plot').innerHTML='<div class="terrain-empty">No terrain profile to plot</div>';
    return;
  }
  $('#terrain-status').textContent=(p.verifiedSource===true?p.source:'Imported GeoTIFF (unverified source)')+': '+p.resolutionM.toFixed(0)+' m/pixel: '+p.radiusKm+' km radius: '+p.coveragePct.toFixed(0)+'% coverage';
  const points=p.elevationDeg.map((v,i)=>{
    const x=10+i*890/(p.elevationDeg.length-1),y=73-Math.min(60,v*13);
    return x.toFixed(1)+','+y.toFixed(1);
  }).join(' ');
  $('#terrain-plot').innerHTML='<svg viewBox="0 0 910 90" preserveAspectRatio="none" role="presentation">'+
    '<line x1="0" y1="73" x2="910" y2="73" stroke="var(--line)"/>'+
    '<polyline fill="none" stroke="var(--accent)" stroke-width="2" points="'+points+'"/>'+
    '<text x="12" y="16" fill="var(--muted)" font-size="11">Terrain horizon by azimuth: 0°–360°</text></svg>';
}
async function requestTerrain(file=null){
  if($('#terrain-load').disabled)return;
  const token=++terrainRequestSeq,site=state.site;
  terrainController=new AbortController();
  const signal=terrainController.signal;
  const lat=site.lat,lon=site.lon;
  $('#terrain-load').disabled=true;
  $('#terrain-badge').textContent='Loading…';
  $('#terrain-status').textContent='Loading terrain for '+site.name+'…';
  try{
    // Mid-latitudes use SLDEM2015 rows (~237 m); the polar caps and local
    // file imports use the LOLA COG products.
    const profile=file||Math.abs(site.lat)>=60
      ? await loadLolaTerrain(site,{file,signal,onProgress:s=>{if(token===terrainRequestSeq)$('#terrain-status').textContent=site.name+': '+s;}})
      : await deriveSldemPatch(site,{signal});
    if(token!==terrainRequestSeq||state.site.lat!==lat||state.site.lon!==lon){
      toast('A newer waypoint selection superseded that terrain load.');
      return;
    }
    cacheTerrain(site,profile);
    refreshTerrainResults();
    toast('Terrain updated for '+state.site.name);
  }catch(e){
    if(token!==terrainRequestSeq)return;
    // A failed native upgrade must not wipe an existing (grid-derived) profile.
    state.terrain=getCachedTerrain(state.site)||null;
    updateMissionPanels();updateModelNotes();renderComparePanel();renderDateComparison();
    $('#terrain-status').textContent='Could not load higher-resolution terrain. '+(state.terrain?'Using the current terrain profile.':'Using a flat 0° horizon.')+' '+e.message;
    toast('Terrain unavailable; no simulated terrain was substituted.');
  }finally{
    if(token!==terrainRequestSeq)return;
    terrainController=null;
    $('#terrain-load').disabled=false;
    if(state.terrain)$('#terrain-badge').textContent='Terrain applied';
    else $('#terrain-badge').textContent='Flat 0° horizon';
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
    $('#finder-data-status').textContent='Load or import terrain for at least two sites in Engineering to compare their horizons.';
  }
}
async function hydrateBundledTerrain(){
  try{
    const entries=await loadBundledTerrain(SITES);
    let accepted=0;
    for(const {site,profile} of entries){
      if(getCachedTerrain(site))continue; // User-loaded profiles take precedence.
      cacheTerrain(site,profile);
      accepted++;
    }
    if(accepted&&!state.terrain){
      state.terrain=getCachedTerrain(state.site);
      if(state.terrain)refreshTerrainResults();
    }
    updateFinderCoverage();
    const total=coverageEntries().length;
    $('#finder-data-status').textContent=accepted
      ?'Terrain mode includes only sites with a loaded profile. '+accepted+' profiles use bundled NASA elevation data with a 20 km radius.'
      :'No bundled profiles loaded. Flat-horizon search is available.';
    // Terrain-aware screening is the default whenever real profiles exist;
    // the explicit selector still offers the flat baseline for comparison.
    if(!finderModeTouched&&total>=2)$('#finder-mode').value='terrain';
    updateModelNotes();renderComparePanel();renderDateComparison();
    if($('#finder-mode').value==='terrain'&&total>=2)runFinder();
  }catch(error){
    $('#finder-data-status').textContent='Bundled terrain unavailable: '+error.message+'. Geometric results remain usable.';
    updateFinderCoverage();updateModelNotes();renderComparePanel();
  }
}
let finderRequest=0;
let finderModeTouched=false;
function finderOpen(siteId,iso,days){
  const site=SITES.find(s=>s.id===siteId);
  if(!site)return;
  cancelTerrainRequest();stopPlay();
  const startTime=state.finder?.startTime||state.time;
  state.site=site;
  state.days=days;
  $('#mission-date').value=iso;
  $('#mission-time').value=startTime;
  document.querySelectorAll('#duration button').forEach(b=>b.classList.toggle('selected',Number(b.dataset.days)===days));
  siteSelect.value=site.id;
  updateAnalysis();
  navigatePage('explore');
  toast('Opened '+site.name+': '+iso+': '+days+' days ('+startTime+' UTC)');
}
function finderPreview(result){
  const {matrix,searchDays,windowDays,stepHours}=result;
  const cols=searchDays;
  const scores=matrix.flatMap(m=>m.windows.map(w=>w.score));
  const top=Math.max(0.01,...scores),low=Math.min(...scores);
  const span=Math.max(1,top-low);
  const width=Math.max(700,190+cols*25);
  let html='<div class="finder-table" style="--day-count:'+cols+';min-width:'+width+'px">';
  html+='<div class="finder-table-heading"><div>Landing site</div>'+
    matrix[0].windows.map((w,i)=>'<span class="finder-date-label" title="'+w.startDate+'">'+
      (i===0||i%5===0?w.startDate.slice(5):'')+'</span>').join('')+'</div>';
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
  $('#finder-caption').textContent='Results ready for '+matrix.length+' sites.';
  $('#finder-model-badge').textContent=result.terrainMode==='terrain'?'Loaded terrain horizons':'Flat 0° geometric horizon';
  const chosen=[],used={};
  for(const w of result.ranked){
    if(chosen.length===3)break;
    const prior=used[w.siteId]||[];
    if(prior.length>=2 || prior.some(date=>Math.abs((Date.parse(date)-Date.parse(w.startDate))/86400000)<3))continue;
    chosen.push(w);
    used[w.siteId]=[...prior,w.startDate];
  }
  $('#finder-top').innerHTML='<table class="metric-table recommendation-table"><thead><tr><th scope="col">Recommended window</th><th scope="col">Inspect</th><th scope="col">Sun</th><th scope="col">Earth</th><th scope="col">Both</th><th scope="col">Longest dark</th></tr></thead><tbody>'+chosen.map((w,i)=>
    '<tr><th scope="row">'+(i+1)+'. '+escapeHTML(w.siteName)+'<small>'+w.startDate+': '+result.startTime+' UTC</small></th><td><button type="button" class="finder-window-card outline-button" data-site="'+escapeHTML(w.siteId)+'" data-date="'+w.startDate+'" aria-label="Use '+escapeHTML(w.siteName)+' window '+w.startDate+'">Use window</button></td><td>'+w.sunPct.toFixed(1)+'%</td><td>'+w.earthPct.toFixed(1)+'%</td><td>'+w.dualPct.toFixed(1)+'%</td><td>'+w.longestDarknessHours+' h</td></tr>'
  ).join('')+'</tbody></table>';
  $('#finder-export').disabled=false;
  $('#finder-shell-status').textContent='';
  for(const element of $$('#finder [data-date][data-site]')){
    element.addEventListener('click',()=>finderOpen(element.dataset.site,element.dataset.date,windowDays));
  }
}
function runFinder(){
  const startDate=$('#finder-date').value,startTime=$('#planning-time').value;
  const searchDays=Number($('#finder-range').value);
  const windowDays=Number($('#finder-duration').value);
  const priority=$('#finder-priority').value;
  const terrainMode=$('#finder-mode').value;
  const token=++finderRequest;
  $('#finder-export').disabled=true;
  $('#finder-caption').textContent='Searching mission windows…';
  // Give the browser a chance to repaint the loading state before calculating.
  requestAnimationFrame(()=>{
    if(token!==finderRequest)return;
    try{
      const entries=coverageEntries();
      if(terrainMode==='terrain'&&entries.length<2)throw Error('Load terrain profiles for at least two sites. Cannot rank unavailable DEM as flat terrain.');
      const sites=terrainMode==='terrain'?entries.map(entry=>entry.site):SITES;
      const terrainById=Object.fromEntries(entries.map(entry=>[entry.site.id,entry.terrain]));
      const result=findMissionWindows({
        sites,startDate,startTime,searchDays,windowDays,stepHours:4,priority,
        terrainMode,terrainProfiles:terrainMode==='terrain'?terrainById:null
      });
      state.finder=result;
      state.finderBaseline=terrainMode==='terrain'?findMissionWindows({
        sites,startDate,startTime,searchDays,windowDays,stepHours:4,priority,terrainMode:'flat'
      }):null;
      finderPreview(result);
    }catch(error){
      $('#finder-caption').textContent=error.message||'Finder could not calculate windows.';
      $('#finder-heatmap').textContent='';
      $('#finder-top').textContent='';
      state.finder=null;state.finderBaseline=null;
      $('#finder-model-badge').textContent='No results';
      $('#finder-shell-status').textContent='Update the inputs to calculate again.';
    }
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
      w.siteName,w.startDate+'T'+state.finder.startTime+':00Z',w.windowDays,w.sunPct.toFixed(2),w.earthPct.toFixed(2),
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
    .map(site=>`<option value="${site.id}">${escapeHTML(site.name)}: ${escapeHTML(fmtCoord(site.lat,site.lon))}</option>`).join('');
};
function syncTravelFromMission(){
  $('#travel-date').value=state.date;
  $('#travel-time').value=state.time;
  $('#travel-origin-name').textContent=state.site.name+': '+fmtCoord(state.site.lat,state.site.lon);
  populateTravelDestinations();
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
    const profile=origin.id===state.site.id?getCachedTerrain(origin):terrainProfiles.get(terrainKey(origin))||null;
    travelEstimate=estimateSurfaceTraverse({
      originLat:origin.lat,originLon:origin.lon,
      destinationLat:target.lat,destinationLon:target.lon,
      departUTC,speedKph:speed,delayHours:delay,
      profile
    });
    renderTravelResults(travelEstimate,origin,target,profile);
    toast('Surface traverse estimated');
  }catch(e){toast(e.message||'Could not estimate the traverse.');}
}
function renderTravelResults(estimate,origin,target,profile){
  const v=estimate.visibility;
  $('#travel-horizon-tag').textContent=horizonBadgeText(estimate.terrainProfileApplied?profile:null);
  const sunLabel=s=>s?`${Number.isFinite(s)?s.toFixed(0):'N/A'}% illuminated`:'Sampling unavailable';
  $('#travel-results').innerHTML=
    `<div class="travel-summary"><div><small>Route</small><strong>${escapeHTML(origin.name)} → ${escapeHTML(target.name)}</strong><span>${escapeHTML(fmtCoord(origin.lat,origin.lon))} → ${escapeHTML(fmtCoord(target.lat,target.lon))}</span></div>
     <div><small>Surface distance</small><strong>${estimate.distanceKm.toFixed(1)} km</strong></div>
     <div><small>Driving time</small><strong>${estimate.drivingHours.toFixed(1)} h</strong><span>at ${estimate.speedKph} km/h average</span></div>
     <div><small>Total traverse time</small><strong>${estimate.totalHours.toFixed(1)} h</strong><span>incl. ${estimate.delayHours.toFixed(1)} h operational delay</span></div></div>
     <div class="travel-schedule"><div><small>Departure (UTC)</small><strong>${fmtUTC(estimate.departureUTC)}</strong></div><div><small>Arrival (UTC)</small><strong>${fmtUTC(estimate.arrivalUTC)}</strong></div></div>
     <div class="travel-visibility"><div><span>Sunlight</span><strong>${v.sunIlluminatedPct.toFixed(0)}%</strong><small>${v.anyLimitedSolar?'Gaps in sunlight':'Continuous sunlight'}${estimate.terrainProfileApplied?': Terrain at origin':': flat horizon'}</small></div>
     <div><span>Geometric Earth visibility</span><strong>${v.earthVisiblePct.toFixed(0)}%</strong><small>${v.anyEarthLimited?'Gaps in visibility':'Continuous visibility'}</small></div></div>
     <p class="travel-caveat">Great-circle distance. Slope, obstacles and traversability are outside the estimate.${v.terrainApplied?' Visibility uses the terrain horizon at the origin.':''}</p>`;
}
$('#travel-run').addEventListener('click',runTravelEstimate);
$('#panorama-open')?.addEventListener('click',openPanorama);
$('#panorama-close')?.addEventListener('click',closePanorama);
$('#travel-sync').addEventListener('click',()=>{syncTravelFromMission();toast('Mission date and time applied');});
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
  $('#transit-destination-tag').textContent=state.site.name;
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
  const destLabel=dest?`${dest.name}: ${fmtCoord(dest.lat,dest.lon)}`:'Selected landing site';
  $('#transit-results').innerHTML=
    `<div class="transit-summary">
       <div><small>Destination</small><strong>${escapeHTML(dest?dest.name:'Selected site')}</strong><span>${escapeHTML(fmtCoord(dest.lat,dest.lon))}</span></div>
       <div><small>Transfer profile</small><strong>${escapeHTML(estimate.profileLabel)}</strong><span>${escapeHTML(estimate.totalTransitLabel)} total</span></div>
       <div><small>Earth departure</small><strong>${fmtUTC(estimate.departureUTC)}</strong><span>${estimate.scheduleMode==='land'?'Back-calculated from landing':'Chosen departure'}</span></div>
       <div><small>Lunar arrival</small><strong>${fmtUTC(estimate.arrivalUTC)}</strong><span>${estimate.scheduleMode==='land'?'Target landing':'Arrival after transit'}</span></div>
     </div>
     <div class="transit-schedule">
       <div><small>Lunar orbit insertion</small><strong>${fmtUTC(estimate.phases.find(p=>p.kind==='insertion').endUTC)}</strong><span>Approx. LOI event</span></div>
       <div><small>Descent start</small><strong>${fmtUTC(estimate.phases.find(p=>p.kind==='descent').startUTC)}</strong><span>Approx. powered descent</span></div>
     </div>
     <div class="transit-phases">
       ${estimate.phases.map(p=>`<div class="transit-phase-row"><span class="transit-phase">${escapeHTML(p.phase)}</span><span class="transit-phase-labels">${p.kind}</span><span class="transit-phase-time">${p.durationHours.toFixed(1)} h</span><span class="transit-phase-time">${fmtUTC(p.startUTC)}</span></div>`).join('')}
     </div>
     <p class="transit-limitation">The schedule uses reference transfer durations. Trajectories, delta-v and launch windows are outside the estimate.</p>`;
}
$('#transit-run').addEventListener('click',runTransitEstimate);
$('#transit-mode').addEventListener('change',()=>{if(transitEstimate)runTransitEstimate();});
$('#transit-profile').addEventListener('change',()=>{
  $('#transit-custom-hours').disabled=$('#transit-profile').value!=='custom';
  const profile=$('#transit-profile').value;
  $('#transit-profile-tag').textContent={
    direct:'About 3.5 days',
    extended:'About 7.5 days',
    custom:''
  }[profile]||'Reference transfer durations';
  if(transitEstimate)runTransitEstimate();
});
$('#transit-custom-hours').addEventListener('input',()=>{if(transitEstimate&&$('#transit-profile').value==='custom')runTransitEstimate();});
$('#transit-date').addEventListener('change',()=>{if(transitEstimate)runTransitEstimate();});
$('#transit-time').addEventListener('change',()=>{if(transitEstimate)runTransitEstimate();});
syncTransitFromMission();
$('#transit-hint').textContent='';

// Events
siteSelect.addEventListener('change',()=>{const s=SITES.find(x=>x.id===siteSelect.value);if(s)selectSite(s);});
document.querySelectorAll('#duration button').forEach(b=>b.addEventListener('click',()=>{state.days=Number(b.dataset.days);document.querySelectorAll('#duration button').forEach(x=>x.classList.toggle('selected',x===b));stopPlay();updateAnalysis();}));
$('#mission-date').addEventListener('change',()=>{stopPlay();updateAnalysis();});
$('#mission-time').addEventListener('change',()=>{stopPlay();updateAnalysis();});
$('#time-scrubber').addEventListener('input',e=>{stopPlay();setOffset(e.target.value);});
$('#time-back').addEventListener('click',()=>{
  stopPlay();setOffset(state.offset-6);
  $('#time-event-note').textContent=fmtUTC(new Date(state.base.getTime()+state.offset*3600000).toISOString());
});
$('#time-next').addEventListener('click',()=>{
  stopPlay();setOffset(state.offset+6);
  $('#time-event-note').textContent=fmtUTC(new Date(state.base.getTime()+state.offset*3600000).toISOString());
});
$('#time-event').addEventListener('click',()=>{
  stopPlay();
  const upcoming=findNextHorizonEvent({
    startUTC:state.base,site:state.site,durationHours:state.days*24,
    offsetHours:Math.min(state.offset,state.days*24),profile:state.terrain
  });
  if(!upcoming){
    $('#time-event-note').textContent='No more visibility changes in this window.';
    return;
  }
  setOffset(upcoming.offsetHours);
  $('#time-event-note').textContent=upcoming.eventType+' around '+fmtUTC(upcoming.eventUTC);
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
});
$('#celestial-scrubber').addEventListener('input',event=>{stopPlay();setOffset(event.target.value);});
$('#celestial-play').addEventListener('click',()=>togglePlay(SUN_CIRCUIT_HOURS));
$('#celestial-reset').addEventListener('click',()=>{map.resetBodies?.();toast('Sun and Earth rotation reset');});
$('#zoom-in').addEventListener('click',()=>$('#zoom-label').textContent=map.zoomBy(.2)+'%');
$('#zoom-out').addEventListener('click',()=>$('#zoom-label').textContent=map.zoomBy(-.2)+'%');
$('#relief-exaggeration').addEventListener('change',e=>map.setReliefExaggeration?.(e.target.value));
map.setReliefExaggeration?.($('#relief-exaggeration').value);

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

$('#download-csv').addEventListener('click',generateCSV);
$('#brief-btn').addEventListener('click',openBrief);
$('#copy-brief').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(briefText());toast('Mission briefing copied');}catch{toast('Clipboard unavailable; use Print / save PDF');}});
$('#print-brief').addEventListener('click',()=>window.print());
$('#share-btn').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(location.href);toast('Shareable mission link copied');}catch{toast('Copy this page URL to share');}});
$('#footer-method').addEventListener('click',()=>navigatePage('science'));
$$('[data-close]').forEach(x=>x.addEventListener('click',()=>$('#'+x.dataset.close).close()));
$$('dialog:not(#onboarding-dialog)').forEach(d=>d.addEventListener('click',e=>{if(e.target===d)d.close();}));

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
function updatePlanningInputs(){
  $('#mission-date').value=$('#finder-date').value;
  $('#mission-time').value=$('#planning-time').value;
  state.days=Number($('#finder-duration').value);
  $$('#duration button').forEach(b=>b.classList.toggle('selected',Number(b.dataset.days)===state.days));
  updateAnalysis();
}
for(const id of ['finder-date','planning-time','finder-duration'])$('#'+id).addEventListener('change',updatePlanningInputs);
$('#finder-mode').addEventListener('change',()=>{finderModeTouched=true;updateFinderCoverage();renderComparePanel();renderDateComparison();runFinder();});
for(const id of ['finder-range','finder-priority'])$('#'+id).addEventListener('change',runFinder);
$('#finder-export').addEventListener('click',exportFinderCSV);
$('#date-compare-site').innerHTML=SITES.map(s=>`<option value="${s.id}">${escapeHTML(s.name)}: ${escapeHTML(s.kind)}</option>`).join('');
$('#date-compare-site').value=state.site.id;
$('#date-compare-a').value=state.date;
$('#date-compare-b').value=new Date(Date.parse(state.date+'T00:00:00Z')+14*86400000).toISOString().slice(0,10);
$('#date-compare-site').addEventListener('change',renderDateComparison);
$('#date-compare-a').addEventListener('change',renderDateComparison);
$('#date-compare-b').addEventListener('change',renderDateComparison);
showPage(currentPage,{scroll:false});
updateAnalysis();
updateFinderCoverage();
hydrateBundledTerrain();

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
    terrainProfiles: profilesBySite(),
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

initOnboarding({
  navigateView:page=>showPage(page),getPage:()=>currentPage,
  onGraphicsChange:value=>{
    $('#relief-exaggeration').value=String(value);
    map.setReliefExaggeration?.(value);
  }
});

