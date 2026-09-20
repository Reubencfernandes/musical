import {tmpdir} from 'node:os';
import path from 'node:path';
import {mkdir,readdir,stat,rm} from 'node:fs/promises';
export const mediaRoot=path.join(tmpdir(),'score-studio-media');
export async function prepareMedia(){
 await mkdir(mediaRoot,{recursive:true});
 for(const id of await readdir(mediaRoot)){
  if(!/^[a-f0-9-]{36}$/.test(id))continue;
  const dir=path.join(mediaRoot,id);
  try{if(Date.now()-(await stat(dir)).mtimeMs>3600000)await rm(dir,{recursive:true,force:true});}catch{}
 }
}
