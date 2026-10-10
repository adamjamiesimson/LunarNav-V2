import {ephemeris,sampleWindow,summarize,rankedSites,longestDualWindow} from './astro.js';
import {SITES,fmtCoord} from './sites.js';
import {createMap} from './globe.js';
import {simulateMission,DEFAULT_ENGINEERING} from './mission.js';
import {loadLolaTerrain} from './terrain.js';
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
function updateAnalysis(){try{if(state.terrain&&(state.terrain.lat!==state.site.lat||state.terrain.lon!==state.site.lon))state.terrain=null;const x=readDate();state.date=x.date;state.time=x.time;state.base=x.base;state.offset=0;state.samples=sampleWindow({start:state.base,lat:state.site.lat,lon:state.site.lon,days:state.days,stepHours:2});state.ranking=rankedSites(SITES,state.base,state.days);$('#time-scrubber').max=String(state.days*24);$('#time-scrubber').value='0';$('#metric-days').textContent=`${state.days} DAYS`;$('#end-label').textContent=`+${state.days} DAYS`;$('#timeline-start').textContent=shortDate(state.base);$('#timeline-end').textContent=shortDate(new Date(state.base.getTime()+state.days*86400000));updateSelected();updateMetrics();drawTimeline();drawComparison();updateInspection();updateMissionPanels();updateURL();}catch(e){toast(e.message||'Could not calculate the mission window.');}}
function updateMetrics(){const stats=summarize(state.samples);$('#dual-value').textContent=stats.dual.toFixed(1);$('#sun-value').textContent=fmtPct(stats.sun);$('#earth-value').textContent=fmtPct(stats.earth);$('#blackout-value').textContent=stats.longestBlackoutHours.toFixed(0)+' h';$('#sun-bar').style.width=`${stats.sun}%`;$('#earth-bar').style.width=`${stats.earth}%`;$('#metric-ring').style.setProperty('--metric-pct',`${stats.dual}%`);const best=longestDualWindow(state.samples);$('#best-window-length').textContent=best.hours?`${best.hours.toFixed(0)} hours`:'No dual-access window';$('#best-window-dates').textContent=best.start?`${shortDate(new Date(best.start))} → ${shortDate(new Date(best.end))} (UTC)`:'No continuous overlap detected in sampled period';}
function drawTimeline(){const list=state.samples.slice(0,-1),N=list.length;const rows=[['SUNLIGHT',x=>x.sun.visible,'sun'],['EARTH LINK',x=>x.earth.visible,'earth'],['DUAL WINDOW',x=>x.dual,'dual']];const W=960,H=126,L=112,R=12,Y=17,rowGap=34,rowH=17,width=W-L-R;let svg=`<svg class="timeline-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mission visibility timeline">`;
  for(let d=0;d<=state.days;d++){const x=L+width*d/state.days;svg+=`<line x1="${x}" x2="${x}" y1="6" y2="${Y+rowGap*2+rowH+7}" stroke="rgba(211,224,233,${d===0||d===state.days?'.17':'.08'})" stroke-dasharray="3 5"/>`;if(d<state.days)svg+=`<text x="${x+4}" y="${H-6}" fill="#7e909d" font-size="10" font-family="DM Mono,monospace">${d===0?'D01':d%2===0||state.days<=7?'D'+String(d+1).padStart(2,'0'):''}</text>`;}
  rows.forEach(([label,pred,kind],i)=>{const y=Y+i*rowGap;svg+=`<text x="0" y="${y+12}" fill="#9daebb" font-size="11" font-family="DM Mono,monospace">${label}</text><rect x="${L}" y="${y}" width="${width}" height="${rowH}" rx="3" fill="#19232c"/>`;list.forEach((point,j)=>{if(pred(point))svg+=`<rect x="${(L+width*j/N).toFixed(2)}" y="${y}" width="${(width/N+.3).toFixed(2)}" height="${rowH}" fill="${kind==='sun'?'#cfa676':kind==='earth'?'#7dbac6':'#b7dfb0'}" />`;});});
  svg+=`<line id="time-indicator" x1="${L}" x2="${L}" y1="4" y2="${Y+rowGap*2+rowH+3}" stroke="#e7f2e9" stroke-width="1.5"/><path id="indicator-triangle" d="M${L-4} 4 L${L+4} 4 L${L} 11 Z" fill="#e7f2e9"/><rect id="timeline-hit" x="${L}" y="4" width="${width}" height="100" fill="transparent" style="cursor:crosshair"/></svg>`;
  $('#timeline-graph').innerHTML=svg;const hit=$('#timeline-hit');hit.addEventListener('pointerdown',e=>{const b=hit.ownerSVGElement.getBoundingClientRect();const u=(e.clientX-b.left)/b.width;const fraction=(u*960-L)/width;setOffset(Math.round(Math.max(0,Math.min(1,fraction))*state.days*24));});updateIndicator();}
function updateIndicator(){const p=Math.max(0,Math.min(1,state.offset/(state.days*24)));const x=112+(960-112-12)*p;const l=$('#time-indicator');const tri=$('#indicator-triangle');if(l){l.setAttribute('x1',x);l.setAttribute('x2',x);}if(tri)tri.setAttribute('d',`M${x-4} 4 L${x+4} 4 L${x} 11 Z`);}
function skySvg(obs){const C=140,R=102;const sky=(body,fill,label)=>{let el=body.elevation,az=body.azimuth*Math.PI/180;let r=R*(90-Math.max(0,el))/90;let x=C+r*Math.sin(az),y=C-r*Math.cos(az);const below=el<=0;return `<circle cx="${x}" cy="${y}" r="${below?8:11}" fill="${fill}" fill-opacity="${below?.22:1}" stroke="${fill}" stroke-width="1.2" stroke-dasharray="${below?'3 3':'none'}"/><text x="${x+15}" y="${y+4}" fill="${below?'#8c99a7':'#dce9ed'}" font-family="DM Mono,monospace" font-size="10">${label}</text>`;};return `<svg viewBox="0 0 280 280" role="img" aria-label="Local sky polar plot"><defs><radialGradient id="sky-grad"><stop offset="0" stop-color="#222e3a"/><stop offset="1" stop-color="#111a23"/></radialGradient></defs><circle cx="${C}" cy="${C}" r="${R}" fill="url(#sky-grad)" stroke="#455361"/><circle cx="${C}" cy="${C}" r="${R*.66}" fill="none" stroke="#334453" stroke-dasharray="4 6"/><circle cx="${C}" cy="${C}" r="${R*.33}" fill="none" stroke="#334453" stroke-dasharray="4 6"/><path d="M140 36V244 M36 140H244" stroke="#384854" stroke-dasharray="3 8"/><text x="140" y="23" text-anchor="middle" fill="#a1b1b9" font-size="10" font-family="DM Mono">N</text><text x="140" y="264" text-anchor="middle" fill="#a1b1b9" font-size="10" font-family="DM Mono">S</text><text x="22" y="144" text-anchor="middle" fill="#a1b1b9" font-size="10" font-family="DM Mono">W</text><text x="258" y="144" text-anchor="middle" fill="#a1b1b9" font-size="10" font-family="DM Mono">E</text><text x="143" y="99" fill="#677e88" font-size="9">30°</text><text x="143" y="132" fill="#677e88" font-size="9">60°</text>${sky(obs.sun,'#d7a973','SUN')}${sky(obs.earth,'#90cbd1','EARTH')}<circle cx="140" cy="140" r="2.5" fill="#d7e5e8"/></svg>`;}
function updateInspection(){const date=new Date(state.base.getTime()+state.offset*3600000);const obs=ephemeris(date,state.site.lat,state.site.lon);map.setSun?.(obs,state.site);$('#condition-date').textContent=longDate(date);$('#sun-elevation').textContent=fmtDeg(obs.sun.elevation);$('#earth-elevation').textContent=fmtDeg(obs.earth.elevation);const sun=$('#sun-state'),earth=$('#earth-state');sun.textContent=obs.sun.visible?'VISIBLE':'BELOW HORIZON';earth.textContent=obs.earth.visible?'IN VIEW':'BELOW HORIZON';sun.classList.toggle('muted',!obs.sun.visible);earth.classList.toggle('muted',!obs.earth.visible);$('#sky-plot').innerHTML=skySvg(obs);$('#scrub-time-label').textContent=`DAY ${String(Math.floor(state.offset/24)+1).padStart(2,'0')} · ${date.toISOString().slice(11,16)}`;$('#time-scrubber').value=String(state.offset);updateIndicator();}
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
  $('#terrain-status').textContent='LOLA terrain active at '+state.site.name+' · '+p.resolutionM.toFixed(0)+' m/pixel · '+p.radiusKm+' km search · '+p.coveragePct.toFixed(0)+'% sample coverage. Estimates are not flight validated.';
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
    state.terrain=profile;
    updateMissionPanels();
    toast('NASA LOLA terrain horizon applied to selected-site feasibility');
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

// Events
siteSelect.addEventListener('change',()=>{const s=SITES.find(x=>x.id===siteSelect.value);if(s)selectSite(s);});
$$('#duration button').forEach(b=>b.addEventListener('click',()=>{state.days=Number(b.dataset.days);$$('#duration button').forEach(x=>x.classList.toggle('selected',x===b));stopPlay();updateAnalysis();}));
$('#analyze-btn').addEventListener('click',()=>{stopPlay();updateAnalysis();toast('Mission window recalculated');});
$('#mission-date').addEventListener('change',()=>{stopPlay();updateAnalysis();});
$('#mission-time').addEventListener('change',()=>{stopPlay();updateAnalysis();});
$('#time-scrubber').addEventListener('input',e=>{stopPlay();setOffset(e.target.value);});
$('#zoom-in').addEventListener('click',()=>$('#zoom-label').textContent=map.zoomBy(.2)+'%');
$('#zoom-out').addEventListener('click',()=>$('#zoom-label').textContent=map.zoomBy(-.2)+'%');
$('#reset-view')?.addEventListener('click',()=>$('#zoom-label').textContent=map.resetView?.()+'%');
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
updateAnalysis();
