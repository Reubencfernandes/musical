'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {Pause,Play,ScrollText} from 'lucide-react';
import Avatar from '@/components/shell/Avatar';
import SongArt from '@/components/songs/SongArt';
import LyricsDialog from '@/components/songs/LyricsDialog';
import {SongSkeletons} from '@/components/Skeleton';
import {label,songPath} from '@/components/songs/SongList';
import {usePlayer} from '@/components/shell/Player';
import {type PublicSong,listPublic} from '@/lib/shared';

const clock=(s:number)=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
const keyOf=(song:PublicSong)=>`shared:${song.repo}/${song.id}`;

/** Songs everyone has shared, read straight from their public datasets. */
export function usePublicSongs(){
 const [songs,setSongs]=useState<PublicSong[]|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  listPublic(controller.signal).then(setSongs).catch(e=>{if(!controller.signal.aborted){setSongs([]);setError((e as Error).message);}});
  return()=>controller.abort();
 },[]);
 return {songs,error};
}

function Card({song}:{song:PublicSong}){
 const player=usePlayer(),[reading,setReading]=useState(false),key=keyOf(song);
 const active=player.current?.id===key,playing=active&&player.playing;
 const by=song.creator.name||song.creator.handle;
 const play=()=>player.play({id:key,title:song.title,subtitle:by,art:song.art,load:()=>Promise.resolve(song.audio)});
 return <li className={'pub-card'+(active?' active':'')}>
  <button className="pub-art" onClick={play} aria-label={playing?`Pause ${song.title}`:`Play ${song.title} by ${by}`}>
   <SongArt id={key} src={song.art} size={200}/><span className="song-play-icon">{playing?<Pause size={26} fill="currentColor"/>:<Play size={26} fill="currentColor"/>}</span></button>
  <div className="pub-info flex min-w-0 flex-col gap-[6px]">
   <Link className="pub-title" href={songPath(song.creator.handle,song.id)} title={song.title}>{song.title}</Link>
   <a className="creator" href={`https://huggingface.co/${encodeURIComponent(song.creator.handle)}`} target="_blank" rel="noopener noreferrer" title={`@${song.creator.handle} on Hugging Face`}>
    <Avatar handle={song.creator.handle} src={song.creator.avatar} size={20}/><span>{by}</span></a>
   <div className="pub-meta"><span className="song-tags"><em>{label(song.model)}</em>{song.instrumental&&<em>Instrumental</em>}</span>
    <span className="song-time">{clock(song.duration)}</span>
    {!song.instrumental&&<button onClick={()=>setReading(true)} aria-label={`Lyrics of ${song.title}`} title="Lyrics"><ScrollText size={14}/></button>}</div>
  </div>
  {reading&&<LyricsDialog song={song} creator={song.creator} close={()=>setReading(false)}/>}
 </li>;
}

/** A grid of shared songs; `limit` shows only the newest few, `query` filters by title, style or creator. */
export default function PublicSongs({songs,limit,query=''}:{songs:PublicSong[]|null;limit?:number;query?:string}){
 if(songs===null)return <SongSkeletons view="cards" count={limit??5} label="Loading shared songs…"/>;
 const q=query.trim().toLowerCase();
 const shown=songs.filter(s=>!q||[s.title,s.caption,s.creator.handle,s.creator.name||''].join(' ').toLowerCase().includes(q)).slice(0,limit);
 if(!shown.length)return <p className="gen-empty">{q?'No shared songs match that.':'Nothing shared yet. Make a song, then switch it to Public to show it here.'}</p>;
 return <ul className="pub-grid">{shown.map(s=><Card key={keyOf(s)} song={s}/>)}</ul>;
}
