'use client';
import {memo,useEffect,useRef} from 'react';

const SPACING=6;
type Props={seed:string;progress:number;width:number;height:number;viewStart?:number;viewWidth?:number};

/** A quiet dot-field placeholder. Its movement is decorative, never audio data. */
function JobWaveform({seed,progress,width,height,viewStart=0,viewWidth=width}:Props){
 const canvas=useRef<HTMLCanvasElement>(null),target=useRef(progress),displayed=useRef(progress);
 const elapsed=useRef(0),redraw=useRef<(()=>void)|null>(null);
 useEffect(()=>{target.current=Math.max(0,Math.min(1,Number.isFinite(progress)?progress:0));redraw.current?.();},[progress]);
 useEffect(()=>{
  const surface=canvas.current,ctx=surface?.getContext('2d');
  if(!surface||!ctx||width<=0||viewWidth<=0||height<=0)return;
  let hash=0;for(const ch of seed)hash=(Math.imul(hash,31)+ch.charCodeAt(0))>>>0;
  const phase=(hash%1000)/1000*Math.PI*2;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const first=Math.floor(viewStart/SPACING),last=Math.ceil((viewStart+viewWidth)/SPACING);
  const mid=height/2,rows=Math.max(0,Math.floor((mid-3)/SPACING));
  let frame=0,visible=true,previous=0,paint:CanvasGradient|string='#ff7133';
  function prepare(){
   if(!surface||!ctx)return;
   const scale=Math.min(devicePixelRatio||1,2,16000/viewWidth);
   surface.width=Math.max(1,Math.ceil(viewWidth*scale));surface.height=Math.max(1,Math.ceil(height*scale));
   ctx.setTransform(surface.width/viewWidth,0,0,surface.height/height,0,0);
   const accent=getComputedStyle(surface).getPropertyValue('--accent').trim()||'#ff7133';
   const gradient=ctx.createLinearGradient(0,0,0,height);
   gradient.addColorStop(0,'#ffc28a');gradient.addColorStop(.48,accent);gradient.addColorStop(1,accent);paint=gradient;
  }
  function draw(){
   if(!ctx)return;
   const seconds=reduced.matches?0:elapsed.current/1000;
   ctx.clearRect(0,0,viewWidth,height);ctx.fillStyle=paint;
   const paths=Array.from({length:8},()=>new Path2D());
   for(let i=first;i<last;i++){
    const x=i*SPACING+SPACING/2,envelope=(.2+.8*(.5+.5*Math.sin(i*.16-seconds*1.1+phase))*(.72+.28*Math.sin(i*.43+seconds*.75+phase)))*(mid-3);
    const passed=x/width<=displayed.current;
    const frontier=Math.max(0,1-Math.abs(x-displayed.current*width)/36);
    for(let row=-rows;row<=rows;row++){
     const distance=Math.abs(row*SPACING);
     const coverage=Math.max(0,Math.min(1,(envelope-distance)/SPACING+.65));
     const radius=1.65*Math.sqrt(coverage);if(radius<.15)continue;
     const alpha=(passed?.76:.24)+frontier*.18;
     const bucket=Math.min(7,Math.floor(alpha*7));
     paths[bucket].moveTo(x-viewStart+radius,mid+row*SPACING);
     paths[bucket].arc(x-viewStart,mid+row*SPACING,radius,0,Math.PI*2);
    }
   }
   paths.forEach((path,i)=>{ctx.globalAlpha=(i+1)/8;ctx.fill(path);});ctx.globalAlpha=1;
  }
  function tick(now:number){
   frame=0;
   if(document.hidden||!visible||reduced.matches)return;
   const delta=previous?Math.min(64,now-previous):0;previous=now;
   elapsed.current+=delta;
   displayed.current+=(target.current-displayed.current)*(1-Math.exp(-delta/180));
   draw();frame=requestAnimationFrame(tick);
  }
  function sync(){
   cancelAnimationFrame(frame);frame=0;previous=0;
   if(document.hidden||!visible)return;
   if(reduced.matches){displayed.current=target.current;draw();}
   else{draw();frame=requestAnimationFrame(tick);}
  }
  redraw.current=()=>{if(reduced.matches&&visible&&!document.hidden){displayed.current=target.current;draw();}};
  const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;sync();});observer.observe(surface);
  const theme=new MutationObserver(()=>{prepare();if(visible&&!document.hidden)draw();});
  theme.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','class','style']});
  const resize=()=>{prepare();sync();};
  document.addEventListener('visibilitychange',sync);reduced.addEventListener('change',sync);window.addEventListener('resize',resize);
  prepare();sync();
  return()=>{
   redraw.current=null;cancelAnimationFrame(frame);observer.disconnect();theme.disconnect();
   document.removeEventListener('visibilitychange',sync);reduced.removeEventListener('change',sync);window.removeEventListener('resize',resize);
  };
 },[seed,width,height,viewStart,viewWidth]);
 return <canvas ref={canvas} className="job-wave" style={{width:Math.max(0,viewWidth),height,left:viewStart}} aria-hidden="true"/>;
}
export default memo(JobWaveform);
