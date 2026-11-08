import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// App boot + navigation smoke in the declared jsdom test dependency.
// This verifies the module actually evaluates and the router responds — the
// class of regression source-text assertions cannot catch.
import {JSDOM} from 'jsdom';

test('app.js boots against the real index.html and navigation works',async t=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const dom=new JSDOM(html,{url:'http://localhost/',pretendToBeVisual:true});
  const {window}=dom;
  t.after(()=>window.close());
  const errors=[];
  window.addEventListener('error',e=>errors.push(e.message));
  for(const k of ['document','history','sessionStorage','localStorage','navigator','Node','Element','HTMLElement','SVGElement','Event','MouseEvent','KeyboardEvent','DOMParser','Option','getComputedStyle'])
    try{Object.defineProperty(globalThis,k,{value:window[k],configurable:true,writable:true});}catch{}
  Object.defineProperty(globalThis,'location',{value:window.location,configurable:true});
  globalThis.window=window;
  const ctxStub=new Proxy({},{get:(t,p)=>p==='canvas'?{}:(typeof p==='string'&&p.startsWith('create')?()=>({addColorStop(){}}):()=>undefined),set:()=>true});
  // Minimal fake WebGL so the real globe init path executes (the 2D fallback
  // would mask WebGL-path boot errors).
  const glStub=new Proxy({},{
    get:(t,p)=>{
      if(p==='getShaderParameter'||p==='getProgramParameter')return ()=>true;
      if(p==='getUniformLocation')return ()=>({});
      if(p==='getAttribLocation')return ()=>0;
      if(p==='getShaderInfoLog'||p==='getProgramInfoLog')return ()=>'';
      if(typeof p==='string'&&p.toUpperCase()===p)return 1; // GL constants
      return ()=>undefined;
    },
    set:()=>true
  });
  window.HTMLCanvasElement.prototype.getContext=function(type){return type==='2d'?ctxStub:type==='webgl'?glStub:null;};
  globalThis.Image=window.Image=class{constructor(){this.width=1;this.height=1;}
    set src(v){setTimeout(()=>this.onload&&this.onload(),0);}};
  globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
  globalThis.devicePixelRatio=1;window.devicePixelRatio=1;
  globalThis.requestAnimationFrame=cb=>setTimeout(()=>cb(Date.now()),0);
  globalThis.cancelAnimationFrame=id=>clearTimeout(id);
  window.requestAnimationFrame=globalThis.requestAnimationFrame;
  window.cancelAnimationFrame=globalThis.cancelAnimationFrame;
  window.scrollTo=()=>{};
  const objectURL={createObjectURL:()=> 'blob:test',revokeObjectURL:()=>{}};
  globalThis.URL.createObjectURL=objectURL.createObjectURL;
  globalThis.URL.revokeObjectURL=objectURL.revokeObjectURL;
  window.URL.createObjectURL=objectURL.createObjectURL;
  window.URL.revokeObjectURL=objectURL.revokeObjectURL;
  window.HTMLAnchorElement.prototype.click=function(){};

  await import('../src/app.js?boot='+Math.random());
  const $=s=>window.document.querySelector(s);
  assert.ok($('#app'),'app shell rendered');
  assert.ok(errors.length===0,'no runtime errors during boot: '+errors.join(' | '));

  // Navigation: every nav link must reveal its own view.
  for(const route of ['explore','planning','engineering','science']){
    window.document.querySelector(`a.nav-link[data-route="${route}"]`)
      .dispatchEvent(new window.MouseEvent('click',{bubbles:true,cancelable:true,button:0}));
    await new Promise(r=>setTimeout(r,20));
    assert.equal(window.document.body.dataset.page,route,'nav reached '+route);
    assert.ok(!window.document.querySelector(`[data-view="${route}"]`).hidden,route+' view is visible');
  }
});

test('navigation survives even when the globe fails to initialise',async t=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const dom=new JSDOM(html,{url:'http://localhost/',pretendToBeVisual:true});
  const {window}=dom;
  t.after(()=>window.close());
  for(const k of ['document','history','sessionStorage','localStorage','navigator','Node','Element','HTMLElement','SVGElement','Event','MouseEvent','KeyboardEvent','DOMParser','Option','getComputedStyle'])
    try{Object.defineProperty(globalThis,k,{value:window[k],configurable:true,writable:true});}catch{}
  Object.defineProperty(globalThis,'location',{value:window.location,configurable:true});
  globalThis.window=window;
  // Globe init throws hard — the app must still boot and navigate.
  window.HTMLCanvasElement.prototype.getContext=function(){throw Error('WebGL unavailable');};
  globalThis.Image=window.Image=class{set src(v){setTimeout(()=>this.onload&&this.onload(),0);}};
  globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
  globalThis.devicePixelRatio=1;
  globalThis.requestAnimationFrame=cb=>setTimeout(()=>cb(Date.now()),0);
  globalThis.cancelAnimationFrame=id=>clearTimeout(id);
  window.scrollTo=()=>{};
  const objectURL={createObjectURL:()=> 'blob:test',revokeObjectURL:()=>{}};
  globalThis.URL.createObjectURL=objectURL.createObjectURL;
  globalThis.URL.revokeObjectURL=objectURL.revokeObjectURL;
  window.HTMLAnchorElement.prototype.click=function(){};

  await import('../src/app.js?boot='+Math.random());
  const link=window.document.querySelector('a.nav-link[data-route="explore"]');
  link.dispatchEvent(new window.MouseEvent('click',{bubbles:true,cancelable:true,button:0}));
  await new Promise(r=>setTimeout(r,20));
  assert.equal(window.document.body.dataset.page,'explore','navigation works despite globe failure');
});
