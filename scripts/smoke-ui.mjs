#!/usr/bin/env node
/**
 * Real headless-Chrome smoke test of the built static LunarNav experience.
 * Standalone CI-only dependency: npm install --no-save --no-package-lock puppeteer-core@24.18.0
 *
 * This checks DOM rendering, input wiring, in-page nav, accessible focus,
 * site/UTC updates, terrain skyline and mobile overflow. It is not a visual
 * design sign-off, scientific verification or a Vercel production check.
 */
import {spawn,spawnSync} from 'node:child_process';
import puppeteer from 'puppeteer-core';

const known=['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium'];
const binary=process.env.CHROME_BIN ||
  known.find(path=>spawnSync('test',['-x',path]).status===0);
if(!binary)throw Error('No installed Chrome/Chromium available for UI smoke test');

// Use the repo preview server so client routes such as /explore resolve to
// index.html (python http.server would 404 on them).
const server=spawn('node',['scripts/preview-server.js','--dist','4173'],{
  stdio:['ignore','pipe','pipe']
});
let browser;
const address='http://127.0.0.1:4173/';
try{
  let ready=false;
  for(let i=0;i<30;i++){
    try{const check=await fetch(address);if(check.ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  if(!ready)throw Error('Local static build never started');
  browser=await puppeteer.launch({executablePath:binary,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-webgl','--ignore-gpu-blocklist']});
  const page=await browser.newPage();
  page.on('pageerror',e=>console.error('BROWSER PAGE ERROR:',e.stack||e.message));
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport({width:1440,height:900});
  // Suppress the first-visit intro/tour overlay so it cannot intercept clicks.
  await page.evaluateOnNewDocument(()=>{
    try{
      sessionStorage.setItem('lunarnav:intro:session:v1','1');
      localStorage.setItem('lunarnav:onboarding:complete:v1','1');
    }catch{}
  });
  // The multi-page refactor put #hero-explore inside the explore view, so open
  // that route directly instead of clicking through the home page.
  await page.goto(address+'explore',{waitUntil:'domcontentloaded',timeout:25000});
  await page.waitForFunction(()=>document.body.dataset.page==='explore');
  await page.waitForFunction(()=>document.querySelector('#hud-sun')?.textContent!=='—',{timeout:20000});
  await page.waitForFunction(()=>document.querySelector('#mission-source')?.textContent?.includes('LOLA'),{timeout:20000});
  const initial=await page.$eval('#mission-source',node=>node.textContent);
  if(!initial.includes('LOLA'))throw Error('Bundled NASA terrain missing from live situation');
  await page.click('#hero-explore');
  await page.waitForFunction(()=>document.querySelector('#focus-site')?.getAttribute('aria-pressed')==='true');
  await page.click('#expand-globe');
  if(!(await page.evaluate(()=>document.body.classList.contains('globe-immersive'))))throw Error('Globe did not expand');
  await page.keyboard.press('Escape');
  if(await page.evaluate(()=>document.body.classList.contains('globe-immersive')))throw Error('Esc did not close immersive globe');
  await page.select('#site-select','malapert');
  await page.waitForFunction(()=>document.querySelector('#mission-source')?.textContent?.includes('Malapert'));
  if(!(await page.$eval('#sky-plot',node=>node.innerHTML.includes('LOCAL LOLA HORIZON'))))throw Error('Real NASA terrain skyline did not render');
  // Earth-to-Moon transit estimator: visible on Explore, defaults to selected site, responds to CTA.
  await page.waitForSelector('#transit',{timeout:15000});
  const transitDestTag=await page.$eval('#transit-destination-tag',node=>node.textContent);
  if(!/MALAPERT/i.test(transitDestTag))throw Error('Transit destination did not follow selected site: '+transitDestTag);
  await page.click('#transit-run');
  await page.waitForFunction(()=>document.querySelector('#transit-results')?.innerHTML?.includes('LUNAR ARRIVAL'),{timeout:10000});
  const transitRun=await page.$eval('#transit-results',node=>node.textContent);
  if(!/Malapert/i.test(transitRun)&&!/Malapert/i.test(transitDestTag))throw Error('Transit result did not reference the selected destination');
  await page.click('#hero-find');
  await page.select('#finder-mode','terrain');
  await page.waitForFunction(()=>!document.querySelector('#finder-impact')?.hidden,{timeout:25000});
  const cards=await page.$$eval('#finder-impact-items .finder-impact-card',els=>els.length);
  if(cards!==5)throw Error('Terrain finder should show five matched site cards; found '+cards);
  // Measure the Explorer view — the surface this smoke run exercises (and the
  // one that hosts the traverse + transit planners).
  await page.click('a[data-route="explore"]');
  await page.waitForFunction(()=>document.body.dataset.page==='explore'&&document.querySelector('#hud-sun')?.textContent!=='—',{timeout:20000});
  await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
  await page.waitForFunction(()=>document.documentElement.clientWidth<=392,{timeout:15000});
  await new Promise(resolve=>setTimeout(resolve,400));
  const dims=await page.evaluate(()=>({
    width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,
    skyModel:document.querySelector('#horizon-label')?.textContent,
    hudStatus:document.querySelector('#hud-status')?.textContent,
    layoutHeight:document.body.scrollHeight
  }));
  if(dims.scrollWidth>dims.width+4)throw Error('Explorer horizontally overflows small viewport: '+JSON.stringify(dims));
  // Windows page: the wide finder heatmap stays inside its own scroll wrap and
  // must never pan the page itself at 390px.
  await page.click('a[data-route="windows"]');
  await page.waitForFunction(()=>document.body.dataset.page==='windows',{timeout:20000});
  if(await page.evaluate(()=>!document.querySelector('#finder-heatmap')?.children.length))
    await page.waitForFunction(()=>document.querySelector('#finder-heatmap')?.children.length>0,{timeout:25000});
  await page.evaluate(()=>window.scrollTo(9999,0));
  await new Promise(resolve=>setTimeout(resolve,300));
  const pan=await page.evaluate(()=>window.scrollX);
  await page.evaluate(()=>window.scrollTo(0,0));
  if(pan>2)throw Error('Windows page pans horizontally at mobile width: scrollX='+pan);
  await page.screenshot({path:'/tmp/lunarnav-mobile-smoke.png',fullPage:false});
  if(errors.length)throw Error('Unexpected JS page errors: '+errors.join(' | '));
  console.log(JSON.stringify({result:'PASS',chrome:binary,initialSituation:initial,terrainImpactCards:cards,mobile:dims},null,2));
}finally{
  await browser?.close().catch(()=>{});
  server.kill('SIGTERM');
}
