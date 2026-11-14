export const LOADING_DURATION_MS=10000;
export const NOTICE_DURATION_MS=10000;
export const TOUR_STEPS=[
  {page:'explore',target:'#tour-site',title:'Choose a landing site',text:'Choose a site to see its coordinates and source.'},
  {page:'explore',target:'#tour-window',title:'Set the mission window',text:'Choose the UTC start date, time and duration. Explore, Plan Mission and Engineering share this mission period.'},
  {page:'explore',target:'#map-stage',title:'Explore the lunar globe',text:'Drag to rotate the Moon. Select a point to create a waypoint.'},
  {page:'explore',target:'#tour-inspection',title:'Inspect a moment in time',text:'Use the slider, step six hours or jump to the next visibility change.'},
  {page:'explore',target:'#mission-situation',title:'Read the site outlook',text:'Clearance is the angle above or below the horizon used for this site.'},
  {page:'explore',target:'.timeline-panel',title:'Read the visibility timeline',text:'See when sunlight and Earth visibility overlap. Select a point on the timeline to inspect that time.'},
  {page:'planning',target:'#compare-table',title:'Compare landing sites',text:'Compare the same dates across sites. The horizon setting applies to the whole table.'},
  {page:'planning',target:'#finder-top',title:'Find a better mission window',text:'Use a recommendation to open its site and dates in Explore. Open the calendar to see more dates.'},
  {page:'engineering',target:'.terrain-actions',title:'Refine the local horizon',text:'Load NASA terrain or import a GeoTIFF to refine the horizon. Check the source and coverage below.'},
  {page:'engineering',target:'.engineering-controls',title:'Size power and battery',text:'Set solar area, efficiency, payload load and battery capacity. Review the modeled charge and power shortfalls, then export the engineering CSV.'},
  {page:'explore',target:'#panorama-open',title:'Explore the surface panorama',text:'Open Surface panorama to look around from your selected site. Drag to turn and zoom to inspect the terrain, Sun and Earth.'},
  {page:'explore',target:'#assistant-fab',title:'Ask the AI assistant',text:'Open Assistant to ask about your site, visibility, mission windows or engineering results.'}
];

// Loading -> memory notice -> graphics -> spotlight tour on every visit. No visit flags.
export function initOnboarding({navigateView,getPage,onGraphicsChange,doc=document,clock=window}={}){
  const dialog=doc.getElementById('onboarding-dialog'),app=doc.getElementById('app');
  const title=doc.getElementById('onboarding-title'),description=doc.getElementById('onboarding-description');
  const card=dialog.querySelector('.onboarding-card'),hole=doc.getElementById('tour-cutout'),ring=doc.getElementById('tour-ring');
  const next=doc.getElementById('tour-next'),back=doc.getElementById('tour-back');
  const counter=doc.getElementById('tour-counter'),progress=doc.getElementById('tour-progress');
  let stage='loading',step=0,target=null,frame=null,observer=null;
  let returnPage=getPage(),returnFocus=doc.activeElement,returnScroll=clock.scrollY||0;
  const listen=(id,fn)=>doc.getElementById(id).addEventListener('click',fn);
  const clamp=(n,min,max)=>Math.max(min,Math.min(n,Math.max(min,max)));
  function open(){
    app.inert=true;
    if(typeof dialog.showModal==='function'){
      if(dialog.open)dialog.close();
      dialog.showModal();
    }else dialog.setAttribute('open','');
  }
  function show(name){
    stage=name;dialog.dataset.stage=name;
    for(const panel of dialog.querySelectorAll('[data-onboarding-panel]'))panel.hidden=panel.dataset.onboardingPanel!==name;
  }
  function positionStep({reveal=false}={}){
    if(stage!=='tour'||!dialog.open||!target)return;
    const w=doc.documentElement.clientWidth||clock.innerWidth,h=clock.innerHeight;
    if(!w||!h)return; // Non-layout DOM environments.
    const gap=16,pad=12,cardBox=card.getBoundingClientRect();
    const cw=cardBox.width,ch=cardBox.height;
    const headerBottom=doc.querySelector('.topbar')?.getBoundingClientRect().bottom||0;
    const top=Math.max(pad,headerBottom+8);
    let rect=target.getBoundingClientRect();
    if(reveal){
      // Reserve room below large features on a phone; desktop can use a side.
      const desired=top+Math.max(0,(h-top-ch-3*gap-rect.height)/2);
      clock.scrollTo?.({top:(clock.scrollY||0)+rect.top-desired,behavior:'instant'});
      rect=target.getBoundingClientRect();
    }
    let box={x:clamp(rect.left-6,pad,w-pad),y:clamp(rect.top-6,top,h-pad),right:clamp(rect.right+6,pad,w-pad),bottom:clamp(rect.bottom+6,top,h-pad)};
    const centerX=clamp((box.x+box.right-cw)/2,pad,w-cw-pad);
    const centerY=clamp((box.y+box.bottom-ch)/2,pad,h-ch-pad);
    const candidates=[
      {x:box.right+gap,y:centerY},
      {x:box.x-gap-cw,y:centerY},
      {x:centerX,y:box.bottom+gap},
      {x:centerX,y:box.y-gap-ch}
    ];
    let position=candidates.find(p=>p.x>=pad&&p.y>=pad&&p.x+cw<=w-pad&&p.y+ch<=h-pad);
    if(!position){
      position={x:clamp(w-cw-pad,pad,w-cw-pad),y:Math.max(pad,h-ch-pad)};
      // Very short screens show the visible portion of a tall feature above
      // the card, rather than letting the card obscure the spotlight.
      box.bottom=Math.min(box.bottom,position.y-gap);
      box.y=Math.min(box.y,box.bottom-24);
    }
    card.style.left=position.x+'px';card.style.top=position.y+'px';
    for(const el of [hole,ring]){
      el.setAttribute('x',String(box.x));el.setAttribute('y',String(box.y));
      el.setAttribute('width',String(Math.max(0,box.right-box.x)));
      el.setAttribute('height',String(Math.max(0,box.bottom-box.y)));
    }
  }
  function schedulePosition(){
    if(stage!=='tour'||frame!==null)return;
    if(clock.requestAnimationFrame)frame=clock.requestAnimationFrame(()=>{frame=null;positionStep();});
    else positionStep();
  }
  function finish(){
    stage='closed';dialog.dataset.stage=stage;observer?.disconnect();
    if(frame!==null)clock.cancelAnimationFrame?.(frame);frame=null;
    target?.classList.remove('tour-target');target=null;
    if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');
    app.inert=false;card.style.left='';card.style.top='';
    navigateView(returnPage);
    clock.scrollTo?.(0,returnScroll);
    if(returnFocus?.isConnected&&returnFocus!==doc.body&&!dialog.contains(returnFocus))returnFocus.focus({preventScroll:true});
    else doc.querySelector(`a.nav-link[data-route="${returnPage}"]`)?.focus({preventScroll:true});
  }
  function renderStep(){
    target?.classList.remove('tour-target');observer?.disconnect();
    const current=TOUR_STEPS[step];
    navigateView(current.page);
    title.textContent=current.title;description.textContent=current.text;
    counter.textContent=`${String(step+1).padStart(2,'0')} / ${TOUR_STEPS.length}`;
    progress.setAttribute('aria-valuemax',String(TOUR_STEPS.length));
    progress.setAttribute('aria-valuenow',String(step+1));
    progress.setAttribute('aria-valuetext',`${step+1} of ${TOUR_STEPS.length} features`);
    progress.innerHTML=TOUR_STEPS.map((_,i)=>`<span class="${i<=step?'complete':''}"></span>`).join('');
    back.disabled=step===0;next.textContent=step===TOUR_STEPS.length-1?'Start exploring':'Next';
    target=doc.querySelector(current.target);
    target?.classList.add('tour-target');
    target?.scrollIntoView?.({block:'center',inline:'nearest',behavior:'instant'});
    positionStep({reveal:true});schedulePosition();
    if(clock.ResizeObserver&&target){observer=new clock.ResizeObserver(schedulePosition);observer.observe(target);observer.observe(card);}
    next.focus({preventScroll:true});
  }
  function startTour(){
    returnPage=getPage();returnFocus=doc.activeElement;returnScroll=clock.scrollY||0;
    open();show('tour');step=0;renderStep();
  }
  open();
  const loadingProgress=doc.getElementById('loading-progress'),fill=doc.getElementById('loading-fill');
  const percent=doc.getElementById('loading-percent');
  const now=()=>clock.performance?.now?.()??Date.now();
  const startedAt=now();
  function updateLoading(value){
    const amount=Math.max(0,Math.min(100,value));
    loadingProgress.setAttribute('aria-valuenow',String(amount));
    fill.style.width=amount+'%';
    percent.textContent=amount+'%';
  }
  let noticeTimer=null;
  function showGraphics(){
    if(stage!=='notice')return;
    if(noticeTimer!==null){clock.clearTimeout?.(noticeTimer);noticeTimer=null;}
    show('graphics');title.textContent='Choose terrain relief';
    description.textContent='Set how much the globe exaggerates elevation.';
    dialog.querySelector('input[name="startup-graphics"]:checked').focus();
  }
  const progressTimer=clock.setInterval?.(()=>{
    updateLoading(Math.min(99,Math.floor((now()-startedAt)/LOADING_DURATION_MS*100)));
  },100);
  clock.setTimeout(()=>{
    if(progressTimer!=null)clock.clearInterval?.(progressTimer);
    updateLoading(100);
    show('notice');
    title.textContent='Before you explore';
    description.textContent="LunarNav's features have been tested. The 3D tools can use substantial browser memory. If something doesn't work, try opening LunarNav in an incognito tab.";
    doc.getElementById('notice-okay').focus();
    noticeTimer=clock.setTimeout(showGraphics,NOTICE_DURATION_MS);
  },LOADING_DURATION_MS);
  listen('notice-okay',showGraphics);
  listen('graphics-continue',()=>{
    onGraphicsChange(Number(dialog.querySelector('input[name="startup-graphics"]:checked').value));startTour();
  });
  listen('tour-next',()=>{if(step===TOUR_STEPS.length-1)finish();else{step++;renderStep();}});
  listen('tour-back',()=>{if(step>0){step--;renderStep();}});
  listen('tour-skip',finish);
  doc.getElementById('restart-tour').addEventListener('click',startTour);
  clock.addEventListener?.('resize',schedulePosition);
  clock.addEventListener?.('scroll',schedulePosition,{passive:true});
  dialog.addEventListener('cancel',event=>{event.preventDefault();if(stage!=='loading'&&stage!=='notice')finish();});
  return {startTour,finish};
}
