'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {ArrowLeft,Check,Download,Globe,Link2,Lock,Pause,Pencil,Play,SlidersHorizontal} from 'lucide-react';
import Avatar from '@/components/shell/Avatar';
import PublicSongs from '@/components/explore/PublicSongs';
import {SongPageSkeleton} from '@/components/Skeleton';
import {usePlayer} from '@/components/shell/Player';
import type {User} from '@/components/shell/session';
import {useSession} from '@/components/shell/session';

import {listShared,type Creator,type PublicSong} from '@/lib/shared';
import Lyrics from './Lyrics';
import SongArt from './SongArt';
import {label} from './SongList';
import {creatorOf,useSongs} from './useSongs';

export function SongScreen({handle,id}:{handle:string;id:string}){const {user}=useSession();return <SongPage handle={handle} id={id} user={user}/>;}

type Shown={title:string;caption:string;lyrics:string;instrumental:boolean;model:string;duration:number;createdAt:string;sharedAt?:string;
 meta?:{bpm?:number;keyscale?:string};public:boolean};
/** What plays the song and paints its artwork: a public file, or the owner's private library. */
type Source={key:string;art?:string;cover?:boolean;load:()=>Promise<string>};
type Owner={saved:boolean;sharing:boolean;rename:(title:string)=>void;share:(on:boolean)=>void;audio:()=>Promise<string>};

const clock=(s:number)=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
const day=(iso?:string)=>{const d=iso?new Date(iso):null;return d&&!isNaN(+d)?d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'';};
const sharedKey=(song:PublicSong)=>`shared:${song.repo}/${song.id}`;

/** One person's shared songs; null while they load. */
function useShared(handle:string){
 const [songs,setSongs]=useState<PublicSong[]|null>(null);
 useEffect(()=>{
  const controller=new AbortController();setSongs(null);
  void listShared(handle,controller.signal).then(found=>{if(!controller.signal.aborted)setSongs(found);});
  return()=>controller.abort();
 },[handle]);
 return songs;
}

function Detail({song,creator,source,owner,more}:{song:Shown;creator:Creator;source:Source;owner?:Owner;more:PublicSong[]|null}){
 const player=usePlayer(),[editing,setEditing]=useState(false),[title,setTitle]=useState(song.title),[copied,setCopied]=useState(false);
 const active=player.current?.id===source.key,playing=active&&player.playing,by=creator.name||creator.handle;
 useEffect(()=>{setTitle(song.title);document.title=`${song.title} · Kiku AI`;},[song.title]);
 const play=()=>player.play({id:source.key,title:song.title,subtitle:by,art:source.art,cover:source.cover,load:source.load});
 async function copyLink(){try{await navigator.clipboard.writeText(location.href);setCopied(true);setTimeout(()=>setCopied(false),1600);}catch{}}
 async function download(){
  if(!owner)return;
  try{const link=document.createElement('a');link.href=await owner.audio();link.download=(song.title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')||'kiku-song')+'.mp3';link.click();}catch{}
 }
 const lyrics=song.lyrics.trim();
 return <article className="song-page">
  <Link className="song-back" href={owner?'/library':'/'}><ArrowLeft size={15}/> {owner?'Library':'Explore'}</Link>
  <header className="song-hero">
   <button className={'song-hero-art'+(active?' active':'')} onClick={play} aria-label={playing?`Pause ${song.title}`:`Play ${song.title}`}>
    <SongArt id={source.key} src={source.art} cover={source.cover} size={240}/>
    <span className="song-play-icon">{playing?<Pause size={38} fill="currentColor"/>:<Play size={38} fill="currentColor"/>}</span></button>
   <div className="song-hero-info">
    <span className="song-kicker">{song.public?<><Globe size={12}/> Public song</>:<><Lock size={12}/> Private song</>}</span>
    {editing?<input className="song-title-input song-hero-title" value={title} autoFocus maxLength={80} aria-label="Song title" onChange={e=>setTitle(e.target.value)}
      onBlur={()=>{setEditing(false);if(title.trim()&&title!==song.title)owner?.rename(title);else setTitle(song.title);}}
      onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur();if(e.key==='Escape'){setTitle(song.title);setEditing(false);}}}/>
     :<h1>{song.title}{owner&&<button className="song-rename" onClick={()=>setEditing(true)} aria-label="Rename" title="Rename"><Pencil size={16}/></button>}</h1>}
    <a className="creator song-creator" href={`https://huggingface.co/${encodeURIComponent(creator.handle)}`} target="_blank" rel="noopener noreferrer" title={`@${creator.handle} on Hugging Face`}>
     <Avatar handle={creator.handle} src={creator.avatar} size={30}/><span>{by}</span>{creator.name&&<small>@{creator.handle}</small>}</a>
    <span className="song-tags"><em>{label(song.model)}</em>{song.instrumental&&<em>Instrumental</em>}{song.meta?.bpm&&<em>{song.meta.bpm} BPM</em>}
     {song.meta?.keyscale&&<em>{song.meta.keyscale}</em>}{song.duration>0&&<em>{clock(song.duration)}</em>}</span>
    <p className="song-dates">{[day(song.createdAt)&&`Made ${day(song.createdAt)}`,song.public&&day(song.sharedAt)&&`shared ${day(song.sharedAt)}`].filter(Boolean).join(' · ')}</p>
    <div className="song-buttons">
     <button className="song-primary" onClick={play}>{playing?<Pause size={16} fill="currentColor"/>:<Play size={16} fill="currentColor"/>}{playing?'Pause':'Play'}</button>
     {song.public&&<button onClick={()=>void copyLink()}>{copied?<Check size={15}/>:<Link2 size={15}/>}{copied?'Link copied':'Copy link'}</button>}
     {owner&&<>
      <button onClick={()=>owner.share(!song.public)} disabled={owner.sharing||!owner.saved} aria-pressed={song.public}
       title={!owner.saved?'Save it to your library to share it':song.public?'Take it off Explore':'Show it on Explore'}>
       {owner.sharing?<span className="spinner"/>:song.public?<Lock size={15}/>:<Globe size={15}/>}{song.public?'Make private':'Make public'}</button>
      <button onClick={()=>void download()}><Download size={15}/>MP3</button>
      {owner.saved&&<a href={`/studio?song=${encodeURIComponent(source.key)}`}><SlidersHorizontal size={15}/>Studio</a>}
     </>}
    </div>
   </div>
  </header>
  {song.caption&&<section className="song-block"><h3>Style</h3><p className="lyrics-style">{song.caption}</p></section>}
  <section className="song-block">{lyrics?<Lyrics text={lyrics}/>
   :<><h3>Lyrics</h3><p className="lyrics-none">{song.instrumental?'This one is instrumental, so it has no lyrics.':'No lyrics were saved with this song.'}</p></>}</section>
  {!!more?.length&&<section className="home-recent" aria-label={`More from ${by}`}>
   <header><h2>More from {by}</h2></header><PublicSongs songs={more} limit={8}/></section>}
 </article>;
}

function Missing({loading}:{loading:boolean}){
 if(loading)return <SongPageSkeleton/>;
 return <div className="song-missing"><h1>Song not found</h1><p>It may be private, or the person who made it took it down.</p><Link href="/">Explore songs</Link></div>;
}

function SharedSong({id,shared}:{id:string;shared:PublicSong[]|null}){
 const song=shared?.find(s=>s.id===id);
 if(!song)return <Missing loading={shared===null}/>;
 return <Detail song={{...song,public:true}} creator={song.creator} more={shared!.filter(s=>s.id!==id)}
  source={{key:sharedKey(song),art:song.art,load:()=>Promise.resolve(song.audio)}}/>;
}

/** The owner sees their own copy, public or private, and can rename and share it here. */
function OwnSong({user,id,shared}:{user:User;id:string;shared:PublicSong[]|null}){
 const songs=useSongs(),item=songs.songs.find(s=>s.id===id);
 if(!item)return songs.loading?<Missing loading/>:<SharedSong id={id} shared={shared}/>;
 const sharedAt=shared?.find(s=>s.id===id)?.sharedAt;
 return <Detail song={{...item,public:!!item.public,sharedAt}} creator={creatorOf(user)} more={shared?.filter(s=>s.id!==id)??null}
  source={{key:item.id,cover:!!item.cover,load:()=>songs.audioUrl(item)}}
  owner={{saved:item.saved,sharing:songs.sharing.has(id),rename:t=>void songs.rename(item,t),share:on=>void songs.share(item,on),audio:()=>songs.audioUrl(item)}}/>;
}

/** A song's own page: artwork, who made it, its style and lyrics, and more from the same person. */
export default function SongPage({handle,id,user}:{handle:string;id:string;user:User|null}){
 const shared=useShared(handle);
 return user?.handle===handle?<OwnSong user={user} id={id} shared={shared}/>:<SharedSong id={id} shared={shared}/>;
}
