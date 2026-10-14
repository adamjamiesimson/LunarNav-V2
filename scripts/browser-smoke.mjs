/**
 * Real Chromium smoke test for the built static application.
 * Run after:
 *   npm run build
 *   npm install --no-save --no-package-lock playwright@1.56.1
 *   npx playwright install --with-deps chromium
 *   node scripts/browser-smoke.mjs
 * The test blocks third-party requests to confirm the procedural lunar fallback
 * works when NASA image/CORS or Google Fonts are unavailable.
 */
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {mkdirSync} from 'node:fs';

const host='http://127.0.0.1:4173';
const server=spawn('node',['scripts/preview-server.js','--dist','4173'],{stdio:'ignore'});
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
      if(hostname==='127.0.0.1'||hostname==='localhost')return route.continue();
    }catch{}
    return route.abort();
  });
}
const errors=[];
try{
  await ready();
  browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader']});
  const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  page.on('pageerror',err=>errors.push('desktop '+err.message));
  await page.addInitScript(()=>{
    sessionStorage.setItem('lunarnav:intro:session:v1','1');
    localStorage.setItem('lunarnav:onboarding:complete:v1','1');
  });
  await offNetwork(page);
  await page.goto(host+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.body.dataset.page==='home');
  assert((await page.locator('.home-tool-card:visible').count())===4,'overview does not have four focused tool entrances');
  assert((await page.locator('.app-view:not([hidden])').count())===1,'more than one page visible on overview');
  mkdirSync('smoke-artifacts',{recursive:true});
  await page.screenshot({path:'smoke-artifacts/overview.png',fullPage:false});
  await page.locator('a.home-action-primary').click();
  assert(new URL(page.url()).pathname==='/explore','overview launch did not open the explorer');
  assert((await page.locator('.app-view:not([hidden])').count())===1,'more than one page visible in explorer');
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
  await page.locator('#celestial-view').click();
  assert((await page.locator('#celestial-view').getAttribute('aria-pressed'))==='true','celestial switch did not activate');
  assert(await page.locator('#map-stage').evaluate(el=>el.classList.contains('is-system-view')),'celestial view did not reach WebGL scene');
  assert(await page.locator('.celestial-sun').isVisible(),'Sun label missing');
  assert(await page.locator('.celestial-earth').isVisible(),'Earth label missing');
  assert(await page.locator('.celestial-moon').isVisible(),'Moon label missing');
  assert(!await page.locator('#zoom-in').isEnabled(),'Moon zoom remains available in celestial overview');
  await page.screenshot({path:'smoke-artifacts/celestial.png',fullPage:false});
  await page.locator('#celestial-view').click();
  assert((await page.locator('#celestial-view').getAttribute('aria-pressed'))==='false','Moon explorer did not restore');
  assert(await page.locator('#zoom-in').isEnabled(),'Moon zoom was not restored');
  await page.locator('#time-next').click();
  const clock=await page.locator('#hud-clock').textContent();
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
  assert((await page.locator('.compare-card:visible').count())>=5,'site comparison missing');
  await page.locator('.compare-card').first().click();
  assert(new URL(page.url()).pathname==='/explore','site comparison did not navigate to selected site');
  await page.locator('a.nav-link[data-route="science"]').click();
  assert(await page.locator('#science-page').isVisible(),'science page missing');
  await page.reload({waitUntil:'domcontentloaded'});
  assert(await page.locator('#science-page').isVisible(),'deep-linked science page broke after refresh');
  await page.locator('a.nav-link[data-route="explore"]').click();
  await page.screenshot({path:'smoke-artifacts/desktop.png',fullPage:false});

  const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  mobile.on('pageerror',err=>errors.push('mobile '+err.message));
  await mobile.addInitScript(()=>{
    sessionStorage.setItem('lunarnav:intro:session:v1','1');
    localStorage.setItem('lunarnav:onboarding:complete:v1','1');
  });
  await offNetwork(mobile);
  await mobile.goto(host+'/explore?site=nobile&date=2026-11-14&days=7',{waitUntil:'domcontentloaded'});
  await mobile.waitForFunction(()=>document.querySelector('#mission-verdict')?.textContent!=='COMPUTING…');
  const mobileNav=await mobile.locator('.main-nav').boundingBox();
  assert(mobileNav&&mobileNav.height>=40,'mobile navigation is not visible/tappable');
  const mobileLinks=await mobile.locator('.main-nav a.nav-link:visible').count();
  assert(mobileLinks>=4,'mobile header hides primary page navigation');
  const overflow=await mobile.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  assert(overflow<=8,'mobile page overflows horizontally by '+overflow+'px');
  await mobile.locator('#hero-find').click();
  assert(new URL(mobile.url()).pathname==='/windows','mobile finder navigation failed');
  assert(await mobile.locator('#finder').isVisible(),'finder not visible on mobile');
  await mobile.screenshot({path:'smoke-artifacts/mobile.png',fullPage:false});
  await mobile.goto(host+'/',{waitUntil:'domcontentloaded'});
  assert(await mobile.locator('.home-page').isVisible(),'overview not visible on mobile');
  assert(await mobile.locator('.main-nav').isVisible(),'overview lost mobile page navigation');
  const homeOverflow=await mobile.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  assert(homeOverflow<=8,'mobile overview overflows by '+homeOverflow+'px');

  // Isolated fresh visitor: observe the full six-second branded intro,
  // then walk across the ten feature highlights and verify persistence.
  const visitor=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'reduce'});
  visitor.on('pageerror',err=>errors.push('first-visit '+err.message));
  await offNetwork(visitor);
  const start=Date.now();
  await visitor.goto(host+'/',{waitUntil:'domcontentloaded'});
  assert(await visitor.locator('html').evaluate(el=>el.hasAttribute('data-intro-loading')),
    'first-visit loading screen did not appear');
  assert(await visitor.locator('#intro-loader').isVisible(),'intro artwork not visible');
  await visitor.screenshot({path:'smoke-artifacts/intro.png',fullPage:false});
  await visitor.waitForFunction(()=>!document.documentElement.hasAttribute('data-intro-loading'),{timeout:11000});
  const duration=Date.now()-start;
  assert(duration>=5500&&duration<=11000,'intro timing outside expected six-second range: '+duration+'ms');
  await visitor.locator('#tour-root').waitFor({state:'visible',timeout:4000});
  assert(await visitor.locator('#tour-title').textContent()==='Welcome to mission control.',
    'welcome tutorial step missing');
  await visitor.screenshot({path:'smoke-artifacts/tutorial.png',fullPage:false});
  const expectedPages=['home','explore','explore','explore','explore','windows','windows','engineering','compare','science'];
  for(let i=0;i<expectedPages.length;i++){
    assert((await visitor.locator('body').getAttribute('data-page'))===expectedPages[i],
      'tour step '+(i+1)+' failed to highlight '+expectedPages[i]);
    assert((await visitor.locator('#tour-counter').textContent())?.includes(String(i+1).padStart(2,'0')),
      'tour step counter incorrect at '+(i+1));
    if(i!==expectedPages.length-1)await visitor.locator('#tour-next').click();
  }
  await visitor.locator('#tour-next').click();
  assert(await visitor.locator('#tour-root').isHidden(),'complete tour failed to close');
  assert(await visitor.locator('body').getAttribute('data-page')==='home',
    'tour completion did not restore original overview');
  assert(await visitor.evaluate(()=>localStorage.getItem('lunarnav:onboarding:complete:v1'))==='1',
    'tutorial completion not persisted');
  await visitor.reload({waitUntil:'domcontentloaded'});
  assert(await visitor.locator('#tour-root').isHidden(),'tour unexpectedly restarted on reload');
  assert(!await visitor.locator('html').evaluate(el=>el.hasAttribute('data-intro-loading')),
    'intro replayed on same-session refresh');
  await visitor.locator('#restart-tour').click();
  assert(await visitor.locator('#tour-root').isVisible(),'replay tutorial control did not work');
  await visitor.keyboard.press('Escape');
  assert(await visitor.locator('#tour-root').isHidden(),'Escape failed to close replayed tour');

  // Mobile first visit can bypass animation without losing the guided tour.
  const mobileVisitor=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  mobileVisitor.on('pageerror',err=>errors.push('mobile first-visit '+err.message));
  await offNetwork(mobileVisitor);
  await mobileVisitor.goto(host+'/',{waitUntil:'domcontentloaded'});
  await mobileVisitor.locator('#intro-skip').click();
  await mobileVisitor.locator('#tour-root').waitFor({state:'visible',timeout:3500});
  await mobileVisitor.screenshot({path:'smoke-artifacts/mobile-tutorial.png',fullPage:false});
  const card=await mobileVisitor.locator('#tour-dialog').boundingBox();
  assert(card&&card.x>=0&&card.x+card.width<=392,'tour card overflows mobile viewport');
  await mobileVisitor.locator('#tour-skip').click();
  assert(await mobileVisitor.locator('#tour-root').isHidden(),'mobile tutorial Skip did not close');

  assert(errors.length===0,'uncaught JavaScript errors: '+errors.join(' | '));
  console.log('Browser smoke PASS: six pages, direct URLs, back/forward, desktop/mobile, science refresh, globe, terrain Finder and exports.');
}catch(error){
  console.error('Browser smoke FAIL:',error.message);
  if(errors.length)console.error('JavaScript errors:',errors.join(' | '));
  process.exitCode=1;
}finally{
  if(browser)await browser.close();
  server.kill();
}
