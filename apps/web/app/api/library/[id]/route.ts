import {createReadStream} from 'node:fs';
import {Readable} from 'node:stream';
import {authorize} from '@/lib/auth';
import {LOCAL_ENGINE} from '@/lib/local-engine';
import {songFile} from '@/lib/library';
export const runtime='nodejs';

/** Streams a saved song (or its score). Range requests let the player seek without loading the whole file. */
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){
 const auth=await authorize(req);if(auth.error)return auth.error;
 if(!LOCAL_ENGINE)return new Response(null,{status:404});
 const {id}=await params,url=new URL(req.url),kind=url.searchParams.get('file')==='score'?'score':'audio';
 let found;try{found=await songFile(id,kind);}catch{return new Response(null,{status:404});}
 const {file,size}=found,type=kind==='audio'?'audio/wav':'text/vnd.abc; charset=utf-8';
 const headers:Record<string,string>={'Content-Type':type,'Accept-Ranges':'bytes','Cache-Control':'private, max-age=3600'};
 if(url.searchParams.has('download'))headers['Content-Disposition']=`attachment; filename="${id}.${kind==='audio'?'wav':'abc'}"`;
 const range=/^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range')||'');
 if(range&&(range[1]||range[2])){
  const start=range[1]?Number(range[1]):Math.max(0,size-Number(range[2])),end=range[1]&&range[2]?Math.min(Number(range[2]),size-1):size-1;
  if(start>end||start>=size)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
  return new Response(Readable.toWeb(createReadStream(file,{start,end})) as ReadableStream,{status:206,headers:{...headers,'Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':String(end-start+1)}});
 }
 return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream,{headers:{...headers,'Content-Length':String(size)}});
}
