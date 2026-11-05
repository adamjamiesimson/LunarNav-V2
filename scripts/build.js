import {cpSync,mkdirSync,existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
const base=process.cwd(),dist=join(base,'dist');
mkdirSync(dist,{recursive:true});
for(const file of ['index.html','src/app.js','src/astro.js','src/compare.js','src/finder.js','src/terrain-cache.js','src/router.js','src/onboarding.js','src/situation.js','src/mission.js','src/terrain.js','src/globe.js','src/celestial.js','src/map.js','src/sites.js','src/styles.css','src/timeline.js','src/travel.js','src/tool-executor.js','src/tool-summary.js','src/tools.js','src/assistant.js','src/transit.js']){
  const path=join(base,file);
  if(!existsSync(path))throw new Error(`Missing app file: ${file}`);
  const text=readFileSync(path,'utf8');
  if(!text.trim())throw new Error(`Empty app file: ${file}`);
  mkdirSync(join(dist,file.substring(0,file.lastIndexOf('/')+1)),{recursive:true});
  cpSync(path,join(dist,file));
}
mkdirSync(join(dist,'data'),{recursive:true});
cpSync(join(base,'data/lola-horizons.json'),join(dist,'data/lola-horizons.json'));
// Optional bundled NASA LROC surface texture (see README); the preview server
// and the Vercel rewrite proxy it when the file is not present.
if(existsSync(join(base,'assets/lroc-color.jpg'))){
  mkdirSync(join(dist,'assets'),{recursive:true});
  cpSync(join(base,'assets/lroc-color.jpg'),join(dist,'assets/lroc-color.jpg'));
}
console.log('Static production build created in dist/');
