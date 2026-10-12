'use client';
import {House,AudioLines,SlidersHorizontal,FileMusic,Library,LogOut} from 'lucide-react';
import SignIn from '@/components/SignIn';
import {PlayerProvider} from './Player';
import {type User,useSession} from './session';
import '@/app/hub.css';

export type Section='home'|'generate'|'library';
const NAV=[
 {id:'home',href:'/',label:'Home',icon:House},{id:'generate',href:'/generate',label:'Generate',icon:AudioLines},
 {id:'studio',href:'/studio',label:'Studio',icon:SlidersHorizontal},{id:'score',href:'/score',label:'Score',icon:FileMusic},
 {id:'library',href:'/library',label:'Library',icon:Library},
] as const;

/**
 * The frame around Home, Generate and Library: navigation on the left, the page,
 * and one player along the bottom. The studio and score pages keep their own
 * full-screen layouts and link back here.
 */
export default function AppShell({section,children}:{section:Section;children:(user:User,refresh:()=>void)=>React.ReactNode}){
 const {user,ready,signOut,refresh}=useSession();
 if(!ready)return <div className="hub hub-loading"><span className="spinner"/></div>;
 if(!user)return <div className="hub hub-signin"><SignIn title={<>Your idea.<br/>A whole song.</>}
  blurb="Write songs from a sentence, reshape your own recordings, and turn music into sheet music."/></div>;
 return <PlayerProvider><div className="hub">
  <nav className="hub-nav" aria-label="Kiku AI">
   <a href="/" className="hub-logo" aria-label="Kiku AI home">KIKU<i/></a>
   <ul>{NAV.map(item=>{const Icon=item.icon;return <li key={item.id}><a href={item.href} aria-current={item.id===section?'page':undefined}><Icon size={17}/><span>{item.label}</span></a></li>;})}</ul>
   <div className="hub-account"><span className="hub-avatar" aria-hidden="true">{user.handle.slice(0,1).toUpperCase()}</span><span className="hub-handle">{user.handle}</span>
    <button onClick={()=>void signOut()} aria-label="Sign out" title="Sign out"><LogOut size={15}/></button></div>
  </nav>
  <main className="hub-main">{children(user,refresh)}</main>
 </div></PlayerProvider>;
}
