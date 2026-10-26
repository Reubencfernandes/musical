'use client';
import {memo,useEffect,useRef} from 'react';
import {waveformEnvelope} from '@/lib/studio/waveform';

type Props={buffer?:AudioBuffer;offset:number;duration:number;width:number;height:number;color:string;viewStart?:number;viewWidth?:number};

/** A continuous, filled audio silhouette, rendered only near the viewport. */
function Waveform({buffer,offset,duration,width,height,color,viewStart=0,viewWidth=width}:Props){
 const canvas=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{
  const surface=canvas.current;if(!surface)return;
  const scale=Math.min(window.devicePixelRatio||1,2);
  const w=Math.max(1,Math.min(16000,Math.ceil(viewWidth*scale))),h=Math.max(1,Math.ceil(height*scale));
  surface.width=w;surface.height=h;
  const draw=surface.getContext('2d');if(!draw)return;
  draw.clearRect(0,0,w,h);
  if(!buffer||width<=0||viewWidth<=0||height<=0)return;
  draw.setTransform(w/viewWidth,0,0,h/height,0,0);
  const pitch=viewWidth/w,first=Math.max(0,Math.floor(viewStart/pitch)-1),last=Math.ceil((viewStart+viewWidth)/pitch)+1;
  const data=waveformEnvelope(buffer,offset+first*pitch/width*duration,(last-first)*pitch/width*duration,last-first,offset+duration);
  const mid=height/2,amplitude=Math.max(0,mid-1.5),count=last-first;
  draw.fillStyle=color;
  draw.globalAlpha=.28;draw.fillRect(0,mid-.35,viewWidth,.7);
  draw.globalAlpha=1;
  draw.beginPath();draw.moveTo(first*pitch-viewStart,mid-data[1]*amplitude);
  // Joining extrema at device-pixel spacing keeps attacks sharp without a bar grid.
  for(let i=1;i<count;i++)draw.lineTo((first+i)*pitch-viewStart,mid-data[i*3+1]*amplitude);
  for(let i=count-1;i>=0;i--)draw.lineTo((first+i)*pitch-viewStart,mid-data[i*3]*amplitude);
  draw.closePath();draw.fill();
 },[buffer,offset,duration,width,height,color,viewStart,viewWidth]);
 return <canvas ref={canvas} className="clip-wave" style={{width:Math.max(0,viewWidth),height,marginLeft:viewStart}} aria-hidden="true"/>;
}
export default memo(Waveform);
