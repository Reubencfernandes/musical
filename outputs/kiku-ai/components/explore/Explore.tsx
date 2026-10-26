'use client';
import {useState} from 'react';
import {Search} from 'lucide-react';
import PromptBox from '@/components/home/PromptBox';
import PublicSongs,{usePublicSongs} from './PublicSongs';
import type {User} from '@/components/shell/session';
import {useSession} from '@/components/shell/session';

export function ExploreScreen(){const {user}=useSession();return <Explore user={user}/>;}

/** The front page: describe a song, or listen to what everyone has shared. Open to visitors who are not signed in. */
export default function Explore({user}:{user:User|null}){
 const {songs,error}=usePublicSongs(),[query,setQuery]=useState('');
 return <div className="home explore">
  <section className="home-hero">
   <h1>{user?`What should we make, ${user.handle}?`:'Describe a song. Kiku makes it.'}</h1>
   <PromptBox user={user}/>
  </section>
  <section className="explore-songs" aria-label="Songs people shared">
   <header><div><h2>Explore</h2><p>Songs people made with Kiku AI and shared.</p></div>
    <label className="gen-search"><Search size={14}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search" aria-label="Search shared songs"/></label></header>
   {error&&<p className="gen-error" role="alert">{error}</p>}
   <PublicSongs songs={songs} query={query}/>
  </section>
 </div>;
}
