'use client';
import {useRef,useState} from 'react';
import {FileAudio,Upload,X} from 'lucide-react';
import {Skeleton} from '@/components/Skeleton';
import {encodeWav} from '@/lib/studio/audio';

/** YuE2 covers and lyric reading both take up to five minutes of a song at once. */
export const COVER_SECONDS=300;
export type Source={name:string;wav:Blob;seconds:number;full:number};

/** The song as mono 44.1 kHz WAV, its first five minutes when it is longer: the engine reads it in mono anyway. */
async function prepare(file:File):Promise<Source>{
 const decoded=await new OfflineAudioContext(2,1,48000).decodeAudioData(await file.arrayBuffer());
 const seconds=Math.min(decoded.duration,COVER_SECONDS),rate=44100;
 const context=new OfflineAudioContext(1,Math.ceil(seconds*rate),rate),source=context.createBufferSource();
 source.buffer=decoded;source.connect(context.destination);source.start(0,0,seconds);
 return {name:file.name.replace(/\.[^.]+$/,'')||'Song',wav:new Blob([encodeWav(await context.startRendering())],{type:'audio/wav'}),seconds,full:decoded.duration};
}
const clock=(s:number)=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;

/** Drop or pick the song to cover. */
export default function CoverSource({source,change}:{source:Source|null;change:(source:Source|null)=>void}){
 const input=useRef<HTMLInputElement>(null),[over,setOver]=useState(false),[reading,setReading]=useState(false),[error,setError]=useState('');
 async function take(file:File|undefined){
  if(!file||reading)return;setError('');
  if(!file.type.startsWith('audio/')&&!/\.(mp3|wav|flac|m4a|aac|ogg|opus|webm)$/i.test(file.name)){setError('Choose an audio file, such as MP3 or WAV.');return;}
  if(file.size>200*1024*1024){setError('Choose a file under 200 MB.');return;}
  setReading(true);
  try{const prepared=await prepare(file);if(prepared.seconds<3)setError('Use a song at least 3 seconds long.');else change(prepared);}
  catch{setError('That file could not be read. Try an MP3 or WAV.');}
  finally{setReading(false);if(input.current)input.current.value='';}
 }
 if(source)return <div className="gen-drop chosen"><FileAudio size={20}/>
  <div><strong title={source.name}>{source.name}</strong><span>{clock(source.seconds)}{source.full>source.seconds+0.5?` · the first ${COVER_SECONDS/60} minutes of ${clock(source.full)}`:''}</span></div>
  <button type="button" onClick={()=>change(null)} aria-label="Remove this song" title="Remove"><X size={15}/></button></div>;
 return <>
  <label className={'gen-drop'+(over?' over':'')} aria-busy={reading} onDragOver={e=>{e.preventDefault();setOver(true);}} onDragLeave={()=>setOver(false)}
   onDrop={e=>{e.preventDefault();setOver(false);void take(e.dataTransfer.files[0]);}}>
   <input ref={input} type="file" accept="audio/*,.mp3,.wav,.flac,.m4a,.ogg" hidden disabled={reading} onChange={e=>void take(e.target.files?.[0])}/>
   {reading?<Skeleton className="skeleton-upload"/>:<Upload size={20}/>}
   <div><strong>{reading?'Reading the song…':'Drop a song to cover'}</strong><span>or click to choose one · MP3, WAV, FLAC · up to {COVER_SECONDS/60} min</span></div>
  </label>
  {error&&<p className="gen-error" role="alert">{error}</p>}
 </>;
}
