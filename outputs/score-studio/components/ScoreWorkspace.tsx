'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowDown,ArrowUp,ChevronDown,Code2,Download,Music2,Pause,Play,Printer,Redo2,Repeat2,RotateCcw,SkipBack,Undo2,Volume2,VolumeX,X} from 'lucide-react';
import type {NoteTimingEvent,TuneObject} from 'abcjs';
import type {Source,ScoreResult} from '@/lib/types';
import OriginalAudioPlayer from '@/components/OriginalAudioPlayer';
import {instruments} from '@/lib/instruments';
import {prepareScore,SampleCache,type Playback} from '@/lib/score-playback';

type AbcLibrary=typeof import('abcjs');
type Selection={start:number;end:number;token:string};
const editingEnabled=false;
const clock=(seconds:number)=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
function save(text:string,name:string,type='text/plain'){
 const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export default function ScoreWorkspace({result,source,onNew}:{result:ScoreResult;source:Source;onNew:()=>void}){
 const [history,setHistory]=useState([result.abc]),[index,setIndex]=useState(0);
 const abc=history[index],edited=abc!==result.abc;
 const [codeOpen,setCodeOpen]=useState(false),[selection,setSelection]=useState<Selection|null>(null);
 const [playing,setPlaying]=useState(false),[loading,setLoading]=useState(false),[position,setPosition]=useState(0),[total,setTotal]=useState(0);
 const [speed,setSpeed]=useState(100),[volume,setVolume]=useState(1),[loop,setLoop]=useState(false),[follow,setFollow]=useState(true);
 const [instrument,setInstrument]=useState(0);
 const instrumentName=instruments.find(item=>item.program===instrument)?.name||'Piano';
 const [problem,setProblem]=useState(''),[notice,setNotice]=useState(''),[ready,setReady]=useState(false);
 const paper=useRef<HTMLDivElement>(null),scoreScroll=useRef<HTMLDivElement>(null),textarea=useRef<HTMLTextAreaElement>(null);
 const lib=useRef<AbcLibrary|null>(null),tune=useRef<TuneObject|null>(null),audio=useRef<AudioContext|null>(null),gain=useRef<GainNode|null>(null),node=useRef<{stop:()=>void}|null>(null),buffer=useRef<Playback|null>(null);
 const preparation=useRef<{revision:number;promise:Promise<void>}|null>(null);
 const [starting,setStarting]=useState(false),playRequest=useRef<number|null>(null);
 const soundCache=useRef(new SampleCache()),volumeRef=useRef(volume);
 volumeRef.current=volume;
 const timings=useRef<NoteTimingEvent[]>([]),offset=useRef(0),started=useRef(0),isPlaying=useRef(false),generation=useRef(0),loopRef=useRef(loop),followRef=useRef(follow),lastEvent=useRef(-1);
 loopRef.current=loop;followRef.current=follow;
 const mark=useCallback((seconds:number)=>{
  const events=timings.current,ms=seconds*1000;let lo=0,hi=events.length-1,found=-1;
  while(lo<=hi){const mid=(lo+hi)>>1;if(events[mid].milliseconds<=ms){found=mid;lo=mid+1;}else hi=mid-1;}
  if(found===lastEvent.current)return;lastEvent.current=found;
  paper.current?.querySelectorAll('.current-note').forEach(n=>n.classList.remove('current-note'));
  const event=events[found];if(!event||event.type==='end'||event.left==null)return;
  event.elements?.flat().forEach(el=>el?.classList.add('current-note'));
  const svg=paper.current?.querySelector('svg');if(!svg)return;
  let line=svg.querySelector('.playhead');if(!line){line=document.createElementNS('http://www.w3.org/2000/svg','line');line.setAttribute('class','playhead');svg.append(line);}
  line.setAttribute('x1',String(event.left-3));line.setAttribute('x2',String(event.left-3));line.setAttribute('y1',String(event.top||0));line.setAttribute('y2',String((event.top||0)+(event.height||0)));
  const pane=scoreScroll.current;if(followRef.current&&pane){const rect=line.getBoundingClientRect(),bound=pane.getBoundingClientRect();if(rect.top<bound.top+30||rect.bottom>bound.bottom-30)pane.scrollBy({top:rect.top-bound.top-70,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
 },[]);
 const stop=useCallback(()=>{
  playRequest.current=null;setStarting(false);
  if(isPlaying.current&&audio.current)offset.current=Math.min((buffer.current?.duration||0),offset.current+audio.current.currentTime-started.current);
  if(node.current){node.current.stop();node.current=null;}
  isPlaying.current=false;setPlaying(false);
 },[]);
 const startBuffer=useCallback((at:number)=>{
  const ctx=audio.current,buf=buffer.current;if(!ctx||!buf||!gain.current)return;
  offset.current=Math.max(0,Math.min(at,buf.duration-.001));started.current=ctx.currentTime;isPlaying.current=true;setPlaying(true);
  node.current=buf.start(ctx,gain.current,offset.current,()=>{if(loopRef.current){isPlaying.current=false;node.current=null;startBuffer(0);}else{isPlaying.current=false;node.current=null;offset.current=0;setPlaying(false);setPosition(0);lastEvent.current=-1;paper.current?.querySelectorAll('.current-note,.playhead').forEach(n=>n.classList.contains('playhead')?n.remove():n.classList.remove('current-note'));}});
 },[]);
 const commit=useCallback((next:string)=>{if(next===abc)return;stop();setHistory(h=>[...h.slice(0,index+1),next]);setIndex(index+1);setNotice('Edits applied. Playback uses this version.');},[abc,index,stop]);
 const undo=useCallback(()=>{if(index>0){stop();setIndex(i=>i-1);setSelection(null);}},[index,stop]);
 const redo=useCallback(()=>{if(index<history.length-1){stop();setIndex(i=>i+1);setSelection(null);}},[index,history.length,stop]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();if(e.shiftKey)redo();else undo();}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo();}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[undo,redo]);
 useEffect(()=>{
  const revision=++generation.current;stop();tune.current=null;buffer.current=null;offset.current=0;setPosition(0);setTotal(0);setLoading(false);setReady(false);setProblem('');lastEvent.current=-1;
  const timer=setTimeout(async()=>{
   const ABC=await import('abcjs');if(revision!==generation.current||!paper.current)return;lib.current=ABC;
   try{
    if(!/\nK:/.test(abc)||!abc.trim())throw new Error('The score needs a K: key field and some notes. Undo or restore the AI score.');
    const visual=ABC.renderAbc(paper.current,abc,{add_classes:true,selectTypes:['note'],selectionColor:'#cd7815',responsive:'resize',staffwidth:850,paddingtop:30,paddingbottom:40,
     clickListener:(el,_n,_classes,analysis)=>{if(el.el_type!=='note'||typeof el.startChar!=='number'||typeof el.endChar!=='number')return;
      if(!editingEnabled){const event=timings.current.find(event=>event.elements?.flat().some(element=>element===analysis.selectableElement||analysis.selectableElement?.contains(element)));if(event)seek(event.milliseconds/1000);return;}
      const selected={start:el.startChar,end:el.endChar,token:abc.slice(el.startChar,el.endChar)};setSelection(selected);
      paper.current?.querySelectorAll('.selected-note').forEach(n=>n.classList.remove('selected-note'));analysis.selectableElement?.classList.add('selected-note');
      if(textarea.current){textarea.current.focus({preventScroll:true});textarea.current.setSelectionRange(selected.start,selected.end);}
     }})[0];
    if(!visual||!paper.current.querySelector('.abcjs-note'))throw new Error('No playable notes found. Check the notation, undo, or restore the AI score.');
    tune.current=visual;
    const timing=new ABC.TimingCallbacks(visual,{qpm:visual.getBpm(visual.metaText.tempo)*speed/100});
    timings.current=timing.noteTimings;
    setTotal(Math.max(0,...timing.noteTimings.map(event=>event.milliseconds))/1000);
    setReady(true);
    setNotice(visual.warnings?.length?'Some notation could not be read. Check your edit before playing.':'');
   }catch(e){setProblem(e instanceof Error?e.message:'This notation could not be read.');tune.current=null;}
  },180);return()=>clearTimeout(timer);
 },[abc,speed,instrument,stop]);
 useEffect(()=>{let frame=0;const tick=()=>{if(isPlaying.current&&audio.current){const time=offset.current+audio.current.currentTime-started.current;setPosition(time);mark(time);}frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);},[mark]);
 useEffect(()=>{if(gain.current)gain.current.gain.value=volume;},[volume]);
 useEffect(()=>()=>{generation.current++;stop();gain.current?.disconnect();},[stop]);
 const preparePlayback=useCallback(async()=>{
  if(!ready||!lib.current||!tune.current)return;
  const rev=generation.current;
  if(buffer.current)return;
  if(preparation.current?.revision===rev)return preparation.current.promise;
  const originalTune=tune.current;
  const promise=(async()=>{try{
    setLoading(true);setProblem('');
    if(!audio.current){audio.current=new AudioContext();gain.current=audio.current.createGain();gain.current.gain.value=volumeRef.current;gain.current.connect(audio.current.destination);}
    const prepared=await prepareScore(audio.current,originalTune,instrument,speed,soundCache.current,()=>rev===generation.current);
    if(rev!==generation.current)return;
    buffer.current=prepared;setTotal(prepared.duration);
   }catch(e){if(rev===generation.current)setProblem(e instanceof Error?e.message:'Playback failed. Please try again.');}
   finally{if(rev===generation.current)setLoading(false);if(preparation.current?.revision===rev)preparation.current=null;}
  })();
  preparation.current={revision:rev,promise};return promise;
 },[ready,abc,speed,instrument,instrumentName]);
 useEffect(()=>{if(ready)void preparePlayback();},[ready,preparePlayback]);
 async function toggle(){
  if(playing){stop();return;}if(!ready||playRequest.current!==null)return;
  const rev=generation.current;
  playRequest.current=rev;setStarting(true);
  try{
   if(!audio.current){audio.current=new AudioContext();gain.current=audio.current.createGain();gain.current.gain.value=volumeRef.current;gain.current.connect(audio.current.destination);}
   await audio.current.resume();await preparePlayback();
   if(rev===generation.current&&playRequest.current===rev&&buffer.current)startBuffer(offset.current);
  }catch(e){if(rev===generation.current)setProblem(e instanceof Error?e.message:'Playback failed. Please try again.');}
  finally{if(playRequest.current===rev){playRequest.current=null;setStarting(false);}}
 }
 function seek(value:number){const was=isPlaying.current;stop();offset.current=value;setPosition(value);lastEvent.current=-1;mark(value);if(was)startBuffer(value);}
 function noteEdit(action:'up'|'down'|'longer'|'shorter'){
  if(!selection)return;const match=selection.token.match(/^(\s*(?:"[^"]*"\s*)*)([_^=]*)([A-Ga-g])([,']*)(\d*(?:\/\d*)?)(-?)(\s*)$/);
  if(!match){setCodeOpen(true);setNotice('Use the notation editor for this chord, rest, or decorated note.');return;}
  let [,prefix,acc,note,oct,length,tie,suffix]=match;
  if(action==='up'||action==='down'){
   const names='CDEFGAB';let pitch=names.indexOf(note.toUpperCase())+(note===note.toLowerCase()?7:0)+7*([...oct].filter(x=>x==="'").length-[...oct].filter(x=>x===',').length)+(action==='up'?1:-1);
   const octave=Math.floor(pitch/7);note=names[((pitch%7)+7)%7];oct=octave<0?', '.trim().repeat(-octave):octave>1?"'".repeat(octave-1):'';if(octave>=1)note=note.toLowerCase();
  }else{const [n,d]=length.split('/');let num=Number(n||1),den=d===undefined?1:Number(d||2);if(action==='longer')num*=2;else den*=2;while(num%2===0&&den%2===0){num/=2;den/=2;}length=den===1?(num===1?'':String(num)):`${num===1?'':num}/${den===2?'':den}`;}
  const token=prefix+acc+note+oct+length+tie+suffix;commit(abc.slice(0,selection.start)+token+abc.slice(selection.end));setSelection({...selection,end:selection.start+token.length,token});
 }
 function midi(){if(!lib.current)return;try{const uri=lib.current.synth.getMidiFile(abc,{midiOutputType:'encoded'}) as string;const a=document.createElement('a');a.href=uri;a.download='edited-score.mid';a.click();}catch{setProblem('MIDI export failed. Check the notation.');}}
 return <section className={`workspace view-enter ${editingEnabled?'':'read-only-score'}`}>
  <div className="workspace-heading"><div><div className="eyebrow">YOUR MUSIC, ON PAPER</div><h1>{source.title}</h1><p>{source.artist||'Your recording'} <span>·</span> {edited?'Edited score':'Original AI score'}</p></div><button className="new-score-button" onClick={onNew}><span aria-hidden="true">+</span> New score</button></div>
  <div className="transport" aria-label="Score playback controls">
   <button className="transport-icon" onClick={()=>seek(0)} title="Restart" aria-label="Restart playback"><SkipBack size={18}/></button>
   <button className="transport-icon play-button" onClick={toggle} disabled={!ready||starting} aria-busy={starting} aria-label={playing?'Pause score':'Play score'}>{starting?<span className="spinner"/>:playing?<Pause size={22} fill="currentColor"/>:<Play size={22} fill="currentColor"/>}</button>
   <div className="track-progress"><div className="progress-fill" style={{width:total?`${Math.min(100,position/total*100)}%`:'0%'}}/><div className="track-label"><span>{clock(position)}</span><strong>{source.title}</strong><span>{total?`−${clock(Math.max(0,total-position))}`:'SCORE'}</span></div><input type="range" min="0" max={total||1} step=".05" value={Math.min(position,total||1)} disabled={!total} onChange={e=>seek(Number(e.target.value))} aria-label="Playback position"/></div>
   <button className={`transport-icon ${loop?'active':''}`} onClick={()=>setLoop(!loop)} aria-label="Loop score" aria-pressed={loop} title="Loop"><Repeat2 size={20}/></button>
   <div className="volume"><button className="transport-icon" onClick={()=>setVolume(volume?0:.7)} aria-label={volume?'Mute':'Unmute'}>{volume?<Volume2 size={18}/>:<VolumeX size={18}/>}</button><input aria-label="Volume" type="range" min="0" max="1" step=".05" value={volume} onChange={e=>setVolume(Number(e.target.value))}/></div>
  </div>
  <div className="under-player"><span>{loading?`Preparing ${instrumentName.toLowerCase()} sounds…`:`${instrumentName} playback follows your written score`}</span><div className="playback-options"><label>Instrument <select aria-label="Playback instrument" value={instrument} onChange={e=>{stop();generation.current++;setInstrument(Number(e.target.value));}}>{instruments.map(item=><option key={item.program} value={item.program}>{item.name}</option>)}</select></label><label>Speed <select aria-label="Playback speed" value={speed} onChange={e=>{stop();setSpeed(Number(e.target.value));}}><option value="50">0.5×</option><option value="75">0.75×</option><option value="100">1×</option><option value="125">1.25×</option><option value="150">1.5×</option></select></label></div></div>
  <div className="score-toolbar"><div className="toolbar-group"><button onClick={undo} disabled={index===0} title="Undo (Ctrl Z)" aria-label="Undo"><Undo2 size={18}/></button><button onClick={redo} disabled={index===history.length-1} title="Redo (Ctrl Shift Z)" aria-label="Redo"><Redo2 size={18}/></button><span className="divider"/><button onClick={()=>{commit(result.abc);setSelection(null);}} disabled={!edited}><RotateCcw size={16}/><span>Restore AI score</span></button></div><div className="toolbar-group"><label className="follow"><input type="checkbox" checked={follow} onChange={e=>setFollow(e.target.checked)}/> Follow notes</label><button className={codeOpen?'chosen':''} onClick={()=>setCodeOpen(!codeOpen)} aria-expanded={codeOpen}><Code2 size={17}/><span>Edit notation</span></button><button onClick={()=>window.print()} title="Print current score" aria-label="Print current score"><Printer size={17}/></button><details className="download-menu"><summary><Download size={17}/><span>Download</span><ChevronDown size={13}/></summary><div><button onClick={()=>save(abc,'score.abc')}>Current score · ABC</button><button onClick={midi}>Current score · MIDI</button>{result.pdf&&<a href={result.pdf} target="_blank" rel="noreferrer">Original AI score · PDF</a>}{result.downloads.find(d=>d.name.endsWith('.zip'))&&<a href={result.downloads.find(d=>d.name.endsWith('.zip'))!.url} target="_blank" rel="noreferrer">Original AI files · ZIP</a>}</div></details></div></div>
  <div className="edit-help"><span>{selection?`Selected: ${selection.token.trim()}`:'Click a note to edit its pitch or length.'}</span>{selection&&<div className="note-actions"><button onClick={()=>noteEdit('down')} aria-label="Lower selected note"><ArrowDown size={14}/></button><button onClick={()=>noteEdit('up')} aria-label="Raise selected note"><ArrowUp size={14}/></button><button onClick={()=>noteEdit('shorter')}>½ length</button><button onClick={()=>noteEdit('longer')}>2× length</button></div>}</div>
  {problem&&<p role="alert" className="error-message">{problem}</p>}{notice&&<p role="status" className="edit-notice">{notice}</p>}
  <div className={`score-layout ${codeOpen?'with-editor':''}`}><div className="score-scroll" ref={scoreScroll}><div className="paper" ref={paper}/></div>{codeOpen&&<aside className="notation-editor"><div><strong>ABC notation</strong><button onClick={()=>setCodeOpen(false)} aria-label="Close notation editor"><X size={16}/></button></div><p>Change notes, rhythm, chords, title, or tempo. Playback updates with your edits.</p><textarea ref={textarea} aria-label="Edit ABC notation" spellCheck={false} value={abc} onChange={e=>commit(e.target.value)}/><span>Undo and redo work here too. Print to save an edited PDF.</span></aside>}</div>
  {source.audioUrl&&<OriginalAudioPlayer src={source.audioUrl} onPlay={stop} scorePlaying={playing}/>}
 </section>;
}
