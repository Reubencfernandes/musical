'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Trash2,Volume2,VolumeX,Plus,AudioWaveform,Download,Check,X,TriangleAlert} from 'lucide-react';
import Waveform from './Waveform';
import JobWaveform from './JobWaveform';
import {WAVE_WINDOW,waveformWindow} from '@/lib/studio/waveform';
import {type Clip,type Project,type Range,type Selection,type Track,MIN_CLIP,clipEnd,heard,projectEnd,showsMute,snap,takeAnchor} from '@/lib/studio/model';
import type {Job} from './useJobs';

export const HEADER=244,LANE=88,RULER=32,CHORDS=22;
export type Tool='pointer'|'range';
type Edit={checkpoint:()=>void;preview:(fn:(p:Project)=>Project)=>void;commit:(fn:(p:Project)=>Project)=>void};
type Props={
 project:Project;buffers:Map<string,AudioBuffer>;
 selection:Selection;select:(next:Selection)=>void;
 zoom:number;setZoom:(zoom:number)=>void;tool:Tool;division:number;
 position:()=>number;playing:boolean;seek:(time:number)=>void;
 /** Scrubbing pauses playback while the ruler is dragged and resumes it from where it is let go. */
 scrubbing:{begin:()=>void;end:(time:number)=>void};
 edit:Edit;jobs:Job[];cancelJob:(id:string)=>void;toggleTake:(id:string)=>void;loop:Range|null;
 changeTrack:(id:string,patch:Partial<Track>)=>void;removeTrack:(id:string)=>void;muteTrack:(id:string,mute:boolean)=>void;
 previewTrack:(id:string,patch:Partial<Track>)=>void;addTrack:()=>void;
 dropFiles:(files:File[],time:number)=>void;
 downloadClip:(id:string)=>void;
 empty:React.ReactNode;
};
type Drag=
 |{kind:'move';x:number;y:number;origin:Map<string,{start:number;track:number}>;lead:string;moved:boolean}
 |{kind:'trim';side:'left'|'right';x:number;origin:Clip;moved:boolean}
 |{kind:'range';time:number;track:number;x:number;moved:boolean;clip?:string}
 |{kind:'scrub'};

export default function Arrangement(props:Props){
 const {project,buffers,selection,select,zoom,tool,division,edit}=props;
 const scroller=useRef<HTMLDivElement>(null),lanes=useRef<HTMLDivElement>(null);
 const head=useRef<HTMLDivElement>(null),rulerHead=useRef<HTMLDivElement>(null);
 const drag=useRef<Drag|null>(null),zoomAnchor=useRef<{time:number;x:number}|null>(null);
 // Follow the playhead unless the user has scrolled away from it; it resumes once the playhead is back in view.
 const follow=useRef(true),autoScroll=useRef(false);
 const [view,setView]=useState(900),[viewHeight,setViewHeight]=useState(600),[headerWidth,setHeaderWidth]=useState(HEADER);
 const [viewLeft,setViewLeft]=useState(0);
 const [clipMenu,setClipMenu]=useState<{id:string;x:number;y:number}|null>(null);
 const menuRef=useRef<HTMLDivElement>(null);
 const menuClip=clipMenu?project.clips.find(c=>c.id===clipMenu.id):undefined;
 const beat=60/project.bpm,bar=beat*4;
 const length=Math.max(projectEnd(project)+bar*8,view/zoom,60);
 const width=Math.ceil(length*zoom);
 const tracks=project.tracks;
 const index=new Map(tracks.map((t,i)=>[t.id,i]));
 // A running job gets a lane of its own under the tracks it works on, where its result will land.
 const rows:({track:Track}|{job:Job})[]=[],waiting=new Map<string,Job[]>(),loose:Job[]=[];
 for(const job of props.jobs){const anchor=job.tracks.length?takeAnchor(project,job.tracks):undefined;if(anchor)waiting.set(anchor,[...(waiting.get(anchor)||[]),job]);else loose.push(job);}
 for(const track of tracks){rows.push({track});for(const job of waiting.get(track.id)||[])rows.push({job});}
 for(const job of loose)rows.push({job});
 const rowOf=new Map(rows.flatMap((row,i)=>'track' in row?[[row.track.id,i] as const]:[]));
 const lanesHeight=Math.max(rows.length*LANE+80,viewHeight-RULER-(project.chords.length?CHORDS:0)-26,LANE*3);
 const [now,setNow]=useState(()=>Date.now());
 useEffect(()=>{if(!props.jobs.length)return;const timer=setInterval(()=>setNow(Date.now()),400);return()=>clearInterval(timer);},[props.jobs.length]);

 function openClipMenu(clip:Clip,x:number,y:number){
  select({clips:[clip.id],range:null});
  setClipMenu({id:clip.id,x,y});
 }
 function closeClipMenu(restoreFocus=false){
  if(restoreFocus&&clipMenu){
   const element=[...(lanes.current?.querySelectorAll<HTMLElement>('[data-clip]')||[])].find(el=>el.dataset.clip===clipMenu.id);
   element?.focus({preventScroll:true});
  }
  setClipMenu(null);
 }
 useLayoutEffect(()=>{
  const menu=menuRef.current;if(!menu||!clipMenu)return;
  const bounds=menu.getBoundingClientRect();
  menu.style.left=`${Math.max(8,Math.min(clipMenu.x,window.innerWidth-bounds.width-8))}px`;
  menu.style.top=`${Math.max(8,Math.min(clipMenu.y,window.innerHeight-bounds.height-8))}px`;
  menu.querySelector<HTMLButtonElement>('button')?.focus();
 },[clipMenu]);
 useEffect(()=>{
  if(!clipMenu)return;
  const outside=(event:PointerEvent)=>{if(!menuRef.current?.contains(event.target as Node))setClipMenu(null);};
  const key=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeClipMenu(true);}
   else if(event.key==='Tab')setClipMenu(null);
  };
  const dismiss=()=>setClipMenu(null);
  window.addEventListener('pointerdown',outside);
  window.addEventListener('keydown',key,true);
  window.addEventListener('resize',dismiss);
  window.addEventListener('blur',dismiss);
  scroller.current?.addEventListener('scroll',dismiss);
  return()=>{
   window.removeEventListener('pointerdown',outside);
   window.removeEventListener('keydown',key,true);
   window.removeEventListener('resize',dismiss);
   window.removeEventListener('blur',dismiss);
   scroller.current?.removeEventListener('scroll',dismiss);
  };
 },[clipMenu]);

 useEffect(()=>{
  const element=scroller.current;if(!element)return;
  const observer=new ResizeObserver(()=>{
   const header=element.clientWidth<640?156:HEADER;
   setHeaderWidth(header);setView(element.clientWidth-header);setViewHeight(element.clientHeight);
  });observer.observe(element);
  return()=>observer.disconnect();
 },[]);

 useEffect(()=>{
  const element=scroller.current;if(!element)return;
  let frame=0;
  const update=()=>{frame=0;setViewLeft(Math.floor(element.scrollLeft/WAVE_WINDOW)*WAVE_WINDOW);};
  const scroll=()=>{if(!frame)frame=requestAnimationFrame(update);};
  element.addEventListener('scroll',scroll,{passive:true});update();
  return()=>{element.removeEventListener('scroll',scroll);cancelAnimationFrame(frame);};
 },[]);

 // The playhead moves every frame, so it is positioned directly rather than through React.
 useEffect(()=>{
  let frame=0;
  const tick=()=>{
   const x=props.position()*zoom;
   if(head.current)head.current.style.transform=`translateX(${x}px)`;
   if(rulerHead.current)rulerHead.current.style.transform=`translateX(${x}px)`;
   const element=scroller.current;
   if(props.playing&&element&&!drag.current){
    const visible=element.clientWidth-headerWidth,inView=x>=element.scrollLeft&&x<=element.scrollLeft+visible-40;
    if(inView)follow.current=true;
    else if(follow.current){autoScroll.current=true;element.scrollLeft=Math.max(0,x-visible*0.15);}
   }
   frame=requestAnimationFrame(tick);
  };
  frame=requestAnimationFrame(tick);
  return()=>cancelAnimationFrame(frame);
 },[props.position,props.playing,zoom,headerWidth]);

useEffect(()=>{
  const element=scroller.current;if(!element)return;
  const scrolled=()=>{if(autoScroll.current){autoScroll.current=false;return;}if(props.playing)follow.current=false;};
  element.addEventListener('scroll',scrolled,{passive:true});return()=>element.removeEventListener('scroll',scrolled);
 },[props.playing]);
 useEffect(()=>{follow.current=true;},[props.playing]);

 // Keep the time under the cursor still while zooming.
 useLayoutEffect(()=>{
  const anchor=zoomAnchor.current,element=scroller.current;
  if(anchor&&element){element.scrollLeft=Math.max(0,anchor.time*zoom-anchor.x);zoomAnchor.current=null;}
 },[zoom]);
 useEffect(()=>{
  const element=scroller.current;if(!element)return;
  const wheel=(event:WheelEvent)=>{
   if(!event.ctrlKey&&!event.metaKey)return;
   event.preventDefault();
   const x=event.clientX-element.getBoundingClientRect().left-headerWidth;
   zoomAnchor.current={time:(element.scrollLeft+x)/zoom,x};
   props.setZoom(Math.min(240,Math.max(4,zoom*(event.deltaY<0?1.15:1/1.15))));
  };
  element.addEventListener('wheel',wheel,{passive:false});
  return()=>element.removeEventListener('wheel',wheel);
 },[zoom,props.setZoom,headerWidth]);

 const timeAt=(clientX:number)=>Math.max(0,(clientX-(lanes.current?.getBoundingClientRect().left||0))/zoom);
 /** The track under a point; a job's lane counts as the track above it. */
 const trackAt=(clientY:number)=>{
  let row=Math.min(rows.length-1,Math.max(0,Math.floor((clientY-(lanes.current?.getBoundingClientRect().top||0))/LANE)));
  while(row>0&&!('track' in rows[row]))row--;
  const found=rows[row];return found&&'track' in found?index.get(found.track.id)??0:0;
 };
 const snapped=(time:number,free?:boolean)=>free?time:snap(time,project.bpm,division);

 function down(event:React.PointerEvent){
  // With no tracks the lane shows the empty state, whose buttons must keep their clicks.
  if(event.button!==0||!tracks.length)return;
  const target=event.target as HTMLElement;
  const clipElement=target.closest<HTMLElement>('[data-clip]');
  const clip=clipElement?project.clips.find(c=>c.id===clipElement.dataset.clip):undefined;
  capture(lanes.current,event.pointerId);
  const time=timeAt(event.clientX);
  if(clip&&tool==='pointer'){
   const edge=target.dataset.edge as 'left'|'right'|undefined;
   if(edge){
    select({clips:[clip.id],range:null});
    drag.current={kind:'trim',side:edge,x:event.clientX,origin:clip,moved:false};
    return;
   }
   // Like most DAWs: the title bar (or Alt) moves a clip; dragging across the waveform selects a stretch of it.
   const multi=event.shiftKey||event.ctrlKey||event.metaKey;
   if(!target.closest('.clip-head')&&!event.altKey&&!multi){
    drag.current={kind:'range',time:snapped(time,false),track:trackAt(event.clientY),x:event.clientX,moved:false,clip:clip.id};
    return;
   }
   let chosen=selection.clips;
   if(event.shiftKey||event.ctrlKey||event.metaKey){
    chosen=chosen.includes(clip.id)?chosen.filter(id=>id!==clip.id):[...chosen,clip.id];
    select({clips:chosen,range:null});
    if(!chosen.includes(clip.id))return;
   }else if(!chosen.includes(clip.id)){chosen=[clip.id];select({clips:chosen,range:null});}
   else if(selection.range)select({clips:chosen,range:null});
   const origin=new Map(project.clips.filter(c=>chosen.includes(c.id)).map(c=>[c.id,{start:c.start,track:index.get(c.trackId)||0}]));
   drag.current={kind:'move',x:event.clientX,y:event.clientY,origin,lead:clip.id,moved:false};
   return;
  }
  drag.current={kind:'range',time:snapped(time,event.shiftKey),track:trackAt(event.clientY),x:event.clientX,moved:false};
 }

 function move(event:React.PointerEvent){
  const current=drag.current;if(!current)return;
  if(current.kind==='scrub'){props.seek(timeAt(event.clientX));return;}
  if(current.kind==='range'){
   if(!current.moved&&Math.abs(event.clientX-current.x)<4)return;
   current.moved=true;
   const time=snapped(timeAt(event.clientX),event.shiftKey),other=trackAt(event.clientY);
   const [a,b]=[Math.min(current.track,other),Math.max(current.track,other)];
   select({clips:[],range:{start:Math.min(current.time,time),end:Math.max(current.time,time),tracks:tracks.slice(a,b+1).map(t=>t.id)}});
   return;
  }
  const dx=(event.clientX-current.x)/zoom;
  if(!current.moved){if(Math.abs(event.clientX-current.x)<3&&(current.kind!=='move'||Math.abs(event.clientY-current.y)<6))return;current.moved=true;edit.checkpoint();}
  if(current.kind==='trim'){
   const clip=current.origin,buffer=buffers.get(clip.buffer);
   const available=buffer?buffer.duration:clip.offset+clip.duration;
   edit.preview(p=>({...p,clips:p.clips.map(c=>{
    if(c.id!==clip.id)return c;
    if(current.side==='left'){
     const start=Math.min(clipEnd(clip)-MIN_CLIP,Math.max(clip.start-clip.offset,snapped(clip.start+dx,event.shiftKey),0));
     return {...c,start,offset:clip.offset+(start-clip.start),duration:clip.duration-(start-clip.start)};
    }
    const end=Math.max(clip.start+MIN_CLIP,Math.min(clip.start+available-clip.offset,snapped(clipEnd(clip)+dx,event.shiftKey)));
    return {...c,duration:end-clip.start};
   })}));
   return;
  }
  const lead=current.origin.get(current.lead)!;
  const earliest=Math.min(...[...current.origin.values()].map(o=>o.start));
  const delta=Math.max(-earliest,snapped(lead.start+dx,event.shiftKey)-lead.start);
  const rows=Math.round((event.clientY-current.y)/LANE);
  const lowest=Math.min(...[...current.origin.values()].map(o=>o.track)),highest=Math.max(...[...current.origin.values()].map(o=>o.track));
  const shift=Math.min(tracks.length-1-highest,Math.max(-lowest,rows));
  edit.preview(p=>({...p,clips:p.clips.map(c=>{
   const o=current.origin.get(c.id);
   return o?{...c,start:o.start+delta,trackId:tracks[o.track+shift]?.id||c.trackId}:c;
  })}));
 }

 function up(event:React.PointerEvent){
  const current=drag.current;drag.current=null;
  try{lanes.current?.releasePointerCapture(event.pointerId);}catch{}
  if(current?.kind==='range'&&!current.moved){
   if(current.clip)select({clips:[current.clip],range:null});else{select({clips:[],range:null});props.seek(timeAt(event.clientX));}
  }
  if(current?.kind==='scrub')props.scrubbing.end(timeAt(event.clientX));
 }

 function scrub(event:React.PointerEvent){
  if(event.button!==0)return;
  capture(event.currentTarget as HTMLElement,event.pointerId);
  props.scrubbing.begin();drag.current={kind:'scrub'};props.seek(timeAt(event.clientX));
 }

 const barPx=bar*zoom,every=Math.max(1,2**Math.ceil(Math.log2(Math.max(1,48/barPx))));
 const bars=Math.ceil(length/bar);
 const range=selection.range;
 const grid:React.CSSProperties={
  width,height:lanesHeight,['--bar-width' as string]:`${barPx*every}px`,
  backgroundImage:`repeating-linear-gradient(to right,var(--grid-bar) 0 1px,transparent 1px ${barPx*every}px)`
   +(beat*zoom>=10?`,repeating-linear-gradient(to right,var(--grid-beat) 0 1px,transparent 1px ${beat*zoom}px)`:''),
 };

 return <><div className="arrangement" ref={scroller}
  onDragOver={e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();}}
  onDrop={e=>{e.preventDefault();const files=[...e.dataTransfer.files].filter(f=>f.type.startsWith('audio/')||/\.(wav|mp3|m4a|ogg|flac|aac|webm)$/i.test(f.name));if(files.length)props.dropFiles(files,snapped(timeAt(e.clientX)));}}>
  <div className="arr-canvas" style={{width:headerWidth+width,['--track-header' as string]:`${headerWidth}px`}}>
   <div className="arr-top">
    <div className="arr-corner" style={{height:RULER+(project.chords.length?CHORDS:0)}}>
     <span><AudioWaveform size={12}/> TRACKS</span><span>{String(tracks.length).padStart(2,'0')}</span>
    </div>
    <div>
     <div className="ruler" style={{width,height:RULER}} onPointerDown={scrub} onPointerMove={move} onPointerUp={up}>
      {Array.from({length:Math.ceil(bars/every)},(_,i)=><span key={i} className="ruler-bar" style={{left:i*every*barPx}}>{i*every+1}</span>)}
      {props.loop&&<i className="ruler-loop" style={{left:props.loop.start*zoom,width:(props.loop.end-props.loop.start)*zoom}}/>}
      {range&&<i className="ruler-range" style={{left:range.start*zoom,width:(range.end-range.start)*zoom}}/>}
      {props.jobs.map(g=><i key={g.id} className="ruler-ghost" style={{left:g.start*zoom,width:Math.max(4,(g.end-g.start)*zoom)}} title={g.label}/>)}
      <i className="ruler-head" ref={rulerHead}/>
     </div>
     {project.chords.length>0&&<div className="chord-lane" style={{width,height:CHORDS}}>
      {project.chords.map((chord,i)=><span key={i} style={{left:chord.time*zoom}}>{chord.name}</span>)}
     </div>}
    </div>
   </div>
   <div className="arr-rows">
    <div className="arr-headers" style={{height:lanesHeight}}>
     {rows.map(row=>'job' in row?<JobHeader key={row.job.id} job={row.job} now={now} cancel={()=>props.cancelJob(row.job.id)}/>
      :<TrackHeader key={row.track.id} track={row.track} number={(index.get(row.track.id)??0)+1}
      heard={heard(project,row.track)} muted={showsMute(project,row.track)} mute={on=>props.muteTrack(row.track.id,on)}
      change={patch=>props.changeTrack(row.track.id,patch)} remove={()=>props.removeTrack(row.track.id)}
      preview={patch=>props.previewTrack(row.track.id,patch)} checkpoint={edit.checkpoint} toggleTake={props.toggleTake}
      selected={selection.range?.tracks.includes(row.track.id)||project.clips.some(c=>c.trackId===row.track.id&&selection.clips.includes(c.id))}
      selectAll={()=>select({clips:project.clips.filter(c=>c.trackId===row.track.id).map(c=>c.id),range:null})}/>)}
     <button className="add-track-button" onClick={props.addTrack}><Plus size={15}/> Add new track</button>
    </div>
    <div className={'arr-lanes tool-'+tool} ref={lanes} style={grid}
     onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
     {rows.map((row,i)=><div key={'track' in row?row.track.id:row.job.id} className={'lane'+('track' in row&&row.track.take?' take-lane':'')+('job' in row?' job-row':'')} style={{top:i*LANE,height:LANE}}/>)}
     {project.clips.map(clip=>{
      const row=rowOf.get(clip.trackId);if(row===undefined)return null;
      const track=tracks[index.get(clip.trackId)!],chosen=selection.clips.includes(clip.id),w=Math.max(2,clip.duration*zoom);
      const window=waveformWindow(clip.start*zoom,w,viewLeft,view);
      return <div key={clip.id} data-clip={clip.id} tabIndex={0} role="button" aria-label={clip.name} aria-haspopup="menu"
       title="Right-click for download options"
       onContextMenu={event=>{event.preventDefault();event.stopPropagation();openClipMenu(clip,event.clientX,event.clientY);}}
       onKeyDown={event=>{
        if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){
         event.preventDefault();event.stopPropagation();const rect=event.currentTarget.getBoundingClientRect();
         openClipMenu(clip,Math.max(headerWidth,rect.left)+12,rect.top+22);
        }else if(event.key==='Enter'){event.preventDefault();event.stopPropagation();select({clips:[clip.id],range:null});}
       }}
       className={'clip'+(chosen?' chosen':'')+(clip.muted?' muted':heard(project,track)?'':' silent')}
       style={{left:clip.start*zoom,top:row*LANE+2,width:w,height:LANE-4,['--clip' as string]:track.color}}>
       <div className="clip-head">{clip.name}</div>
       <Waveform buffer={buffers.get(clip.buffer)} offset={clip.offset} duration={clip.duration}
        width={w} height={LANE-4} color="#111f19" viewStart={window.start} viewWidth={window.width}/>
       {tool==='pointer'&&<><i className="clip-edge" data-edge="left"/><i className="clip-edge right" data-edge="right"/></>}
      </div>;
     })}
     {range&&range.tracks.map(id=>{
      const row=rowOf.get(id);if(row===undefined)return null;
      return <i key={id} className="range-box" style={{left:range.start*zoom,width:(range.end-range.start)*zoom,top:row*LANE,height:LANE}}/>;
     })}
     {rows.map((row,i)=>'job' in row&&<JobLane key={row.job.id} job={row.job} now={now} left={row.job.start*zoom} top={i*LANE+2}
      width={Math.max(24,(row.job.end-row.job.start)*zoom)} height={LANE-4} viewLeft={viewLeft} viewWidth={view}/>)}
     {!tracks.length&&<div className="arr-empty" style={{width:headerWidth<HEADER?view+headerWidth:view,left:headerWidth<HEADER?-headerWidth:0}}>{props.empty}</div>}
     <i className="playhead" ref={head} style={{height:lanesHeight}}/>
    </div>
   </div>
   <div className="arr-timebar"><span className="timebar-corner">MIN : SEC</span><div style={{width}}>
    {Array.from({length:Math.ceil(length/15)},(_,i)=><span key={i} style={{left:i*15*zoom}}>{Math.floor(i*15/60)}:{String(i*15%60).padStart(2,'0')}</span>)}
   </div></div>
  </div>
 </div>
 {clipMenu&&menuClip&&<div ref={menuRef} className="clip-context-menu" role="menu" aria-label={`${menuClip.name} options`}
  style={{left:clipMenu.x,top:clipMenu.y}} onContextMenu={event=>event.preventDefault()}>
  <span className="clip-menu-name">{menuClip.name}</span>
  <button type="button" role="menuitem" onClick={()=>{props.downloadClip(menuClip.id);closeClipMenu(true);}}><Download size={15}/> Download WAV</button>
 </div>}
 </>;
}

/** Keep receiving a drag outside the element; a pointer the browser already cancelled cannot be captured. */
function capture(element:Element|null,pointer:number){try{element?.setPointerCapture(pointer);}catch{}}

/**
 * How far along a job looks. The engine's own fraction wins when it reports
 * one; otherwise the queue's time estimate, or a curve that slows as it nears
 * the end, so the lane keeps moving without ever claiming to be finished.
 */
function shown(job:Job,now:number){
 // Waiting in the queue is not progress: creep a little so the lane looks alive, nothing more.
 if(!job.running)return Math.min(0.05,(now-job.began)/1000/1200);
 const elapsed=(now-job.running)/1000;
 const guess=job.etaAt?elapsed/(elapsed+Math.max(1,(job.etaAt-now)/1000)):1-Math.exp(-elapsed/75);
 return Math.min(0.97,Math.max(job.progress??0,guess*0.97));
}

function JobHeader({job,now,cancel}:{job:Job;now:number;cancel:()=>void}){
 const percent=Math.round(shown(job,now)*100);
 return <div className="track-head job-head" style={{height:LANE}}>
  <span className="job-pulse" aria-hidden="true"/>
  <div className="track-main">
   <div className="track-title-row"><strong className="job-title" title={job.label}>{job.label}</strong>
    <button className="ms" aria-label={`Cancel ${job.label}`} title="Cancel" onClick={cancel}><X size={12}/></button></div>
   <span className="job-status" role="status" title={job.status}>{job.queue?`In queue · ${job.queue} ahead`:job.status}</span>
   <span className="job-meter" aria-hidden="true"><i style={{width:`${percent}%`}}/></span>
  </div>
 </div>;
}

/**
 * Where a result will land. Dots morph on a fixed grid and brighten as the job
 * advances. Models write the whole piece at once, so this is a placeholder.
 */
function JobLane({job,now,left,top,width,height,viewLeft,viewWidth}:{job:Job;now:number;left:number;top:number;width:number;height:number;viewLeft:number;viewWidth:number}){
 const done=shown(job,now);
 const window=waveformWindow(left,width,viewLeft,viewWidth);
 return <div className="job-lane" style={{left,top,width,height}} aria-hidden="true">
  <JobWaveform seed={job.id} progress={done} width={width} height={height-22} viewStart={window.start} viewWidth={window.width}/>
  <span className="job-lane-label">{job.label} · {Math.round(done*100)}%</span>
 </div>;
}

function TrackHeader({track,number,heard,muted,mute,change,preview,checkpoint,remove,selectAll,selected,toggleTake}:{track:Track;number:number;heard:boolean;muted:boolean;mute:(on:boolean)=>void;change:(patch:Partial<Track>)=>void;preview:(patch:Partial<Track>)=>void;checkpoint:()=>void;remove:()=>void;selectAll:()=>void;selected?:boolean;toggleTake:(id:string)=>void}){
 const [name,setName]=useState(track.name);
 useEffect(()=>setName(track.name),[track.name]);
 const take=track.take;
 return <div className={'track-head'+(selected?' selected':'')+(take?' take-head':'')+(heard?'':' silent')} style={{height:LANE,['--clip' as string]:track.color}} onClick={e=>{if(e.target===e.currentTarget)selectAll();}}>
  {take?<button className={'take-use'+(take.selected?' on':'')} aria-pressed={take.selected} onClick={()=>toggleTake(take.id)}
   aria-label={take.selected?`Stop using ${take.label} take`:`Use ${take.label} take`} title={take.selected?'Using this take. Click to hear the original.':'Use this take in place of the original'}>{take.selected&&<Check size={12} strokeWidth={3}/>}</button>
   :<span className="track-number" onClick={selectAll}>{number}</span>}
  <div className="track-main">
   <div className="track-title-row"><input className="track-name" value={name} aria-label="Track name" onChange={e=>setName(e.target.value)}
    onBlur={()=>{const next=name.trim().slice(0,40);if(next&&next!==track.name)change({name:next});else setName(track.name);}}
    onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur();e.stopPropagation();}}/>
    {take&&take.warnings.length>0&&<span className="take-warn" title={take.warnings.join(' ')} aria-label={take.warnings.join(' ')}><TriangleAlert size={12}/></span>}
    <button className={'ms mute-button'+(muted?' on-mute':'')} aria-pressed={muted} aria-label={`Mute ${track.name}`} title={muted?'Unmute':'Mute'} onClick={()=>mute(!muted)}>{muted?<VolumeX size={12}/>:<Volume2 size={12}/>}</button>
    <button className={'ms'+(track.solo?' on-solo':'')} aria-pressed={track.solo} title="Solo" onClick={()=>change({solo:!track.solo})}>S</button>
    <button className="ms trash" title="Delete track" aria-label={`Delete ${track.name}`} onClick={remove}><Trash2 size={12}/></button>
   </div>
   <div className="track-controls">
    <label className="channel-volume" title={`${track.volume<=0?'−∞':(20*Math.log10(track.volume)).toFixed(1)} dB`} style={{['--volume' as string]:`${track.volume/2*100}%`}}>
     <input type="range" min={0} max={2} step={0.01} value={track.volume} aria-label={`${track.name} volume`}
      onPointerDown={checkpoint} onKeyDown={checkpoint} onChange={e=>preview({volume:Number(e.target.value)})} onDoubleClick={()=>change({volume:1})}/>
    </label>
    <label className="channel-pan" title={`Pan ${Math.round(track.pan*100)}`}>
     <input type="range" min={-1} max={1} step={0.01} value={track.pan} aria-label={`${track.name} pan`}
      onPointerDown={checkpoint} onKeyDown={checkpoint} onChange={e=>preview({pan:Number(e.target.value)})} onDoubleClick={()=>change({pan:0})}/>
    </label>
   </div>
  </div>
 </div>;
}
