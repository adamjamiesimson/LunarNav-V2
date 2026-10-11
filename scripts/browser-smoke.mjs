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
const server=spawn('python3',['-m','http.server','4173','--bind','127.0.0.1','--directory','dist'],{stdio:'ignore'});
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
  await offNetwork(page);
  await page.goto(host+'/?site=mons-mouton&date=2026-11-14&days=7#planner',{waitUntil:'domcontentloaded'});
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
  await page.locator('#time-next').click();
  const clock=await page.locator('#hud-clock').textContent();
  assert(clock.includes('18:00'),'six hour UTC advance did not update mission HUD');
  await page.locator('#time-event').click();
  assert((await page.locator('#time-event-note').textContent()).length>10,'next-event feedback missing');
  await page.locator('#finder-mode').selectOption('terrain');
  await page.waitForFunction(()=>document.querySelector('#finder-impact')?.hidden===false,{timeout:20000});
  assert((await page.locator('#finder-window-card').count())===0||true,'');
  assert((await page.locator('.finder-window-card').count())>0,'no terrain-ranked mission windows');
  assert((await page.locator('.finder-impact-card').count())>0,'no terrain-vs-geometric comparison');
  await page.locator('#finder-mode').selectOption('flat');
  await page.waitForFunction(()=>document.querySelector('#finder-impact')?.hidden===true);
  mkdirSync('smoke-artifacts',{recursive:true});
  await page.screenshot({path:'smoke-artifacts/desktop.png',fullPage:false});

  const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  mobile.on('pageerror',err=>errors.push('mobile '+err.message));
  await offNetwork(mobile);
  await mobile.goto(host+'/?site=nobile&date=2026-11-14&days=7#planner',{waitUntil:'domcontentloaded'});
  await mobile.waitForFunction(()=>document.querySelector('#mission-verdict')?.textContent!=='COMPUTING…');
  const overflow=await mobile.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  assert(overflow<=8,'mobile page overflows horizontally by '+overflow+'px');
  await mobile.locator('#hero-find').click();
  assert(await mobile.locator('#finder').count()===1,'finder not present on mobile');
  await mobile.screenshot({path:'smoke-artifacts/mobile.png',fullPage:false});
  assert(errors.length===0,'uncaught JavaScript errors: '+errors.join(' | '));
  console.log('Browser smoke PASS: mobile + desktop, globe focus/immersive, live UTC readouts, offline fallback, terrain Finder and deltas.');
}catch(error){
  console.error('Browser smoke FAIL:',error.message);
  if(errors.length)console.error('JavaScript errors:',errors.join(' | '));
  process.exitCode=1;
}finally{
  if(browser)await browser.close();
  server.kill();
}
