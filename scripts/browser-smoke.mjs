/**
 * Real Chromium smoke test for the built static application.
 * Run after:
 *   npm run build
 *   npm ci
 *   npx playwright install --with-deps chromium
 *   node scripts/browser-smoke.mjs
 * The test blocks third-party requests to confirm the procedural lunar fallback
 * works when optional NASA imagery and runtime terrain networks are unavailable.
 */
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';

const host='http://127.0.0.1:4173';
const server=spawn(process.execPath,['scripts/preview-server.js','--dist','4173'],{stdio:['ignore','pipe','pipe']});
server.on('error',error=>console.error('Preview server:',error.message));
server.stderr.on('data',chunk=>console.error(String(chunk)));
let browser=null;
const assert=(value,message)=>{if(!value)throw new Error('Browser smoke: '+message);};
async function ready(){
  for(let i=0;i<40;i++){
    try{const response=await fetch(host+'/index.html');if(response.ok)return;}
    catch{}
    await sleep(250);
  }
  throw Error('Static build did not start at '+host);
}
async function offNetwork(page){
  await page.route('**/*',route=>{
    try{
      const hostname=new URL(route.request().url()).hostname;
      const pathname=new URL(route.request().url()).pathname;
      if(['/assets/bluemarble-1024.png','/assets/lola-80m.tif','/assets/lola-60s-60m.tif','/assets/sldem.img'].includes(pathname))return route.abort();
      if(hostname==='127.0.0.1'||hostname==='localhost')return route.continue();
    }catch{}
    return route.abort();
  });
}
async function trackGPU(page){
  await page.addInitScript(()=>{
    window.gpuUploads=[];
    const upload=WebGLRenderingContext.prototype.texImage2D;
    WebGLRenderingContext.prototype.texImage2D=function(...args){
      const result=upload.apply(this,args),source=args[5];
      const width=args.length===9?args[3]:source.width,height=args.length===9?args[4]:source.height;
      window.gpuUploads.push({width,height,bytes:args[8]?.byteLength||null,error:this.getError()});
      return result;
    };
  });
}
async function checkCSV(page,selector){
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator(selector).click()]);
  const text=readFileSync(await download.path(),'utf8');
  assert(download.suggestedFilename().endsWith('.csv')&&text.split('\n').length>2,'CSV has no data: '+selector);
}
const errors=[];
try{
  await ready();
  browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader']});
  const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  await trackGPU(page);
  page.on('pageerror',err=>errors.push('desktop '+err.message));
  await offNetwork(page);
  await page.goto(host+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.body.dataset.page==='explore');
  mkdirSync('smoke-artifacts',{recursive:true});
  await page.waitForFunction(()=>document.querySelector('#mission-verdict')?.textContent!=='COMPUTING…');
  await page.waitForFunction(()=>document.querySelector('#finder-terrain-count')?.textContent?.startsWith('5 of 5'),{timeout:20000});
  const initial=await page.locator('#mission-verdict').textContent();
  assert(/VISIBILITY|ONLY|OBSTRUCTED/.test(initial),'no live mission verdict');
  const imageStatus=await page.locator('#map-image-status').textContent();
  assert(/GLOBE|PROCEDURAL|SCHEMATIC|LROC/.test(imageStatus),'no truthful globe image status');
  await page.locator('#focus-site').click();
  assert((await page.locator('#zoom-label').textContent())==='135%','focus camera did not change zoom');
  await page.locator('#expand-globe').click();
  assert(await page.locator('body').evaluate(el=>el.classList.contains('globe-immersive')),'globe did not expand');
  await page.keyboard.press('Escape');
  assert(!await page.locator('body').evaluate(el=>el.classList.contains('globe-immersive')),'Escape did not close immersive mode');
  assert(await page.locator('#moon-globe').count()===1,'custom WebGL Moon scene fell back to schematic');
  assert((await page.locator('#celestial-view').getAttribute('aria-pressed'))==='true','Sun and Earth should show in shared globe by default');
  assert(await page.locator('#map-stage').evaluate(el=>el.classList.contains('show-celestial-bodies')),'Sun/Earth layer is not in Moon scene');
  assert(await page.locator('#zoom-in').isEnabled(),'Moon controls should remain active with celestial markers');
  const earthBefore=await page.locator('.celestial-earth').evaluate(el=>el.style.left);
  const moonRect=await page.locator('#moon-map').boundingBox();
  const centerX=moonRect.x+moonRect.width/2,centerY=moonRect.y+moonRect.height/2;
  await page.mouse.move(centerX,centerY);
  await page.mouse.down();
  await page.mouse.move(centerX+95,centerY+30,{steps:5});
  await page.mouse.up();
  const earthAfter=await page.locator('.celestial-earth').evaluate(el=>el.style.left);
  assert(earthBefore!==earthAfter,'Earth did not follow lunar camera rotation');
  await page.locator('#celestial-view').click();
  assert((await page.locator('#celestial-view').getAttribute('aria-pressed'))==='false','sky visibility toggle did not disable');
  await page.locator('#celestial-view').click();
  assert((await page.locator('#celestial-view').getAttribute('aria-pressed'))==='true','sky visibility toggle did not restore');
  await page.locator('#celestial-scrubber').evaluate(el=>{el.value='12';el.dispatchEvent(new Event('input',{bubbles:true}));});
  assert((await page.locator('#celestial-clock').textContent()).includes('2026-11-15'),'UTC time slider did not update simulation');
  const beforePlay=await page.locator('#celestial-clock').textContent();
  await page.locator('#celestial-play').click();
  await page.waitForTimeout(300);
  await page.locator('#celestial-play').click();
  assert((await page.locator('#celestial-clock').textContent())!==beforePlay,'timeline playback did not progress');
  await page.locator('#celestial-reset').click();
  await page.screenshot({path:'smoke-artifacts/celestial.png',fullPage:false});
  await page.locator('#celestial-scrubber').evaluate(el=>{el.value='0';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.locator('#time-next').click();
  const clock=await page.locator('#celestial-clock').textContent();
  assert(clock.includes('18:00'),'six hour UTC advance did not update mission HUD');
  await page.locator('#time-event').click();
  assert((await page.locator('#time-event-note').textContent()).length>10,'next-event feedback missing');
  await page.locator('a.nav-link[data-route="windows"]').click();
  assert(new URL(page.url()).pathname==='/windows','mission windows has no own route');
  assert((await page.locator('.app-view:not([hidden])').count())===1,'hidden modules still visible on window page');
  await page.waitForFunction(()=>document.querySelector('.finder-window-card'));
  await page.locator('#finder-mode').selectOption('terrain');
  await page.waitForFunction(()=>document.querySelector('#finder-impact')?.hidden===false,{timeout:20000});
  assert((await page.locator('.finder-window-card').count())>0,'no terrain-ranked mission windows');
  assert((await page.locator('.finder-impact-card').count())>0,'no terrain-vs-geometric comparison');
  await page.locator('#finder-mode').selectOption('flat');
  await page.waitForFunction(()=>document.querySelector('#finder-impact')?.hidden===true);
  await page.screenshot({path:'smoke-artifacts/windows.png',fullPage:false});
  await page.locator('.finder-window-card').first().click();
  assert(new URL(page.url()).pathname==='/explore','finder recommendation did not open dedicated explorer');
  assert((await page.locator('#mission-date').inputValue())!=='','finder lost selected mission date');
  await page.goBack();
  assert(new URL(page.url()).pathname==='/windows','browser Back did not restore mission windows');
  await page.locator('a.nav-link[data-route="engineering"]').click();
  assert(new URL(page.url()).pathname==='/engineering','engineering lab route failed');
  assert(await page.locator('#eng-charge-chart').isVisible(),'engineering simulator hidden');
  await page.locator('a.nav-link[data-route="compare"]').click();
  await checkCSV(page,'#download-csv');
  assert(await page.locator('#date-compare-table table').isVisible(),'date comparison did not render');
  assert((await page.locator('.compare-card:visible').count())>=5,'site comparison missing');
  await page.locator('.compare-card').first().click();
  assert(new URL(page.url()).pathname==='/explore','site comparison did not navigate to selected site');
  await page.locator('a.nav-link[data-route="science"]').click();
  assert(await page.locator('#science-page').isVisible(),'science page missing');
  await page.reload({waitUntil:'domcontentloaded'});
  assert(await page.locator('#science-page').isVisible(),'deep-linked science page broke after refresh');
  await page.locator('a.nav-link[data-route="explore"]').click();

  // Timeline stays fully draggable (pointer capture journal: indicator follows the pointer)…
  await page.waitForSelector('#timeline-graph #timeline-hit',{state:'attached'});
  // Disable smooth scrolling so coordinates are stable immediately, then center the widget.
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
  await page.locator('#timeline-hit').scrollIntoViewIfNeeded();
  await page.waitForTimeout(80);
  const track=await page.locator('#timeline-hit').boundingBox();
  const readOffset=async()=>Number(await page.locator('#time-scrubber').inputValue());
  const startOffset=await readOffset();
  const startX=track.x+track.width*0.1;
  const startY=track.y+track.height/2;
  await page.mouse.move(startX,startY);
  await page.mouse.down();
  await page.mouse.move(startX+track.width*0.45,startY,{steps:8});
  await page.mouse.up();
  const draggedOffset=await readOffset();
  assert(draggedOffset>startOffset+2,'timeline drag did not advance the inspection offset');
  // Click-to-jump must still work: clicking the middle of the track should land
  // near half the mission window (84 h on a 7-day mission).
  const jumpTrack=await page.locator('#timeline-hit').boundingBox();
  await page.mouse.click(jumpTrack.x+jumpTrack.width*0.5,jumpTrack.y+jumpTrack.height/2);
  const clickedOffset=await readOffset();
  assert(Math.abs(clickedOffset-84)<6,'click-to-jump no longer lands near the middle of the window');

  // Surface traverse planner lives on the Engineering page and produces a results card.
  await page.locator('a.nav-link[data-route="engineering"]').click();
  await page.waitForSelector('#travel-panel',{state:'visible'});
  await page.locator('#travel-run').scrollIntoViewIfNeeded();
  await page.locator('#travel-run').click();
  await page.waitForSelector('#travel-results .travel-summary',{state:'visible'});
  const travelDistance=await page.locator('#travel-results .travel-summary').textContent();
  assert(/\d+(\.\d+)? km/.test(travelDistance),'travel estimate did not report a distance');
  const energy=await page.locator('#eng-energy').textContent();
  await page.locator('#eng-area').fill('0');
  assert((await page.locator('#eng-energy').textContent())==='0.0 kWh','solar-area input did not update engineering');
  await page.locator('#eng-area').fill('12');
  assert((await page.locator('#eng-energy').textContent())===energy,'engineering restoration changed output');
  await checkCSV(page,'#export-model');
  await page.locator('a.nav-link[data-route="windows"]').click();
  await checkCSV(page,'#finder-export');
  await page.locator('#transit-run').click();
  assert((await page.locator('#transit-results').textContent()).includes('LUNAR ARRIVAL'),'transit results missing');
  await page.locator('#brief-btn').click();
  assert(await page.locator('#brief-content .report-grid').isVisible(),'briefing did not contain computed results');
  await page.pdf({path:'smoke-artifacts/mission-brief.pdf'});
  assert(readFileSync('smoke-artifacts/mission-brief.pdf').subarray(0,4).toString()==='%PDF','briefing PDF export failed');
  await page.locator('[data-close="brief-dialog"]').click();

  // Gemini assistant floats above the app, opens without an API key, and shows a friendly failure.
  assert(await page.locator('#assistant-fab').isVisible(),'assistant launcher button missing');
  await page.locator('#assistant-fab').click();
  await page.waitForSelector('#assistant-root:not([hidden])',{state:'visible'});
  assert(await page.locator('.assistant-message.assistant').count()>=1,'assistant welcome message missing');
  await page.locator('#assistant-input').fill('Which location has the most simultaneous Sun and Earth visibility?');
  await page.locator('#assistant-send').click();
  await page.waitForFunction(()=>document.querySelector('#assistant-messages')?.textContent?.includes('could not complete')===true,{timeout:15000});
  assert((await page.locator('#assistant-messages').textContent()).includes('GEMINI_API_KEY'),'assistant did not surface the configuration message');
  await page.locator('#assistant-close').click();
  assert(await page.locator('#assistant-root').isHidden(),'assistant did not close');
  await page.locator('a.nav-link[data-route="explore"]').click();
  await page.waitForSelector('#toast:not(.show)');
  await page.screenshot({path:'smoke-artifacts/desktop.png',fullPage:false});

  const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  await trackGPU(mobile);
  mobile.on('pageerror',err=>errors.push('mobile '+err.message));
  await offNetwork(mobile);
  await mobile.goto(host+'/explore?site=nobile&date=2026-11-14&days=7',{waitUntil:'domcontentloaded'});
  await mobile.waitForFunction(()=>document.querySelector('#mission-verdict')?.textContent!=='COMPUTING…');
  const mobileNav=await mobile.locator('.main-nav').boundingBox();
  assert(mobileNav&&mobileNav.height>=40,'mobile navigation is not visible/tappable');
  const mobileLinks=await mobile.locator('.main-nav a.nav-link:visible').count();
  assert(mobileLinks>=4,'mobile header hides primary page navigation');
  const overflow=await mobile.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  assert(overflow<=8,'mobile page overflows horizontally by '+overflow+'px');
  await mobile.locator('a.nav-link[data-route="windows"]').click();
  assert(new URL(mobile.url()).pathname==='/windows','mobile finder navigation failed');
  assert(await mobile.locator('#finder').isVisible(),'finder not visible on mobile');
  await mobile.locator('a.nav-link[data-route="explore"]').click();
  await mobile.screenshot({path:'smoke-artifacts/mobile.png',fullPage:false});
  for(const route of ['windows','compare','engineering','science','explore']){
    await mobile.locator('a.nav-link[data-route="'+route+'"]').click();
    const overflow=await mobile.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
    assert(overflow<=8,route+' mobile overflow: '+overflow);
  }
  const visitor=await browser.newPage({viewport:{width:1280,height:800}});
  visitor.on('pageerror',error=>errors.push(error.message));
  await offNetwork(visitor);
  await visitor.route('**/assets/*',route=>route.abort());
  await visitor.goto(host+'/',{waitUntil:'domcontentloaded'});
  assert(await visitor.locator('#moon-map').isVisible(),'fresh visitor cannot see globe');
  assert(await visitor.locator('#intro-loader,#tour-root').count()===0,'forced onboarding remains');
  await visitor.waitForFunction(()=>document.querySelector('#map-image-status').textContent.includes('PROCEDURAL'));
  await visitor.locator('#planner-help').click();
  assert(await visitor.locator('#science-page').isVisible(),'optional help did not open Methods');

  // Fixture-backed integration: exercise the real browser decoder and WebGL patch upload.
  // These synthetic rows test wiring only; live NASA verification is a separate command.
  const terrainPage=await browser.newPage({viewport:{width:1440,height:900}});
  terrainPage.on('pageerror',error=>errors.push('terrain '+error.message));
  await trackGPU(terrainPage);await offNetwork(terrainPage);
  let hold=false,release,started=false;
  const gate=new Promise(resolve=>{release=resolve;});
  await terrainPage.route('**/assets/sldem.img',async route=>{
    started=true;
    if(hold)await gate;
    const [,start,end]=/bytes=(\d+)-(\d+)/.exec(route.request().headers().range);
    const size=Number(end)-Number(start)+1;
    try{await route.fulfill({status:206,headers:{'content-range':'bytes '+start+'-'+end+'/'+(15360*46080*4),
      'content-length':String(size),'content-type':'application/octet-stream'},body:Buffer.alloc(size)});}catch{}
  });
  await terrainPage.goto(host+'/explore',{waitUntil:'domcontentloaded'});
  await terrainPage.waitForFunction(()=>document.querySelector('#finder-terrain-count').textContent.startsWith('5 of 5'));
  await terrainPage.locator('#moon-map').press('3');
  for(let i=0;i<7;i++)await terrainPage.locator('#moon-map').press('ArrowUp');
  await terrainPage.waitForTimeout(100);
  const box=await terrainPage.locator('#moon-map').boundingBox();
  await terrainPage.mouse.click(box.x+box.width/2,box.y+box.height/2);
  await terrainPage.waitForFunction(()=>document.querySelector('#site-select').value==='custom');
  await terrainPage.waitForFunction(()=>document.querySelector('#metrics-model').textContent.includes('NASA terrain'));
  await terrainPage.locator('a.nav-link[data-route="engineering"]').click();
  await terrainPage.locator('#terrain-load').click();
  await terrainPage.waitForFunction(()=>document.querySelector('#terrain-status').textContent.includes('SLDEM2015'));
  await terrainPage.waitForFunction(()=>!document.querySelector('#terrain-load').disabled);
  const patchUploads=await terrainPage.evaluate(()=>gpuUploads.filter(u=>u.bytes>4&&u.width>10));
  assert(patchUploads.length>0&&patchUploads.every(u=>u.bytes===u.width*u.height*4&&u.error===0),'native RGBA patch upload failed');
  hold=true;started=false;
  await terrainPage.locator('#terrain-load').click();
  for(let i=0;i<40&&!started;i++)await sleep(25);
  assert(started,'delayed native request did not start');
  await terrainPage.locator('a.nav-link[data-route="explore"]').click();
  await terrainPage.locator('#site-select').selectOption('nobile');
  release();await terrainPage.waitForTimeout(150);
  assert((await terrainPage.locator('#selected-name').textContent())==='Nobile Region','stale terrain restored old site');
  assert(!(await terrainPage.locator('#terrain-status').textContent()).includes('SLDEM2015'),'stale terrain replaced current profile');

  const metrics={};
  for(const [name,target,limit] of [['desktop',page,4096],['mobile',mobile,2048]]){
    const uploads=await target.evaluate(()=>gpuUploads);
    assert(uploads.every(u=>u.error===0),name+' WebGL upload error');
    assert(uploads.filter(u=>u.bytes===null).every(u=>u.width<=limit&&u.height<=limit),name+' exceeded texture budget');
    metrics[name]=await target.evaluate(()=>({uploads:gpuUploads,jsHeapBytes:performance.memory?.usedJSHeapSize||null}));
  }
  writeFileSync('smoke-artifacts/render-metrics.json',JSON.stringify(metrics,null,2));
  assert(errors.length===0,'uncaught JavaScript errors: '+errors.join(' | '));
  console.log('Browser smoke PASS: five pages, direct URLs, back/forward, desktop/mobile, science refresh, globe, terrain Finder and exports.');
}catch(error){
  console.error('Browser smoke FAIL:',error.message);
  if(errors.length)console.error('JavaScript errors:',errors.join(' | '));
  process.exitCode=1;
}finally{
  if(browser)await browser.close();
  server.kill();
}
