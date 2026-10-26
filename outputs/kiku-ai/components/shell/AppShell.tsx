'use client';
import {Compass,House,AudioLines,SlidersHorizontal,FileMusic,Library,LogIn,LogOut} from 'lucide-react';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import Logo from '@/components/Logo';
import Avatar from './Avatar';
import {PlayerProvider} from './Player';
import {startSignIn} from '@/lib/sign-in';
import {useSession} from './session';
import {SongsProvider} from '@/components/songs/useSongs';

export type Section='explore'|'home'|'generate'|'library'|'song';
const NAV=[
 {id:'explore',href:'/',label:'Explore',icon:Compass},{id:'home',href:'/home',label:'Home',icon:House},
 {id:'generate',href:'/generate',label:'Generate',icon:AudioLines},
 {id:'studio',href:'/studio',label:'Studio',icon:SlidersHorizontal},{id:'score',href:'/score',label:'Score',icon:FileMusic},
 {id:'library',href:'/library',label:'Library',icon:Library},
] as const;

function GuestAccount(){
 return <button className="hub-account hub-sign-in" onClick={()=>startSignIn()}><LogIn size={16}/><span>Sign in</span></button>;
}

/**
 * The frame around Explore, Home, Generate and Library: navigation on the left,
 * the page, and one player along the bottom. Visitors who are not signed in see
 * the frame too; a page that needs an account shows sign-in in its place. The
 * studio and score pages keep their own full-screen layouts and link back here.
 */
export default function AppShell({children}:{children:React.ReactNode}){
 const {user,signOut}=useSession(),pathname=usePathname();
 return <SongsProvider user={user}><PlayerProvider key={user?.id??'guest'}><div className="hub">
  <nav className="hub-nav" aria-label="Kiku AI">
   <Logo className="hub-logo" size={26}/>
   <ul>{NAV.map(item=>{const Icon=item.icon,content=<><Icon size={17}/><span>{item.label}</span></>;
    // Entering the editors starts a document so their recording/job unload guards also cover Back.
    return <li key={item.id}>{item.id==='studio'||item.id==='score'?<a href={item.href}>{content}</a>
     :<Link href={item.href} aria-current={pathname===item.href?'page':undefined}>{content}</Link>}</li>;})}</ul>
   {user?<div className="hub-account"><Avatar handle={user.handle} src={user.avatar}/><span className="hub-handle" title={user.fullname||user.handle}>{user.handle}</span>
    <button onClick={()=>void signOut()} aria-label="Sign out" title="Sign out"><LogOut size={15}/></button></div>:<GuestAccount/>}
  </nav>
  <main className="hub-main">{children}</main>
 </div></PlayerProvider></SongsProvider>;
}
