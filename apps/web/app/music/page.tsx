'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Download,FileMusic,Sparkles,Square,X} from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';
import StudioNav from '@/components/StudioNav';
import {MELODY_KEY} from '@/lib/types';
import '../music.css';

type Song={id:string;title:string;style:string;lyrics:string;seconds:number;requestedSeconds:number;created:string;elapsedMs:number;seed:number;hasScore:boolean;followsMelody:boolean};
const STYLES:[string,string][]=[
 ['J-pop','J-pop, bright female vocal, upbeat, synth, electric guitar, catchy chorus'],
 ['J-rock','Japanese alternative rock, powerful emotional male vocal, distorted electric guitars, driving drums, anthemic chorus'],
 ['Lo-fi','lo-fi hip hop, mellow, warm keys, vinyl texture, soft vocal, relaxed tempo'],
 ['Acoustic','acoustic folk, fingerpicked guitar, intimate warm vocal, gentle'],
 ['EDM','EDM, four on the floor, bright synth lead, big drop, energetic female vocal'],
 ['Ballad','piano ballad, emotional vocal, strings, slow tempo, cinematic'],
 ['Hip-hop','hip hop, punchy drums, deep bass, confident rap vocal'],
 ['Orchestral','orchestral, cinematic, strings and brass, choir, epic'],
];
const clock=(s:number)=>`${Math.floor(s/60)}:${String(Math.round(s)%60).padStart(2,'0')}`;

export default function Music(){
 const [ready,setReady]=useState(false),[available,setAvailable]=useState(false),[library,setLibrary]=useState('');
 const [style,setStyle]=useState(''),[lyrics,setLyrics]=useState(''),[melody,setMelody]=useState(''),[seconds,setSeconds]=useState(30),[keepScore,setKeepScore]=useState(false);
 const [songs,setSongs]=useState<Song[]>([]),[fresh,setFresh]=useState(''),[error,setError]=useState('');
 const [making,setMaking]=useState(false),[message,setMessage]=useState(''),[elapsed,setElapsed]=useState(0);
 const abort=useRef<AbortController|null>(null);

 const refresh=useCallback(()=>fetch('/api/library',{cache:'no-store'}).then(r=>r.json()).then(d=>setSongs(d.songs||[])).catch(()=>{}),[]);
 useEffect(()=>{
  fetch('/api/generate',{cache:'no-store'}).then(r=>r.json()).then(d=>{setAvailable(!!d.available);setLibrary(d.library||'');}).catch(()=>{}).finally(()=>setReady(true));
  refresh();
  try{const saved=sessionStorage.getItem(MELODY_KEY);if(saved)setMelody(saved);}catch{}
  return()=>abort.current?.abort();
 },[refresh]);
 useEffect(()=>{if(!making)return;const tick=setInterval(()=>setElapsed(t=>t+1),1000);return()=>clearInterval(tick);},[making]);

 // Learn this computer's speed from songs it has already made.
 const measured=songs.filter(s=>s.seconds>5&&s.elapsedMs>0).slice(0,5);
 const pace=measured.length?measured.reduce((sum,s)=>sum+s.elapsedMs/1000/s.seconds,0)/measured.length:0;

 async function generate(){
  if(making)return;
  setError('');setMaking(true);setElapsed(0);setMessage('Starting…');
  const controller=new AbortController();abort.current=controller;
  try{
   const response=await fetch('/api/generate',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({style,lyrics,seconds,melody,keepScore})});
   if(!response.ok||!response.body)throw new Error((await response.json().catch(()=>null))?.error||'The song could not be started.');
   const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
   for(;;){
    const {done,value}=await reader.read();if(done)break;
    buffer+=decoder.decode(value,{stream:true});
    const lines=buffer.split('\n');buffer=lines.pop()||'';
    for(const line of lines){
     if(!line.trim())continue;
     const event=JSON.parse(line) as {type:string;data:unknown};
     if(event.type==='status')setMessage(String(event.data));
     if(event.type==='error')throw new Error(String(event.data));
     if(event.type==='result'){const song=event.data as Song;setFresh(song.id);await refresh();}
    }
   }
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Something went wrong. Please try again.');}
  finally{if(abort.current===controller){abort.current=null;setMaking(false);}}
 }

 return <div className="app-shell">
  <StudioNav current="music"/><ThemeToggle/>
  <main className="music-view">
   {!ready?<div className="auth-loading" role="status" aria-label="Loading"><span className="spinner"/></div>:!available?
    <section className="desktop-only view-enter"><h1>Music lives in the desktop app.</h1><p>Generating songs runs on your own computer&apos;s GPU, so it is part of Kiku Studio for Mac and Windows. Transcribing audio into sheet music works right here.</p></section>:
    <>
     <form className="music-panel view-enter" onSubmit={e=>{e.preventDefault();generate();}}>
      <div className="panel-intro"><h1>Make a song.</h1><p>Describe the sound, write the words, choose the length.<br/>Everything is made and kept on this computer.</p></div>
      <label className="field" htmlFor="style">Style</label>
      <div className="style-chips">{STYLES.map(([name,tags])=><button type="button" key={name} onClick={()=>setStyle(tags)} disabled={making}>{name}</button>)}</div>
      <input id="style" type="text" value={style} onChange={e=>setStyle(e.target.value)} placeholder="Genre, voice, instruments, mood…" maxLength={2000} disabled={making}/>
      <label className="field" htmlFor="lyrics">Lyrics</label>
      <textarea id="lyrics" className="lyrics" value={lyrics} onChange={e=>setLyrics(e.target.value)} placeholder={'[verse]\n…\n\n[chorus]\n…'} maxLength={12000} disabled={making}/>
      <label className="field" htmlFor="length">Length</label>
      <div className="length-row"><input id="length" type="range" min={10} max={180} step={5} value={seconds} onChange={e=>setSeconds(Number(e.target.value))} disabled={making}/><output htmlFor="length">{clock(seconds)}</output></div>
      <p className="length-note">Up to 3 minutes. The song ends early if the lyrics run out{pace?<> · about {clock(seconds*pace)} to make on this computer</>:null}.</p>
      <details className="melody-toggle" open={!!melody}><summary>Use a score{melody?' · one is loaded':''}</summary>
       <textarea className="melody" value={melody} onChange={e=>setMelody(e.target.value)} placeholder="Paste ABC notation — for example a score you transcribed in the Score room. Leave this empty to write a brand new song." maxLength={20000} disabled={making}/>
       {melody&&<div className="route-choice" role="radiogroup" aria-label="How to use this score">
        <label><input type="radio" name="route" checked={!keepScore} onChange={()=>setKeepScore(false)} disabled={making}/><span><strong>Cover</strong> — keep the tune, rewrite the arrangement in your style</span></label>
        <label><input type="radio" name="route" checked={keepScore} onChange={()=>setKeepScore(true)} disabled={making}/><span><strong>Render this score</strong> — follow the harmony and form as written, for a score you edited</span></label>
       </div>}
      </details>
      {error&&<div className="error-message" role="alert"><p>{error}</p><button type="button" onClick={()=>setError('')} aria-label="Dismiss error"><X size={17}/></button></div>}
      {making?<div className="making" role="status"><span className="spinner"/><span>{message}</span><span className="time">{clock(elapsed)}</span><button type="button" className="clear-button" onClick={()=>abort.current?.abort()}><Square size={12} fill="currentColor"/> Stop</button></div>:
       <div className="panel-actions"><span>Runs on this computer&apos;s GPU</span><button type="submit" className="primary-button" disabled={!style.trim()||!lyrics.trim()}><Sparkles size={16}/> Generate</button></div>}
     </form>
     <section className="library" aria-label="Your songs">
      <h2>Your songs</h2><p>{songs.length?`Saved in ${library}`:'Songs you make appear here, saved on this computer.'}</p>
      {songs.map(song=><article key={song.id} className={`song ${song.id===fresh?'fresh':''}`}>
       <header><strong>{song.title}</strong><span>{clock(song.seconds)} · {new Date(song.created).toLocaleDateString()}</span></header>
       <p className="style">{song.followsMelody?'Follows a melody · ':''}{song.style}</p>
       <audio controls preload="none" src={`/api/library/${song.id}`}/>
       <div className="song-actions">
        <a href={`/api/library/${song.id}?download`}><Download size={14}/> WAV</a>
        {song.hasScore&&<a href={`/api/library/${song.id}?file=score&download`}><FileMusic size={14}/> Melody · ABC</a>}
        <button type="button" onClick={()=>{setStyle(song.style);setLyrics(song.lyrics);scrollTo({top:0,behavior:'smooth'});}} disabled={making}>Use these settings</button>
       </div>
      </article>)}
     </section>
    </>}
  </main>
 </div>;
}
