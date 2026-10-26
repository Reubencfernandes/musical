'use client';
import {fetchResult,runJob} from '@/lib/studio/engine';
import type {Download} from '@/lib/types';
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
/** Cover art is painted by Z-Image Turbo on the Kiku Art ZeroGPU Space, with the user's own token. */
export const COVER_MODEL={model:'Tongyi-MAI/Z-Image-Turbo',license:'Apache-2.0'} as const;
/** Libraries keep artwork as songs/<id>.webp, 768 px square; a browser that cannot write WebP keeps the original bytes. */
async function webp(image:Blob){
 try{
  const bitmap=await createImageBitmap(image),side=Math.min(bitmap.width,bitmap.height),size=768,canvas=new OffscreenCanvas(size,size);
  canvas.getContext('2d')!.drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,size,size);bitmap.close();
  const out=await canvas.convertToBlob({type:'image/webp',quality:.86});
  return out.type==='image/webp'?out:image;
 }catch{return image;}
}
export async function generateCover(song:{title:string;caption:string},signal:AbortSignal,status:(text:string)=>void=()=>{}){
 const result=await runJob<{image?:Download;seed?:number}>('art',{title:song.title.slice(0,80),style:song.caption.slice(0,2000),seed:-1},{signal,status});
 if(!result.image)throw new Error('No cover');
 const blob=await webp(new Blob([await fetchResult(result.image,signal)],{type:'image/webp'}));
 return {blob,metadata:{...COVER_MODEL,seed:result.seed}};
}
