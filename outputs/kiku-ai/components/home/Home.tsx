'use client';
import {useState} from 'react';
import {AudioLines,SlidersHorizontal,FileMusic,ArrowRight} from 'lucide-react';
import {SongRow} from '@/components/songs/SongList';
import {useSongs} from '@/components/songs/useSongs';
import {HANDOFF} from '@/components/songs/Generate';
import type {User} from '@/components/shell/session';

const PLACES=[
 {href:'/generate',icon:AudioLines,title:'Generate',text:'Describe a song in a sentence, or write the style and lyrics yourself.'},
 {href:'/studio',icon:SlidersHorizontal,title:'Studio',text:'Record or import audio, then restyle, rewrite, cover or split any part of it.'},
 {href:'/score',icon:FileMusic,title:'Score',text:'Turn a recording into sheet music you can play along with and edit.'},
];

export default function Home({user}:{user:User}){
 const [idea,setIdea]=useState(''),[instrumental,setInstrumental]=useState(false);
 const songs=useSongs(user.storage);
 function start(event:React.FormEvent){
  event.preventDefault();if(!idea.trim())return;
  try{sessionStorage.setItem(HANDOFF,JSON.stringify({idea:idea.trim(),instrumental}));}catch{}
  location.href='/generate';
 }
 return <div className="home">
  <section className="home-hero">
   <h1>What should we make, {user.handle}?</h1>
   <form className="home-prompt" onSubmit={start}>
    <textarea value={idea} onChange={e=>setIdea(e.target.value)} rows={2} maxLength={500} aria-label="Describe the song you want to make"
     placeholder="Describe the song you want to make…" onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();e.currentTarget.form?.requestSubmit();}}}/>
    <div><label className="gen-switch"><input type="checkbox" checked={instrumental} onChange={e=>setInstrumental(e.target.checked)}/><span>Instrumental</span></label>
     <button type="submit" className="gen-create" disabled={!idea.trim()}><AudioLines size={16}/> Create</button></div>
   </form>
  </section>
  <section className="home-places" aria-label="Where to start">
   {PLACES.map(p=>{const Icon=p.icon;return <a key={p.href} href={p.href} className="home-place"><span className="home-place-icon"><Icon size={20}/></span>
    <strong>{p.title}</strong><p>{p.text}</p><span className="home-go">Open <ArrowRight size={14}/></span></a>;})}
  </section>
  {songs.songs.length>0&&<section className="home-recent" aria-label="Recent songs">
   <header><h2>Recent songs</h2><a href="/library">See all <ArrowRight size={13}/></a></header>
   <ul className="song-list">{songs.songs.slice(0,4).map(s=><SongRow key={s.id} item={s} audioUrl={songs.audioUrl} remove={i=>void songs.remove(i)} rename={(i,t)=>void songs.rename(i,t)} paint={i=>void songs.paint(i)} painting={songs.painting.has(s.id)}/>)}</ul>
  </section>}
 </div>;
}
