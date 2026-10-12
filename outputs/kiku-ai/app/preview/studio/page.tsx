'use client';
import dynamic from 'next/dynamic';
import '../../studio.css';

// Development only: the studio without signing in, for checking editing and playback.
// Engine calls from here return "sign in" errors, which is expected.
const Studio=dynamic(()=>import('@/components/studio/Studio'),{ssr:false});
export default function Page(){
 if(process.env.NODE_ENV!=='development')return null;
 return <Studio user={{name:'Preview'}} signOut={()=>{}}/>;
}
