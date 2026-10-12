'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Trash2,Volume2,VolumeX,Plus,AudioWaveform} from 'lucide-react';
import Waveform from './Waveform';
import {type Clip,type Project,type Range,type Selection,type Track,MIN_CLIP,clipEnd,projectEnd,snap} from '@/lib/studio/model';

export const HEADER=244,LANE=88,RULER=32,CHORDS=22;
export type Tool='pointer'|'range';
export type Ghost={id:string;label:string;start:number;end:number};
type Edit={checkpoint:()=>void;preview:(fn:(p:Project)=>Project)=>void;commit:(fn:(p:Project)=>Project)=>void};
type Props={
 project:Project;buffers:Map<string,AudioBuffer>;
 selection:Selection;select:(next:Selection)=>void;
 zoom:number;setZoom:(zoom:number)=>void;tool:Tool;division:number;
 position:()=>number;playing:boolean;seek:(time:number)=>void;
 edit:Edit;ghosts:Ghost[];loop:Range|null;
 changeTrack:(id:string,patch:Partial<Track>)=>void;removeTrack:(id:string)=>void;
 previewTrack:(id:string,patch:Partial<Track>)=>void;addTrack:()=>void;
 dropFiles:(files:File[],time:number)=>void;
 empty:React.ReactNode;
};
type Drag=
 |{kind:'move';x:number;y:number;origin:Map<string,{start:number;track:number}>;lead:string;moved:boolean}
 |{kind:'trim';side:'left'|'right';x:number;origin:Clip;moved:boolean}
 |{kind:'range';time:number;track:number;x:number;moved:boolean}
 |{kind:'scrub'};

export default function Arrangement(props:Props){
 const {project,buffers,selection,select,zoom,tool,division,edit}=props;
 const scroller=useRef<HTMLDivElement>(null),lanes=useRef<HTMLDivElement>(null);
 const head=useRef<HTMLDivElement>(null),rulerHead=useRef<HTMLDivElement>(null);
 const drag=useRef<Drag|null>(null),zoomAnchor=useRef<{time:number;x:number}|null>(null);
 const [view,setView]=useState(900),[viewHeight,setViewHeight]=useState(600),[headerWidth,setHeaderWidth]=useState(HEADER);
 const beat=60/project.bpm,bar=beat*4;
 const length=Math.max(projectEnd(project)+bar*8,view/zoom,60);
 const width=Math.ceil(length*zoom);
 const tracks=project.tracks;
 const index=new Map(tracks.map((t,i)=>[t.id,i]));
 const lanesHeight=Math.max(tracks.length*LANE+80,viewHeight-RULER-(project.chords.length?CHORDS:0)-26,LANE*3);

 useEffect(()=>{
  const element=scroller.current;if(!element)return;
  const observer=new ResizeObserver(()=>{
   const header=element.clientWidth<640?156:HEADER;
   setHeaderWidth(header);setView(element.clientWidth-header);setViewHeight(element.clientHeight);
  });observer.observe(element);
  return()=>observer.disconnect();
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
    const visible=element.clientWidth-headerWidth;
    if(x>element.scrollLeft+visible-40||x<element.scrollLeft)element.scrollLeft=Math.max(0,x-visible*0.15);
   }
   frame=requestAnimationFrame(tick);
  };
  frame=requestAnimationFrame(tick);
  return()=>cancelAnimationFrame(frame);
 },[props.position,props.playing,zoom,headerWidth]);

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
 const trackAt=(clientY:number)=>Math.min(tracks.length-1,Math.max(0,Math.floor((clientY-(lanes.current?.getBoundingClientRect().top||0))/LANE)));
 const snapped=(time:number,free?:boolean)=>free?time:snap(time,project.bpm,division);

 function down(event:React.PointerEvent){
  // With no tracks the lane shows the empty state, whose buttons must keep their clicks.
  if(event.button!==0||!tracks.length)return;
  const target=event.target as HTMLElement;
  const clipElement=target.closest<HTMLElement>('[data-clip]');
  const clip=clipElement?project.clips.find(c=>c.id===clipElement.dataset.clip):undefined;
  capture(lanes.current,event.pointerId);
  const time=timeAt(event.clientX);
  if(clip&&tool==='pointer'&&!event.altKey){
   const edge=target.dataset.edge as 'left'|'right'|undefined;
   if(edge){
    select({clips:[clip.id],range:null});
    drag.current={kind:'trim',side:edge,x:event.clientX,origin:clip,moved:false};
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
  if(current?.kind==='range'&&!current.moved){select({clips:[],range:null});props.seek(timeAt(event.clientX));}
 }

 function scrub(event:React.PointerEvent){
  if(event.button!==0)return;
  capture(event.currentTarget as HTMLElement,event.pointerId);
  drag.current={kind:'scrub'};props.seek(timeAt(event.clientX));
 }

 const barPx=bar*zoom,every=Math.max(1,2**Math.ceil(Math.log2(Math.max(1,48/barPx))));
 const bars=Math.ceil(length/bar);
 const range=selection.range;
 const grid:React.CSSProperties={
  width,height:lanesHeight,['--bar-width' as string]:`${barPx*every}px`,
  backgroundImage:`repeating-linear-gradient(to right,var(--grid-bar) 0 1px,transparent 1px ${barPx*every}px)`
   +(beat*zoom>=10?`,repeating-linear-gradient(to right,var(--grid-beat) 0 1px,transparent 1px ${beat*zoom}px)`:''),
 };

 return <div className="arrangement" ref={scroller}
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
      {props.ghosts.map(g=><i key={g.id} className="ruler-ghost" style={{left:g.start*zoom,width:Math.max(4,(g.end-g.start)*zoom)}} title={g.label}/>)}
      <i className="ruler-head" ref={rulerHead}/>
     </div>
     {project.chords.length>0&&<div className="chord-lane" style={{width,height:CHORDS}}>
      {project.chords.map((chord,i)=><span key={i} style={{left:chord.time*zoom}}>{chord.name}</span>)}
     </div>}
    </div>
   </div>
   <div className="arr-rows">
    <div className="arr-headers" style={{height:lanesHeight}}>
     {tracks.map((track,i)=><TrackHeader key={track.id} track={track} number={i+1}
      change={patch=>props.changeTrack(track.id,patch)} remove={()=>props.removeTrack(track.id)}
      preview={patch=>props.previewTrack(track.id,patch)} checkpoint={edit.checkpoint}
      selected={selection.range?.tracks.includes(track.id)||project.clips.some(c=>c.trackId===track.id&&selection.clips.includes(c.id))}
      selectAll={()=>select({clips:project.clips.filter(c=>c.trackId===track.id).map(c=>c.id),range:null})}/>)}
     <button className="add-track-button" onClick={props.addTrack}><Plus size={15}/> Add new track</button>
    </div>
    <div className={'arr-lanes tool-'+tool} ref={lanes} style={grid}
     onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
     {tracks.map((track,i)=><div key={track.id} className="lane" style={{top:i*LANE,height:LANE}}/>)}
     {project.clips.map(clip=>{
      const row=index.get(clip.trackId);if(row===undefined)return null;
      const track=tracks[row],chosen=selection.clips.includes(clip.id),w=Math.max(2,clip.duration*zoom);
      return <div key={clip.id} data-clip={clip.id}
       className={'clip'+(chosen?' chosen':'')+(clip.muted?' muted':'')}
       style={{left:clip.start*zoom,top:row*LANE+2,width:w,height:LANE-4,['--clip' as string]:track.color}}>
       <div className="clip-head">{clip.name}</div>
       <Waveform buffer={buffers.get(clip.buffer)} offset={clip.offset} duration={clip.duration}
        width={w} height={LANE-26} color="rgba(0,0,0,.58)"/>
       {tool==='pointer'&&<><i className="clip-edge" data-edge="left"/><i className="clip-edge right" data-edge="right"/></>}
      </div>;
     })}
     {range&&range.tracks.map(id=>{
      const row=index.get(id);if(row===undefined)return null;
      return <i key={id} className="range-box" style={{left:range.start*zoom,width:(range.end-range.start)*zoom,top:row*LANE,height:LANE}}/>;
     })}
     {props.ghosts.map(g=><div key={g.id} className="ghost" style={{left:g.start*zoom,width:Math.max(4,(g.end-g.start)*zoom),height:lanesHeight}}>
      <span>{g.label}</span></div>)}
     {!tracks.length&&<div className="arr-empty" style={{width:headerWidth<HEADER?view+headerWidth:view,left:headerWidth<HEADER?-headerWidth:0}}>{props.empty}</div>}
     <i className="playhead" ref={head} style={{height:lanesHeight}}/>
    </div>
   </div>
   <div className="arr-timebar"><span className="timebar-corner">MIN : SEC</span><div style={{width}}>
    {Array.from({length:Math.ceil(length/15)},(_,i)=><span key={i} style={{left:i*15*zoom}}>{Math.floor(i*15/60)}:{String(i*15%60).padStart(2,'0')}</span>)}
   </div></div>
  </div>
 </div>;
}

/** Keep receiving a drag outside the element; a pointer the browser already cancelled cannot be captured. */
function capture(element:Element|null,pointer:number){try{element?.setPointerCapture(pointer);}catch{}}

function TrackHeader({track,number,change,preview,checkpoint,remove,selectAll,selected}:{track:Track;number:number;change:(patch:Partial<Track>)=>void;preview:(patch:Partial<Track>)=>void;checkpoint:()=>void;remove:()=>void;selectAll:()=>void;selected?:boolean}){
 const [name,setName]=useState(track.name);
 useEffect(()=>setName(track.name),[track.name]);
 return <div className={'track-head'+(selected?' selected':'')} style={{height:LANE,['--clip' as string]:track.color}} onClick={e=>{if(e.target===e.currentTarget)selectAll();}}>
  <span className="track-number" onClick={selectAll}>{number}</span>
  <div className="track-main">
   <div className="track-title-row"><input className="track-name" value={name} aria-label="Track name" onChange={e=>setName(e.target.value)}
    onBlur={()=>{const next=name.trim().slice(0,40);if(next&&next!==track.name)change({name:next});else setName(track.name);}}
    onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur();e.stopPropagation();}}/>
    <button className={'ms mute-button'+(track.mute?' on-mute':'')} aria-pressed={track.mute} aria-label={`Mute ${track.name}`} title="Mute" onClick={()=>change({mute:!track.mute})}>{track.mute?<VolumeX size={12}/>:<Volume2 size={12}/>}</button>
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
