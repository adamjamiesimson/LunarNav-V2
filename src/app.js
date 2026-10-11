import {ephemeris,sampleWindow,summarize,rankedSites,longestDualWindow} from './astro.js';
import {SITES,fmtCoord} from './sites.js';
import {createMap} from './globe.js';
import {simulateMission,DEFAULT_ENGINEERING} from './mission.js';
import {loadLolaTerrain} from './terrain.js';
import {findMissionWindows,compareFinderModels} from './finder.js';
import {inspectSituation,buildSkyDiagram,fmtMargin,findNextHorizonEvent} from './situation.js';
import {loadBundledTerrain} from './terrain-cache.js';
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const fmtPct=n=>`${n.toFixed(1)}%`;
const fmtDeg=n=>`${n>=0?'+':''}${n.toFixed(2)}°`;
const longDate=date=>date.toLocaleString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).toUpperCase()+' UTC';
const shortDate=date=>date.toLocaleDateString('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric'}).toUpperCase();
const escapeHTML=str=>String(str).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const params=new URLSearchParams(location.search);
const startSite=SITES.find(x=>x.id===params.get('site'))||SITES[0];
const startDays=[3,7,14,28].includes(Number(params.get('days')))?Number(params.get('days')):7;
const startDate=/^\d{4}-\d{2}-\d{2}$/.test(params.get('date')||'')?params.get('date'):'2026-11-14';
const state={site:startSite,date:startDate,time:'12:00',days:startDays,offset:0,base:null,samples:[],ranking:[],playing:false,terrain:null,engineering:{...DEFAULT_ENGINEERING},simulation:null};
const terrainProfiles=new Map();
const terrainKey=site=>site.id+'|'+site.lat.toFixed(6)+'|'+site.lon.toFixed(6);
const getCachedTerrain=site=>terrainProfiles.get(terrainKey(site))||null;
let terrainBatchLoading=false;
let playTimer,toastTimer;
const siteSelect=$('#site-select');
SITES.forEach(site=>siteSelect.add(new Option(`${site.name}  ·  ${site.tag}`,site.id)));
siteSelect.value=state.site.id;
$('#mission-date').value=state.date;
$$('#duration button').forEach(b=>b.classList.toggle('selected',Number(b.dataset.days)===state.days));

function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2800);}
function updateURL(){if(state.site.custom)return;const p=new URLSearchParams();p.set('site',state.site.id);p.set('date',state.date);p.set('days',String(state.days));history.replaceState({},'',`${location.pathname}?${p}#planner`);}
const map=createMap($('#moon-map'),{onPick:selectSite,onHover:(site,e)=>{const tip=$('#map-tooltip');if(!site){tip.hidden=true;return;}tip.hidden=false;tip.textContent=`${site.name} · ${fmtCoord(site.lat,site.lon)}`;const rect=$('#map-stage').getBoundingClientRect();tip.style.left=`${Math.min(rect.width-235,Math.max(12,e.clientX-rect.left+16))}px`;tip.style.top=`${Math.max(12,e.clientY-rect.top-20)}px`;}});
function selectSite(site){stopPlay();state.site=site;if(site.custom&&!siteSelect.querySelector('[value="custom"]'))siteSelect.add(new Option('Custom waypoint  ·  Map-selected','custom'));siteSelect.value=site.id;updateAnalysis();toast(`${site.name} selected`);}
function updateSelected(){const site=state.site;$('#selected-name').textContent=site.name;$('#selected-tag').textContent=site.tag;$('#selected-coord').textContent=fmtCoord(site.lat,site.lon);$('#selected-type').textContent=site.kind;$('#site-source').href=site.source||'https://science.nasa.gov/moon/';$('#site-source').style.display=site.custom?'none':'';$('#map-site-name').textContent=site.name.toUpperCase();$('#map-coordinate').textContent=fmtCoord(site.lat,site.lon);$('.site-dot').style.background=site.accent;map.render(site);}
function readDate(){const date=$('#mission-date').value;const time=$('#mission-time').value;if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d\d:\d\d$/.test(time))throw new Error('Enter a valid UTC date and time.');const base=new Date(`${date}T${time}:00Z`);if(!Number.isFinite(base.getTime()))throw new Error('Invalid UTC date.');return {date,time,base};}
function updateAnalysis(){try{state.terrain=getCachedTerrain(state.site);const x=readDate();state.date=x.date;state.time=x.time;state.base=x.base;state.offset=0;state.samples=sampleWindow({start:state.base,lat:state.site.lat,lon:state.site.lon,days:state.days,stepHours:2});state.ranking=rankedSites(SITES,state.base,state.days);$('#time-scrubber').max=String(state.days*24);$('#time-scrubber').value='0';$('#metric-days').textContent=`${state.days} DAYS`;$('#end-label').textContent=`+${state.days} DAYS`;$('#timeline-start').textContent=shortDate(state.base);$('#timeline-end').textContent=shortDate(new Date(state.base.getTime()+state.days*86400000));updateSelected();updateMetrics();drawTimeline();drawComparison();updateInspection();updateMissionPanels();updateURL();}catch(e){toast(e.message||'Could not calculate the mission window.');}}
function updateMetrics(){const stats=summarize(state.samples);$('#dual-value').textContent=stats.dual.toFixed(1);$('#sun-value').textContent=fmtPct(stats.sun);$('#earth-value').textContent=fmtPct(stats.earth);$('#blackout-value').textContent=stats.longestBlackoutHours.toFixed(0)+' h';$('#sun-bar').style.width=`${stats.sun}%`;$('#earth-bar').style.width=`${stats.earth}%`;$('#metric-ring').style.setProperty('--metric-pct',`${stats.dual}%`);const best=longestDualWindow(state.samples);$('#best-window-length').textContent=best.hours?`${best.hours.toFixed(0)} hours`:'No dual-access window';$('#best-window-dates').textContent=best.start?`${shortDate(new Date(best.start))} → ${shortDate(new Date(best.end))} (UTC)`:'No continuous overlap detected in sampled period';}
function drawTimeline(){const list=state.samples.slice(0,-1),N=list.length;const rows=[['SUNLIGHT',x=>x.sun.visible,'sun'],['EARTH LINK',x=>x.earth.visible,'earth'],['DUAL WINDOW',x=>x.dual,'dual']];const W=960,H=126,L=112,R=12,Y=17,rowGap=34,rowH=17,width=W-L-R;let svg=`<svg class="timeline-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mission visibility timeline">`;
  for(let d=0;d<=state.days;d++){const x=L+width*d/state.days;svg+=`<line x1="${x}" x2="${x}" y1="6" y2="${Y+rowGap*2+rowH+7}" stroke="rgba(211,224,233,${d===0||d===state.days?'.17':'.08'})" stroke-dasharray="3 5"/>`;if(d<state.days)svg+=`<text x="${x+4}" y="${H-6}" fill="#7e909d" font-size="10" font-family="DM Mono,monospace">${d===0?'D01':d%2===0||state.days<=7?'D'+String(d+1).padStart(2,'0'):''}</text>`;}
  rows.forEach(([label,pred,kind],i)=>{const y=Y+i*rowGap;svg+=`<text x="0" y="${y+12}" fill="#9daebb" font-size="11" font-family="DM Mono,monospace">${label}</text><rect x="${L}" y="${y}" width="${width}" height="${rowH}" rx="3" fill="#19232c"/>`;list.forEach((point,j)=>{if(pred(point))svg+=`<rect x="${(L+width*j/N).toFixed(2)}" y="${y}" width="${(width/N+.3).toFixed(2)}" height="${rowH}" fill="${kind==='sun'?'#cfa676':kind==='earth'?'#7dbac6':'#b7dfb0'}" />`;});});
  svg+=`<line id="time-indicator" x1="${L}" x2="${L}" y1="4" y2="${Y+rowGap*2+rowH+3}" stroke="#e7f2e9" stroke-width="1.5"/><path id="indicator-triangle" d="M${L-4} 4 L${L+4} 4 L${L} 11 Z" fill="#e7f2e9"/><rect id="timeline-hit" x="${L}" y="4" width="${width}" height="100" fill="transparent" style="cursor:crosshair"/></svg>`;
  $('#timeline-graph').innerHTML=svg;const hit=$('#timeline-hit');hit.addEventListener('pointerdown',e=>{const b=hit.ownerSVGElement.getBoundingClientRect();const u=(e.clientX-b.left)/b.width;const fraction=(u*960-L)/width;setOffset(Math.round(Math.max(0,Math.min(1,fraction))*state.days*24));});updateIndicator();}
function updateIndicator(){const p=Math.max(0,Math.min(1,state.offset/(state.days*24)));const x=112+(960-112-12)*p;const l=$('#time-indicator');const tri=$('#indicator-triangle');if(l){l.setAttribute('x1',x);l.setAttribute('x2',x);}if(tri)tri.setAttribute('d',`M${x-4} 4 L${x+4} 4 L${x} 11 Z`);}
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
  updateIndicator();
}
function setOffset(v){state.offset=Math.max(0,Math.min(state.days*24,Number(v)||0));updateInspection();}
function drawComparison(){const entries=state.ranking;$('#site-comparison').innerHTML=entries.map((entry,i)=>{const {site,stats}=entry,active=site.id===state.site.id;return `<button type="button" class="compare-card ${active?'active':''}" data-site="${site.id}" aria-label="Inspect ${escapeHTML(site.name)}"><div class="compare-top"><span class="compare-rank">${String(i+1).padStart(2,'0')}</span><span class="compare-indicator" style="--site-color:${site.accent}"></span><span class="compare-type">${escapeHTML(site.tag.toUpperCase())}</span><span class="compare-arrow">↗</span></div><h3>${escapeHTML(site.name)}</h3><p>${escapeHTML(fmtCoord(site.lat,site.lon))}</p><div class="compare-score"><strong>${stats.dual.toFixed(1)}<span>%</span></strong><small>DUAL ACCESS</small></div><div class="compare-progress"><span style="width:${stats.dual}%"></span></div><div class="compare-meta"><span>Sun ${stats.sun.toFixed(0)}%</span><span>Earth ${stats.earth.toFixed(0)}%</span></div></button>`;}).join('');$$('.compare-card').forEach(b=>b.addEventListener('click',()=>{const s=SITES.find(x=>x.id===b.dataset.site);selectSite(s);document.querySelector('#planner').scrollIntoView({behavior:'smooth'});}));}
function generateCSV(){const esc=v=>'"'+String(v).replaceAll('"','""')+'"';const csv=[['utc','site','latitude_deg','longitude_deg_east','sun_azimuth_deg','sun_elevation_deg','sun_visible_flat_horizon','earth_azimuth_deg','earth_elevation_deg','earth_visible_flat_horizon','both_visible'].join(',')];state.samples.forEach(r=>csv.push([r.time,state.site.name,state.site.lat,state.site.lon,r.sun.azimuth.toFixed(4),r.sun.elevation.toFixed(4),r.sun.visible,r.earth.azimuth.toFixed(4),r.earth.elevation.toFixed(4),r.earth.visible,r.dual].map(esc).join(',')));const blob=new Blob([csv.join('\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`lunarnav-${state.site.id}-${state.date}-${state.days}d.csv`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);toast('Mission timeline CSV exported');}
function briefText(){const {site,date,time,days}=state;const q=summarize(state.samples);const best=longestDualWindow(state.samples);return `LUNARNAV V2 — LUNAR MISSION SCREENING BRIEF\nGenerated: ${new Date().toISOString()}\nSite: ${site.name} (${site.kind})\nCoordinates: ${fmtCoord(site.lat,site.lon)}\nPeriod: ${date} ${time} UTC + ${days} days\n\nSun visible: ${fmtPct(q.sun)}\nEarth visible: ${fmtPct(q.earth)}\nSun + Earth together: ${fmtPct(q.dual)}\nLongest sampled Earth blackout: ${q.longestBlackoutHours.toFixed(0)} hours\nLongest continuous dual-access period: ${best.hours.toFixed(0)} hours (${best.start||'none'} to ${best.end||'none'})\n\nMETHOD: analytical ephemeris; spherical geometric horizon; two-hour samples. No terrain occlusion, link-budget analysis, solar power calculation, or landing hazard validation. For research screening only — not for flight operations.\nSource reference: ${site.source||'User-selected coordinates'}\n`;} 
function openBrief(){const q=summarize(state.samples);const best=longestDualWindow(state.samples);$('#brief-content').innerHTML=`<div class="report-kicker">LUNAR SOUTH POLE / PLANNING REPORT</div><h3>${escapeHTML(state.site.name)}</h3><p class="report-coordinates">${escapeHTML(fmtCoord(state.site.lat,state.site.lon))}</p><div class="report-grid"><div><small>MISSION WINDOW</small><strong>${state.days} days</strong></div><div><small>START TIME (UTC)</small><strong>${escapeHTML(state.date)} ${escapeHTML(state.time)}</strong></div><div><small>SUN VISIBILITY</small><strong>${fmtPct(q.sun)}</strong></div><div><small>EARTH VISIBILITY</small><strong>${fmtPct(q.earth)}</strong></div><div><small>DUAL ACCESS</small><strong>${fmtPct(q.dual)}</strong></div><div><small>MAX EARTH BLACKOUT</small><strong>${q.longestBlackoutHours.toFixed(0)} h</strong></div><div><small>BEST CONTINUOUS OVERLAP</small><strong>${best.hours.toFixed(0)} h</strong></div></div><p class="report-warning">SCIENTIFIC LIMITATIONS — Analytical geometry with a 0° spherical horizon. Does not account for lunar terrain shadows, spacecraft communications link margin, solar power budget, landing hazards or flight validation. Values are screening estimates only.</p>`;$('#brief-dialog').showModal();}
function stopPlay(){state.playing=false;clearInterval(playTimer);const b=$('#replay-btn');if(b)b.textContent='▶ Replay window';}
function togglePlay(){if(state.playing){stopPlay();return;}state.playing=true;$('#replay-btn').textContent='Ⅱ Pause replay';playTimer=setInterval(()=>{if(state.offset>=state.days*24)setOffset(0);else setOffset(state.offset+2);},95);}


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
    $('#model-horizon-tag').textContent=sim.terrainApplied?'LOLA TERRAIN MODEL':'FLAT HORIZON';
    const width=920,height=90,points=sim.timeline.map((t,i)=>{
      const x=20+i*(width-40)/Math.max(1,sim.timeline.length-1);
      const y=height-10-(height-23)*t.socPct/100;
      return [x,y];
    });
    const line=points.map(v=>v.map(n=>n.toFixed(1)).join(',')).join(' ');
    $('#eng-charge-chart').innerHTML='<svg viewBox="0 0 920 90" role="presentation" preserveAspectRatio="none">'+
      '<line x1="0" y1="79" x2="920" y2="79" stroke="#526a78" opacity=".5"/>'+
      '<line x1="0" y1="12" x2="920" y2="12" stroke="#526a78" opacity=".3" stroke-dasharray="3 5"/>'+
      '<polyline fill="none" stroke="#b9efc3" stroke-width="2.5" stroke-linejoin="round" points="'+line+'"/>'+
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
    '<line x1="0" y1="73" x2="910" y2="73" stroke="#526a78"/>'+
    '<polyline fill="none" stroke="#d8b88d" stroke-width="2" points="'+points+'"/>'+
    '<text x="12" y="16" fill="#9dadb7" font-size="11">AZ 0° → 360° · TERRAIN HORIZON ABOVE IDEAL</text></svg>';
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
  const header=['UTC','site','terrain_applied','solar_elevation_deg','solar_horizon_deg','solar_generation_W','sun_exposed','earth_geometric_access','earth_horizon_deg','battery_SOC_pct'];
  const rows=sim.timeline.map((s,i)=>{
    const obs=state.samples[i];return [s.time,state.site.name,sim.terrainApplied,obs.sun.elevation.toFixed(3),s.sunHorizonDeg.toFixed(3),s.solarW.toFixed(2),s.sunVisible,s.earthVisible,s.earthHorizonDeg.toFixed(3),s.socPct.toFixed(2)]
      .map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',');
  });
  const blob=new Blob([[header.join(','),...rows].join('\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;
  a.download='lunarnav-engineering-'+state.date+'-'+state.site.id+'.csv';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  toast('Engineering simulation CSV exported');
}



function coverageEntries(){
  return SITES.map(site=>({site,terrain:getCachedTerrain(site)})).filter(entry=>Boolean(entry.terrain));
}
function updateFinderCoverage(){
  const available=coverageEntries();
  $('#finder-terrain-count').textContent=available.length+' of '+SITES.length+' sites have loaded terrain ('+
    available.filter(entry=>entry.terrain.verifiedSource).length+' from NASA URL)';
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
  // Respect the mission time chosen by the user (finder scans at 12:00 UTC).
  $('#mission-time').value='12:00';
  $('#duration button').forEach(b=>b.classList.toggle('selected',Number(b.dataset.days)===days));
  siteSelect.value=site.id;
  updateAnalysis();
  $('#planner').scrollIntoView({behavior:'smooth',block:'start'});
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
  const header=['site','start_utc','duration_days','sun_pct','earth_pct','dual_pct','max_dark_hours',
    'max_earth_gap_hours','longest_dual_hours','rank_score','priority','sampling_hours',
    'horizon','data_source','baseline_sun_pct','baseline_earth_pct','baseline_dual_pct',
    'delta_sun_pp','delta_earth_pp','delta_dual_pp'];
  const differences=state.finderBaseline
    ?new Map(compareFinderModels(state.finderBaseline,state.finder).map(e=>[e.siteId+'|'+e.startDate,e]))
    :new Map();
  const lines=state.finder.ranked.map(w=>{
    const diff=differences.get(w.siteId+'|'+w.startDate);
    const site=SITES.find(s=>s.id===w.siteId),profile=site?getCachedTerrain(site):null;
    return [
      w.siteName,w.startDate,w.windowDays,w.sunPct.toFixed(2),w.earthPct.toFixed(2),
      w.dualPct.toFixed(2),w.longestDarknessHours,w.longestEarthBlackoutHours,
      w.longestDualHours,w.score.toFixed(2),state.finder.priority,state.finder.stepHours,
      state.finder.terrainMode==='terrain'?'experimental NASA LOLA 20km local horizon':'spherical 0deg geometric horizon',
      state.finder.terrainMode==='terrain'?(profile?.provenance||'missing source'):'analytical-screening-v1',
      diff?.flatSunPct.toFixed(2)??'',diff?.flatEarthPct.toFixed(2)??'',diff?.flatDualPct.toFixed(2)??'',
      diff?.deltaSunPp.toFixed(2)??'',diff?.deltaEarthPp.toFixed(2)??'',diff?.deltaDualPp.toFixed(2)??''
    ].map(value=>'"'+String(value).replaceAll('"','""')+'"').join(',');
  });
  const csv=[header.join(','),...lines].join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='lunarnav-windows-'+state.finder.startDate+'-'+state.finder.searchDays+'d.csv';
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
  toast('All windows exported, with matched terrain differences where available');
}

// Events
siteSelect.addEventListener('change',()=>{const s=SITES.find(x=>x.id===siteSelect.value);if(s)selectSite(s);});
$$('#duration button').forEach(b=>b.addEventListener('click',()=>{state.days=Number(b.dataset.days);$$('#duration button').forEach(x=>x.classList.toggle('selected',x===b));stopPlay();updateAnalysis();}));
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
$('#hero-find').addEventListener('click',()=>$('#finder').scrollIntoView({behavior:'smooth'}));

$('#download-csv').addEventListener('click',generateCSV);
$('#brief-btn').addEventListener('click',openBrief);
$('#copy-brief').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(briefText());toast('Mission briefing copied');}catch{toast('Clipboard unavailable; use Print / save PDF');}});
$('#print-brief').addEventListener('click',()=>window.print());
$('#share-btn').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(location.href);toast('Shareable mission link copied');}catch{toast('Copy this page URL to share');}});
for(const id of ['method-nav','notice-method','footer-method'])$('#'+id).addEventListener('click',()=>$('#method-dialog').showModal());
$$('[data-close]').forEach(x=>x.addEventListener('click',()=>$('#'+x.dataset.close).close()));
$$('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d)d.close();}));
$$('[data-scroll]').forEach(b=>b.addEventListener('click',()=>{$$('[data-scroll]').forEach(x=>x.classList.toggle('active',x===b));$('#'+b.dataset.scroll).scrollIntoView({behavior:'smooth'});}));
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
  $('#engineering').scrollIntoView({behavior:'smooth',block:'start'});
  toast('Select a site above, then load NASA terrain or import its 80m GeoTIFF.');
});
$('#finder-export').addEventListener('click',exportFinderCSV);
updateAnalysis();
updateFinderCoverage();
runFinder();
hydrateBundledTerrain();
