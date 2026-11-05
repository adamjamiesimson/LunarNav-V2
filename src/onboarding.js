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
  {page:'home',target:'.home-intro',title:'Welcome to LunarNav.',
   description:'Each tool has its own page: explorer, mission windows, engineering, comparison and science.'},
  {page:'explore',target:'.map-panel',title:'Explore the globe.',
   description:'Drag to rotate the Moon, pick a study site, and use the focus and zoom controls.'},
  {page:'explore',target:'.control-panel',title:'Set the mission.',
   description:'Choose a site, a UTC start date and a 3–28 day window; these carry across all tools.'},
  {page:'explore',target:'.status-panel',title:'Follow the Sun and Earth.',
   description:'Elevations, the local sky plot and horizon margins update for the selected time.'},
  {page:'explore',target:'.timeline-panel',title:'Move through time.',
   description:'Drag the timeline or step six hours at a time to inspect visibility changes.'},
  {page:'windows',target:'.finder-shell',title:'Find mission windows.',
   description:'The heatmap ranks candidate start dates across sites for your mission length.'},
  {page:'windows',target:'.finder-toolbar',title:'Compare horizon models.',
   description:'Switch between geometric and loaded LOLA terrain screening, then export results.'},
  {page:'engineering',target:'.engineering-controls',title:'Screen the power budget.',
   description:'Adjust solar array, battery and load assumptions to test surface feasibility.'},
  {page:'compare',target:'#site-comparison',title:'Compare study sites.',
   description:'All five locations are scored for the same UTC window; open one to inspect it.'},
  {page:'science',target:'.science-feature',title:'Read the limitations.',
   description:'Data sources, JPL benchmark results and model limits are documented here.'}
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
  navigateView,getPage,session=null,persistent=null,
  doc=document,clock=window,initialDelayMs=INTRO_DURATION_MS
}={}){
  if(typeof navigateView!=='function'||typeof getPage!=='function')throw Error('Onboarding needs navigation callbacks');
  if(session===null){try{session=clock.sessionStorage;}catch{session=undefined;}}
  if(persistent===null){try{persistent=clock.localStorage;}catch{persistent=undefined;}}

  const root=doc.getElementById('tour-root');
  const panel=doc.getElementById('tour-dialog');
  const spotlight=doc.getElementById('tour-spotlight');
  const loaderSkip=doc.getElementById('intro-skip');
  const tourNext=doc.getElementById('tour-next');
  const tourBack=doc.getElementById('tour-back');
  const tourSkip=doc.getElementById('tour-skip');
  let stepIndex=0,originalPage='home',originalScroll=0,returnFocus=null;
  let active=false,paintHandle=null,loadingTimer=null;

  const later=callback=>clock.requestAnimationFrame(callback);
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
  for(const id of ['tour-help','restart-tour','home-tour']){
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
