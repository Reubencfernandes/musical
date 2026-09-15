'use client';
import {useEffect,useRef,useState} from 'react';
import {coverageAt,GRID_SIZE,loadPerformer,LOOP_SECONDS,PERFORMERS,POSE_COUNT,type PerformerId} from '@/lib/performers';

type Props={message?:string;onCancel:()=>void;cancelLabel?:string;performer?:PerformerId};
export default function Processing({message,onCancel,cancelLabel='Cancel conversion',performer='saxophone'}:Props){
 const canvas=useRef<HTMLCanvasElement>(null);
 const [unavailable,setUnavailable]=useState(false);
 const person=PERFORMERS.find(item=>item.id===performer)!.person;
 useEffect(()=>{
  const surface=canvas.current;if(!surface)return;
  const ctx=surface.getContext('2d');if(!ctx){setUnavailable(true);return;}
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let frame=0,disposed=false;
  setUnavailable(false);
  delete surface.dataset.particles;
  ctx.clearRect(0,0,GRID_SIZE,GRID_SIZE);
  loadPerformer(performer).then(dots=>{
   if(disposed)return;
   const scale=Math.min(devicePixelRatio||1,2);
   surface.width=GRID_SIZE*scale;surface.height=GRID_SIZE*scale;
   ctx.setTransform(scale,0,0,scale,0,0);
   surface.dataset.particles=String(dots.length);
   surface.dataset.poses=String(POSE_COUNT);
   const began=performance.now();
   function draw(now:number){
    if(disposed||!ctx)return;
    const seconds=reduced.matches?0:Math.max(0,now-began)/1000;
    const position=(seconds/LOOP_SECONDS%1)*POSE_COUNT;
    ctx.clearRect(0,0,GRID_SIZE,GRID_SIZE);
    ctx.fillStyle=getComputedStyle(surface!).getPropertyValue('--accent').trim()||'#fa5425';
    for(const dot of dots){
     const radius=3.35*Math.sqrt(coverageAt(dot.coverage,position));
     if(radius<.08)continue;
     ctx.beginPath();ctx.arc(dot.x,dot.y,radius,0,Math.PI*2);ctx.fill();
    }
    frame=requestAnimationFrame(draw);
   }
   frame=requestAnimationFrame(draw);
  }).catch(()=>{if(!disposed)setUnavailable(true);});
  return()=>{disposed=true;cancelAnimationFrame(frame);};
 },[performer]);
 return <section className="processing view-enter" aria-live="polite">
  <canvas ref={canvas} className="musician-canvas" data-performer={performer} role="img" aria-label={`A ${person} animated by dots growing and shrinking on a fixed grid`} hidden={unavailable}/>
  {unavailable&&<div className="performer-unavailable" role="status">The animation could not load.</div>}
  <div className="process-label">PROCESSING</div>
  {message&&<p>{message}</p>}
  <button className="text-button" onClick={onCancel}>{cancelLabel}</button>
 </section>;
}
