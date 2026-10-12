import {authorize} from '@/lib/auth';
import {modalEngine} from '@/lib/modal-engine';
export const runtime='nodejs';
export const maxDuration=600;

/** DreamLite is private; only Kiku's authenticated server can call its GPU. */
export async function POST(req:Request){
 const auth=await authorize(req);if(auth.error)return auth.error;
 let input:{title?:unknown;caption?:unknown;lyrics?:unknown},bytes=0;
 try{
  if(!req.body||Number(req.headers.get('content-length'))>16000)throw new Error('Invalid body');
  const bounded=req.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){
   bytes+=chunk.byteLength;if(bytes>16000)throw new Error('Too large');controller.enqueue(chunk);
  }}));
  input=await new Response(bounded).json();
  if(!input||typeof input.title!=='string'||input.title.length>80||typeof input.caption!=='string'||!input.caption.trim()||input.caption.length>2000||
   (input.lyrics!==undefined&&(typeof input.lyrics!=='string'||input.lyrics.length>500)))throw new Error('Invalid theme');
 }catch{return Response.json({error:'Provide a song title and style for the cover.'},{status:400});}
 // Saying "album cover" makes DreamLite paint a printed sleeve with fake lettering; asking for a full-bleed painting does not.
 const prompt=`Full-bleed square digital painting that fills the whole frame edge to edge, no border, no frame, no printed page, no text. Imagery for a song called "${input.title}". Mood and style: ${String(input.caption).slice(0,1200)}. Lyrical imagery: ${String(input.lyrics||'').slice(0,500)}. Rich colors, cinematic lighting, painterly detail.`;
 try{
  const {headers}=modalEngine();
  const origin=process.env.MODAL_COVER_ORIGIN;if(!origin)throw new Error('Not configured');
  const response=await fetch(new URL('/generate',origin),{method:'POST',headers:{...headers,'Content-Type':'application/json'},
   body:JSON.stringify({prompt}),cache:'no-store',redirect:'error',signal:AbortSignal.any([req.signal,AbortSignal.timeout(600000)])});
  if(!response.ok||!response.headers.get('content-type')?.startsWith('image/webp'))throw new Error('No artwork');
  const data=await response.arrayBuffer();if(!data.byteLength||data.byteLength>1024*1024)throw new Error('Invalid artwork');
  const seed=response.headers.get('x-cover-seed');
  return new Response(data,{headers:{'Content-Type':'image/webp','Cache-Control':'private, no-store',
   ...(seed&&/^\d{1,10}$/.test(seed)?{'X-Cover-Seed':seed}:{})}});
 }catch{return Response.json({error:'Artwork could not finish. Your song is still available.'},{status:502});}
}
