import {authorize} from '@/lib/auth';
import {modalEngine,readModalFile} from '@/lib/modal-engine';
export const runtime='nodejs';

export async function GET(req:Request){
 const auth=await authorize(req);if(auth.error)return auth.error;
 const file=readModalFile(new URL(req.url).searchParams.get('ticket')||'',auth.session.user.id);
 if(!file)return new Response('This file is unavailable or has expired.',{status:404});
 try{
  const {engine,headers}=modalEngine(file.model);
  const url=engine.origin+'/gradio_api/file='+file.path.split('/').map(encodeURIComponent).join('/');
  const response=await fetch(url,{headers,signal:req.signal,cache:'no-store',redirect:'error'});
  if(!response.ok)return new Response('The result file is unavailable.',{status:response.status===404?404:502});
  return new Response(response.body,{headers:{'Content-Type':response.headers.get('content-type')||'application/octet-stream','Cache-Control':'private, no-store'}});
 }catch{return new Response('Could not download the Modal result. Try again.',{status:502});}
}
