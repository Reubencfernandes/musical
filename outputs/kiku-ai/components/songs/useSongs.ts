'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {type Progress,SignedOut,fetchResult,runJob} from '@/lib/studio/engine';
import {type Song,NeedsStorage,deleteSong,listSongs,newId,renameSong,saveSong,saveSongCover,songAudio} from '@/lib/library';
import {generateCover,publishCover,forgetCover} from '@/lib/song-covers';
import {toMp3} from '@/lib/mp3';
import type {Meta} from '@/lib/jobs';
import type {Model} from '@/lib/studio/models';
import type {SongResult} from '@/lib/types';

/** A song in the list. `local` holds audio not saved to the library yet. */
export type Item=Song&{local?:Blob;localCover?:Blob;saved:boolean};
/** A song being made: drives a progress row like the studio's job lanes. */
export type Making={id:string;title:string;status:string;began:number;running:number|null;progress:number|null;etaAt:number|null;queue:number|null;error?:string};
export type Request=
 |{mode:'simple';idea:string;instrumental:boolean;model?:Model}
 |{mode:'custom';caption:string;lyrics:string;instrumental:boolean;model:Model;duration:number|null;meta?:Meta};

const titleCase=(text:string)=>text.replace(/\b\w/g,c=>c.toUpperCase());
/** A working title from the idea or the first phrase of the caption; the user can rename it. */
export function titleFrom(text:string){
 const words=text.split(/[,.;:\n]/)[0].trim().split(/\s+/).filter(Boolean).slice(0,6).join(' ');
 return titleCase(words||'Untitled song').slice(0,60);
}
async function decode(data:ArrayBuffer){return new OfflineAudioContext(2,1,48000).decodeAudioData(data);}

/**
 * The user's songs: what is in their library plus what this page made, and the
 * songs being made. Simple mode lets ACE-Step's language model write the caption
 * and lyrics first (its "sample" step); custom mode sends the user's own.
 */
export function useSongs(storage:boolean){
 const [songs,setSongs]=useState<Item[]>([]),[making,setMaking]=useState<Making[]>([]);
 const [loading,setLoading]=useState(true),[needsStorage,setNeedsStorage]=useState(!storage),[error,setError]=useState('');
 const [painting,setPainting]=useState<Set<string>>(()=>new Set());
 const urls=useRef(new Map<string,string>()),controllers=useRef(new Map<string,AbortController>());
 const latest=useRef(songs),removed=useRef(new Set<string>());latest.current=songs;
 const storageAllowed=useRef(storage);storageAllowed.current=storage;
 const reload=useCallback(async()=>{
  setLoading(true);
  try{const saved=await listSongs();setSongs(list=>[...list.filter(s=>!s.saved),...saved.map(s=>({...s,saved:true}))]);}
  catch(e){setError((e as Error).message);}finally{setLoading(false);}
 },[]);
 useEffect(()=>{void reload();},[reload,storage]);
 useEffect(()=>{setNeedsStorage(!storage);},[storage]);
 useEffect(()=>()=>{controllers.current.forEach(c=>c.abort());urls.current.forEach(u=>URL.revokeObjectURL(u));},[]);

 const audioUrl=useCallback(async(item:Item)=>{
  const known=urls.current.get(item.id);if(known)return known;
  const blob=item.local??await songAudio(item);if(!blob)throw new Error('This song’s audio is missing.');
  const url=URL.createObjectURL(blob);urls.current.set(item.id,url);return url;
 },[]);

 /** Save to the library; without permission the song stays here, marked unsaved. */
 const keep=useCallback(async(item:Item)=>{
  if(!item.local||!storageAllowed.current)return false;
  try{await saveSong(item,item.local,item.localCover);setSongs(list=>list.map(s=>s.id===item.id?{...s,saved:true}:s));return true;}
  catch(e){if(e instanceof NeedsStorage)setNeedsStorage(true);else setError('Saved here, but not to your library: '+(e as Error).message);}
  return false;
 },[]);
 const saveUnsaved=useCallback(async()=>{for(const item of songs.filter(s=>!s.saved))await keep(item);},[keep,songs]);

 const create=useCallback((request:Request)=>{
  const id=newId(),controller=new AbortController();controllers.current.set(id,controller);
  const title=titleFrom(request.mode==='simple'?request.idea:request.caption);
  setMaking(list=>[{id,title,status:'Starting…',began:Date.now(),running:null,progress:null,etaAt:null,queue:null},...list]);
  const update=(patch:Partial<Making>)=>setMaking(list=>list.map(m=>m.id===id?{...m,...patch}:m));
  const status=(text:string)=>update({status:text});
  const progress=(p:Progress)=>setMaking(list=>list.map(m=>m.id!==id?m:{...m,progress:p.fraction,queue:p.queue,
   etaAt:p.eta===null?m.etaAt:Date.now()+p.eta*1000,running:m.running??(p.running?Date.now():null)}));
  const call={signal:controller.signal,status,progress};
  (async()=>{
   let caption='',lyrics='',meta:Meta|undefined,model:Model='ace15',duration:number|null=null;
   if(request.mode==='simple'){
    model=request.model??'ace15';
    status('Writing the lyrics and style…');
    const idea=await runJob<{caption:string;lyrics:string;meta:Meta}>('sample',{query:request.idea,instrumental:String(request.instrumental)},call);
    caption=idea.caption;lyrics=request.instrumental?'':idea.lyrics;meta=idea.meta;duration=idea.meta.duration??null;
    // The sung part starts its own clock: writing the idea is a separate GPU call.
    setMaking(list=>list.map(m=>m.id===id?{...m,running:null,progress:null,etaAt:null}:m));
   }else({caption,lyrics,meta,model,duration}={...request,lyrics:request.instrumental?'':request.lyrics});
   const instrumental=request.instrumental||!lyrics.trim();
   const result=instrumental
    ?await runJob<SongResult>('instrumental',{style:caption,lyrics:'',duration:Math.min(240,Math.max(10,duration??60)),model,abc:'',seed:-1},call)
    :await runJob<SongResult>('song',{style:caption,lyrics,cot:'full',model,abc:'',seed:-1,duration:duration??-1,meta:JSON.stringify(meta||{})},call);
   if(!result.audio)throw new Error('The engine did not return the song.');
   status('Preparing your song…');
   const buffer=await decode(await fetchResult(result.audio,controller.signal));
   const mp3=await toMp3(buffer);
   const item:Item={id,title,caption,lyrics,instrumental,model,seed:result.seed??result.report?.seed,duration:buffer.duration,
    createdAt:new Date().toISOString(),meta,idea:request.mode==='simple'?request.idea:undefined,local:mp3,saved:false};
   setSongs(list=>[item,...list]);setMaking(list=>list.filter(m=>m.id!==id));
   const artwork=generateCover(item,controller.signal).catch(()=>null);
   const saved=await keep(item);
   if(controller.signal.aborted){if(saved&&removed.current.has(id))await deleteSong(item);return;}
   const cover=await artwork;if(!cover||controller.signal.aborted)return;
   const current=latest.current.find(s=>s.id===id);if(!current||removed.current.has(id))return;
   publishCover(id,cover.blob);
   const withCover={...current,cover:cover.metadata,localCover:cover.blob};
   setSongs(list=>list.map(s=>s.id===id?{...s,cover:cover.metadata,localCover:cover.blob}:s));
   // Audio is already available and saved independently of the optional artwork.
   try{if(saved||current.saved)await saveSongCover(withCover,cover.blob);else if(storageAllowed.current)await keep(withCover);}catch{}
  })().catch(e=>{
   if(controller.signal.aborted){setMaking(list=>list.filter(m=>m.id!==id));return;}
   if(e instanceof SignedOut)setError('Your sign-in expired. Sign in again to keep making songs.');
   update({error:(e as Error).message||'That song could not be made.'});
  }).finally(()=>controllers.current.delete(id));
 },[keep]);
 /** Cover art on request: songs made before covers existed, or a new take on one. */
 const paint=useCallback(async(item:Item)=>{
  setPainting(set=>new Set(set).add(item.id));
  try{
   const cover=await generateCover(item,AbortSignal.timeout(600000));
   if(removed.current.has(item.id))return;
   publishCover(item.id,cover.blob);
   setSongs(list=>list.map(s=>s.id===item.id?{...s,cover:cover.metadata,localCover:cover.blob}:s));
   const withCover={...item,cover:cover.metadata,localCover:cover.blob};
   if(item.saved)await saveSongCover(withCover,cover.blob);else if(storageAllowed.current)await keep(withCover);
  }catch(e){setError(e instanceof NeedsStorage?'The cover is shown here, but saving it needs permission.':'The cover art could not be made. Try again.');}
  finally{setPainting(set=>{const next=new Set(set);next.delete(item.id);return next;});}
 },[keep]);
 const cancel=useCallback((id:string)=>{controllers.current.get(id)?.abort();setMaking(list=>list.filter(m=>m.id!==id));},[]);
 const dismiss=useCallback((id:string)=>setMaking(list=>list.filter(m=>m.id!==id)),[]);
 const remove=useCallback(async(item:Item)=>{
  removed.current.add(item.id);
  controllers.current.get(item.id)?.abort();
  try{if(item.saved)await deleteSong(item);forgetCover(item.id);setSongs(list=>list.filter(s=>s.id!==item.id));}
  catch(e){setError((e as Error).message);}
 },[]);
 const rename=useCallback(async(item:Item,title:string)=>{
  const next=title.trim().slice(0,80);if(!next||next===item.title)return;
  setSongs(list=>list.map(s=>s.id===item.id?{...s,title:next}:s));
  try{if(item.saved)await renameSong(item,next);}catch(e){setError((e as Error).message);}
 },[]);
 return {songs,making,loading,needsStorage,error,setError,create,cancel,dismiss,remove,rename,audioUrl,reload,saveUnsaved,paint,painting};
}
