import {all,get,remove,transact} from '@/lib/local';
import type {Project} from './model';
import {encodeWav} from './audio';

/** A Modal job still running when the draft was written, with what is needed to place its result. */
export type PendingJob={id:string;server:string;kind:string;label:string;start:number;end:number;tracks:string[];began:number;params:unknown};
/**
 * The studio's open project as this browser last saw it. `saved` is whether it
 * matches the library copy; `uploaded` are buffers the library already holds.
 */
export type Draft={key:string;name:string;projectId:string|null;project:Project;saved:boolean;createdAt:string;uploaded:string[];updatedAt:number;jobs:PendingJob[]};

const KEEP=14*24*3600*1000;
const used=(draft:Draft)=>new Set(draft.project.clips.map(c=>c.buffer));

/** Write the draft, with any of its audio this browser does not hold yet. */
export function saveDraft(draft:Draft,buffers:Map<string,AudioBuffer>){
 return transact(['drafts','audio'],'readwrite',tx=>{
  const audio=tx.objectStore('audio'),held=audio.getAllKeys();
  held.onsuccess=()=>{
   const have=new Set(held.result as string[]);
   for(const key of used(draft))if(!have.has(key)&&buffers.has(key))audio.put(encodeWav(buffers.get(key)!),key);
   tx.objectStore('drafts').put(draft);
  };
 });
}

/** A draft and its audio, decoded; null when this browser has none under that key. */
export async function loadDraft(key:string,decode:(data:ArrayBuffer)=>Promise<AudioBuffer>){
 const draft=await get<Draft>('drafts',key);if(!draft)return null;
 const buffers=new Map<string,AudioBuffer>();
 for(const id of used(draft)){
  const blob=await get<Blob>('audio',id);if(!blob)throw new Error('Some of this project’s audio is missing from this browser.');
  buffers.set(id,await decode(await blob.arrayBuffer()));
 }
 return {draft,buffers};
}

export const forgetDraft=(key:string)=>remove('drafts',key);

/** The most recent draft with work the library does not have: unsaved changes, or jobs still running. */
export async function unsavedDraft(){
 const drafts=(await all<Draft>('drafts')).filter(d=>(!d.saved||d.jobs.length>0)&&d.project.clips.length+d.jobs.length>0);
 return drafts.sort((a,b)=>b.updatedAt-a.updatedAt)[0]??null;
}

/** Forget drafts untouched for two weeks, and audio no remaining draft uses. */
export function pruneDrafts(){
 return transact(['drafts','audio'],'readwrite',tx=>{
  const drafts=tx.objectStore('drafts'),audio=tx.objectStore('audio'),listed=drafts.getAll();
  listed.onsuccess=()=>{
   const now=Date.now(),keep=new Set<string>();
   for(const draft of listed.result as Draft[]){
    if(now-draft.updatedAt>KEEP)drafts.delete(draft.key);else for(const key of used(draft))keep.add(key);
   }
   const held=audio.getAllKeys();
   held.onsuccess=()=>{for(const key of held.result as string[])if(!keep.has(key))audio.delete(key);};
  };
 });
}
