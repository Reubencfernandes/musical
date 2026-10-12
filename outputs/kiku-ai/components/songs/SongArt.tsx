'use client';
import {useEffect,useState} from 'react';
import {songCover} from '@/lib/library';
import {cachedCover,publishCover,watchCover} from '@/lib/song-covers';
/** Generated art stays private; older songs keep their consistent gradient. */
export default function SongArt({id,size=56,cover=false}:{id:string;size?:number;cover?:boolean}){
 const [image,setImage]=useState<{id:string;url:string}|null>(null);
 useEffect(()=>{
  let active=true,url:string|undefined;
  const update=()=>{if(!active)return;if(url)URL.revokeObjectURL(url);const blob=cachedCover(id);url=blob?URL.createObjectURL(blob):undefined;setImage(url?{id,url}:null);};
  const stop=watchCover(id,update);update();
  if(cover&&!cachedCover(id))void songCover(id).then(blob=>{if(active&&blob)publishCover(id,blob);}).catch(()=>{});
  return ()=>{active=false;stop();if(url)URL.revokeObjectURL(url);};
 },[id,cover]);
 let h=0;for(const ch of id)h=(h*31+ch.charCodeAt(0))>>>0;
 const a=h%360,b=(a+40+(h>>>9)%80)%360,x=20+(h>>>4)%60,y=20+(h>>>12)%60;
 return <span className="song-art" aria-hidden="true" style={{width:size,height:size,
  background:`radial-gradient(circle at ${x}% ${y}%,hsl(${b} 85% 66%) 0,transparent 55%),linear-gradient(135deg,hsl(${a} 70% 42%),hsl(${(a+300)%360} 55% 18%))`}}>
  {image?.id===id?<img src={image.url} alt="" onError={()=>setImage(null)}/>:<i style={{inset:`${18+(h>>>7)%14}%`}}/>}
 </span>;
}
