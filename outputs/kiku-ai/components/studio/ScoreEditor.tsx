'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {X,Play,Pause,Square,Undo2,Redo2,Piano,Download,ArrowUp,ArrowDown,Check,Upload,Repeat2} from 'lucide-react';
import {readScore,writeScore,validateScore,scoreLength,scoreSeconds,pitchName,transposeScore,type ScoreDocument,type ScoreVoice} from '@/lib/studio/score';
import {engrave} from '@/lib/engrave';
import {SampleCache} from '@/lib/score-playback';
import type {Sheet} from './ScoreSheet';

type Draft={score:ScoreDocument;lyrics:string};
type Props={sheet:Sheet;lockedVocal:boolean;save:(sheet:Sheet)=>void;close:()=>void;source?:()=>Promise<Blob>};
const timing=(score:ScoreDocument)=>JSON.stringify([score.bpm,score.bars.map(b=>[b.length,b.meter])]);
const ROW=16,BEAT=64,KEY=96,RULER=28,BANK='acoustic_grand_piano';
const black=(pitch:number)=>[1,3,6,8,10].includes(pitch%12);
/** Where each white key sits in its octave, in semitone rows from the octave's bottom, so the keys meet like a real keyboard. */
const WHITE:Record<number,[number,number]>={0:[0,1.5],2:[1.5,2],4:[3.5,1.5],5:[5,1.5],7:[6.5,2],9:[8.5,2],11:[10.5,1.5]};
function download(blob:Blob,name:string){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

/** The roll's own piano: sampled grand notes for the keyboard, edits and playback. */
class PianoSound{
 context:AudioContext|null=null;out:GainNode|null=null;cache=new SampleCache();
 async ready(){
  const context=this.context??=new AudioContext();
  if(!this.out){this.out=context.createGain();this.out.gain.value=.8;this.out.connect(context.destination);}
  await context.resume();return context;
 }
 sample(context:AudioContext,pitch:number){return this.cache.load(context,BANK,pitch);}
 /** Sound a note now. It rings until the returned release, or for `seconds` when given. */
 press(pitch:number,seconds?:number){
  let release=()=>{},released=false;
  void this.ready().then(async context=>{
   const buffer=await this.sample(context,pitch);if(released&&!seconds)return;
   const source=context.createBufferSource(),envelope=context.createGain();
   source.buffer=buffer;source.connect(envelope);envelope.connect(this.out!);envelope.gain.value=.9;source.start();
   release=()=>{const now=context.currentTime;envelope.gain.cancelScheduledValues(now);envelope.gain.setValueAtTime(envelope.gain.value,now);envelope.gain.linearRampToValueAtTime(0,now+.25);source.stop(now+.3);};
   if(seconds){const end=context.currentTime+seconds;envelope.gain.setValueAtTime(.9,end);envelope.gain.linearRampToValueAtTime(0,end+.2);source.stop(end+.25);release=()=>{};}
  }).catch(()=>{});
  return()=>{released=true;release();};
 }
 close(){const context=this.context;this.context=null;this.out=null;if(context&&context.state!=='closed')void context.close().catch(()=>{});}
}

export function sheetFromAbc(abc:string,sig:string,lyrics='',clock:number[]=[],seed?:number):Sheet{
 const document=readScore(abc),secondsPerTick=240/document.grid/document.bpm;
 const bars=document.bars.map((bar,index)=>({start:clock[index]??bar.start*secondsPerTick,end:clock[index+1]??(bar.start+bar.length)*secondsPerTick,
  chords:document.chords.filter(c=>c.start>=bar.start&&c.start<bar.start+bar.length).map(c=>c.name),section:bar.sections.at(-1)||''}));
 return {sig,abc,document,sourceTiming:timing(document),seed,summary:{bpm:document.bpm,key:document.bars[0].key,keyName:document.bars[0].key,
  duration:clock.at(-1)??scoreSeconds(document),bars,clock,lyrics,
  notes:document.notes.filter(n=>n.voice==='Vocal').length,fills:document.notes.filter(n=>n.voice==='Ins').length},transpose:0,bpm:document.bpm,chords:{},lyrics};
}
export function emptySheet(sig:string,bpm=100):Sheet{
 const score:ScoreDocument={grid:32,bpm:Math.round(bpm),bars:Array.from({length:8},(_,i)=>({start:i*32,length:32,meter:[4,4],key:'C',sections:i===0?['verse']:[]})),notes:[],chords:[],keys:[[0,'C']]};
 return sheetFromAbc(writeScore(score),sig);
}

/**
 * The score as an FL-style piano roll. Only the notes are shown and played:
 * lyrics, sections and chords ride along untouched and are saved with the score.
 */
export default function ScoreEditor({sheet,lockedVocal,save,close,source}:Props){
 const [history,setHistory]=useState<Draft[]>(()=>[{score:sheet.document||readScore(sheet.abc),lyrics:sheet.lyrics}]);
 const [index,setIndex]=useState(0),[drag,setDrag]=useState<ScoreDocument|null>(null);
 const current=history[index],score=drag||current.score;
 const [voice,setVoice]=useState<ScoreVoice>(()=>lockedVocal||!history[0].score.notes.some(n=>n.voice==='Vocal')&&history[0].score.notes.some(n=>n.voice==='Ins')?'Ins':'Vocal');
 const [selected,setSelected]=useState<string|null>(null),[snap,setSnap]=useState(16),[length,setLength]=useState(0);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[playing,setPlaying]=useState(false),[loading,setLoading]=useState(false);
 const [position,setPosition]=useState(0),[cursor,setCursor]=useState(0),[loop,setLoop]=useState(false),[held,setHeld]=useState<number[]>([]);
 const scroller=useRef<HTMLDivElement>(null),dialog=useRef<HTMLDivElement>(null),closeButton=useRef<HTMLButtonElement>(null),importer=useRef<HTMLInputElement>(null);
 const sound=useRef(new PianoSound()),active=useRef<{stop:()=>void}|null>(null),timer=useRef<ReturnType<typeof setInterval>|null>(null);
 const request=useRef(0),loopRef=useRef(loop);loopRef.current=loop;
 const original=useRef<HTMLAudioElement>(null),sourceUrl=useRef(''),[originalUrl,setOriginalUrl]=useState(''),[originalPlaying,setOriginalPlaying]=useState(false);
 const stop=useCallback(()=>{request.current++;active.current?.stop();active.current=null;if(timer.current)clearInterval(timer.current);timer.current=null;original.current?.pause();setPlaying(false);setLoading(false);},[]);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null,piano=sound.current;closeButton.current?.focus();return()=>{stop();piano.close();if(sourceUrl.current)URL.revokeObjectURL(sourceUrl.current);previous?.focus();};},[stop]);
 const commit=useCallback((next:Draft)=>{
  try{validateScore(next.score);writeScore(next.score);stop();setHistory(h=>[...h.slice(Math.max(0,index-99),index+1),next]);setIndex(Math.min(index+1,100));setError('');}
  catch(e){setError(e instanceof Error?e.message:'That edit could not be saved.');}
 },[index,stop]);
 const edit=(next:ScoreDocument)=>commit({...current,score:next});
 const undo=()=>{if(index){stop();setIndex(index-1);setSelected(null);}};
 const redo=()=>{if(index<history.length-1){stop();setIndex(index+1);setSelected(null);}};
 const note=score.notes.find(n=>n.id===selected),readOnly=lockedVocal&&note?.voice==='Vocal';
 const tick=score.grid/snap,scale=BEAT*4/score.grid,total=scoreLength(score),width=Math.max(720,total*scale),noteLength=length||score.grid/4;
 // Whole octaves, C at the bottom and B at the top, with room around the melody.
 const [high,low]=useMemo(()=>{const pitches=score.notes.map(n=>n.pitch);
  return [Math.min(127,Math.ceil((Math.max(84,...pitches)+3)/12)*12-1),Math.max(0,Math.floor((Math.min(48,...pitches)-3)/12)*12)];},[score.notes]);
 const height=(high-low+1)*ROW,rows=useMemo(()=>Array.from({length:high-low+1},(_,i)=>high-i),[high,low]);
 const centre=useMemo(()=>{const pitches=score.notes.map(n=>n.pitch).sort((a,b)=>a-b);return pitches.length?pitches[pitches.length>>1]:67;},[score.notes]);
 useEffect(()=>{const node=scroller.current;if(node)node.scrollTop=Math.max(0,(high-centre)*ROW-node.clientHeight/2+RULER);},[high]); // eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{stop();},[index,stop]);
 useEffect(()=>{setCursor(c=>Math.min(c,Math.max(0,total-1)));},[total]);
 const sounding=useMemo(()=>new Set([...held,...(playing?score.notes.filter(n=>n.start<=position&&position<n.start+n.duration).map(n=>n.pitch):[])]),[held,playing,position,score.notes]);

 async function play(){
  if(playing||loading){stop();return;}
  setLoading(true);setError('');original.current?.pause();const id=++request.current;
  try{
   const piano=sound.current,context=await piano.ready(),from=Math.min(cursor,Math.max(0,total-1)),spt=240/score.grid/score.bpm;
   const notes=score.notes.filter(n=>n.start+n.duration>from),last=Math.max(0,...notes.map(n=>n.start+n.duration));
   const until=last>from?last:total,samples=new Map<number,AudioBuffer>();
   await Promise.all([...new Set(notes.map(n=>n.pitch))].map(async p=>{samples.set(p,await piano.sample(context,p));}));
   if(request.current!==id)return;
   const begin=()=>{
    const t0=context.currentTime+.06,sources:AudioBufferSourceNode[]=[];
    for(const n of notes){
     const start=Math.max(n.start,from),when=t0+(start-from)*spt,end=t0+(n.start+n.duration-from)*spt;
     const voice=context.createBufferSource(),envelope=context.createGain();
     voice.buffer=samples.get(n.pitch)!;voice.connect(envelope);envelope.connect(piano.out!);
     envelope.gain.setValueAtTime(.75,when);envelope.gain.setValueAtTime(.75,end);envelope.gain.linearRampToValueAtTime(0,end+.12);
     voice.start(when,(start-n.start)*spt);voice.stop(end+.15);sources.push(voice);
    }
    const done=setTimeout(()=>{if(request.current!==id)return;if(loopRef.current)begin();else stop();},((until-from)*spt+.1)*1000);
    active.current={stop:()=>{clearTimeout(done);for(const s of sources)try{s.stop();}catch{}}};
    if(timer.current)clearInterval(timer.current);
    timer.current=setInterval(()=>{
     const at=from+Math.max(0,context.currentTime-t0)/spt;setPosition(at);
     const node=scroller.current,x=KEY+at*scale;if(node&&(x>node.scrollLeft+node.clientWidth-60||x<node.scrollLeft+KEY))node.scrollLeft=Math.max(0,x-KEY-60);
    },30);
   };
   begin();setLoading(false);setPlaying(true);
  }catch(e){if(request.current===id){stop();setError(e instanceof Error?e.message:'The piano could not load.');}}
 }
 const playRef=useRef(play);playRef.current=play;
 async function playOriginal(){
  if(original.current&&!original.current.paused){original.current.pause();return;}
  stop();setError('');const id=++request.current;try{if(!originalUrl&&source){const blob=await source();if(request.current!==id)return;sourceUrl.current=URL.createObjectURL(blob);setOriginalUrl(sourceUrl.current);}
   setTimeout(()=>{if(request.current===id)void original.current?.play().catch(()=>setError('The recording could not play.'));},0);
  }catch(e){setError(e instanceof Error?e.message:'Could not load the recording.');}
 }
 const preview=(pitch:number)=>sound.current.press(pitch,.35);
 function updateNote(patch:Partial<{pitch:number;start:number;duration:number}>){if(!note||readOnly)return;edit({...score,notes:score.notes.map(n=>n.id===note.id?{...n,...patch}:n)});if(patch.pitch!==undefined)preview(patch.pitch);}
 function removeNote(id=note?.id){const target=score.notes.find(n=>n.id===id);if(!target||lockedVocal&&target.voice==='Vocal')return;edit({...score,notes:score.notes.filter(n=>n.id!==id)});if(selected===id)setSelected(null);}
 function pointer(event:React.PointerEvent<HTMLElement>,kind:'move'|'length'){
  if(event.button!==0)return;
  const node=event.currentTarget.closest<HTMLButtonElement>('[data-id]');if(!node)return;
  const found=score.notes.find(n=>n.id===node.dataset.id);if(!found)return;
  event.preventDefault();event.stopPropagation();setSelected(found.id);setVoice(found.voice);
  if(lockedVocal&&found.voice==='Vocal'){preview(found.pitch);return;}
  stop();preview(found.pitch);
  const initial=score,fromX=event.clientX,fromY=event.clientY;let final=score,pitch=found.pitch;
  node.setPointerCapture(event.pointerId);
  const move=(ev:PointerEvent)=>{
   const delta=Math.round((ev.clientX-fromX)/scale/tick)*tick;
   const patch=kind==='length'?{duration:Math.max(tick,Math.min(total-found.start,found.duration+delta))}
    :{start:Math.max(0,Math.min(total-found.duration,Math.round((found.start+delta)/tick)*tick)),pitch:Math.max(low,Math.min(high,found.pitch-Math.round((ev.clientY-fromY)/ROW)))};
   if(patch.pitch!==undefined&&patch.pitch!==pitch){pitch=patch.pitch;preview(pitch);}
   final={...initial,notes:initial.notes.map(n=>n.id===found.id?{...n,...patch}:n)};setDrag(final);
  };
  const end=(ev:PointerEvent,keep:boolean)=>{
   node.removeEventListener('pointermove',move);node.removeEventListener('pointerup',up);node.removeEventListener('pointercancel',cancel);
   if(node.hasPointerCapture(ev.pointerId))node.releasePointerCapture(ev.pointerId);setDrag(null);
   if(keep&&final!==initial){edit(final);if(kind==='length')setLength(final.notes.find(n=>n.id===found.id)!.duration);}
  };
  const up=(ev:PointerEvent)=>end(ev,true),cancel=(ev:PointerEvent)=>end(ev,false);
  node.addEventListener('pointermove',move);node.addEventListener('pointerup',up);node.addEventListener('pointercancel',cancel);
 }
 /** Click on empty grid: a note of the last length used, trimming any note of the same melody it lands in (each melody is one line). */
 function addNote(event:React.PointerEvent<HTMLDivElement>){
  if(event.button!==0||event.target!==event.currentTarget)return;
  if(lockedVocal&&voice==='Vocal'){setNotice('The recorded vocal stays fixed. Switch to the instrumental melody to add notes.');return;}
  const rect=event.currentTarget.getBoundingClientRect(),start=Math.max(0,Math.min(total-1,Math.floor((event.clientX-rect.left)/scale/tick)*tick));
  const pitch=Math.max(low,Math.min(high,high-Math.floor((event.clientY-rect.top)/ROW))),id=crypto.randomUUID();
  const line=score.notes.filter(n=>n.voice===voice),inside=line.find(n=>n.start<=start&&start<n.start+n.duration);
  const notes=inside?inside.start===start?score.notes.filter(n=>n.id!==inside.id):score.notes.map(n=>n.id===inside.id?{...n,duration:start-n.start}:n):score.notes;
  const next=Math.min(total,...line.filter(n=>n.start>start).map(n=>n.start)),duration=Math.min(noteLength,next-start);
  if(duration<=0)return;
  try{const doc={...score,notes:[...notes,{id,voice,start,pitch,duration}]};validateScore(doc);edit(doc);setSelected(id);preview(pitch);}catch(e){setError((e as Error).message);}
 }
 function seek(event:React.PointerEvent<HTMLDivElement>){
  const rect=event.currentTarget.getBoundingClientRect(),beat=score.grid/4;
  const at=Math.max(0,Math.min(total-1,Math.round((event.clientX-rect.left)/scale/beat)*beat));
  const wasPlaying=playing;stop();setCursor(at);setPosition(at);if(wasPlaying)setTimeout(()=>void playRef.current(),0);
 }
 function pressKey(pitch:number,event:React.PointerEvent<HTMLElement>){
  if(event.pointerType!=='mouse'&&event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  const release=sound.current.press(pitch);setHeld(h=>[...h,pitch]);
  const node=event.currentTarget,off=()=>{release();setHeld(h=>h.filter(p=>p!==pitch));node.removeEventListener('pointerleave',off);window.removeEventListener('pointerup',off);};
  node.addEventListener('pointerleave',off);window.addEventListener('pointerup',off);
 }
 function saveDraft(){
  try{const abc=writeScore(score),next=sheetFromAbc(abc,sheet.sig,current.lyrics,sheet.summary.clock,sheet.seed);
   next.sourceTiming=sheet.sourceTiming||timing(sheet.document||readScore(sheet.abc));next.timingChanged=timing(score)!==next.sourceTiming;
   next.summary.beats=sheet.summary.beats;save(next);close();
  }catch(e){setError((e as Error).message);}
 }
 async function importScore(file?:File){if(!file)return;try{const text=await file.text(),next=readScore(text);
  if(lockedVocal)throw new Error('Use New AI performance to import a different score. The recorded vocal stays fixed.');
  edit(next);setSelected(null);setNotice('Score imported.');
 }catch(e){setError((e as Error).message);}finally{if(importer.current)importer.current.value='';}}

 // Shortcuts are caught before the studio sees them, so Space plays this roll and nothing else.
 const keysRef=useRef<(e:KeyboardEvent)=>void>(()=>{});
 keysRef.current=e=>{
  const typing=(e.target as Element|null)?.closest?.('input,textarea,select');
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();return;}
  if(e.key==='Tab'||typing)return;
  const mod=e.ctrlKey||e.metaKey,k=e.key.toLowerCase();
  if(e.key===' '){e.preventDefault();e.stopPropagation();if(!e.repeat)void playRef.current();return;}
  if(mod&&(k==='z'||k==='y')){e.preventDefault();e.stopPropagation();if(k==='y'||e.shiftKey)redo();else undo();return;}
  if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();e.stopPropagation();removeNote();return;}
  if(note&&!readOnly&&e.key.startsWith('Arrow')){e.preventDefault();e.stopPropagation();
   if(e.key==='ArrowUp'||e.key==='ArrowDown')updateNote({pitch:note.pitch+(e.key==='ArrowUp'?1:-1)*(e.shiftKey?12:1)});
   else if(e.shiftKey)updateNote({duration:note.duration+(e.key==='ArrowRight'?tick:-tick)});else updateNote({start:note.start+(e.key==='ArrowRight'?tick:-tick)});}
 };
 useEffect(()=>{
  const down=(e:KeyboardEvent)=>keysRef.current(e);
  // A focused button would also click on Space's keyup.
  const up=(e:KeyboardEvent)=>{if(e.key===' '&&!(e.target as Element|null)?.closest?.('input,textarea,select')){e.preventDefault();e.stopPropagation();}};
  window.addEventListener('keydown',down,true);window.addEventListener('keyup',up,true);
  return()=>{window.removeEventListener('keydown',down,true);window.removeEventListener('keyup',up,true);};
 },[]);

 const marker=playing?position:cursor,step=BEAT*4/snap;
 return createPortal(<div className="score-overlay" onPointerDown={e=>{if(e.target===e.currentTarget)close();}}>
  <section ref={dialog} className="score-editor roll-editor" role="dialog" aria-modal="true" aria-label="Piano roll" onKeyDown={e=>{
   if(e.key!=='Tab')return;
   const elements=[...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,[tabindex="0"]')].filter(el=>el.getClientRects().length);
   const first=elements[0],last=elements.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
  }}>
   <header className="score-editor-header"><div className="score-editor-title"><span><Piano size={18}/></span><div><h2>Piano roll</h2><p>Click to add · drag to move · drag the end to resize · right-click to delete · Space to play</p></div></div>
    <button ref={closeButton} className="tool-button" onClick={close} aria-label="Close piano roll"><X size={20}/></button></header>
   <div className="roll-toolbar">
    <div className="roll-transport">
     <button className={'roll-play'+(playing?' on':'')} onClick={()=>void play()} aria-label={playing?'Pause':'Play'}>{loading?<span className="spinner"/>:playing?<Pause size={15}/>:<Play size={15}/>}</button>
     <button className="roll-button" onClick={()=>{stop();setCursor(0);setPosition(0);}} aria-label="Stop and return to the start"><Square size={13}/></button>
     <button className={'roll-button'+(loop?' on':'')} aria-label="Loop" aria-pressed={loop} onClick={()=>setLoop(!loop)}><Repeat2 size={14}/></button>
    </div>
    <label className="roll-field">Tempo <input aria-label="Tempo" type="number" value={score.bpm} min={30} max={300} disabled={lockedVocal} onChange={e=>{const bpm=Number(e.target.value);if(bpm>=30&&bpm<=300)edit({...score,bpm});}}/></label>
    <div className="roll-field roll-key"><button className="roll-button" disabled={lockedVocal} onClick={()=>{try{edit(transposeScore(score,-1));}catch(e){setError((e as Error).message);}}} aria-label="Transpose down"><ArrowDown size={13}/></button><span>{score.bars[0].key}</span><button className="roll-button" disabled={lockedVocal} onClick={()=>{try{edit(transposeScore(score,1));}catch(e){setError((e as Error).message);}}} aria-label="Transpose up"><ArrowUp size={13}/></button></div>
    <label className="roll-field">Snap <select aria-label="Note snap" value={snap} onChange={e=>setSnap(Number(e.target.value))}><option value={4}>Beat</option><option value={8}>1/8</option><option value={16}>1/16</option><option value={32}>1/32</option></select></label>
    <div className="roll-lanes" role="group" aria-label="Melody to edit"><button className={voice==='Vocal'?'on vocal':''} aria-pressed={voice==='Vocal'} onClick={()=>setVoice('Vocal')}>Sung{lockedVocal?' · fixed':''}</button><button className={voice==='Ins'?'on instrument':''} aria-pressed={voice==='Ins'} onClick={()=>setVoice('Ins')}>Instrumental</button></div>
    <div className="roll-history"><button className="roll-button" onClick={undo} disabled={!index} aria-label="Undo"><Undo2 size={14}/></button><button className="roll-button" onClick={redo} disabled={index>=history.length-1} aria-label="Redo"><Redo2 size={14}/></button></div>
   </div>
   <div className="roll-scroll" ref={scroller}><div className="roll-content" style={{width:width+KEY,height:height+RULER}}>
    <div className="roll-ruler" style={{width:width+KEY}}>
     <div className="roll-corner" style={{width:KEY}}/>
     <div className="roll-timeline" style={{left:KEY,width}} onPointerDown={seek}>
      {score.bars.map((b,i)=><span key={i} className="roll-bar-number" style={{left:b.start*scale}}>{i+1}</span>)}
      <i className="roll-marker" style={{left:marker*scale}}/>
     </div>
    </div>
    <div className="roll-keys" style={{height,top:RULER}} aria-hidden="true">
     {rows.filter(p=>!black(p)).map(p=>{const octave=p-p%12,[from,span]=WHITE[p%12],bottom=(high-octave+1)*ROW-from*ROW;
      return <div key={p} className={'key white'+(sounding.has(p)?' down':'')} style={{top:bottom-span*ROW,height:span*ROW}} onPointerDown={e=>pressKey(p,e)} onPointerEnter={e=>{if(e.buttons===1)pressKey(p,e);}}>{p%12===0&&<em>{pitchName(p)}</em>}</div>;})}
     {rows.filter(black).map(p=><div key={p} className={'key black'+(sounding.has(p)?' down':'')} style={{top:(high-p)*ROW,height:ROW}} onPointerDown={e=>pressKey(p,e)} onPointerEnter={e=>{if(e.buttons===1)pressKey(p,e);}}/>)}
    </div>
    <div className="roll-grid" style={{left:KEY,top:RULER,width,height}}>
     {rows.map(p=><div key={p} className={'roll-lane'+(black(p)?' black':'')+(p%12===0?' octave':'')+(sounding.has(p)?' lit':'')} style={{top:(high-p)*ROW,height:ROW}}/>)}
     <div className="roll-lines" style={{backgroundSize:`${BEAT}px 100%, ${step}px 100%`}}/>
     {score.bars.map((b,i)=><div className="roll-bar-line" key={i} style={{left:b.start*scale}}/>)}
     <div className="roll-hit" onPointerDown={addNote} onContextMenu={e=>e.preventDefault()}/>
     {score.notes.map(n=><button key={n.id} data-id={n.id} className={'roll-note '+(n.voice==='Vocal'?'vocal':'instrument')+(selected===n.id?' selected':'')+(n.voice!==voice?' secondary':'')+(lockedVocal&&n.voice==='Vocal'?' fixed':'')+(playing&&n.start<=position&&position<n.start+n.duration?' playing':'')}
      style={{left:n.start*scale,top:(high-n.pitch)*ROW,width:Math.max(6,n.duration*scale-1),height:ROW-1}} aria-label={`${n.voice==='Vocal'?'Sung':'Instrumental'} note ${pitchName(n.pitch)}, beat ${(n.start*4/score.grid+1).toFixed(2)}, length ${(n.duration*4/score.grid).toFixed(2)} beats`}
      onPointerDown={e=>pointer(e,'move')} onContextMenu={e=>{e.preventDefault();removeNote(n.id);}}><span>{pitchName(n.pitch)}</span><i onPointerDown={e=>pointer(e,'length')} aria-hidden="true"/></button>)}
     <div className={'roll-playhead'+(playing?' on':'')} style={{left:marker*scale}}/>
    </div>
   </div></div>
   {(error||notice)&&<p className={'score-editor-message'+(error?' error':'')} role={error?'alert':'status'}>{error||notice}<button className="tool-button" onClick={()=>{setError('');setNotice('');}} aria-label="Dismiss message"><X size={13}/></button></p>}
   <footer className="score-editor-footer"><div>{source&&<button className="tool-button wide" onClick={()=>void playOriginal()}>{originalPlaying?'Pause original':'Original recording'}</button>}</div>
    <div><input ref={importer} type="file" accept=".abc,text/plain" hidden onChange={e=>void importScore(e.target.files?.[0])}/><button className="tool-button" onClick={()=>importer.current?.click()} disabled={lockedVocal} aria-label="Import ABC score"><Upload size={15}/></button><button className="tool-button" aria-label="Download edited ABC" onClick={()=>{try{download(new Blob([writeScore(score)],{type:'text/plain'}),'kiku-score.abc');}catch(e){setError((e as Error).message);}}}><Download size={15}/></button><button className="tool-button wide" onClick={async()=>{try{const ABC=await import('abcjs'),tune=ABC.parseOnly(engrave(writeScore(score)))[0],data=ABC.synth.getMidiFile(tune,{midiOutputType:'binary'}) as Uint8Array;download(new Blob([new Uint8Array(data)],{type:'audio/midi'}),'kiku-score.mid');}catch(e){setError((e as Error).message);}}}>MIDI</button><button className="score-save-button" onClick={saveDraft}><Check size={16}/> Use this score</button></div>
   </footer><audio ref={original} src={originalUrl||undefined} onPlay={()=>setOriginalPlaying(true)} onPause={()=>setOriginalPlaying(false)} onEnded={()=>setOriginalPlaying(false)} hidden/>
  </section>
 </div>,document.body);
}
