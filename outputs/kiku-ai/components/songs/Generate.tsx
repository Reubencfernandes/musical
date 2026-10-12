'use client';
import {useEffect,useRef,useState} from 'react';
import {AudioLines,WandSparkles,CloudUpload,Search} from 'lucide-react';
import PromptHelper from '@/components/studio/PromptHelper';
import {MakingRow,SongRow} from './SongList';
import {type Request,useSongs} from './useSongs';
import {allowSaving} from '@/lib/library';
import {runJob} from '@/lib/studio/engine';
import type {Meta} from '@/lib/jobs';
import type {User} from '@/components/shell/session';

const TAGS=['Intro','Verse','Pre-Chorus','Chorus','Bridge','Outro','Instrumental'];
const LENGTHS=[{value:0,label:'Auto'},{value:30,label:'30 s'},{value:60,label:'1 min'},{value:120,label:'2 min'},{value:180,label:'3 min'}];
/** Home hands an idea over through session storage, so it never sits in a URL. */
export const HANDOFF='kiku-idea';

export default function Generate({user}:{user:User}){
 const songs=useSongs(user.storage);
 const [mode,setMode]=useState<'simple'|'custom'>('simple'),[idea,setIdea]=useState(''),[instrumental,setInstrumental]=useState(false);
 const [caption,setCaption]=useState(''),[lyrics,setLyrics]=useState(''),[model,setModel]=useState<'ace15'|'yue2'>('ace15'),[length,setLength]=useState(0);
 const [meta,setMeta]=useState<Meta|undefined>(),[enhancing,setEnhancing]=useState(false),[error,setError]=useState(''),[filter,setFilter]=useState('');
 const [now,setNow]=useState(()=>Date.now());
 const lyricsBox=useRef<HTMLTextAreaElement>(null),started=useRef(false);
 useEffect(()=>{if(!songs.making.length)return;const t=setInterval(()=>setNow(Date.now()),400);return()=>clearInterval(t);},[songs.making.length]);
 useEffect(()=>{if(user.storage)void songs.saveUnsaved();},[user.storage]); // eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{
  if(started.current)return;started.current=true;
  try{const raw=sessionStorage.getItem(HANDOFF);if(!raw)return;sessionStorage.removeItem(HANDOFF);
   const handed=JSON.parse(raw) as {idea:string;instrumental:boolean;model?:'ace15'|'yue2'};
   const chosen=handed.model==='yue2'?'yue2':'ace15';
   if(handed.idea?.trim()){setIdea(handed.idea);setInstrumental(!!handed.instrumental);setModel(chosen);songs.create({mode:'simple',idea:handed.idea.trim(),instrumental:!!handed.instrumental,model:chosen});}
  }catch{}
 },[]); // eslint-disable-line react-hooks/exhaustive-deps

 function tag(name:string){
  const box=lyricsBox.current,insert=`${lyrics&&!lyrics.endsWith('\n')?'\n':''}${lyrics?'\n':''}[${name}]\n`;
  if(!box){setLyrics(lyrics+insert);return;}
  const at=box.selectionStart??lyrics.length,next=lyrics.slice(0,at)+insert+lyrics.slice(at);
  setLyrics(next);requestAnimationFrame(()=>{box.focus();box.selectionStart=box.selectionEnd=at+insert.length;});
 }
 async function enhance(){
  if(!caption.trim()||enhancing)return;setEnhancing(true);setError('');
  try{const result=await runJob<{caption:string;meta:Meta}>('enhance',{caption,lyrics:instrumental?'':lyrics},{signal:new AbortController().signal,status:()=>{}});
   setCaption(result.caption.slice(0,2000));setMeta(result.meta);}
  catch(e){setError((e as Error).message);}finally{setEnhancing(false);}
 }
 function create(event:React.FormEvent){
  event.preventDefault();setError('');
  let request:Request;
  if(mode==='simple'){if(!idea.trim()){setError('Describe the song you want to make.');return;}request={mode,idea:idea.trim(),instrumental,model};}
  else{
   if(!caption.trim()){setError('Describe the style: genre, mood, instruments, texture.');return;}
   if(!instrumental&&!lyrics.trim()){setError('Add lyrics, or switch on Instrumental.');return;}
   request={mode,caption:caption.trim(),lyrics:lyrics.trim(),instrumental,model,duration:length||null,meta};
  }
  songs.create(request);
 }
 const query=filter.trim().toLowerCase();
 const shown=songs.songs.filter(s=>!query||(s.title+' '+s.caption).toLowerCase().includes(query));
 return <div className="generate">
  <form className="gen-form" onSubmit={create} aria-label="Make a song">
   <div className="gen-modes" role="tablist" aria-label="How to describe the song">
    {(['simple','custom'] as const).map(m=><button key={m} type="button" role="tab" aria-selected={mode===m} className={mode===m?'on':''} onClick={()=>setMode(m)}>{m==='simple'?'Simple':'Custom'}</button>)}
   </div>
   {mode==='simple'?<>
    <label className="gen-field"><span>Describe the song</span>
     <textarea value={idea} onChange={e=>setIdea(e.target.value)} rows={5} maxLength={500} placeholder="A warm acoustic love song about the first snow, soft female vocal…"/></label>
    <p className="gen-note">Kiku writes the style and lyrics from your idea, then performs it with {model==='yue2'?'YuE2':'ACE-Step 1.5'}.</p>
   </>:<>
    <label className="gen-field"><span>Style</span>
     <textarea value={caption} onChange={e=>{setCaption(e.target.value);setMeta(undefined);}} rows={4} maxLength={2000} placeholder="Genre, mood, instruments, texture, era: e.g. dreamy indie pop, shimmering guitars, soft female vocal, warm and nostalgic"/></label>
    <div className="prompt-tools gen-tools">
     <PromptHelper value={caption} change={v=>{setCaption(v);setMeta(undefined);}} vocals={!instrumental}/>
     <button type="button" className={'enhance-button'+(enhancing?' busy':'')} onClick={()=>void enhance()} disabled={enhancing||!caption.trim()}>{enhancing?<span className="spinner"/>:<WandSparkles size={13}/>}{enhancing?'Enhancing…':'Enhance'}</button>
    </div>
    {meta&&(meta.bpm||meta.keyscale)&&<p className="measured">Planned: {[meta.bpm&&`${meta.bpm} BPM`,meta.keyscale,meta.timesignature&&`${String(meta.timesignature).split('/')[0]}/4`].filter(Boolean).join(' · ')}</p>}
    {!instrumental&&<label className="gen-field"><span>Lyrics</span>
     <textarea ref={lyricsBox} className="gen-lyrics" value={lyrics} onChange={e=>setLyrics(e.target.value)} rows={9} maxLength={4000} placeholder={'[Verse]\nYour first lines here\n\n[Chorus]\nThe part everyone sings'}/></label>}
    {!instrumental&&<div className="gen-tags" aria-label="Insert a section">{TAGS.map(t=><button key={t} type="button" onClick={()=>tag(t)}>[{t}]</button>)}</div>}
    {!instrumental&&<p className="gen-note">Keep lines to about 6–10 syllables and leave a blank line between sections.</p>}
   </>}
    <div className="gen-row">
     <label className="gen-select"><span>Model</span><select value={model} onChange={e=>setModel(e.target.value as 'ace15'|'yue2')}>
      <option value="ace15">ACE-Step 1.5 · fast, follows the style</option><option value="yue2">YuE2 · strong vocals and melody</option></select></label>
     {mode==='custom'&&<label className="gen-select"><span>Length</span><select value={model==='yue2'&&!instrumental?0:length} onChange={e=>setLength(Number(e.target.value))} disabled={model==='yue2'&&!instrumental}>
      {LENGTHS.map(l=><option key={l.value} value={l.value}>{l.label}</option>)}</select></label>}
    </div>
   <label className="gen-switch"><input type="checkbox" checked={instrumental} onChange={e=>setInstrumental(e.target.checked)}/><span>Instrumental</span></label>
   {error&&<p className="gen-error" role="alert">{error}</p>}
   <button type="submit" className="gen-create"><AudioLines size={17}/> Create</button>
  </form>

  <section className="gen-list" aria-label="Your songs">
   <header><h1>Your songs</h1><label className="gen-search"><Search size={14}/><input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Search" aria-label="Search your songs"/></label></header>
   {songs.needsStorage&&<div className="storage-banner"><CloudUpload size={18}/><div><strong>Keep your songs</strong><span>Allow Kiku AI to save them to a private dataset in your Hugging Face account, so they are here next time.</span></div>
    <button onClick={()=>allowSaving('/generate')}>Allow saving</button></div>}
   {(songs.error)&&<p className="gen-error" role="alert">{songs.error}</p>}
   <ul className="song-list">
    {songs.making.map(m=><MakingRow key={m.id} item={m} now={now} cancel={()=>songs.cancel(m.id)} dismiss={()=>songs.dismiss(m.id)}/>)}
    {shown.map(s=><SongRow key={s.id} item={s} audioUrl={songs.audioUrl} remove={i=>void songs.remove(i)} rename={(i,t)=>void songs.rename(i,t)} paint={i=>void songs.paint(i)} painting={songs.painting.has(s.id)}/>)}
   </ul>
   {songs.loading&&!songs.songs.length&&<p className="gen-empty"><span className="spinner"/> Opening your library…</p>}
   {!songs.loading&&!songs.songs.length&&!songs.making.length&&<p className="gen-empty">Your songs will appear here. Describe one on the left to begin.</p>}
  </section>
 </div>;
}
