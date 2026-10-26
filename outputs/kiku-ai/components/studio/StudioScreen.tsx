'use client';
import dynamic from 'next/dynamic';
import ThemeToggle from '@/components/ThemeToggle';
import SignIn from '@/components/SignIn';
import {useSession} from '@/components/shell/session';

// The studio is Web Audio from top to bottom, so it never renders on the server.
const Studio=dynamic(()=>import('@/components/studio/Studio'),{ssr:false,
 loading:()=><div className="auth-loading"><span className="spinner"/></div>});

export default function StudioScreen({open}:{open:{project?:string;song?:string;draft?:string}}){
 const {user,ready,signOut}=useSession();
 if(!ready)return <div className="auth-loading"><span className="spinner"/></div>;
 if(!user)return <><ThemeToggle/><SignIn title={<>Your voice.<br/>Your band.</>}
  blurb="Record a take, build a band that follows it, and reshape any part of your song with AI."/></>;
 return <Studio key={[open.project,open.song,open.draft].join('|')} user={user} signOut={()=>void signOut()} open={open}/>;
}
