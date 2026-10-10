import {cpSync,mkdirSync,existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
const base=process.cwd(),dist=join(base,'dist');
mkdirSync(dist,{recursive:true});
for(const file of ['index.html','src/app.js','src/astro.js','src/finder.js','src/mission.js','src/terrain.js','src/globe.js','src/map.js','src/sites.js','src/styles.css']){
  const path=join(base,file);
  if(!existsSync(path))throw new Error(`Missing app file: ${file}`);
  const text=readFileSync(path,'utf8');
  if(!text.trim())throw new Error(`Empty app file: ${file}`);
  mkdirSync(join(dist,file.substring(0,file.lastIndexOf('/')+1)),{recursive:true});
  cpSync(path,join(dist,file));
}
console.log('Static production build created in dist/');
