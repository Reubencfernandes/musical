'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {type Progress,LEAVING,SignedOut,fetchResult,resumeJob,runJob} from '@/lib/studio/engine';
import {type Song,NeedsStorage,deleteSong,listSongs,newId,renameSong,saveSong,saveSongCover,songAudio} from '@/lib/library';
import {all,put,remove as forget} from '@/lib/local';
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
/** The caption and lyrics a song is sung from: written by ACE-Step's planner in simple mode, or the user's own. */
type Idea={caption:string;lyrics:string;meta?:Meta;model:Model;duration:number|null};
/**
 * What this browser keeps (lib/local) so a refresh loses nothing: a song being
 * made, at its step and with its Modal job's server ID once it has one, and a
 * finished song until it is in the library. A step without a server ID (ACE-Step
 * 1 runs in the page, so a refresh ends it) is simply run again.
 */
type Kept=
 |{id:string;kind:'making';title:string;request:Request;began:number;step:'idea'|'song';server?:string;idea?:Idea}
 |{id:string;kind:'unsaved';item:Item};

const titleCase=(text:string)=>text.replace(/\b\w/g,c=>c.toUpperCase());
/** A working title from the idea or the first phrase of the caption; the user can rename it. */
export function titleFrom(text:string){
 const words=text.split(/[,.;:\n]/)[0].trim().split(/\s+/).filter(Boolean).slice(0,6).join(' ');
 return titleCase(words||'Untitled song').slice(0,60);
}
async function decode(data:ArrayBuffer){return new OfflineAudioContext(2,1,48000).decodeAudioData(data);}
const keepLocally=(record:Kept)=>put('songs',record).catch(()=>{});

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
 // Songs whose current step has a server ID, and so can be picked up again later.
 const resumable=useRef(new Set<string>());
 const latest=useRef(songs),removed=useRef(new Set<string>());latest.current=songs;
 const storageAllowed=useRef(storage);storageAllowed.current=storage;
 const reload=useCallback(async()=>{
  setLoading(true);
  try{const saved=await listSongs();setSongs(list=>[...list.filter(s=>!s.saved),...saved.map(s=>({...s,saved:true}))]);}
  catch(e){setError((e as Error).message);}finally{setLoading(false);}
 },[]);
 useEffect(()=>{void reload();},[reload,storage]);
 useEffect(()=>{setNeedsStorage(!storage);},[storage]);
 // Leaving the page is not stopping: songs on Modal carry on and are picked up on return. A song still
 // starting has nothing to pick up yet, so it is left to run (React's dev double mount relies on this too).
 useEffect(()=>()=>{controllers.current.forEach((c,id)=>{if(resumable.current.has(id))c.abort(LEAVING);});urls.current.forEach(u=>URL.revokeObjectURL(u));},[]);

 const audioUrl=useCallback(async(item:Item)=>{
  const known=urls.current.get(item.id);if(known)return known;
  const blob=item.local??await songAudio(item);if(!blob)throw new Error('This song’s audio is missing.');
  const url=URL.createObjectURL(blob);urls.current.set(item.id,url);return url;
 },[]);

 /** Save to the library; without permission, or offline, the song stays here and in this browser, marked unsaved. */
 const keep=useCallback(async(item:Item)=>{
  if(!item.local||!storageAllowed.current)return false;
  try{
   await saveSong(item,item.local,item.localCover);setSongs(list=>list.map(s=>s.id===item.id?{...s,saved:true}:s));
   void forget('songs',item.id).catch(()=>{});return true;
  }catch(e){if(e instanceof NeedsStorage)setNeedsStorage(true);else setError('Saved here, but not to your library: '+(e as Error).message);}
  return false;
 },[]);
 const saveUnsaved=useCallback(async()=>{for(const item of songs.filter(s=>!s.saved))await keep(item);},[keep,songs]);

 /** Make a song, or carry on making one from where a refreshed page left it. */
 const make=useCallback((id:string,title:string,request:Request,began:number,from?:Extract<Kept,{kind:'making'}>)=>{
  const controller=new AbortController();controllers.current.set(id,controller);
  setMaking(list=>[{id,title,status:from?'Picking up where this left off…':'Starting…',began,running:null,progress:null,etaAt:null,queue:null},...list.filter(m=>m.id!==id)]);
  const update=(patch:Partial<Making>)=>setMaking(list=>list.map(m=>m.id===id?{...m,...patch}:m));
  const status=(text:string)=>update({status:text});
  const progress=(p:Progress)=>setMaking(list=>list.map(m=>m.id!==id?m:{...m,progress:p.fraction,queue:p.queue,
   etaAt:p.eta===null?m.etaAt:Date.now()+p.eta*1000,running:m.running??(p.running?Date.now():null)}));
  const record:Extract<Kept,{kind:'making'}>=from??{id,kind:'making',title,request,began,step:request.mode==='simple'?'idea':'song'};
  const remember=(patch:Partial<typeof record>)=>{Object.assign(record,patch);void keepLocally(record);};
  remember({});
  if(record.server)resumable.current.add(id);
  const call={signal:controller.signal,status,progress,job:(server:string)=>{remember({server});resumable.current.add(id);}};
  (async()=>{
   let idea:Idea;
   if(record.step==='idea'&&request.mode==='simple'){
    status('Writing the lyrics and style…');
    const sample=record.server?await resumeJob<{caption:string;lyrics:string;meta:Meta}>(record.server,call)
     :await runJob<{caption:string;lyrics:string;meta:Meta}>('sample',{query:request.idea,instrumental:String(request.instrumental)},call);
    idea={caption:sample.caption,lyrics:request.instrumental?'':sample.lyrics,meta:sample.meta,model:request.model??'ace15',duration:sample.meta.duration??null};
    remember({step:'song',server:undefined,idea});resumable.current.delete(id);
    // The sung part starts its own clock: writing the idea is a separate GPU call.
    setMaking(list=>list.map(m=>m.id===id?{...m,running:null,progress:null,etaAt:null}:m));
   }else idea=record.idea??(request.mode==='custom'
    ?{caption:request.caption,lyrics:request.instrumental?'':request.lyrics,meta:request.meta,model:request.model,duration:request.duration}
    :{caption:request.idea,lyrics:'',model:request.model??'ace15',duration:null});
   const {caption,lyrics,meta,model,duration}=idea;
   const instrumental=request.instrumental||!lyrics.trim();
   const result=record.server?await resumeJob<SongResult>(record.server,call):instrumental
    ?await runJob<SongResult>('instrumental',{style:caption,lyrics:'',duration:Math.min(240,Math.max(10,duration??60)),model,abc:'',seed:-1},call)
    :await runJob<SongResult>('song',{style:caption,lyrics,cot:'full',model,abc:'',seed:-1,duration:duration??-1,meta:JSON.stringify(meta||{})},call);
   if(!result.audio)throw new Error('The engine did not return the song.');
   status('Preparing your song…');
   const buffer=await decode(await fetchResult(result.audio,controller.signal));
   const mp3=await toMp3(buffer);
   const item:Item={id,title,caption,lyrics,instrumental,model,seed:result.seed??result.report?.seed,duration:buffer.duration,
    createdAt:new Date().toISOString(),meta,idea:request.mode==='simple'?request.idea:undefined,local:mp3,saved:false};
   // Kept in this browser until the library has it.
   await keepLocally({id,kind:'unsaved',item});
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
   try{if(saved||current.saved)await saveSongCover(withCover,cover.blob);else if(storageAllowed.current)await keep(withCover);else void keepLocally({id,kind:'unsaved',item:withCover});}catch{}
  })().catch(e=>{
   if(controller.signal.reason===LEAVING)return;
   void forget('songs',id).catch(()=>{});
   if(controller.signal.aborted){setMaking(list=>list.filter(m=>m.id!==id));return;}
   if(e instanceof SignedOut)setError('Your sign-in expired. Sign in again to keep making songs.');
   update({error:(e as Error).message||'That song could not be made.'});
  }).finally(()=>{controllers.current.delete(id);resumable.current.delete(id);});
 },[keep]);
 const create=useCallback((request:Request)=>{
  make(newId(),titleFrom(request.mode==='simple'?request.idea:request.caption),request,Date.now());
 },[make]);
 // Pick up what a refreshed page was making, and show finished songs the library does not have yet.
 useEffect(()=>{
  let active=true;
  void all<Kept>('songs').then(records=>{
   if(!active)return;
   for(const record of records){
    // A song started since this page opened (the home page hands one over on load) is already running.
    if(controllers.current.has(record.id))continue;
    if(record.kind==='making')make(record.id,record.title,record.request,record.began,record);
    else{setSongs(list=>list.some(s=>s.id===record.id)?list:[{...record.item,saved:false},...list]);void keep(record.item);}
   }
  }).catch(()=>{});
  return()=>{active=false;};
 },[make,keep]);
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
 const cancel=useCallback((id:string)=>{controllers.current.get(id)?.abort();setMaking(list=>list.filter(m=>m.id!==id));void forget('songs',id).catch(()=>{});},[]);
 const dismiss=useCallback((id:string)=>setMaking(list=>list.filter(m=>m.id!==id)),[]);
 const remove=useCallback(async(item:Item)=>{
  removed.current.add(item.id);
  controllers.current.get(item.id)?.abort();
  try{if(item.saved)await deleteSong(item);forgetCover(item.id);setSongs(list=>list.filter(s=>s.id!==item.id));void forget('songs',item.id).catch(()=>{});}
  catch(e){setError((e as Error).message);}
 },[]);
 const rename=useCallback(async(item:Item,title:string)=>{
  const next=title.trim().slice(0,80);if(!next||next===item.title)return;
  setSongs(list=>list.map(s=>s.id===item.id?{...s,title:next}:s));
  try{if(item.saved)await renameSong(item,next);else void keepLocally({id:item.id,kind:'unsaved',item:{...item,title:next}});}catch(e){setError((e as Error).message);}
 },[]);
 return {songs,making,loading,needsStorage,error,setError,create,cancel,dismiss,remove,rename,audioUrl,reload,saveUnsaved,paint,painting};
}
