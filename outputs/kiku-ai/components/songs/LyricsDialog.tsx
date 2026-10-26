'use client';
import {useEffect,useRef} from 'react';
import {X} from 'lucide-react';
import Avatar from '@/components/shell/Avatar';
import Lyrics from './Lyrics';
import {label} from './SongList';
import type {Creator} from '@/lib/shared';

export type Words={title:string;caption:string;lyrics:string;instrumental:boolean;model:string;meta?:{bpm?:number;keyscale?:string}};

/** A song's words and style in a dialog, with who made it when it is someone else's. */
export default function LyricsDialog({song,creator,close}:{song:Words;creator?:Creator;close:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const d=dialog.current;if(d&&!d.open)d.showModal();},[]);
 return <dialog ref={dialog} className="hub-dialog lyrics-dialog" aria-label={`Lyrics of ${song.title}`} onClose={close}
  onClick={e=>{if(e.target===e.currentTarget)e.currentTarget.close();}}>
  <button className="hub-dialog-close" onClick={()=>dialog.current?.close()} aria-label="Close"><X size={18}/></button>
  <header>
   <h2>{song.title}</h2>
   {creator&&<a className="creator" href={`https://huggingface.co/${encodeURIComponent(creator.handle)}`} target="_blank" rel="noopener noreferrer">
    <Avatar handle={creator.handle} src={creator.avatar} size={22}/><span>{creator.name||creator.handle}</span>{creator.name&&<small>@{creator.handle}</small>}</a>}
   <span className="song-tags"><em>{label(song.model)}</em>{song.instrumental&&<em>Instrumental</em>}
    {song.meta?.bpm&&<em>{song.meta.bpm} BPM</em>}{song.meta?.keyscale&&<em>{song.meta.keyscale}</em>}</span>
  </header>
  {song.caption&&<p className="lyrics-style">{song.caption}</p>}
  {song.lyrics.trim()?<Lyrics text={song.lyrics}/>
   :<p className="lyrics-none">{song.instrumental?'This one is instrumental, so it has no lyrics.':'No lyrics were saved with this song.'}</p>}
 </dialog>;
}
