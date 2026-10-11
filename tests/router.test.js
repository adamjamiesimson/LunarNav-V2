import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PAGE_ROUTES,PAGE_TITLES,routeFromURL,buildPageURL} from '../src/router.js';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const config=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
test('six distinct routes point to a single, routed interface',()=>{
 assert.deepEqual(Object.keys(PAGE_ROUTES),['home','explore','windows','engineering','compare','science']);
 for(const [page,path] of Object.entries(PAGE_ROUTES)){
   assert.equal(routeFromURL(path),page);
   assert.ok(PAGE_TITLES[page]);
   assert.ok(html.includes('data-view="'+page+'"'));
   assert.ok(html.includes('href="'+path+'"'));
 }
});
test('legacy links remain compatible without flattening old bookmarks',()=>{
 for(const [url,hash,expected] of [
   ['/','#planner','explore'],['/','#finder','windows'],['/','#compare','compare'],
   ['/','#engineering','engineering'],['/planner','','explore'],
   ['/finder','','windows'],['/methodology','','science'],['/index.html','#finder','windows']
 ])assert.equal(routeFromURL(url,hash),expected);
 assert.equal(routeFromURL('/unknown'), 'home');
});
test('Vercel supports direct reloads and deep links without breaking asset rewrites',()=>{
 const known=new Map(config.rewrites.map(r=>[r.source,r.destination]));
 for(const path of ['/explore','/windows','/engineering','/compare','/science','/planner','/finder','/methodology'])
   assert.equal(known.get(path),'/index.html','Missing direct URL rewrite for '+path);
 assert.match(html,/href="\/src\/styles\.css"/);
 assert.match(html,/src="\/src\/app\.js"/);
 assert.ok(known.get('/assets/lroc-color.jpg').includes('svs.gsfc.nasa.gov'));
 assert.ok(known.get('/assets/lola-80m.tif').includes('pgda.gsfc.nasa.gov'));
});
test('page query builder retains shareable site/date/duration settings',()=>{
 assert.equal(buildPageURL('windows','site=nobile&date=2026-11-14&days=7'),
   '/windows?site=nobile&date=2026-11-14&days=7');
 assert.equal(buildPageURL('home'),'/');
 assert.throws(()=>buildPageURL('unsupported'),/Unknown LunarNav page/);
});
test('one-view-at-a-time page structure includes every existing analytical module',()=>{
 assert.equal((html.match(/data-view="/g)||[]).length,6);
 assert.ok(html.includes('id="moon-map"'));
 assert.ok(html.includes('id="finder-heatmap"'));
 assert.ok(html.includes('id="eng-charge-chart"'));
 assert.ok(html.includes('id="site-comparison"'));
 assert.ok(html.includes('id="method-dialog"'));
 assert.ok(html.includes('id="science-page"'));
});
