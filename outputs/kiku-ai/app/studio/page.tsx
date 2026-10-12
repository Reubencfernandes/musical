'use client';
import {useEffect,useState} from 'react';
import dynamic from 'next/dynamic';
import ThemeToggle from '@/components/ThemeToggle';
import SignIn from '@/components/SignIn';
import {useSession} from '@/components/shell/session';
import '../studio.css';

// The studio is Web Audio from top to bottom, so it never renders on the server.
const Studio=dynamic(()=>import('@/components/studio/Studio'),{ssr:false,
 loading:()=><div className="auth-loading"><span className="spinner"/></div>});

export default function StudioPage(){
 const {user,ready,signOut}=useSession();
 // ?project= reopens a saved project and ?song= starts one from a library song.
 const [open,setOpen]=useState<{project?:string;song?:string}|null>(null);
 useEffect(()=>{const q=new URLSearchParams(location.search);setOpen({project:q.get('project')||undefined,song:q.get('song')||undefined});},[]);
 if(!ready||!open)return <div className="auth-loading"><span className="spinner"/></div>;
 if(!user)return <><ThemeToggle/><SignIn title={<>Your voice.<br/>Your band.</>}
  blurb="Record a take, build a band that follows it, and reshape any part of your song with AI."/></>;
 return <Studio user={user} signOut={signOut} open={open}/>;
}
