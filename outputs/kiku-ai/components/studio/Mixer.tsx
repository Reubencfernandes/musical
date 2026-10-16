'use client';
import {useEffect,useRef} from 'react';
import {type Project,type Track,heard,showsMute} from '@/lib/studio/model';
import type {Player} from '@/lib/studio/audio';

const FLOOR=-60;
const toDb=(gain:number)=>gain<=0?FLOOR:Math.max(FLOOR,20*Math.log10(gain));
const toGain=(db:number)=>db<=FLOOR?0:10**(db/20);
/** Meters read in dB, so a quiet track still moves. */
const meterHeight=(peak:number)=>peak<=0?0:Math.max(0,Math.min(1,(toDb(peak)-FLOOR)/(6-FLOOR)));

type Props={project:Project;player:Player;master:number;setMaster:(gain:number)=>void;
 change:(id:string,patch:Partial<Track>)=>void;muteTrack:(id:string,mute:boolean)=>void;commitMix:()=>void};

/** A channel strip per track plus the master bus. Faders move live; one undo step is saved per gesture. */
export default function Mixer({project,player,master,setMaster,change,muteTrack,commitMix}:Props){
 const meters=useRef(new Map<string,HTMLElement>());
 useEffect(()=>{
  let frame=0;const held=new Map<string,number>();
  const tick=()=>{
   for(const [id,element] of meters.current){
    const level=meterHeight(player.level(id==='master'?undefined:id));
    // Fall back slowly, like a hardware meter, so peaks are readable.
    const shown=Math.max(level,(held.get(id)||0)-0.02);held.set(id,shown);
    element.style.transform=`scaleY(${shown})`;
   }
   frame=requestAnimationFrame(tick);
  };
  frame=requestAnimationFrame(tick);
  return()=>cancelAnimationFrame(frame);
 },[player]);
 const bind=(id:string)=>(element:HTMLElement|null)=>{if(element)meters.current.set(id,element);else meters.current.delete(id);};

 return <section className="mixer" aria-label="Mixer">
  <Strip name="Master" color="var(--accent)" meter={bind('master')} gain={master}
   onGain={setMaster} onGrab={()=>{}} master/>
  {project.tracks.map((track,i)=><Strip key={track.id} name={track.name} number={i+1} color={track.color}
   meter={bind(track.id)} gain={track.volume} pan={track.pan} mute={showsMute(project,track)} solo={track.solo} heard={heard(project,track)}
   onGain={volume=>change(track.id,{volume})} onPan={pan=>change(track.id,{pan})}
   onMute={()=>muteTrack(track.id,!showsMute(project,track))}
   onSolo={()=>{commitMix();change(track.id,{solo:!track.solo});}}
   onGrab={commitMix}/>)}
  {!project.tracks.length&&<p className="mixer-empty">Channels appear here as you add tracks.</p>}
 </section>;
}

type StripProps={name:string;number?:number;color:string;meter:(el:HTMLElement|null)=>void;gain:number;pan?:number;
 mute?:boolean;solo?:boolean;heard?:boolean;master?:boolean;onGain:(gain:number)=>void;onPan?:(pan:number)=>void;
 onMute?:()=>void;onSolo?:()=>void;onGrab:()=>void};

function Strip(props:StripProps){
 const db=toDb(props.gain);
 return <div className={'strip'+(props.master?' strip-master':'')+(props.heard===false?' silent':'')} style={{['--clip' as string]:props.color}}>
  <span className="strip-number">{props.master?'M':props.number}</span>
  {props.onPan?<label className="strip-pan" title={`Pan ${Math.round((props.pan||0)*100)}`}>
   <input type="range" min={-1} max={1} step={0.01} value={props.pan||0} aria-label={`${props.name} pan`}
    onPointerDown={props.onGrab} onChange={e=>props.onPan!(Number(e.target.value))}
    onDoubleClick={()=>props.onPan!(0)}/>
  </label>:<span className="strip-pan"/>}
  <div className="strip-body">
   <div className="strip-meter"><i ref={props.meter}/></div>
   <input className="fader" type="range" min={FLOOR} max={6} step={0.5} value={db} aria-label={`${props.name} volume`}
    onPointerDown={props.onGrab} onChange={e=>props.onGain(toGain(Number(e.target.value)))}
    onDoubleClick={()=>props.onGain(1)}/>
  </div>
  <span className="strip-db">{db<=FLOOR?'-∞':(db>0?'+':'')+db.toFixed(1)}</span>
  {!props.master&&<div className="strip-buttons">
   <button className={'ms'+(props.mute?' on-mute':'')} aria-pressed={props.mute} onClick={props.onMute}>M</button>
   <button className={'ms'+(props.solo?' on-solo':'')} aria-pressed={props.solo} onClick={props.onSolo}>S</button>
  </div>}
  <span className="strip-name" title={props.name}>{props.name}</span>
 </div>;
}
