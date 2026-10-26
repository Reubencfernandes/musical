'use client';
import {useEffect,useRef,useState} from 'react';
import {coverageAt,GRID_SIZE,loadPerformer,LOOP_SECONDS,PERFORMERS,POSE_COUNT,type PerformerDot,type PerformerId} from '@/lib/performers';

type Props={message?:string;onCancel:()=>void;cancelLabel?:string;performer?:PerformerId};
export default function Processing({message,onCancel,cancelLabel='Cancel conversion',performer='saxophone'}:Props){
 const canvas=useRef<HTMLCanvasElement>(null);
 const [unavailable,setUnavailable]=useState(false);
 const person=PERFORMERS.find(item=>item.id===performer)!.person;
 useEffect(()=>{
  const surface=canvas.current;if(!surface)return;
  const ctx=surface.getContext('2d');if(!ctx){setUnavailable(true);return;}
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let frame=0,disposed=false,inView=true,elapsed=0,previousTime:number|null=null;
  let dots:PerformerDot[]|null=null,ink:string|CanvasGradient='#fa5425';
  setUnavailable(false);
  delete surface.dataset.particles;
  delete surface.dataset.ready;
  function updateInk(){
   if(!ctx)return;
   const accent=getComputedStyle(surface!).getPropertyValue('--accent').trim()||'#fa5425';
   const gradient=ctx.createLinearGradient(0,35,GRID_SIZE*.7,GRID_SIZE);
   gradient.addColorStop(0,'#ff9867');gradient.addColorStop(.5,accent);gradient.addColorStop(1,accent);
   ink=gradient;
  }
  function draw(){
   if(disposed||!ctx||!dots)return;
   const position=(elapsed/(LOOP_SECONDS*1000)%1)*POSE_COUNT;
   ctx.clearRect(0,0,GRID_SIZE,GRID_SIZE);
   ctx.fillStyle=ink;
   // One path keeps thousands of dots inexpensive, even on a phone.
   ctx.beginPath();
   for(const dot of dots){
     const radius=3.35*Math.sqrt(coverageAt(dot.coverage,position));
     if(radius<.08)continue;
     ctx.moveTo(dot.x+radius,dot.y);ctx.arc(dot.x,dot.y,radius,0,Math.PI*2);
   }
   ctx.fill();
  }
  function tick(now:number){
   if(disposed)return;
   // Resume from the visible pose instead of skipping ahead after a hidden tab.
   if(previousTime!==null)elapsed+=Math.min(now-previousTime,100);
   previousTime=now;draw();frame=requestAnimationFrame(tick);
  }
  function synchronize(){
   cancelAnimationFrame(frame);frame=0;previousTime=null;
   if(disposed||!dots||document.hidden||!inView)return;
   draw();
   if(!reduced.matches)frame=requestAnimationFrame(tick);
  }
  function resize(){
   if(disposed||!ctx)return;
   const size=Math.max(1,Math.round(surface!.getBoundingClientRect().width*Math.min(devicePixelRatio||1,2)));
   if(surface!.width!==size||surface!.height!==size){
    surface!.width=size;surface!.height=size;
    ctx.setTransform(size/GRID_SIZE,0,0,size/GRID_SIZE,0,0);
    updateInk();
   }
   synchronize();
  }
  const sizeObserver=new ResizeObserver(resize);
  const visibilityObserver=new IntersectionObserver(([entry])=>{inView=entry.isIntersecting;synchronize();});
  const themeObserver=new MutationObserver(()=>{updateInk();synchronize();});
  sizeObserver.observe(surface);visibilityObserver.observe(surface);
  themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  document.addEventListener('visibilitychange',synchronize);
  reduced.addEventListener('change',synchronize);
  window.addEventListener('resize',resize);
  resize();updateInk();
  loadPerformer(performer).then(loaded=>{
   if(disposed)return;
   dots=loaded;
   surface.dataset.particles=String(dots.length);
   surface.dataset.poses=String(POSE_COUNT);
   surface.dataset.ready='true';
   synchronize();
  }).catch(()=>{if(!disposed)setUnavailable(true);});
  return()=>{
   disposed=true;cancelAnimationFrame(frame);
   sizeObserver.disconnect();visibilityObserver.disconnect();themeObserver.disconnect();
   document.removeEventListener('visibilitychange',synchronize);
   reduced.removeEventListener('change',synchronize);window.removeEventListener('resize',resize);
  };
 },[performer]);
 return <section className="processing view-enter" aria-live="polite">
  <canvas ref={canvas} width={GRID_SIZE} height={GRID_SIZE} className="musician-canvas" data-performer={performer} role="img" aria-label={`A ${person} illustrated in softly animated orange dots`} hidden={unavailable}/>
  {unavailable&&<div className="performer-unavailable" role="status">The animation could not load.</div>}
  <div className="process-label">PROCESSING</div>
  {message&&<p>{message}</p>}
  <button className="text-button" onClick={onCancel}>{cancelLabel}</button>
 </section>;
}
