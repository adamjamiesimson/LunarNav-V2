/**
 * Minimal local preview server with the same page-entry fallback as Vercel.
 * Source files are served in development; compiled /dist in browser smoke.
 * Usage: node scripts/preview-server.js [--dist] [port]
 */
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {resolve,join,sep,extname} from 'node:path';
const root=resolve(process.argv.includes('--dist')?'dist':'.');
const port=Number(process.argv.find(x=>/^\d{3,5}$/.test(x))||4173);
const pages=new Set(['/','/index.html','/explore','/planning','/windows','/engineering','/compare','/science','/planner','/finder','/methodology']);
// Same-origin proxies as vercel.json, for assets that upstream hosts serve
// without CORS headers. A local copy of the file always wins over the proxy.
// Range requests are forwarded so cloud-optimized DEMs can be read in parts.
const remoteAssets={
  '/assets/lroc-color.jpg':'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg',
  '/assets/bluemarble-1024.png':'https://svs.gsfc.nasa.gov/vis/a000000/a002900/a002915/bluemarble-1024.png',
  '/assets/lola-80m.tif':'https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF',
  '/assets/lola-60s-60m.tif':'https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_60S_60MPP_ADJ.TIF',
  '/assets/sldem.img':'https://imbrium.mit.edu/DATA/SLDEM2015/GLOBAL/FLOAT_IMG/SLDEM2015_128_60S_60N_000_360_FLOAT.IMG'
};
const contentTypes={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png'};
const server=createServer(async(req,res)=>{
 try{
   if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
   const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
   const file=pages.has(pathname)?'/index.html':pathname;
   const full=resolve(root,'.'+file);
   if(!full.startsWith(root+sep)&&full!==root)throw Error('Invalid path');
   const info=await stat(full);
   if(!info.isFile())throw Error('Not found');
   if(/\.(img|tif)$/i.test(full)){
     const range=/^bytes=(\d+)-(\d+)$/.exec(req.headers.range||'');
     const start=Number(range?.[1]),end=Number(range?.[2]);
     if(!range||end<start||end>=info.size||end-start+1>1024*1024){
       res.writeHead(416,{'Content-Range':'bytes */'+info.size});res.end();return;
     }
     res.writeHead(206,{'Content-Type':'application/octet-stream','Accept-Ranges':'bytes',
       'Content-Range':'bytes '+start+'-'+end+'/'+info.size,'Content-Length':end-start+1});
     if(req.method==='HEAD')res.end();
     else createReadStream(full,{start,end}).on('error',()=>res.destroy()).pipe(res);
     return;
   }
   const body=await readFile(full);
   res.writeHead(200,{'Content-Type':contentTypes[extname(full)]||'application/octet-stream',
      'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
   res.end(req.method==='HEAD'?undefined:body);
 }catch{
   const pathname=new URL(req.url,'http://localhost').pathname;
   const remote=remoteAssets[pathname];
   if(remote){
     try{
       const headers={};
       const dem=/\.(img|tif)$/.test(pathname);
       const range=/^bytes=(\d+)-(\d+)$/.exec(req.headers.range||'');
       if(dem&&(!range||Number(range[2])-Number(range[1])+1>1024*1024)){
         res.writeHead(416);res.end('DEM access requires a range of at most 1 MiB');return;
       }
       if(req.headers.range)headers.Range=req.headers.range;
       const upstream=await fetch(remote,{headers,signal:AbortSignal.timeout(20000)});
       const limit=dem?Number(range[2])-Number(range[1])+1:16*1024*1024;
       if(dem&&(upstream.status!==206||!upstream.headers.get('content-range')?.startsWith('bytes '+range[1]+'-'+range[2]+'/'))){
         await upstream.body?.cancel();throw Error('Upstream ignored DEM range');
       }
       if(upstream.ok){
         const out={'Content-Type':contentTypes[extname(pathname)]||'application/octet-stream','Cache-Control':'no-cache'};
         if(upstream.headers.get('content-range'))out['Content-Range']=upstream.headers.get('content-range');
         if(upstream.headers.get('accept-ranges'))out['Accept-Ranges']=upstream.headers.get('accept-ranges');
         const chunks=[];let size=0;
         for await(const chunk of upstream.body){
           size+=chunk.length;
           if(size>limit)throw Error('Upstream response exceeds requested size');
           chunks.push(chunk);
         }
         if(dem&&size!==limit)throw Error('Truncated upstream DEM range');
         out['Content-Length']=size;
         res.writeHead(upstream.status,out);
         res.end(req.method==='HEAD'?undefined:Buffer.concat(chunks));
         return;
       }
     }catch{/* Upstream unreachable: fall through to the client-side fallback. */}
   }
   res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');
 }
});
server.listen(port,'127.0.0.1',()=>console.log('LunarNav preview at http://127.0.0.1:'+port+' ('+root+')'));
