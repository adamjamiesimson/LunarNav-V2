import test from 'node:test';
import assert from 'node:assert/strict';
import {selectSafeLolaSource,LOLA_COG} from '../src/terrain.js';
const before=globalThis.fetch;
const reply=status=>({status,body:{cancel:async()=>{}},ok:status>=200&&status<300});
test('same-origin COG is preferred only when range response is 206',async()=>{
 let called=[];
 globalThis.fetch=async(url,options)=>{called.push({url,range:options.headers.Range});return reply(206);};
 try{
   assert.equal(await selectSafeLolaSource(),'/assets/lola-80m.tif');
   assert.deepEqual(called,[{url:'/assets/lola-80m.tif',range:'bytes=0-63'}]);
 }finally{globalThis.fetch=before;}
});
test('when Vercel rewrite ignores Range, prefer direct NASA URL with valid partial content',async()=>{
 globalThis.fetch=async url=>reply(url.startsWith('/assets/')?200:206);
 try{assert.equal(await selectSafeLolaSource(),LOLA_COG);}
 finally{globalThis.fetch=before;}
});
test('rejects servers returning full 181 MB content instead of 206',async()=>{
 globalThis.fetch=async()=>reply(200);
 try{await assert.rejects(()=>selectSafeLolaSource(),/requires 206 Partial Content/);}
 finally{globalThis.fetch=before;}
});
test('remote unavailable or denied remains an explicit failure, not fabricated terrain',async()=>{
 globalThis.fetch=async()=>{throw Error('CORS unavailable');};
 try{await assert.rejects(()=>selectSafeLolaSource(),/CORS unavailable/);}
 finally{globalThis.fetch=before;}
});
