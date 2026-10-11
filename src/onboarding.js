/**
 * LunarNav first-visit experience.
 * Intro: six seconds once per browser tab session, skippable.
 * Tour: once per browser profile unless replayed or storage is unavailable.
 * All tour page changes are previews; they do NOT change URL or selected site.
 */
export const INTRO_SESSION_KEY='lunarnav:intro:session:v1';
export const TOUR_DONE_KEY='lunarnav:onboarding:complete:v1';
export const INTRO_DURATION_MS=6000;

export const TOUR_STEPS=Object.freeze([
  {page:'home',target:'.home-intro',title:'Welcome to mission control.',
   description:'LunarNav is your home for exploring the Moon’s south pole. Each mission tool now has its own page, so you can focus on one decision at a time.'},
  {page:'explore',target:'.map-panel',title:'Explore the lunar globe.',
   description:'Drag to orbit, zoom into the south polar region, select study sites, and focus or expand the interactive Moon. The globe image is illustrative, not a terrain hazard map.'},
  {page:'explore',target:'.control-panel',title:'Choose your mission.',
   description:'Select a site, set your start date in UTC, and choose a 3–28 day mission window. These choices carry across all the tools.'},
  {page:'explore',target:'.status-panel',title:'Follow the Sun and Earth.',
   description:'See the local sky, Sun and Earth elevation, and the modeled horizon. Where NASA-derived terrain is loaded, the gold skyline shows approximate local obstructions.'},
  {page:'explore',target:'.timeline-panel',title:'Rewind, replay, and find transitions.',
   description:'Explore the visibility timeline, move time forward or back six hours, and jump to the next modeled Sun/Earth horizon event.'},
  {page:'windows',target:'.finder-shell',title:'Discover better mission windows.',
   description:'Scan potential dates across lunar sites. The heatmap ranks opportunities; selecting a result opens that same location and window in the Explorer.'},
  {page:'windows',target:'.finder-toolbar',title:'Account for local terrain.',
   description:'Switch between geometric and loaded LOLA horizon models, adjust ranking priorities, and export candidate windows with terrain-impact comparisons.'},
  {page:'engineering',target:'.engineering-controls',title:'Test surface system designs.',
   description:'Adjust solar panel area, conversion efficiency, battery capacity, and power demand. View the modeled energy balance and load elevation data when needed.'},
  {page:'compare',target:'#site-comparison',title:'Compare candidate sites.',
   description:'Review five lunar study locations under consistent UTC assumptions. Open a site to inspect it or export the comparison as a CSV.'},
  {page:'science',target:'.science-feature',title:'Explore the methods and limitations.',
   description:'Inspect NASA data provenance, independent JPL reference checks, and where our simplified models stop. The results are screening estimates, not flight-ready recommendations.'}
]);

function readStorage(storage,key){
  try{return storage?.getItem(key)=== '1';}catch{return false;}
}
function writeStorage(storage,key){
  try{storage?.setItem(key,'1');}catch{/* Private browsing may block storage. */}
}
export function introNeeded(storage){
  return !readStorage(storage,INTRO_SESSION_KEY);
}
export function tourNeeded(storage){
  return !readStorage(storage,TOUR_DONE_KEY);
}

export function initOnboarding({
  navigateView,getPage,session=window.sessionStorage,persistent=window.localStorage,
  doc=document,clock=window,initialDelayMs=INTRO_DURATION_MS
}={}){
  if(typeof navigateView!=='function'||typeof getPage!=='function')throw Error('Onboarding needs navigation callbacks');
  const root=doc.getElementById('tour-root');
  const panel=doc.getElementById('tour-dialog');
  const spotlight=doc.getElementById('tour-spotlight');
  const loaderSkip=doc.getElementById('intro-skip');
  const tourNext=doc.getElementById('tour-next');
  const tourBack=doc.getElementById('tour-back');
  const tourSkip=doc.getElementById('tour-skip');
  let stepIndex=0,originalPage='home',originalScroll=0,returnFocus=null;
  let active=false,paintHandle=null,loadingTimer=null;

  const later=callback=>(clock.requestAnimationFrame||requestAnimationFrame)(callback);
  const focusable='button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';
  const viewport=()=>({w:doc.documentElement.clientWidth,h:doc.documentElement.clientHeight});

  function placeSpotlight(){
    if(!active)return;
    const step=TOUR_STEPS[stepIndex];
    let target=doc.querySelector(step.target);
    if(!target||target.getBoundingClientRect().width<1){
      target=doc.querySelector('a.nav-link[data-route="'+step.page+'"]');
    }
    if(!target)return;
    const rect=target.getBoundingClientRect(),{w,h}=viewport();
    const pad=8;
    const x=Math.max(pad,rect.left-pad),y=Math.max(pad,rect.top-pad);
    const width=Math.max(25,Math.min(w-x-pad,rect.width+pad*2));
    const height=Math.max(25,Math.min(h-y-pad,rect.height+pad*2));
    Object.assign(spotlight.style,{left:x+'px',top:y+'px',
      width:width+'px',height:height+'px'});
    if(w<=760){
      panel.style.left='14px';panel.style.right='14px';panel.style.top='auto';panel.style.bottom='14px';
    }else{
      const cardWidth=Math.min(398,w-40);
      const gap=22;
      let left=rect.right+cardWidth+gap<w?rect.right+gap:
        rect.left-cardWidth-gap>0?rect.left-cardWidth-gap:w-cardWidth-26;
      left=Math.max(18,Math.min(w-cardWidth-18,left));
      const cardHeight=panel.getBoundingClientRect().height||360;
      const top=Math.max(18,Math.min(h-cardHeight-18,rect.top+rect.height/2-cardHeight/2));
      Object.assign(panel.style,{left:left+'px',right:'auto',top:top+'px',bottom:'auto'});
    }
  }
  function queuePosition(){
    if(!active)return;
    if(paintHandle!==null)clock.cancelAnimationFrame?.(paintHandle);
    paintHandle=later(()=>{paintHandle=null;placeSpotlight();});
  }
  function renderStep(){
    const step=TOUR_STEPS[stepIndex];
    navigateView(step.page);
    doc.getElementById('tour-title').textContent=step.title;
    doc.getElementById('tour-description').textContent=step.description;
    doc.getElementById('tour-counter').textContent=
      String(stepIndex+1).padStart(2,'0')+' / '+String(TOUR_STEPS.length).padStart(2,'0');
    doc.getElementById('tour-progress').innerHTML=TOUR_STEPS.map((_,i)=>
      '<span class="'+(i<=stepIndex?'is-active':'')+'"></span>').join('');
    tourBack.disabled=stepIndex===0;
    tourNext.innerHTML=stepIndex===TOUR_STEPS.length-1?
      'Start exploring <span aria-hidden="true">↗</span>':
      'Next feature <span aria-hidden="true">→</span>';
    const target=doc.querySelector(step.target);
    if(target?.scrollIntoView){
      target.scrollIntoView({behavior:'instant',block:'center',inline:'nearest'});
    }
    later(()=>later(()=>{placeSpotlight();tourNext.focus({preventScroll:true});}));
  }
  function stopTour(){
    if(!active)return;
    active=false;
    writeStorage(persistent,TOUR_DONE_KEY);
    root.hidden=true;
    doc.body.classList.remove('tour-is-active');
    if(paintHandle!==null)clock.cancelAnimationFrame?.(paintHandle);
    paintHandle=null;
    navigateView(originalPage);
    clock.scrollTo?.(0,originalScroll);
    const element=returnFocus?.isConnected?returnFocus:doc.querySelector('a.nav-link[data-route="'+originalPage+'"]');
    element?.focus?.({preventScroll:true});
  }
  function startTour(){
    if(active)return;
    originalPage=getPage();
    originalScroll=clock.scrollY||0;
    returnFocus=doc.activeElement;
    stepIndex=0;
    active=true;
    root.hidden=false;
    doc.body.classList.add('tour-is-active');
    renderStep();
  }
  function completeIntro(){
    if(loadingTimer!==null){clock.clearTimeout(loadingTimer);loadingTimer=null;}
    doc.documentElement.removeAttribute('data-intro-loading');
    writeStorage(session,INTRO_SESSION_KEY);
    if(tourNeeded(persistent)){
      clock.setTimeout(()=>startTour(),220);
    }
  }
  tourNext.addEventListener('click',()=>{
    if(stepIndex===TOUR_STEPS.length-1){stopTour();return;}
    stepIndex++;renderStep();
  });
  tourBack.addEventListener('click',()=>{
    if(stepIndex>0){stepIndex--;renderStep();}
  });
  tourSkip.addEventListener('click',stopTour);
  loaderSkip?.addEventListener('click',completeIntro);
  for(const id of ['tour-help','restart-tour']){
    doc.getElementById(id)?.addEventListener('click',startTour);
  }
  function handleKey(event){
    if(!active)return;
    if(event.key==='Escape'){event.preventDefault();stopTour();return;}
    if(event.key==='ArrowRight'){event.preventDefault();tourNext.click();return;}
    if(event.key==='ArrowLeft'){event.preventDefault();tourBack.click();return;}
    if(event.key==='Tab'){
      const controls=[...panel.querySelectorAll(focusable)].filter(el=>el.getClientRects().length);
      if(!controls.length)return;
      const first=controls[0],last=controls[controls.length-1];
      if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first.focus();}
    }
  }
  doc.addEventListener('keydown',handleKey);
  clock.addEventListener('resize',queuePosition);
  clock.addEventListener('scroll',queuePosition,true);
  if(introNeeded(session)){
    // A timeout is intentional: this is a short branded intro, not a claim
    // that NASA data is downloading. A visible Skip button avoids trapping users.
    doc.documentElement.setAttribute('data-intro-loading','');
    loadingTimer=clock.setTimeout(completeIntro,initialDelayMs);
  }else{
    doc.documentElement.removeAttribute('data-intro-loading');
    if(tourNeeded(persistent))clock.setTimeout(startTour,100);
  }
  return {startTour,stopTour,completeIntro,isTourActive:()=>active};
}
