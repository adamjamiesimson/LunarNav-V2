/**
 * Minimal local preview server with the same page-entry fallback as Vercel.
 * Source files are served in development; compiled /dist in browser smoke.
 * Usage: node scripts/preview-server.js [--dist] [port]
 */
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,join,sep,extname} from 'node:path';
const root=resolve(process.argv.includes('--dist')?'dist':'.');
const port=Number(process.argv.find(x=>/^\d{3,5}$/.test(x))||4173);
const pages=new Set(['/','/index.html','/explore','/windows','/engineering','/compare','/science','/planner','/finder','/methodology']);
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
   const body=await readFile(full);
   res.writeHead(200,{'Content-Type':contentTypes[extname(full)]||'application/octet-stream',
      'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
   res.end(req.method==='HEAD'?undefined:body);
 }catch{res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log('LunarNav preview at http://127.0.0.1:'+port+' ('+root+')'));
