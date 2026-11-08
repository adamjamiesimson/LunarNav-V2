export const LOADING_DURATION_MS=5000;
export const TOUR_STEPS=[
  {target:'#site-select',title:'Choose a landing site',text:'Select a study site, or click the globe to create a custom waypoint.'},
  {target:'.field-row',title:'Set your mission time',text:'Choose the UTC start date, time and mission duration. Use the sliders to inspect conditions.'},
  {target:'#mission-situation',title:'Read the mission conditions',text:'Check Sun and Earth clearance, then use Windows, Compare and Engineering to plan your mission.'}
];

/** Each page load runs loading → graphics → tutorial; no visit flags are stored. */
export function initOnboarding({navigateView,getPage,onGraphicsChange,doc=document,clock=window}={}){
  const dialog=doc.getElementById('onboarding-dialog');
  const app=doc.getElementById('app');
  const title=doc.getElementById('onboarding-title');
  const description=doc.getElementById('onboarding-description');
  const next=doc.getElementById('tour-next');
  const back=doc.getElementById('tour-back');
  let stage='loading',step=0,target=null,returnPage=getPage(),returnFocus=doc.activeElement,returnScroll=clock.scrollY||0;
  const listen=(id,fn)=>doc.getElementById(id).addEventListener('click',fn);
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
  function finish(){
    target?.classList.remove('tour-target');target=null;
    if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');
    app.inert=false;
    navigateView(returnPage);
    clock.scrollTo?.(0,returnScroll);
    if(returnFocus?.isConnected&&returnFocus!==doc.body&&!dialog.contains(returnFocus))returnFocus.focus({preventScroll:true});
    else doc.querySelector(`a.nav-link[data-route="${returnPage}"]`)?.focus({preventScroll:true});
  }
  function renderStep(){
    target?.classList.remove('tour-target');
    const current=TOUR_STEPS[step];
    title.textContent=current.title;description.textContent=current.text;
    doc.getElementById('tour-counter').textContent=`${step+1} / ${TOUR_STEPS.length}`;
    back.disabled=step===0;next.textContent=step===TOUR_STEPS.length-1?'Start exploring':'Next';
    target=doc.querySelector(current.target);
    target?.classList.add('tour-target');
    target?.scrollIntoView?.({block:'center',behavior:'instant'});
    next.focus({preventScroll:true});
  }
  function startTour(){
    returnPage=getPage();returnFocus=doc.activeElement;returnScroll=clock.scrollY||0;
    open();show('tour');step=0;
    navigateView('explore');renderStep();
  }
  open();
  clock.setTimeout(()=>{
    show('graphics');title.textContent='Choose your graphics';
    description.textContent='Choose how strongly the lunar terrain is shown.';
    dialog.querySelector('input[name="startup-graphics"]:checked').focus();
  },LOADING_DURATION_MS);
  listen('graphics-continue',()=>{
    onGraphicsChange(Number(dialog.querySelector('input[name="startup-graphics"]:checked').value));
    startTour();
  });
  listen('tour-next',()=>{if(step===TOUR_STEPS.length-1)finish();else{step++;renderStep();}});
  listen('tour-back',()=>{if(step>0){step--;renderStep();}});
  listen('tour-skip',finish);
  doc.getElementById('restart-tour').addEventListener('click',startTour);
  dialog.addEventListener('cancel',event=>{event.preventDefault();if(stage!=='loading')finish();});
  return {startTour,finish};
}
