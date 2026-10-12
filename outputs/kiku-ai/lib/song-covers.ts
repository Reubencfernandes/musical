'use client';
/** Share private image blobs between song rows and the player, without public URLs. */
const covers=new Map<string,Blob>(),listeners=new Map<string,Set<()=>void>>();
export const cachedCover=(id:string)=>covers.get(id);
export function publishCover(id:string,blob:Blob){covers.set(id,blob);listeners.get(id)?.forEach(fn=>fn());}
export function forgetCover(id:string){covers.delete(id);listeners.get(id)?.forEach(fn=>fn());}
export function clearCovers(){covers.clear();listeners.forEach(set=>set.forEach(fn=>fn()));}
export function watchCover(id:string,fn:()=>void){
 const set=listeners.get(id)??new Set<()=>void>();set.add(fn);listeners.set(id,set);
 return ()=>{set.delete(fn);if(!set.size)listeners.delete(id);};
}
export async function generateCover(song:{title:string;caption:string;lyrics:string},signal:AbortSignal){
 const response=await fetch('/api/modal/cover',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({title:song.title,caption:song.caption.slice(0,2000),lyrics:song.lyrics.slice(0,500)}),signal});
 if(!response.ok||!response.headers.get('content-type')?.startsWith('image/webp'))throw new Error('No cover');
 const blob=await response.blob();
 return {blob,metadata:{model:'carlofkl/DreamLite-base' as const,license:'CC-BY-NC-4.0' as const,seed:Number(response.headers.get('x-cover-seed'))||undefined}};
}
