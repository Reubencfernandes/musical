import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('apps/web/public/soundfonts');
const source=await readFile('apps/web/lib/instruments.ts','utf8');
const names=[...source.matchAll(/sample:'([a-z0-9_]+)'/g)].map(match=>match[1]);
for(const name of names){
 if(name==='acoustic_grand_piano')continue;
 const response=await fetch(`https://raw.githubusercontent.com/paulrosen/midi-js-soundfonts/gh-pages/FluidR3_GM/${name}-mp3.js`);
 if(!response.ok)throw new Error(`${name}: HTTP ${response.status}`);
 const data=await response.text();
 const notes=[...data.matchAll(/["']([A-G](?:b|#)?\d+)["']\s*:\s*["']data:audio\/mp3;base64,([A-Za-z0-9+/=]+)["']/g)];
 if(notes.length<80)throw new Error(`${name}: incomplete sound bank (${notes.length})`);
 const dir=path.join(root,`${name}-mp3`);await mkdir(dir,{recursive:true});
 for(const [,note,encoded] of notes){const bytes=Buffer.from(encoded,'base64');if(bytes.length<100)throw new Error('Invalid audio sample');await writeFile(path.join(dir,`${note}.mp3`),bytes);}
 console.log(`${name}: ${notes.length} samples`);
}
