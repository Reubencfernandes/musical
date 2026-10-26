'use client';
import {useEffect,useState} from 'react';

/** Only pictures on Hugging Face's own hosts are shown. */
function hosted(url:unknown){
 if(typeof url!=='string'||url.length>500)return null;
 const absolute=url.startsWith('/')?'https://huggingface.co'+url:url;
 return /^https:\/\/(cdn-avatars\.huggingface\.co|huggingface\.co)\//.test(absolute)?absolute:null;
}
const known=new Map<string,Promise<string|null>>();
/** A Hugging Face user's profile picture, from their public profile; asked once per page. */
export function avatarOf(handle:string){
 let found=known.get(handle);
 if(!found){
  found=fetch(`https://huggingface.co/api/users/${encodeURIComponent(handle)}/overview`)
   .then(r=>r.ok?r.json():null).then(d=>hosted(d?.avatarUrl)).catch(()=>null);
  known.set(handle,found);
 }
 return found;
}

/** A round profile picture, or the handle's initial while it loads or if there is none. */
export default function Avatar({handle,src,size=28,className='hub-avatar'}:{handle:string;src?:string;size?:number;className?:string}){
 const [url,setUrl]=useState<string|null>(hosted(src)),[broken,setBroken]=useState(false);
 useEffect(()=>{
  setBroken(false);
  const given=hosted(src);if(given){setUrl(given);return;}
  let active=true;setUrl(null);
  void avatarOf(handle).then(found=>{if(active)setUrl(found);});
  return()=>{active=false;};
 },[handle,src]);
 return <span className={className} style={{width:size,height:size,fontSize:Math.round(size*.43)}} aria-hidden="true">
  {url&&!broken?<img src={url} alt="" referrerPolicy="no-referrer" onError={()=>setBroken(true)}/>:handle.slice(0,1).toUpperCase()}
 </span>;
}
