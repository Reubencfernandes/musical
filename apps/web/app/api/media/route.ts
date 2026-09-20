import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {mediaRoot} from '@/lib/media';
import {authorize} from '@/lib/auth';
export const runtime='nodejs';
export async function GET(req:Request){
 const auth=await authorize(req);if(auth.error)return auth.error;
 const id=new URL(req.url).searchParams.get('id')||'';
 if(!/^[a-f0-9-]{36}$/.test(id))return new Response('Not found',{status:404});
 try{if(await readFile(path.join(mediaRoot,id,'owner'),'utf8')!==auth.session.user.id)return new Response('Not found',{status:404});
  const file=path.join(mediaRoot,id,'audio.wav');const info=await stat(file);
  if(Date.now()-info.mtimeMs>3600000)return new Response('This import expired. Import the video again.',{status:410});
  return new Response(await readFile(file),{headers:{'Content-Type':'audio/wav','Cache-Control':'private, no-store','Content-Disposition':'attachment; filename="youtube-excerpt.wav"'}});
 }catch{return new Response('Not found',{status:404});}
}
