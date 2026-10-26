'use client';
import {useEffect,useRef,useState} from 'react';
import {AudioLines,Music2,ListMusic,WandSparkles,CloudUpload,Search,ScrollText} from 'lucide-react';
import PromptHelper from '@/components/studio/PromptHelper';
import AnimatedHeight from '@/components/AnimatedHeight';
import {SongSkeletons} from '@/components/Skeleton';
import {MakingRow,SongRow} from './SongList';
import CoverSource,{type Source} from './CoverSource';
import {type Request,useSongs} from './useSongs';
import {allowSaving} from '@/lib/library';
import {runJob} from '@/lib/studio/engine';
import type {Meta} from '@/lib/jobs';
import type {LyricsResult} from '@/lib/types';
import type {User} from '@/components/shell/session';
import RequireSession from '@/components/shell/RequireSession';
import {HANDOFF} from '@/lib/song-handoff';

export function GenerateScreen(){return <RequireSession>{user=><Generate user={user}/>}</RequireSession>;}

const TAGS=['Intro','Verse','Pre-Chorus','Chorus','Bridge','Outro','Instrumental'];
const LENGTHS=[{value:0,label:'Auto'},{value:30,label:'30 s'},{value:60,label:'1 min'},{value:120,label:'2 min'},{value:180,label:'3 min'}];
/** Every song is sung by YuE2-Turbo; ACE-Step 1.5 is no longer offered. */
const MODEL='yue2' as const;
const MODES=['simple','custom','cover'] as const;

export default function Generate({user}:{user:User}){
 const songs=useSongs();
 const [mode,setMode]=useState<'simple'|'custom'|'cover'>('simple'),[idea,setIdea]=useState(''),[instrumental,setInstrumental]=useState(false);
 const [caption,setCaption]=useState(''),[lyrics,setLyrics]=useState(''),[length,setLength]=useState(0);
 const [meta,setMeta]=useState<Meta|undefined>(),[enhancing,setEnhancing]=useState(false),[error,setError]=useState(''),[filter,setFilter]=useState('');
 const [now,setNow]=useState(()=>Date.now());
 // Cover mode: the dropped song, the new style, and its words once read (empty sings the song's own).
 const [source,setSource]=useState<Source|null>(null),[style,setStyle]=useState(''),[words,setWords]=useState(''),[listening,setListening]=useState('');
 const [harmony,setHarmony]=useState<'keep'|'free'>('keep');
 const listen=useRef<AbortController|null>(null);
 useEffect(()=>()=>listen.current?.abort(),[]);
 const lyricsBox=useRef<HTMLTextAreaElement>(null),started=useRef(false);
 useEffect(()=>{if(!songs.making.length)return;const t=setInterval(()=>setNow(Date.now()),400);return()=>clearInterval(t);},[songs.making.length]);
 useEffect(()=>{if(user.storage)void songs.saveUnsaved();},[user.storage]); // eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{
  if(started.current)return;started.current=true;
  try{const raw=sessionStorage.getItem(HANDOFF);if(!raw)return;sessionStorage.removeItem(HANDOFF);
   const handed=JSON.parse(raw) as {idea:string;instrumental:boolean};
   if(handed.idea?.trim()){setIdea(handed.idea);setInstrumental(!!handed.instrumental);songs.create({mode:'simple',idea:handed.idea.trim(),instrumental:!!handed.instrumental,model:MODEL});}
  }catch{}
 },[]); // eslint-disable-line react-hooks/exhaustive-deps

 function tag(name:string){
  const box=lyricsBox.current,insert=`${lyrics&&!lyrics.endsWith('\n')?'\n':''}${lyrics?'\n':''}[${name}]\n`;
  if(!box){setLyrics(lyrics+insert);return;}
  const at=box.selectionStart??lyrics.length,next=lyrics.slice(0,at)+insert+lyrics.slice(at);
  setLyrics(next);requestAnimationFrame(()=>{box.focus();box.selectionStart=box.selectionEnd=at+insert.length;});
 }
 /** Read the dropped song's words with HeartTranscriptor, so they can be checked or changed before the cover. */
 async function getLyrics(){
  if(!source||listening)return;setError('');
  const controller=new AbortController();listen.current=controller;setListening('Listening to the words…');
  try{
   const form=new FormData();form.append('audio',new File([source.wav],'song.wav',{type:'audio/wav'}));
   const result=await runJob<LyricsResult>('lyrics',form,{signal:controller.signal,status:setListening});
   if(!result.lyrics.trim())setError('No sung words were found in this song.');else setWords(result.lyrics.trim().slice(0,4000));
  }catch(e){if(!controller.signal.aborted)setError((e as Error).message);}
  finally{setListening('');}
 }
 function changeSource(next:Source|null){listen.current?.abort();setSource(next);setWords('');}
 async function enhance(){
  if(!caption.trim()||enhancing)return;setEnhancing(true);setError('');
  try{const result=await runJob<{caption:string;meta:Meta}>('enhance',{caption,lyrics:instrumental?'':lyrics},{signal:new AbortController().signal,status:()=>{}});
   setCaption(result.caption.slice(0,2000));setMeta(result.meta);}
  catch(e){setError((e as Error).message);}finally{setEnhancing(false);}
 }
 function create(event:React.FormEvent){
  event.preventDefault();setError('');
  let request:Request;
  if(mode==='simple'){if(!idea.trim()){setError('Describe the song you want to make.');return;}request={mode,idea:idea.trim(),instrumental,model:MODEL};}
  else if(mode==='cover'){
   if(!source){setError('Drop the song you want to cover.');return;}
   if(!style.trim()){setError('Describe the new style: genre, mood, instruments, voice.');return;}
   request={mode,title:`${source.name} (cover)`.slice(0,60),audio:source.wav,style:style.trim(),lyrics:words.trim(),instrumental,harmony};
  }else{
   if(!caption.trim()){setError('Describe the style: genre, mood, instruments, texture.');return;}
   if(!instrumental&&!lyrics.trim()){setError('Add lyrics, or switch on Instrumental.');return;}
   request={mode,caption:caption.trim(),lyrics:lyrics.trim(),instrumental,model:MODEL,duration:instrumental&&length||null,meta};
  }
  songs.create(request);
 }
 const query=filter.trim().toLowerCase();
 const shown=songs.songs.filter(s=>!query||(s.title+' '+s.caption).toLowerCase().includes(query));
 function changeMode(next:typeof mode){setMode(next);setError('');}
 function modeKey(event:React.KeyboardEvent<HTMLDivElement>){
  const current=MODES.indexOf(mode),next=event.key==='ArrowRight'?(current+1)%MODES.length:event.key==='ArrowLeft'?(current+MODES.length-1)%MODES.length:event.key==='Home'?0:event.key==='End'?MODES.length-1:null;
  if(next===null)return;event.preventDefault();changeMode(MODES[next]);event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
 }
 return <div className="generate">
  <form className="gen-form" onSubmit={create} aria-label="Make a song">
   <div className="gen-modes" data-mode={mode} role="tablist" aria-label="How to describe the song" onKeyDown={modeKey}>
    {MODES.map(m=><button key={m} id={`gen-tab-${m}`} type="button" role="tab" aria-selected={mode===m} aria-controls="gen-mode-panel" tabIndex={mode===m?0:-1} className={mode===m?'on':''} onClick={()=>changeMode(m)}>{m==='simple'?'Simple':m==='custom'?'Custom':'Cover'}</button>)}
   </div>
   <AnimatedHeight><div key={mode} id="gen-mode-panel" className="gen-mode-panel flex flex-col gap-[13px]" role="tabpanel" aria-labelledby={`gen-tab-${mode}`}>
   {mode==='cover'?<>
    <CoverSource source={source} change={changeSource}/>
    <div className="gen-field flex flex-col gap-[7px] text-[12px] text-hub-muted">
     <span id="cover-harmony-label">Keep from the original</span>
     <div className="gen-cover-options" data-harmony={harmony} role="group" aria-labelledby="cover-harmony-label" aria-describedby="cover-harmony-note">
      <button type="button" aria-pressed={harmony==='keep'} aria-label="Keep melody and chords" onClick={()=>setHarmony('keep')}><ListMusic size={15} aria-hidden="true"/><span>Melody &amp; chords</span></button>
      <button type="button" aria-pressed={harmony==='free'} aria-label="Keep melody only" onClick={()=>setHarmony('free')}><Music2 size={15} aria-hidden="true"/><span>Melody only</span></button>
     </div>
     <p id="cover-harmony-note" className="gen-cover-note" aria-live="polite">{harmony==='keep'
      ?'Keep the tune and chords, with a new performance in your style.'
      :'Keep the tune and let YuE2 reimagine the chords and arrangement.'}{instrumental?' The melody is played on instruments.':''}</p>
    </div>
    <label className="gen-field flex flex-col gap-[7px] text-[12px] text-hub-muted"><span>New style</span>
     <textarea value={style} onChange={e=>setStyle(e.target.value)} rows={4} maxLength={2000} placeholder="Genre, mood, instruments, voice: e.g. slow jazz ballad, brushed drums, upright bass, smoky female vocal"/></label>
    {!instrumental&&<label className="gen-field flex flex-col gap-[7px] text-[12px] text-hub-muted"><span className="gen-field-head">Lyrics
      <button type="button" className={'enhance-button'+(listening?' busy':'')} onClick={()=>void getLyrics()} disabled={!source||!!listening} title={source?'Transcribe the words sung in this song':'Drop a song first'}>
       {listening?<span className="spinner"/>:<ScrollText size={13}/>}{listening?'Listening…':'Get lyrics'}</button></span>
     <textarea className="gen-lyrics" value={words} onChange={e=>setWords(e.target.value)} rows={8} maxLength={4000}
      placeholder={'Leave empty to sing the song’s own words.\nGet lyrics to read them first, or write new ones.'}/></label>}
    {listening&&<p className="gen-note" role="status">{listening}</p>}
   </>:mode==='simple'?<>
    <label className="gen-field flex flex-col gap-[7px] text-[12px] text-hub-muted"><span>Describe the song</span>
     <textarea value={idea} onChange={e=>setIdea(e.target.value)} rows={5} maxLength={500} placeholder="A warm acoustic love song about the first snow, soft female vocal…"/></label>
    <p className="gen-note">Kiku writes the style and lyrics from your idea, then YuE2-Turbo performs it.</p>
   </>:<>
    <label className="gen-field flex flex-col gap-[7px] text-[12px] text-hub-muted"><span>Style</span>
     <textarea value={caption} onChange={e=>{setCaption(e.target.value);setMeta(undefined);}} rows={4} maxLength={2000} placeholder="Genre, mood, instruments, texture, era: e.g. dreamy indie pop, shimmering guitars, soft female vocal, warm and nostalgic"/></label>
    <div className="prompt-tools gen-tools">
     <PromptHelper value={caption} change={v=>{setCaption(v);setMeta(undefined);}} vocals={!instrumental}/>
     <button type="button" className={'enhance-button'+(enhancing?' busy':'')} onClick={()=>void enhance()} disabled={enhancing||!caption.trim()}>{enhancing?<span className="spinner"/>:<WandSparkles size={13}/>}{enhancing?'Enhancing…':'Enhance'}</button>
    </div>
    {meta&&(meta.bpm||meta.keyscale)&&<p className="measured">Planned: {[meta.bpm&&`${meta.bpm} BPM`,meta.keyscale,meta.timesignature&&`${String(meta.timesignature).split('/')[0]}/4`].filter(Boolean).join(' · ')}</p>}
    {!instrumental&&<label className="gen-field flex flex-col gap-[7px] text-[12px] text-hub-muted"><span>Lyrics</span>
     <textarea ref={lyricsBox} className="gen-lyrics" value={lyrics} onChange={e=>setLyrics(e.target.value)} rows={9} maxLength={4000} placeholder={'[Verse]\nYour first lines here\n\n[Chorus]\nThe part everyone sings'}/></label>}
    {!instrumental&&<div className="gen-tags" aria-label="Insert a section">{TAGS.map(t=><button key={t} type="button" onClick={()=>tag(t)}>[{t}]</button>)}</div>}
    {!instrumental&&<p className="gen-note">Keep lines to about 6–10 syllables and leave a blank line between sections.</p>}
   </>}
    {mode==='custom'&&instrumental&&<div className="gen-row">
     <label className="gen-select"><span>Length</span><select value={length} onChange={e=>setLength(Number(e.target.value))}>
      {LENGTHS.map(l=><option key={l.value} value={l.value}>{l.label}</option>)}</select></label>
    </div>}
   </div></AnimatedHeight>
   <label className="gen-switch"><input type="checkbox" checked={instrumental} onChange={e=>setInstrumental(e.target.checked)}/><span>Instrumental</span></label>
   {error&&<p className="gen-error" role="alert">{error}</p>}
   <button type="submit" className="gen-create"><AudioLines size={17}/> Create</button>
  </form>

  <section className="gen-list" aria-label="Your songs">
   <header><h1>Your songs</h1><label className="gen-search"><Search size={14}/><input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Search" aria-label="Search your songs"/></label></header>
   {songs.needsStorage&&<div className="storage-banner"><CloudUpload size={18}/><div><strong>Keep your songs</strong><span>Allow Kiku AI to save them to a private dataset in your Hugging Face account, so they are here next time.</span></div>
    <button onClick={()=>allowSaving('/generate')}>Allow saving</button></div>}
   {(songs.error)&&<p className="gen-error" role="alert">{songs.error}</p>}
   <ul className="song-list m-0 flex list-none flex-col gap-[2px] p-0">
    {songs.making.map(m=><MakingRow key={m.id} item={m} now={now} cancel={()=>songs.cancel(m.id)} dismiss={()=>songs.dismiss(m.id)}/>)}
    {shown.map(s=><SongRow key={s.id} item={s} audioUrl={songs.audioUrl} remove={i=>void songs.remove(i)} rename={(i,t)=>void songs.rename(i,t)} paint={i=>void songs.paint(i)} painting={songs.painting.has(s.id)}
     share={(i,on)=>void songs.share(i,on)} sharing={songs.sharing.has(s.id)} owner={user.handle}/>)}
   </ul>
   {songs.loading&&!songs.songs.length&&!songs.making.length&&<SongSkeletons label="Loading your songs…"/>}
   {!songs.loading&&!songs.songs.length&&!songs.making.length&&<p className="gen-empty">Your songs will appear here. Describe one on the left to begin.</p>}
  </section>
 </div>;
}
