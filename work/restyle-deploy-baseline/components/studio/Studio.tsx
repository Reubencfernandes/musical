'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Play,Pause,Square,SkipBack,Repeat,Circle,MousePointer2,TextCursor,Undo2,Redo2,ZoomIn,ZoomOut,
 SlidersHorizontal,Magnet,Scissors,LogOut,Mic,FolderOpen,FileMusic,AudioWaveform,ChevronDown,
 Download,Library,Sparkles,X,Volume2,Headphones,Maximize2,Keyboard} from 'lucide-react';
import Arrangement,{type Tool} from './Arrangement';
import Mixer from './Mixer';
import AIPanel,{type Create} from './AIPanel';
import Browser,{INSTRUMENTS} from './Browser';
import {useJobs,type Target} from './useJobs';
import {type Project,type Range,type Selection,type Track,EMPTY,addTrack,clipEnd,formatBars,formatTime,projectEnd,splitClip,uid} from '@/lib/studio/model';
import {Player,encodeWav,renderMix} from '@/lib/studio/audio';

type History={past:Project[];present:Project;future:Project[]};
const DEPTH=100;
const DIVISIONS=[{value:0,label:'Off'},{value:0.25,label:'Bar'},{value:1,label:'Beat'},{value:2,label:'1/8'},{value:4,label:'1/16'}];

/**
 * Undo history over immutable project snapshots. Drags and fader moves call
 * `checkpoint` once when the gesture starts and `preview` while it moves, so a
 * whole gesture is one undo step.
 */
function useHistory(initial:Project){
 const [state,setState]=useState<History>({past:[],present:initial,future:[]});
 const commit=useCallback((fn:(p:Project)=>Project)=>setState(s=>{
  const next=fn(s.present);
  return next===s.present?s:{past:[...s.past.slice(-DEPTH),s.present],present:next,future:[]};
 }),[]);
 const preview=useCallback((fn:(p:Project)=>Project)=>setState(s=>({...s,present:fn(s.present)})),[]);
 const checkpoint=useCallback(()=>setState(s=>({past:[...s.past.slice(-DEPTH),s.present],present:s.present,future:[]})),[]);
 const undo=useCallback(()=>setState(s=>s.past.length?{past:s.past.slice(0,-1),present:s.past[s.past.length-1],future:[s.present,...s.future]}:s),[]);
 const redo=useCallback(()=>setState(s=>s.future.length?{past:[...s.past,s.present],present:s.future[0],future:s.future.slice(1)}:s),[]);
 return {project:state.present,canUndo:state.past.length>0,canRedo:state.future.length>0,commit,preview,checkpoint,undo,redo};
}

export default function Studio({user,signOut}:{user:{name:string};signOut:()=>void}){
 const player=useMemo(()=>new Player(),[]);
 const buffers=useRef(new Map<string,AudioBuffer>()).current;
 const history=useHistory(EMPTY);
 const {project,commit,preview,checkpoint}=history;
 const latest=useRef(project);latest.current=project;
 const [selection,setSelection]=useState<Selection>({clips:[],range:null});
 const [zoom,setZoom]=useState(18),[tool,setTool]=useState<Tool>('pointer'),[division,setDivision]=useState(1);
 const [playing,setPlaying]=useState(false),[loop,setLoop]=useState<Range|null>(null);
 const [master,setMaster]=useState(1),[mixerOpen,setMixerOpen]=useState(false);
 const [libraryOpen,setLibraryOpen]=useState(false),[aiOpen,setAiOpen]=useState(true);
 const [projectName,setProjectName]=useState('Untitled project');
 const [helpOpen,setHelpOpen]=useState(false);
 const filePicker=useRef<HTMLInputElement>(null);
 const [create,setCreate]=useState<Create>({kind:'part',instrument:INSTRUMENTS[0].id,label:INSTRUMENTS[0].label});
 const [recording,setRecording]=useState(false),[recordSeconds,setRecordSeconds]=useState(0);
 const [exporting,setExporting]=useState(false),[notice,setNotice]=useState(''),[expired,setExpired]=useState(false);
 const recorder=useRef<{media:MediaRecorder;stream:MediaStream;from:number;latency:number}|null>(null);
 const clock=useRef<HTMLSpanElement>(null),bars=useRef<HTMLSpanElement>(null);

 const position=useCallback(()=>player.position(),[player]);
 const jobs=useJobs({player,buffers,project:()=>latest.current,playhead:position,commit,signedOut:()=>setExpired(true),pause:()=>{player.stop();setPlaying(false);}});

 useEffect(()=>()=>{player.close();recorder.current?.stream.getTracks().forEach(t=>t.stop());},[player]);
 useEffect(()=>{
  const warn=(event:BeforeUnloadEvent)=>{if(latest.current.clips.length){event.preventDefault();}};
  window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
 },[]);

 const play=useCallback(async(from:number)=>{
  await player.play(latest.current,buffers,from,master);setPlaying(true);
 },[buffers,master,player]);
 const stop=useCallback(()=>{player.stop();setPlaying(false);},[player]);
 const toggle=useCallback(()=>{if(player.playing)stop();else void play(player.position());},[play,player,stop]);
 const seek=useCallback((time:number)=>{if(player.playing)void play(time);else player.seek(time);},[play,player]);

 // Mixer moves apply live; clip edits reschedule playback once they settle.
 useEffect(()=>{if(player.ctx)player.mix(project,master);},[player,project.tracks,master]);
 useEffect(()=>{
  if(!player.playing)return;
  const timer=setTimeout(()=>{if(player.playing)void player.play(latest.current,buffers,player.position(),master);},120);
  return()=>clearTimeout(timer);
 },[buffers,master,player,project.clips]);

 // The clock is drawn every frame outside React.
 useEffect(()=>{
  let frame=0;
  const tick=()=>{
   const at=player.position();
   if(clock.current)clock.current.textContent=formatTime(at);
   if(bars.current)bars.current.textContent=formatBars(at,latest.current.bpm);
   frame=requestAnimationFrame(tick);
  };
  frame=requestAnimationFrame(tick);
  return()=>cancelAnimationFrame(frame);
 },[player]);
 // Looping and stopping at the end run on a timer, because animation frames
 // pause in a background tab while the audio keeps playing.
 useEffect(()=>{
  const timer=setInterval(()=>{
   if(!player.playing)return;
   const at=player.position();
   if(loop&&at>=loop.end)void player.play(latest.current,buffers,loop.start,master);
   else if(!loop&&!recorder.current&&at>projectEnd(latest.current)+1&&latest.current.clips.length){player.stop();player.seek(0);setPlaying(false);}
  },25);
  return()=>clearInterval(timer);
 },[buffers,loop,master,player]);

 useEffect(()=>{if(!recording)return;const t=setInterval(()=>setRecordSeconds(s=>s+1),1000);return()=>clearInterval(t);},[recording]);
 useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),5000);return()=>clearTimeout(t);},[notice]);

 const addAudio=useCallback((name:string,buffer:AudioBuffer,start:number)=>{
  const id=uid();buffers.set(id,buffer);
  commit(p=>{
   const [next,track]=addTrack(p,name);
   return {...next,clips:[...next.clips,{id:uid(),trackId:track.id,buffer:id,start:Math.max(0,start),offset:0,duration:buffer.duration,name}]};
  });
 },[buffers,commit]);

 const importFiles=useCallback(async(files:File[],at=player.position())=>{
  for(const file of files){
   if(file.size>150*1024*1024){setNotice(`${file.name} is over 150 MB.`);continue;}
   try{addAudio(file.name.replace(/\.[^.]+$/,'').slice(0,40)||'Audio',await player.decode(await file.arrayBuffer()),at);}
   catch{setNotice(`${file.name} could not be read. Try MP3, WAV, M4A, OGG or FLAC.`);}
  }
 },[addAudio,player]);

 /**
  * Record over the project. Playback starts with the recorder so the singer
  * hears the band, and the take is moved earlier by the output and input
  * latency so it lands where it was sung rather than where it was captured.
  */
 const record=useCallback(async()=>{
  if(recorder.current){recorder.current.media.stop();return;}
  if(!navigator.mediaDevices?.getUserMedia){setNotice('Recording needs a supported browser and a secure connection.');return;}
  try{
   const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
   const media=new MediaRecorder(stream),parts:Blob[]=[];
   const from=player.position();
   const input=(stream.getAudioTracks()[0]?.getSettings() as {latency?:number}).latency||0;
   recorder.current={media,stream,from,latency:0};
   media.ondataavailable=e=>{if(e.data.size)parts.push(e.data);};
   media.onstart=()=>{
    if(!recorder.current)return;
    recorder.current.latency=player.latency()+input;
    if(latest.current.clips.some(c=>!c.muted))void play(from);
   };
   media.onstop=async()=>{
    const take=recorder.current;recorder.current=null;
    stream.getTracks().forEach(t=>t.stop());setRecording(false);stop();
    try{
     const buffer=await player.decode(await new Blob(parts,{type:media.mimeType}).arrayBuffer());
     const count=latest.current.tracks.filter(t=>t.name.startsWith('Take')).length+1;
     addAudio(`Take ${count}`,buffer,take?take.from-take.latency:from);
     player.seek(from);
    }catch{setNotice('The recording could not be decoded. Try again, or import a file.');}
   };
   media.start(500);setRecordSeconds(0);setRecording(true);
  }catch{setNotice('Microphone access was not available. Allow it in your browser, or import a file.');}
 },[addAudio,play,player,stop]);

 const exportMix=useCallback(async()=>{
  setExporting(true);
  try{
   const buffer=await renderMix(latest.current,buffers,{start:0,end:projectEnd(latest.current),rate:48000,gain:master});
   save(encodeWav(buffer),'kiku-mix.wav');
  }catch{setNotice('The mix could not be rendered.');}
  finally{setExporting(false);}
 },[buffers,master]);

 const download=useCallback(async(target:Target)=>{
  const buffer=await renderMix(latest.current,buffers,{start:target.start,end:target.end,clips:target.clips.map(c=>c.id),mixer:target.clips.length>1});
  save(encodeWav(buffer),'kiku-selection.wav');
 },[buffers]);

 const changeTrack=useCallback((id:string,patch:Partial<Track>)=>
  preview(p=>({...p,tracks:p.tracks.map(t=>t.id===id?{...t,...patch}:t)})),[preview]);
 const renameTrack=useCallback((id:string,patch:Partial<Track>)=>
  commit(p=>({...p,tracks:p.tracks.map(t=>t.id===id?{...t,...patch}:t)})),[commit]);
 const removeTrack=useCallback((id:string)=>{
  commit(p=>({...p,tracks:p.tracks.filter(t=>t.id!==id),clips:p.clips.filter(c=>c.trackId!==id)}));
  setSelection({clips:[],range:null});
 },[commit]);

 /** Split selected clips at the playhead, or every clip a range touches at its edges. */
 const split=useCallback(()=>{
  const range=selection.range,at=player.position();
  commit(p=>{
   let next=p;
   const ids=range?p.clips.filter(c=>range.tracks.includes(c.trackId)).map(c=>c.id):selection.clips;
   for(const id of ids){
    if(range){let parts:string[];[next,parts]=splitClip(next,id,range.start);for(const part of parts)[next]=splitClip(next,part,range.end);}
    else [next]=splitClip(next,id,at);
   }
   return next;
  });
 },[commit,player,selection]);

 const remove=useCallback(()=>{
  const range=selection.range;
  if(range){
   commit(p=>{
    let next=p;
    for(const clip of p.clips.filter(c=>range.tracks.includes(c.trackId))){
     let parts:string[];[next,parts]=splitClip(next,clip.id,range.start);
     for(const part of parts)[next]=splitClip(next,part,range.end);
    }
    return {...next,clips:next.clips.filter(c=>!(range.tracks.includes(c.trackId)&&c.start>=range.start-1e-6&&clipEnd(c)<=range.end+1e-6))};
   });
  }else if(selection.clips.length)commit(p=>({...p,clips:p.clips.filter(c=>!selection.clips.includes(c.id))}));
  setSelection({clips:[],range:null});
 },[commit,selection]);

 const duplicate=useCallback(()=>{
  const chosen=latest.current.clips.filter(c=>selection.clips.includes(c.id));
  if(!chosen.length)return;
  const span=Math.max(...chosen.map(clipEnd))-Math.min(...chosen.map(c=>c.start));
  const copies=chosen.map(c=>({...c,id:uid(),start:c.start+span}));
  commit(p=>({...p,clips:[...p.clips,...copies]}));
  setSelection({clips:copies.map(c=>c.id),range:null});
 },[commit,selection]);

 const toggleMute=useCallback(()=>{
  if(!selection.clips.length)return;
  commit(p=>{const all=p.clips.filter(c=>selection.clips.includes(c.id)).every(c=>c.muted);
   return {...p,clips:p.clips.map(c=>selection.clips.includes(c.id)?{...c,muted:!all}:c)};});
 },[commit,selection]);

 const toggleLoop=useCallback(()=>{
  if(loop){setLoop(null);return;}
  const range=selection.range;
  const chosen=latest.current.clips.filter(c=>selection.clips.includes(c.id));
  const start=range?range.start:chosen.length?Math.min(...chosen.map(c=>c.start)):player.position();
  const end=range?range.end:chosen.length?Math.max(...chosen.map(clipEnd)):start+4*60/latest.current.bpm*4;
  setLoop({start,end,tracks:[]});
 },[loop,player,selection]);

 useEffect(()=>{
  const key=(event:KeyboardEvent)=>{
   if(event.defaultPrevented)return;
   const target=event.target;
   if(target instanceof Element&&target.closest('input,textarea,select,[contenteditable=true],[role=dialog]'))return;
   const mod=event.ctrlKey||event.metaKey,k=event.key.toLowerCase();
   if((k===' '||k==='enter')&&target instanceof Element&&target.closest('button,a,summary,[role=option],[role=tab]'))return;
   const act=(fn:()=>void)=>{event.preventDefault();fn();};
   if(k===' ')act(toggle);
   else if(mod&&k==='z')act(event.shiftKey?history.redo:history.undo);
   else if(mod&&k==='y')act(history.redo);
   else if(mod&&k==='d')act(duplicate);
   else if(mod&&k==='a')act(()=>setSelection({clips:latest.current.clips.map(c=>c.id),range:null}));
   else if(mod)return;
   else if(k==='delete'||k==='backspace')act(remove);
   else if(k==='s')act(split);
   else if(k==='m')act(toggleMute);
   else if(k==='l')act(toggleLoop);
   else if(k==='v')act(()=>setTool('pointer'));
   else if(k==='r')act(()=>setTool('range'));
   else if(k==='home'||k==='enter')act(()=>seek(0));
   else if(k==='escape')act(()=>setSelection({clips:[],range:null}));
   else if(k==='='||k==='+')act(()=>setZoom(z=>Math.min(240,z*1.25)));
   else if(k==='-')act(()=>setZoom(z=>Math.max(4,z/1.25)));
  };
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
 },[duplicate,history.redo,history.undo,remove,seek,split,toggle,toggleLoop,toggleMute]);

 const ghosts=jobs.jobs.filter(j=>!j.error).map(j=>({id:j.id,label:`${j.label}: ${j.status}`,start:j.start,end:j.end}));
 const empty=<div className="empty-state">
  <span className="empty-symbol"><AudioWaveform size={28} strokeWidth={1.5}/></span>
  <span className="empty-eyebrow">A LITTLE IDEA. A WHOLE NEW SOUND.</span>
  <h2>Your next song starts here.</h2>
  <p>Drop in a recording, lay down a take,<br/>or make something new with Kiku.</p>
  <div><button className="run-button" onClick={record}><Mic size={15}/> Record a take</button>
   <button className="tool-button wide" onClick={()=>filePicker.current?.click()}><FolderOpen size={15}/> Import audio</button></div>
  <span className="empty-formats">MP3, WAV, M4A, OGG or FLAC</span>
 </div>;

 return <div className={'studio'+(libraryOpen?' library-open':'')+(mixerOpen?' mixer-open':'')}>
  <input ref={filePicker} type="file" accept="audio/*" multiple className="sr-only" aria-label="Import audio files"
   onChange={e=>{void importFiles([...(e.target.files||[])]);e.target.value='';}}/>
  <header className="studio-bar">
   <div className="studio-brand">
    <a href="/studio" className="studio-logo" aria-label="Kiku Studio">KIKU<span className="logo-dot"/></a>
    <details className="project-menu">
     <summary className="header-pill"><span>{projectName}</span><ChevronDown size={12}/></summary>
     <div className="studio-popover">
      <label className="project-name-label">Project name<input value={projectName} maxLength={50} onChange={e=>setProjectName(e.target.value)} onBlur={()=>{if(!projectName.trim())setProjectName('Untitled project');}}/></label>
      <button onClick={()=>filePicker.current?.click()}><FolderOpen size={15}/> Import audio</button>
      <a href="/score"><FileMusic size={15}/> Sheet music</a>
      <div className="account-row"><span>{user.name}</span><button onClick={signOut} title="Sign out" aria-label="Sign out"><LogOut size={15}/></button></div>
     </div>
    </details>
    <div className="history-buttons header-pill">
     <button onClick={history.undo} disabled={!history.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo"><Undo2 size={14}/></button>
     <button onClick={history.redo} disabled={!history.canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><Redo2 size={14}/></button>
    </div>
   </div>
   <div className="studio-transport">
   <div className="transport" role="group" aria-label="Transport">
    <button onClick={()=>seek(0)} title="To start (Home)" aria-label="To start"><SkipBack size={15}/></button>
    <button className={'play'+(playing?' on':'')} onClick={toggle} title="Play / pause (Space)" aria-label={playing?'Pause':'Play'}>{playing?<Pause size={16}/>:<Play size={16}/>}</button>
    <button onClick={()=>{stop();player.seek(0);}} title="Stop" aria-label="Stop"><Square size={12}/></button>
    <button className={'rec'+(recording?' on':'')} onClick={record} title="Record a take" aria-label={recording?'Stop recording':'Record a take'} aria-pressed={recording}><Circle size={13} fill="currentColor"/></button>
    <button className={loop?'on':''} onClick={toggleLoop} title="Loop the selection (L)" aria-label="Loop selection" aria-pressed={!!loop}><Repeat size={15}/></button>
   </div>
   <div className="lcd" aria-label="Position"><AudioWaveform size={13}/><span ref={clock} className="lcd-time">0:00.000</span><span ref={bars} className="lcd-bars">1.1.00</span></div>
   </div>
   <div className="studio-header-actions">
    <label className="tempo-pill header-pill" title="Project tempo"><input type="number" aria-label="Project tempo" min={40} max={300} step={0.1} value={project.bpm}
     onChange={e=>{const bpm=Number(e.target.value);if(bpm>=40&&bpm<=300)commit(p=>({...p,bpm}));}}/><span>BPM</span><span className="time-signature">4/4</span></label>
    <button className="header-pill" onClick={exportMix} disabled={exporting||!project.clips.length}><Download size={14}/><span>{exporting?'Rendering…':'Export'}</span></button>
    <button className={'header-pill'+(libraryOpen?' on':'')} onClick={()=>setLibraryOpen(o=>!o)} aria-expanded={libraryOpen} aria-controls="studio-library"><Library size={14}/><span>Library</span></button>
   </div>
  </header>

  <Arrangement project={project} buffers={buffers} selection={selection} select={next=>{setSelection(next);if(next.clips.length||next.range)setAiOpen(true);}}
   zoom={zoom} setZoom={setZoom} tool={tool} division={division}
   position={position} playing={playing} seek={seek}
   edit={{checkpoint,preview,commit}} ghosts={ghosts} loop={loop}
   changeTrack={renameTrack} previewTrack={changeTrack} removeTrack={removeTrack}
   addTrack={()=>commit(p=>addTrack(p,`Audio ${p.tracks.length+1}`)[0])}
   dropFiles={(files,at)=>void importFiles(files,at)} empty={empty}/>

  <div className="master-channel">
   <div><Headphones size={13}/><strong>Main</strong><Volume2 size={13}/></div>
   <label className="channel-volume" style={{['--clip' as string]:'#d8d8d8',['--volume' as string]:`${master/2*100}%`}}>
    <input type="range" min={0} max={2} step={0.01} value={master} aria-label="Main volume" onChange={e=>setMaster(Number(e.target.value))}/>
   </label><span className="master-db">{master<=0?'−∞':`${(20*Math.log10(master)).toFixed(1)} dB`}</span>
  </div>

  {libraryOpen&&<div className="library-drawer" id="studio-library">
   <header><span><Library size={15}/> Your library</span><button aria-label="Close library" onClick={()=>setLibraryOpen(false)}><X size={16}/></button></header>
   <p className="library-intro">Find the next layer of your sound.</p>
   <Browser project={project} create={selection.clips.length||selection.range?null:create}
    choose={next=>{setCreate(next);setSelection({clips:[],range:null});setAiOpen(true);setLibraryOpen(false);}}
    recording={recording} recordSeconds={recordSeconds} record={record}
    importFiles={files=>void importFiles(files)} exportMix={exportMix} exporting={exporting}
    setBpm={bpm=>commit(p=>({...p,bpm}))}/>
  </div>}

  <div className={'assistant-dock'+(aiOpen?'':' assistant-hidden')}>
   <AIPanel project={project} selection={selection} create={create} jobs={jobs} download={t=>void download(t)}
    close={()=>setAiOpen(false)} openLibrary={()=>setLibraryOpen(o=>!o)}/>
  </div>

  {mixerOpen&&<div className="mixer-drawer"><header><span><SlidersHorizontal size={15}/> Mixer</span><button aria-label="Close mixer" onClick={()=>setMixerOpen(false)}><X size={16}/></button></header>
   <Mixer project={project} player={player} master={master} setMaster={setMaster}
    change={changeTrack} commitMix={checkpoint}/></div>}

  <footer className="studio-tools" role="toolbar" aria-label="Editing tools">
   <div className="tool-group">
    <button className={'tool-button'+(mixerOpen?' on':'')} onClick={()=>setMixerOpen(o=>!o)} title="Show the mixer" aria-label="Mixer" aria-pressed={mixerOpen}><SlidersHorizontal size={15}/></button>
   </div>
   <div className="tool-group">
    <button className={'tool-button'+(tool==='pointer'?' on':'')} onClick={()=>setTool('pointer')} title="Select and move clips (V)" aria-label="Select tool" aria-pressed={tool==='pointer'}><MousePointer2 size={15}/></button>
    <button className={'tool-button'+(tool==='range'?' on':'')} onClick={()=>setTool('range')} title="Select a stretch of time (R)" aria-label="Range tool" aria-pressed={tool==='range'}><TextCursor size={15}/></button>
    <button className="tool-button" onClick={split} title="Split at the playhead (S)" aria-label="Split clips"><Scissors size={15}/></button>
   </div>
   <label className="tool-group snap" title="Snap to grid"><Magnet size={13}/>
    <select value={division} onChange={e=>setDivision(Number(e.target.value))} aria-label="Snap">
     {DIVISIONS.map(d=><option key={d.value} value={d.value}>{d.label}</option>)}</select></label>
   <span className="tool-hint">{project.tracks.length} tracks<span>·</span>{project.key||'Let’s make some music'}</span>
   <div className="tool-group zoom-tools">
    <button className="tool-button" onClick={()=>setZoom(z=>Math.max(4,z/1.25))} title="Zoom out (-)" aria-label="Zoom out"><ZoomOut size={14}/></button>
    <button className="tool-button" onClick={()=>{const span=Math.max(60,projectEnd(project)+8);setZoom(Math.min(240,Math.max(4,(window.innerWidth-290)/span)));}} title="Fit project" aria-label="Fit project"><Maximize2 size={13}/></button>
    <button className="tool-button" onClick={()=>setZoom(z=>Math.min(240,z*1.25))} title="Zoom in (+)" aria-label="Zoom in"><ZoomIn size={14}/></button>
   </div>
   <button className="tool-button help-button" onClick={()=>setHelpOpen(o=>!o)} aria-expanded={helpOpen} title="Keyboard shortcuts" aria-label="Keyboard shortcuts"><Keyboard size={15}/></button>
   <button className={'assistant-toggle tool-button'+(aiOpen?' on':'')} onClick={()=>setAiOpen(o=>!o)} aria-expanded={aiOpen}><Sparkles size={14}/><span>Kiku AI</span></button>
  </footer>
  {helpOpen&&<div className="shortcuts-popover studio-popover"><header><strong>Make yourself at home</strong><button onClick={()=>setHelpOpen(false)} aria-label="Close shortcuts"><X size={14}/></button></header>
   { [['Play / pause','Space'],['Select tool','V'],['Range tool','R'],['Split clips','S'],['Mute selected clips','M'],['Loop selection','L'],['Undo','Ctrl / ⌘ Z'],['Duplicate clips','Ctrl / ⌘ D']].map(([label,key])=><div className="shortcut" key={label}><span>{label}</span><kbd>{key}</kbd></div>)}
  </div>}
  {notice&&<p className="studio-notice" role="status">{notice}</p>}
  {expired&&<div className="studio-notice expired" role="alert">Your sign-in expired. Your project is still here.
   <button onClick={()=>{window.open('/auth/login?popup=1','kiku-sign-in','width=520,height=730');setExpired(false);}}>Sign in again</button></div>}
 </div>;
}

function save(blob:Blob,name:string){
 const url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=name;link.click();
 setTimeout(()=>URL.revokeObjectURL(url),10000);
}
