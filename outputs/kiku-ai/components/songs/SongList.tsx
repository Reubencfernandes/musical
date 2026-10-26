'use client';
import Link from 'next/link';
import {useState} from 'react';
import {Download,Pause,Play,SlidersHorizontal,Trash2,X,Check,CloudOff,ImagePlus,Globe,Lock,ScrollText} from 'lucide-react';
import SongArt from './SongArt';
import LyricsDialog from './LyricsDialog';
import {usePlayer} from '@/components/shell/Player';
import {modelLabel} from '@/lib/studio/models';
import type {Item,Making} from './useSongs';

const clock=(s:number)=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
/** A song's model by name; ACE-Step 1.5 is no longer offered, but songs made with it keep its name. */
export const label=(model:string)=>model==='ace15'?'ACE-Step 1.5':model==='yue2'||model==='ace1'?modelLabel(model):model;
/** A song's own page, which works for anyone once it is public and for its owner always. */
export const songPath=(handle:string,id:string)=>`/song/${encodeURIComponent(handle)}/${encodeURIComponent(id)}`;

/** How far a song being made looks; the same rule as the studio's job lanes. */
function shown(m:Making,now:number){
 if(!m.running)return Math.min(0.05,(now-m.began)/1000/1200);
 const elapsed=(now-m.running)/1000;
 const guess=m.etaAt?elapsed/(elapsed+Math.max(1,(m.etaAt-now)/1000)):1-Math.exp(-elapsed/75);
 return Math.min(0.97,Math.max(m.progress??0,guess*0.97));
}

export function MakingRow({item,now,cancel,dismiss}:{item:Making;now:number;cancel:()=>void;dismiss:()=>void}){
 const done=shown(item,now);
 return <li className={'song-row making'+(item.error?' failed':'')}>
  <span className="song-art making-art" aria-hidden="true"><i/></span>
  <div className="song-info"><strong>{item.title}</strong>
   <span className="song-status" role="status">{item.error||(item.queue?`In queue · ${item.queue} ahead`:item.status)}</span>
   {!item.error&&<span className="song-meter" aria-hidden="true"><i style={{width:`${Math.round(done*100)}%`}}/></span>}</div>
  <span className="song-time">{item.error?'':`${Math.round(done*100)}%`}</span>
  <div className="song-actions"><button onClick={item.error?dismiss:cancel} aria-label={item.error?'Dismiss':'Cancel'} title={item.error?'Dismiss':'Cancel'}><X size={15}/></button></div>
 </li>;
}

type RowProps={item:Item;audioUrl:(item:Item)=>Promise<string>;remove:(item:Item)=>void;rename:(item:Item,title:string)=>void;
 paint?:(item:Item)=>void;painting?:boolean;share?:(item:Item,on:boolean)=>void;sharing?:boolean;
 /** The owner's handle: a saved song's title then opens its page, where it is renamed too. */
 owner?:string};
export function SongRow({item,audioUrl,remove,rename,paint,painting=false,share,sharing=false,owner}:RowProps){
 const player=usePlayer(),[confirming,setConfirming]=useState(false),[editing,setEditing]=useState(false),[title,setTitle]=useState(item.title),[reading,setReading]=useState(false);
 const active=player.current?.id===item.id,playing=active&&player.playing;
 const play=()=>player.play({id:item.id,title:item.title,subtitle:item.caption,cover:!!item.cover,load:()=>audioUrl(item)});
 async function download(){
  try{const url=await audioUrl(item),link=document.createElement('a');link.href=url;link.download=(item.title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')||'kiku-song')+'.mp3';link.click();}catch{}
 }
 return <li className={'song-row'+(active?' active':'')}>
  <button className="song-play" onClick={play} aria-label={playing?`Pause ${item.title}`:`Play ${item.title}`}>
   <SongArt id={item.id} cover={!!item.cover}/><span className="song-play-icon">{playing?<Pause size={18} fill="currentColor"/>:<Play size={18} fill="currentColor"/>}</span></button>
  <div className="song-info">
   {editing?<input className="song-title-input" value={title} autoFocus maxLength={80} aria-label="Song title" onChange={e=>setTitle(e.target.value)}
     onBlur={()=>{setEditing(false);rename(item,title);}} onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur();if(e.key==='Escape'){setTitle(item.title);setEditing(false);}}}/>
    :<strong>{owner&&item.saved?<Link className="song-title" href={songPath(owner,item.id)} title="Open the song’s page">{item.title}</Link>
     :<button className="song-title" onClick={()=>setEditing(true)} title="Rename">{item.title}</button>}</strong>}
   <span className="song-tags"><em>{label(item.model)}</em>{item.instrumental&&<em>Instrumental</em>}{item.meta?.bpm&&<em>{item.meta.bpm} BPM</em>}{item.meta?.keyscale&&<em>{item.meta.keyscale}</em>}
    {!item.saved&&<em className="unsaved" title="Only on this page until you allow saving"><CloudOff size={10}/> Not saved</em>}
    {item.public&&<em className="shared" title="Anyone can find this on Explore"><Globe size={10}/> Public</em>}</span>
   <p title={item.caption}>{item.caption}</p>
  </div>
  <span className="song-time">{clock(item.duration)}</span>
  <div className="song-actions">
   {confirming?<><span className="confirm-text">Delete?</span><button onClick={()=>{setConfirming(false);remove(item);}} aria-label="Delete for good"><Check size={15}/></button><button onClick={()=>setConfirming(false)} aria-label="Keep it"><X size={15}/></button></>
    :<><button onClick={()=>setReading(true)} aria-label="Lyrics" title="Lyrics"><ScrollText size={15}/></button>
     {share&&<button onClick={()=>share(item,!item.public)} disabled={sharing||!item.saved} aria-pressed={!!item.public}
      aria-label={item.public?'Make private':'Make public'} title={sharing?'Updating…':!item.saved?'Save it to your library to share it':item.public?'Public on Explore. Make private':'Private. Make public on Explore'}>
      {sharing?<span className="spinner"/>:item.public?<Globe size={15}/>:<Lock size={15}/>}</button>}
     {paint&&<button onClick={()=>paint(item)} disabled={painting} aria-label={item.cover?'New cover art':'Make cover art'} title={painting?'Making cover art…':item.cover?'New cover art':'Make cover art'}>{painting?<span className="spinner"/>:<ImagePlus size={15}/>}</button>}
     <button onClick={()=>void download()} aria-label="Download MP3" title="Download MP3"><Download size={15}/></button>
     {item.saved?<a href={`/studio?song=${encodeURIComponent(item.id)}`} aria-label="Open in the studio" title="Open in the studio"><SlidersHorizontal size={15}/></a>
      :<button disabled title="Save it to your library to open it in the studio" aria-label="Open in the studio"><SlidersHorizontal size={15}/></button>}
     <button onClick={()=>setConfirming(true)} aria-label="Delete" title="Delete"><Trash2 size={15}/></button></>}
  </div>
  {reading&&<LyricsDialog song={item} close={()=>setReading(false)}/>}
 </li>;
}
