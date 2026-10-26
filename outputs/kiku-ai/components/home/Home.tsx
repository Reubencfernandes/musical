'use client';
import Link from 'next/link';
import {AudioLines,SlidersHorizontal,FileMusic,ArrowRight} from 'lucide-react';
import {SongRow} from '@/components/songs/SongList';
import {SongSkeletons} from '@/components/Skeleton';
import {useSongs} from '@/components/songs/useSongs';
import PublicSongs,{usePublicSongs} from '@/components/explore/PublicSongs';
import PromptBox from './PromptBox';
import type {User} from '@/components/shell/session';
import {useSession} from '@/components/shell/session';

export function HomeScreen(){const {user}=useSession();return <Home user={user}/>;}

const PLACES=[
 {href:'/generate',icon:AudioLines,title:'Generate',text:'Describe a song in a sentence, write the style and lyrics yourself, or cover a song you drop in.'},
 {href:'/studio',icon:SlidersHorizontal,title:'Studio',text:'Record or import audio, then restyle, rewrite, cover or split any part of it.'},
 {href:'/score',icon:FileMusic,title:'Score',text:'Turn a recording into sheet music you can play along with and edit.'},
];

function Recent({user}:{user:User}){
 const songs=useSongs();
 if(!songs.loading&&!songs.songs.length)return null;
 return <section className="home-recent" aria-label="Recent songs">
  <header><h2>Recent songs</h2><Link href="/library">See all <ArrowRight size={13}/></Link></header>
  {songs.loading&&!songs.songs.length?<SongSkeletons count={3} label="Loading recent songs…"/>
   :<ul className="song-list m-0 flex list-none flex-col gap-[2px] p-0">{songs.songs.slice(0,4).map(s=><SongRow key={s.id} item={s} audioUrl={songs.audioUrl} remove={i=>void songs.remove(i)} rename={(i,t)=>void songs.rename(i,t)}
   paint={i=>void songs.paint(i)} painting={songs.painting.has(s.id)} share={(i,on)=>void songs.share(i,on)} sharing={songs.sharing.has(s.id)} owner={user.handle}/>)}</ul>}
 </section>;
}

/** Where to start, the user's latest songs and the newest shared ones. Visitors who are not signed in see it too. */
export default function Home({user}:{user:User|null}){
 const shared=usePublicSongs();
 return <div className="home">
  <section className="home-hero">
   <h1>{user?`What should we make, ${user.handle}?`:'What should we make?'}</h1>
   <PromptBox user={user}/>
  </section>
  <section className="home-places" aria-label="Where to start">
   {PLACES.map(p=>{const Icon=p.icon,Tag=p.href==='/generate'?Link:'a';return <Tag key={p.href} href={p.href} className="home-place"><span className="home-place-icon"><Icon size={20}/></span>
    <strong>{p.title}</strong><p>{p.text}</p><span className="home-go">Open <ArrowRight size={14}/></span></Tag>;})}
  </section>
  {user&&<Recent user={user}/>}
  <section className="home-recent" aria-label="New on Explore">
   <header><h2>New on Explore</h2><Link href="/">See all <ArrowRight size={13}/></Link></header>
   <PublicSongs songs={shared.songs} limit={4}/>
  </section>
 </div>;
}
