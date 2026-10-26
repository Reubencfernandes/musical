'use client';
import {useEffect,useState} from 'react';
import {songCover} from '@/lib/library';
import {cachedCover,publishCover,watchCover} from '@/lib/song-covers';
import {Skeleton} from '@/components/Skeleton';
/** Generated art stays private; older songs keep their consistent gradient. A shared song's art comes from its public `src`. */
export default function SongArt({id,size=56,cover=false,src}:{id:string;size?:number;cover?:boolean;src?:string}){
 const [broken,setBroken]=useState(false);
 const [loaded,setLoaded]=useState<string|null>(null),[fetching,setFetching]=useState(false);
 const [image,setImage]=useState<{id:string;url:string}|null>(null);
 useEffect(()=>{
  setBroken(false);
  setFetching(false);
  if(src)return;
  let active=true,url:string|undefined;
  const update=()=>{if(!active)return;if(url)URL.revokeObjectURL(url);const blob=cachedCover(id);url=blob?URL.createObjectURL(blob):undefined;setImage(url?{id,url}:null);};
  const stop=watchCover(id,update);update();
  if(cover&&!cachedCover(id)){
   setFetching(true);
   void songCover(id).then(blob=>{if(active&&blob)publishCover(id,blob);}).catch(()=>{}).finally(()=>{if(active)setFetching(false);});
  }
  return ()=>{active=false;stop();if(url)URL.revokeObjectURL(url);};
 },[id,cover,src]);
 let h=0;for(const ch of id)h=(h*31+ch.charCodeAt(0))>>>0;
 const a=h%360,b=(a+40+(h>>>9)%80)%360,x=20+(h>>>4)%60,y=20+(h>>>12)%60;
 const artwork=src&&!broken?src:!src&&image?.id===id?image.url:null;
 const loading=fetching||!!artwork&&loaded!==artwork;
 return <span className="song-art" aria-hidden="true" style={{width:size,height:size,
  background:`radial-gradient(circle at ${x}% ${y}%,hsl(${b} 85% 66%) 0,transparent 55%),linear-gradient(135deg,hsl(${a} 70% 42%),hsl(${(a+300)%360} 55% 18%))`}}>
  {artwork?<img className={loaded===artwork?'is-ready':''} src={artwork} alt="" loading="lazy" onLoad={()=>setLoaded(artwork)} onError={()=>{if(src)setBroken(true);else setImage(null);}}/>
   :<i style={{inset:`${18+(h>>>7)%14}%`}}/>}
  {loading&&<Skeleton className="song-art-skeleton"/>}
 </span>;
}
