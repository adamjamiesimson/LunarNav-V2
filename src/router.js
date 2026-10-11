/**
 * LunarNav client-side page navigation. URL paths work as direct Vercel entries
 * (server rewrites to index.html) and browser Back/Forward preserves the view.
 * Legacy #planner/#finder links resolve to their modern locations.
 */
export const PAGE_ROUTES=Object.freeze({
 home:'/',explore:'/explore',windows:'/windows',engineering:'/engineering',compare:'/compare',science:'/science'
});
export const PAGE_TITLES=Object.freeze({
 home:'Overview',explore:'Lunar explorer',windows:'Mission windows',engineering:'Engineering lab',compare:'Site comparison',science:'Science & methodology'
});
export function routeFromURL(pathname='/',hash=''){
 const path=pathname.replace(/\/+$/,'')||'/';
 for(const [name,href] of Object.entries(PAGE_ROUTES))if(path===href)return name;
 if(path==='/planner')return 'explore';
 if(path==='/finder')return 'windows';
 if(path==='/methodology'||path==='/method')return 'science';
 if(path==='/'||path==='/index.html'){
   if(hash==='#planner')return 'explore';
   if(hash==='#finder')return 'windows';
   if(hash==='#compare')return 'compare';
   if(hash==='#engineering')return 'engineering';
 }
 return 'home';
}
export function buildPageURL(page,query=''){
 const path=PAGE_ROUTES[page];
 if(!path)throw Error('Unknown LunarNav page: '+page);
 return path+(query?(query.startsWith('?')?query:'?'+query):'');
}
