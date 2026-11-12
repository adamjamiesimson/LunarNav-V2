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
    window.reliefValues=[];
    const reliefLocations=new WeakSet();
    const locate=WebGLRenderingContext.prototype.getUniformLocation;
    WebGLRenderingContext.prototype.getUniformLocation=function(program,name){
      const location=locate.call(this,program,name);
      if(name==='reliefExag'&&location)reliefLocations.add(location);
      return location;
    };
    const uniform=WebGLRenderingContext.prototype.uniform1f;
    WebGLRenderingContext.prototype.uniform1f=function(location,value){
      if(location&&reliefLocations.has(location))window.reliefValues.push(value);
      return uniform.call(this,location,value);
    };
    const upload=WebGLRenderingContext.prototype.texImage2D;
    WebGLRenderingContext.prototype.texImage2D=function(...args){
      const result=upload.apply(this,args),source=args[5];
      const width=args.length===9?args[3]:source.width,height=args.length===9?args[4]:source.height;
      window.gpuUploads.push({canvas:this.canvas.id,width,height,bytes:args[8]?.byteLength||null,error:this.getError()});
      return result;
    };
  });
}
async function trackPanorama(page,{fallback=false}={}){
  await page.addInitScript(useFallback=>{
    const probe=window.panoramaProbe={grids:[],frame:null,skyline:null};
    if(useFallback){
      const getContext=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(type,...args){
        if(this.id==='panorama-canvas'&&type==='webgl')return null;
        return getContext.call(this,type,...args);
      };
    }
    const read=CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData=function(...args){
      const pixels=read.apply(this,args);
      if(!this.canvas.isConnected&&pixels.width>50&&pixels.width<300&&pixels.height<300){
        const codes=new Set();
        for(let i=0;i<pixels.data.length;i+=68){
          const code=pixels.data[i]*16+pixels.data[i+1]/16;
          if(code&&pixels.data[i+3])codes.add(code);
        }
        probe.grids.push(codes.size);
      }
      return pixels;
    };
    if(useFallback){
      const write=CanvasRenderingContext2D.prototype.putImageData;
      CanvasRenderingContext2D.prototype.putImageData=function(pixels,...args){
        if(this.canvas.id==='panorama-canvas'&&!probe.skyline){
          const rows=[];
          for(let x=0;x<pixels.width;x+=40){
            for(let y=0;y<pixels.height;y++){
              const offset=(y*pixels.width+x)*4;
              if(pixels.data[offset]===201&&pixels.data[offset+1]===155&&pixels.data[offset+2]===82){
                rows.push(y);
                break;
              }
            }
          }
          probe.skyline=rows;
        }
        return write.call(this,pixels,...args);
      };
    }else{
      const draw=WebGLRenderingContext.prototype.drawArrays;
      WebGLRenderingContext.prototype.drawArrays=function(...args){
        const result=draw.apply(this,args);
        if(this.canvas.id!=='panorama-canvas'||this.drawingBufferWidth<200)return result;
        const program=this.getParameter(this.CURRENT_PROGRAM);
        const uniform=name=>this.getUniform(program,this.getUniformLocation(program,name));
        const fov=uniform('uTanFov');
        if(!probe.frame){
          const colors=new Set(),pixel=new Uint8Array(4);
          for(const x of [.2,.5,.8])for(const y of [.15,.35,.65,.85]){
            this.readPixels(Math.floor(x*this.drawingBufferWidth),Math.floor(y*this.drawingBufferHeight),
              1,1,this.RGBA,this.UNSIGNED_BYTE,pixel);
            colors.add(pixel.join(','));
          }
          probe.frame={colors:colors.size,sun:Array.from(uniform('uSunDir')),earth:Array.from(uniform('uEarthDir'))};
        }
        probe.frame.fov=fov;
        return result;
      };
    }
  },fallback);
}
async function openPanorama(page){
  await page.locator('#panorama-open').click();
  assert(await page.locator('#panorama-open').isDisabled(),'panorama did not begin the camera fly-in');
  await page.locator('#panorama-overlay.visible').waitFor({timeout:45000});
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#panorama-overlay')).opacity==='1');
  assert(await page.evaluate(()=>panoramaProbe.grids.some(count=>count>20)),'panorama loader did not sample varied elevations from the bundled grid');
}
async function closePanorama(page){
  await page.locator('#panorama-close').click();
  assert(await page.locator('#panorama-overlay').isHidden(),'close did not return to the globe');
  assert(await page.locator('#moon-map').isVisible()&&await page.locator('#panorama-open').isEnabled(),'globe controls were not restored');
}
async function checkPanorama(page,mobile=false){
  await openPanorama(page);
  await page.waitForFunction(()=>panoramaProbe.frame?.colors>2);
  const frame=await page.evaluate(()=>panoramaProbe.frame);
  assert([frame.sun,frame.earth].every(direction=>Math.abs(Math.hypot(...direction)-1)<.001),'surface shader did not receive Sun and Earth directions');
  const canvas=page.locator('#panorama-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const rect=await canvas.boundingBox();
  assert(rect.width>200&&rect.height>140,'surface viewport is too small');
  const x=Math.round(rect.x+rect.width/2),y=Math.round(rect.y+rect.height/2);
  const heading=()=>page.locator('#panorama-heading').textContent();
  const waitForTurn=previous=>page.waitForFunction(value=>document.querySelector('#panorama-heading').textContent!==value,previous);
  const initial=await heading();
  if(mobile){
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+50,y}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await cdp.detach();
    await waitForTurn(initial);
  }else{
    await page.mouse.move(x,y);
    await page.mouse.down();
    await page.mouse.move(x+50,y,{steps:3});
    await page.mouse.up();
    await waitForTurn(initial);
    const dragged=await heading();
    await canvas.press('ArrowRight');
    await waitForTurn(dragged);
    await canvas.press('=');
    await page.waitForFunction(fov=>panoramaProbe.frame.fov<fov,frame.fov);
  }
  await page.screenshot({path:'smoke-artifacts/'+(mobile?'mobile-':'')+'panorama.png'});
  await closePanorama(page);
}
async function checkCSV(page,selector){
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator(selector).click()]);
  const text=readFileSync(await download.path(),'utf8');
  assert(download.suggestedFilename().endsWith('.csv')&&text.split('\n').length>2,'CSV has no data: '+selector);
}
async function completeWelcome(page,preset='5'){
  await page.locator('#onboarding-dialog[data-stage="graphics"]').waitFor();
  await page.locator(`input[name="startup-graphics"][value="${preset}"]`).check();
  await page.locator('#graphics-continue').click();
  assert((await page.locator('#relief-exaggeration').inputValue())===preset,'startup preset was not applied');
  await page.locator('#tour-skip').click();
  assert(!await page.locator('#onboarding-dialog').isVisible(),'skipped tour still covers the workspace');
  assert(!await page.locator('#app').evaluate(el=>el.inert),'tutorial left the workspace inert');
}
async function checkTourStep(page,step,expectedPage){
  await page.waitForFunction(n=>document.querySelector('#tour-progress').getAttribute('aria-valuenow')===String(n),step);
  await page.waitForTimeout(80);
  const check=await page.evaluate(()=>{
    const target=document.querySelector('.tour-target'),ring=document.querySelector('#tour-ring');
    const r=ring.getBoundingClientRect(),card=document.querySelector('.onboarding-card').getBoundingClientRect(),t=target.getBoundingClientRect();
    return {page:document.body.dataset.page,count:document.querySelectorAll('.tour-target').length,
      visible:!target.closest('[data-view]').hidden,
      ringOnScreen:r.width>24&&r.height>=24&&r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,
      marksTarget:r.left<t.right&&r.right>t.left&&r.top<t.bottom&&r.bottom>t.top,
      cardOnScreen:card.left>=0&&card.top>=0&&card.right<=innerWidth+1&&card.bottom<=innerHeight+1,
      separate:r.right<=card.left||r.left>=card.right||r.bottom<=card.top||r.top>=card.bottom,
      progress:document.querySelectorAll('#tour-progress .complete').length};
  });
  assert(check.page===expectedPage&&check.count===1&&check.visible,'tour step '+step+' has the wrong target/page');
  assert(check.ringOnScreen&&check.marksTarget&&check.cardOnScreen&&check.separate,'tour step '+step+' spotlight/card geometry: '+JSON.stringify(check));
  assert(check.progress===step,'tour progress does not match step '+step);
}
const errors=[];
try{
  await ready();
  browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  await trackGPU(page);
  await trackPanorama(page);
  page.on('pageerror',err=>errors.push('desktop '+err.message));
  await offNetwork(page);
  await page.goto(host+'/',{waitUntil:'domcontentloaded'});
  await completeWelcome(page,'2');
  await page.waitForFunction(()=>document.body.dataset.page==='explore');
  mkdirSync('smoke-artifacts',{recursive:true});
  await page.waitForFunction(()=>document.querySelector('#mission-verdict')?.textContent!=='Calculating…');
  await page.waitForFunction(()=>document.querySelector('#finder-terrain-count')?.textContent?.startsWith('5 of 5'),{timeout:20000});
  const initial=await page.locator('#mission-verdict').textContent();
  assert(/visibility|only|obstructed/i.test(initial),'no live mission verdict');
  await page.locator('#map-image-status[data-imagery="loaded"]').waitFor({state:'attached'});
  assert(await page.locator('#map-image-status').isHidden(),'successful Moon imagery showed a redundant status');
  assert(await page.evaluate(()=>gpuUploads.some(upload=>upload.width===2048&&upload.height===1024&&upload.error===0)),
    'the LROC texture did not reach WebGL');
  for(const value of ['2','5','10']){
    await page.locator('#relief-exaggeration').selectOption(value);
    await page.waitForFunction(n=>window.reliefValues.at(-1)===Number(n),value);
  }
  await page.locator('#relief-exaggeration').selectOption('5');
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
  await page.locator('a.nav-link[data-route="planning"]').click();
  assert(new URL(page.url()).pathname==='/planning','planning route failed');
  assert(await page.locator('.app-view:not([hidden])').count()===1,'more than one page visible');
  await page.waitForFunction(()=>document.querySelectorAll('.finder-window-card').length===3);
  assert(await page.locator('#compare-table tbody tr').count()===6,'expected six core metrics');
  assert(await page.locator('#compare-table .planning-site').count()===5,'missing study sites');
  assert(!await page.locator('#date-compare-table').isVisible(),'date comparison should start collapsed');
  assert(!await page.locator('#transit-run').isVisible(),'transit should start collapsed');
  await page.locator('#finder-mode').selectOption('flat');
  await page.waitForFunction(()=>document.querySelector('#finder-model-badge').textContent.includes('Flat 0° geometric horizon'));
  assert((await page.locator('#compare-model').textContent()).includes('Flat 0° horizon'),'comparison did not share horizon');
  await page.locator('#planning-time').fill('18:00');await page.locator('#planning-time').dispatchEvent('change');
  await page.locator('#finder-duration').selectOption('14');
  await page.waitForFunction(()=>document.querySelector('#finder-caption').textContent.includes('14-day')&&document.querySelector('#finder-shell-status').textContent.includes('18:00 UTC'));
  await page.locator('.planning-calendar summary').click();
  assert(await page.locator('.finder-day').count()===150,'date calendar lost sites/dates');
  await page.locator('#finder-mode').selectOption('terrain');
  await page.waitForFunction(()=>document.querySelector('#finder-model-badge').textContent.includes('Loaded terrain horizons'));
  assert((await page.locator('#compare-model').textContent()).includes('Loaded terrain'),'comparison did not switch horizon');
  const [searchDownload]=await Promise.all([page.waitForEvent('download'),page.locator('#finder-export').click()]);
  const searchCSV=readFileSync(await searchDownload.path(),'utf8');
  assert(searchCSV.includes('T18:00:00Z')&&searchCSV.includes('delta_dual_pp')&&searchCSV.includes('data_source'),'CSV lost UTC, baseline or provenance');
  await page.locator('.planning-calendar summary').click();
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:'smoke-artifacts/planning.png',fullPage:true});
  const recommendation=page.locator('.finder-window-card').first();
  const chosenDate=await recommendation.getAttribute('data-date'),chosenSite=await recommendation.getAttribute('data-site');
  await recommendation.click();
  assert(new URL(page.url()).pathname==='/explore','recommendation did not open Explore');
  assert(await page.locator('#mission-time').inputValue()==='18:00','recommendation lost UTC');
  assert(await page.locator('#mission-date').inputValue()===chosenDate,'recommendation lost date');
  assert(await page.locator('#site-select').inputValue()===chosenSite,'recommendation lost site');
  assert(await page.locator('#duration .selected').getAttribute('data-days')==='14','recommendation lost duration');
  await checkCSV(page,'#download-csv');
  await page.goBack();
  assert(new URL(page.url()).pathname==='/planning','Back lost Plan Mission');
  await page.locator('#date-comparison summary').click();
  assert(await page.locator('#date-compare-table table').isVisible(),'date comparison missing');
  await page.locator('#date-compare-b').fill('2026-12-21');await page.locator('#date-compare-b').dispatchEvent('change');
  assert((await page.locator('#date-compare-table thead').textContent()).includes('2026-12-21'),'date comparison did not update');
  await page.locator('#compare-table .planning-site').first().click();
  assert(new URL(page.url()).pathname==='/explore','site header did not open Explore');
  await page.locator('a.nav-link[data-route="engineering"]').click();
  assert(await page.locator('#eng-charge-chart').isVisible(),'engineering hidden');
  await page.locator('a.nav-link[data-route="science"]').click();
  assert(await page.locator('#science-page').isVisible(),'science page missing');
  await page.reload({waitUntil:'domcontentloaded'});
  await completeWelcome(page);
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
  // near half the active mission window.
  const jumpTrack=await page.locator('#timeline-hit').boundingBox();
  await page.mouse.click(jumpTrack.x+jumpTrack.width*0.5,jumpTrack.y+jumpTrack.height/2);
  const clickedOffset=await readOffset();
  const halfWindow=Number(await page.locator('#duration .selected').getAttribute('data-days'))*12;
  assert(Math.abs(clickedOffset-halfWindow)<6,'click-to-jump no longer lands near the middle of the window');

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
  await page.locator('a.nav-link[data-route="planning"]').click();
  await checkCSV(page,'#finder-export');
  await page.locator('#transit summary').click();
  await page.locator('#transit-run').click();
  assert((await page.locator('#transit-results').textContent()).includes('Lunar arrival'),'transit results missing');
  await page.locator('#brief-btn').click();
  assert(await page.locator('#brief-content .report-grid').isVisible(),'briefing did not contain computed results');
  await page.pdf({path:'smoke-artifacts/mission-brief.pdf'});
  assert(readFileSync('smoke-artifacts/mission-brief.pdf').subarray(0,4).toString()==='%PDF','briefing PDF export failed');
  await page.locator('[data-close="brief-dialog"]').click();

  // Gemini assistant floats above the app, opens without an API key, and shows a friendly failure.
  // Local preview serves static files only; emulate Vercel's missing-key API response.
  // This validates the UI error path without contacting Gemini or requiring credentials.
  await page.route('**/api/chat',route=>route.fulfill({
    status:500,
    contentType:'application/json',
    body:JSON.stringify({error:'Gemini API key is not configured on the server (GEMINI_API_KEY).'})
  }));
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
  await checkPanorama(page);

  const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  await trackGPU(mobile);
  await trackPanorama(mobile);
  mobile.on('pageerror',err=>errors.push('mobile '+err.message));
  await offNetwork(mobile);
  await mobile.goto(host+'/explore?site=nobile&date=2026-11-14&days=7',{waitUntil:'domcontentloaded'});
  await mobile.locator('#onboarding-dialog[data-stage="graphics"]').waitFor();
  await mobile.screenshot({path:'smoke-artifacts/mobile-graphics.png'});
  await completeWelcome(mobile);
  await mobile.waitForFunction(()=>document.querySelector('#mission-verdict')?.textContent!=='Calculating…');
  const mobileNav=await mobile.locator('.main-nav').boundingBox();
  assert(mobileNav&&mobileNav.height>=40,'mobile navigation is not visible/tappable');
  const mobileLinks=await mobile.locator('.main-nav a.nav-link:visible').count();
  assert(mobileLinks>=4,'mobile header hides primary page navigation');
  const overflow=await mobile.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  assert(overflow<=8,'mobile page overflows horizontally by '+overflow+'px');
  await mobile.locator('a.nav-link[data-route="planning"]').click();
  assert(new URL(mobile.url()).pathname==='/planning','mobile finder navigation failed');
  assert(await mobile.locator('#finder').isVisible(),'finder not visible on mobile');
  await mobile.evaluate(()=>scrollTo(0,0));
  await mobile.screenshot({path:'smoke-artifacts/mobile-planning.png',fullPage:true});
  await mobile.locator('.finder-window-card').first().click();
  assert(new URL(mobile.url()).pathname==='/explore','mobile recommendation did not open Explore');
  await mobile.goBack();
  assert(new URL(mobile.url()).pathname==='/planning','mobile Back lost Plan Mission');
  await mobile.locator('a.nav-link[data-route="explore"]').click();
  await mobile.screenshot({path:'smoke-artifacts/mobile.png',fullPage:false});
  await checkPanorama(mobile,true);
  for(const route of ['planning','engineering','science','explore']){
    await mobile.locator('a.nav-link[data-route="'+route+'"]').click();
    const overflow=await mobile.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
    assert(overflow<=8,route+' mobile overflow: '+overflow);
  }
  const visitor=await browser.newPage({viewport:{width:1280,height:800}});
  visitor.on('pageerror',error=>errors.push(error.message));
  await offNetwork(visitor);
  await visitor.route('**/assets/*',route=>route.abort());
  await visitor.addInitScript(()=>{
    sessionStorage.setItem('lunarnav:intro:session:v1','1');
    localStorage.setItem('lunarnav:onboarding:complete:v1','1');
  });
  const arrival=Date.now();
  await visitor.goto(host+'/',{waitUntil:'domcontentloaded'});
  assert(await visitor.locator('#onboarding-dialog[data-stage="loading"]').isVisible(),'five-second loading screen missing');
  await visitor.mouse.click(5,5);
  assert(await visitor.locator('#onboarding-dialog').evaluate(el=>el.open),'loading backdrop click stranded the workspace');
  await visitor.screenshot({path:'smoke-artifacts/loading.png'});
  await visitor.locator('#onboarding-dialog[data-stage="graphics"]').waitFor();
  assert(Date.now()-arrival>=4900,'loading screen ended before five seconds');
  await visitor.screenshot({path:'smoke-artifacts/graphics.png'});
  await visitor.locator('input[name="startup-graphics"][value="10"]').check();
  await visitor.locator('#graphics-continue').click();
  assert((await visitor.locator('#relief-exaggeration').inputValue())==='10','high realistic preset did not set ×10 relief');
  assert((await visitor.locator('#tour-counter').textContent())==='01 / 10','tutorial did not start at step one');
  await checkTourStep(visitor,1,'explore');
  await visitor.screenshot({path:'smoke-artifacts/tutorial.png'});
  await visitor.locator('#tour-next').click();
  await visitor.locator('#tour-back').click();
  assert((await visitor.locator('#tour-counter').textContent())==='01 / 10','tutorial Back failed');
  const tourPages=['explore','explore','explore','explore','explore','explore','planning','planning','engineering','engineering'];
  for(let i=0;i<10;i++){
    await checkTourStep(visitor,i+1,tourPages[i]);
    if([2,6,9].includes(i))await visitor.screenshot({path:'smoke-artifacts/tutorial-desktop-'+(i+1)+'.png'});
    await visitor.locator('#tour-next').click();
  }
  assert(!await visitor.locator('#onboarding-dialog').evaluate(el=>el.open),'tutorial did not finish');
  assert(!await visitor.locator('#onboarding-dialog').isVisible(),'completed tour still covers the workspace');
  await visitor.reload({waitUntil:'domcontentloaded'});
  assert(await visitor.locator('#onboarding-dialog[data-stage="loading"]').isVisible(),'onboarding did not replay on reload');
  await completeWelcome(visitor);
  const imageFallback=visitor.locator('#map-image-status[data-imagery="fallback"]');
  await imageFallback.waitFor();
  assert((await imageFallback.textContent()).includes('Showing a simulated surface'),'fallback imagery was not disclosed');
  await visitor.locator('#planner-help').click();
  assert(await visitor.locator('#science-page').isVisible(),'optional help did not open Methods');
  await visitor.locator('#restart-tour').click();
  await visitor.keyboard.press('Escape');
  assert(await visitor.locator('#science-page').isVisible(),'skipping tutorial lost the original page');
  // Walk every spotlight at phone width and reflow the large globe step on resize.
  await mobile.locator('a.nav-link[data-route="science"]').click();
  const tourURL=mobile.url(),tourDate=await mobile.locator('#mission-date').inputValue();
  await mobile.locator('#restart-tour').click();
  for(let i=0;i<10;i++){
    await checkTourStep(mobile,i+1,tourPages[i]);
    if(i===2){
      await mobile.setViewportSize({width:360,height:640});await checkTourStep(mobile,3,'explore');
      await mobile.screenshot({path:'smoke-artifacts/tutorial-mobile-short.png'});
      await mobile.setViewportSize({width:390,height:844});await checkTourStep(mobile,3,'explore');
    }
    if([0,6,9].includes(i))await mobile.screenshot({path:'smoke-artifacts/tutorial-mobile-'+(i+1)+'.png'});
    await mobile.locator('#tour-next').click();
  }
  assert(await mobile.locator('#science-page').isVisible()&&mobile.url()===tourURL,'tour changed the return page/history');
  assert(await mobile.locator('#mission-date').inputValue()===tourDate,'tour changed mission inputs');
  assert(await mobile.locator('.tour-target').count()===0,'tour left a stale highlight');
  // Both replaced URLs keep existing bookmarks usable and run the entry flow.
  for(const legacy of ['/windows','/compare']){
    await visitor.goto(host+legacy+'?site=nobile&date=2026-11-14&days=28',{waitUntil:'domcontentloaded'});
    await completeWelcome(visitor);
    assert(await visitor.locator('[data-view="planning"]').isVisible(),'legacy link did not reach Plan Mission');
    assert(await visitor.locator('#finder-duration').inputValue()==='28','legacy link lost the mission duration');
  }

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
  await completeWelcome(terrainPage);
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

  // Leave the production loader and renderer modules intact. Block only the
  // surface canvas WebGL context so the real DEM samples drive the 2D skyline.
  const fallback=await browser.newPage({viewport:{width:1024,height:768},reducedMotion:'reduce'});
  fallback.on('pageerror',error=>errors.push('panorama fallback '+error.message));
  await trackPanorama(fallback,{fallback:true});
  await offNetwork(fallback);
  await fallback.goto(host+'/explore',{waitUntil:'domcontentloaded'});
  await completeWelcome(fallback);
  await openPanorama(fallback);
  const skyline=await fallback.evaluate(()=>panoramaProbe.skyline);
  assert(skyline?.length>10&&new Set(skyline).size>3,'the 2D panorama did not render a varying DEM skyline');
  await closePanorama(fallback);
  await fallback.close();

  const {size:polarGridSize}=JSON.parse(readFileSync('dist/data/relief.json','utf8'));
  const metrics={};
  for(const [name,target,limit] of [['desktop',page,4096],['mobile',mobile,2048]]){
    const uploads=await target.evaluate(()=>gpuUploads);
    assert(uploads.every(u=>u.error===0),name+' WebGL upload error');
    const globeTextures=uploads.filter(u=>u.canvas==='moon-globe'&&u.bytes===null);
    assert(globeTextures.length>0&&globeTextures.every(u=>u.width<=limit&&u.height<=limit),name+' globe exceeded texture budget');
    const surfaceTextures=uploads.filter(u=>u.canvas==='panorama-canvas'&&u.bytes===null);
    assert(surfaceTextures.length===1&&surfaceTextures[0].width===polarGridSize&&surfaceTextures[0].height===polarGridSize,
      name+' surface panorama did not upload its single full-resolution polar grid');
    metrics[name]=await target.evaluate(()=>({uploads:gpuUploads,jsHeapBytes:performance.memory?.usedJSHeapSize||null}));
  }
  writeFileSync('smoke-artifacts/render-metrics.json',JSON.stringify(metrics,null,2));
  assert(errors.length===0,'uncaught JavaScript errors: '+errors.join(' | '));
  console.log('Browser smoke PASS: four pages, shared planning inputs, recommendations, date comparison, transit, direct URLs, back/forward, desktop/mobile, science refresh, globe, real terrain panoramas, terrain Finder and exports.');
}catch(error){
  console.error('Browser smoke FAIL:',error.message);
  if(errors.length)console.error('JavaScript errors:',errors.join(' | '));
  process.exitCode=1;
}finally{
  if(browser)await browser.close();
  server.kill();
}
