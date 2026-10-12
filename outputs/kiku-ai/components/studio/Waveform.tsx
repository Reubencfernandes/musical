'use client';
import {memo,useEffect,useRef} from 'react';
import {peaks,peakRate} from '@/lib/studio/audio';

/** Browsers refuse canvases much wider than this; longer clips are drawn at this width and stretched. */
const MAX_CANVAS=16000;

/** Draws the visible window of a buffer as a min/max waveform. */
function Waveform({buffer,offset,duration,width,height,color}:{buffer?:AudioBuffer;offset:number;duration:number;width:number;height:number;color:string}){
 const canvas=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{
  const element=canvas.current;
  if(!element||!buffer||width<1)return;
  const scale=Math.min(window.devicePixelRatio||1,2);
  const w=Math.max(1,Math.min(MAX_CANVAS,Math.round(width*scale))),h=Math.max(1,Math.round(height*scale));
  element.width=w;element.height=h;
  const draw=element.getContext('2d');
  if(!draw)return;
  draw.clearRect(0,0,w,h);
  draw.fillStyle=color;
  const data=peaks(buffer),rate=peakRate(buffer),blocks=data.length/2,mid=h/2;
  const upper=new Float32Array(w),lower=new Float32Array(w);
  for(let x=0;x<w;x++){
   const a=Math.floor((offset+duration*x/w)*rate),b=Math.max(a+1,Math.floor((offset+duration*(x+1)/w)*rate));
   let lo=0,hi=0;
   for(let i=Math.max(0,a);i<Math.min(blocks,b);i++){if(data[i*2]<lo)lo=data[i*2];if(data[i*2+1]>hi)hi=data[i*2+1];}
   upper[x]=mid-hi*mid*0.9;lower[x]=mid-lo*mid*0.9;
  }
  // One continuous, antialiased envelope keeps dense audio clear at any zoom.
  draw.beginPath();draw.moveTo(0,upper[0]);
  for(let x=1;x<w;x++)draw.lineTo(x,upper[x]);
  for(let x=w-1;x>=0;x--)draw.lineTo(x,lower[x]);
  draw.closePath();draw.fill();
  draw.globalAlpha=0.35;draw.fillRect(0,mid,w,Math.max(1,scale*0.5));
 },[buffer,offset,duration,width,height,color]);
 return <canvas ref={canvas} className="clip-wave" style={{width,height}} aria-hidden="true"/>;
}
export default memo(Waveform);
