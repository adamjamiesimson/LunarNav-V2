// Legacy hash links are resolved on the root and index.html. Vercel serves the same entry for page paths.
export const PAGE_ROUTES=Object.freeze({
 explore:'/explore',planning:'/planning',engineering:'/engineering',science:'/science'
});
export const PAGE_TITLES=Object.freeze({
 explore:'Lunar explorer',planning:'Plan Mission',engineering:'Engineering lab',science:'Science & methodology'
});
export function routeFromURL(pathname='/',hash=''){
 const path=pathname.replace(/\/+$/,'')||'/';
 if(path==='/'||path==='/index.html'){
   if(hash==='#finder'||hash==='#compare')return 'planning';
   if(hash==='#engineering')return 'engineering';
   return 'explore';
 }
 for(const [name,href] of Object.entries(PAGE_ROUTES))if(path===href)return name;
 if(path==='/planner')return 'explore';
 if(['/finder','/windows','/compare'].includes(path))return 'planning';
 if(path==='/methodology'||path==='/method')return 'science';
 return 'explore';
}
export function buildPageURL(page,query=''){
 const path=PAGE_ROUTES[page];
 if(!path)throw Error('Unknown LunarNav page: '+page);
 return path+(query?(query.startsWith('?')?query:'?'+query):'');
}
