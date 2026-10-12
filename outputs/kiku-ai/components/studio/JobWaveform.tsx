'use client';
import {useEffect,useRef} from 'react';
import {coverageAt,LOOP_SECONDS,POSE_COUNT} from '@/lib/performers';

const SPACING=6,MAX_WIDTH=16000;

/** A placeholder, animated on the same fixed dot grid as the /score performers. */
export default function JobWaveform({seed,progress,width,height}:{seed:string;progress:number;width:number;height:number}){
 const canvas=useRef<HTMLCanvasElement>(null),done=useRef(progress);
 useEffect(()=>{done.current=progress;},[progress]);
 useEffect(()=>{
  const surface=canvas.current,ctx=surface?.getContext('2d');if(!surface||!ctx)return;
  // Cap the backing surface for long selections; retain the same on-screen dot spacing.
  const scale=Math.min(devicePixelRatio||1,2,MAX_WIDTH/width);
  surface.width=Math.max(1,Math.round(width*scale));surface.height=Math.max(1,Math.round(height*scale));
  ctx.setTransform(scale,0,0,scale,0,0);
  let hash=0;for(const ch of seed)hash=(hash*31+ch.charCodeAt(0))>>>0;
  const columns=Array.from({length:Math.floor(width/SPACING)},(_,i)=>{
   hash=(Math.imul(hash,1664525)+1013904223)>>>0;
   const strength=.55+.45*(hash/4294967296),phase=hash/4294967296*Math.PI*2;
   return Float32Array.from({length:POSE_COUNT},(_,pose)=>{
    const angle=pose/POSE_COUNT*Math.PI*2;
    const swell=.5+.5*Math.sin(i*.19-angle);
    const detail=.5+.5*Math.sin(i*.47+angle*2+phase);
    return .14+.86*strength*(.65*swell+.35*detail);
   });
  });
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const color=getComputedStyle(surface).getPropertyValue('--accent').trim()||'#fa5425';
  const mid=height/2,rows=Math.floor((mid-3)/SPACING);
  let frame=0,last=-Infinity;
  const began=performance.now();
  function draw(now:number){
   if(!ctx)return;
   // Draw at 30 fps without React renders; reduced motion keeps the silhouette still.
   if(now-last>=1000/30){
    last=now;
    const pose=reduced.matches?0:((now-began)/1000/LOOP_SECONDS%1)*POSE_COUNT;
    ctx.clearRect(0,0,width,height);ctx.fillStyle=color;
    for(let i=0;i<columns.length;i++){
     const x=i*SPACING+SPACING/2,envelope=coverageAt(columns[i],pose)*(mid-3);
     ctx.globalAlpha=x/width<=done.current ? .9 : .3;
     for(let row=-rows;row<=rows;row++){
      const coverage=Math.max(0,Math.min(1,(envelope-Math.abs(row*SPACING))/SPACING+.5));
      const radius=2.05*Math.sqrt(coverage);if(radius<.08)continue;
      ctx.beginPath();ctx.arc(x,mid+row*SPACING,radius,0,Math.PI*2);ctx.fill();
     }
    }
   }
   frame=requestAnimationFrame(draw);
  }
  frame=requestAnimationFrame(draw);
  return()=>cancelAnimationFrame(frame);
 },[seed,width,height]);
 return <canvas ref={canvas} className="job-wave" style={{width,height}} aria-hidden="true"/>;
}
