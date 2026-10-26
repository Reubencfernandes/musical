'use client';
import {useEffect,useState} from 'react';
import {ArrowUpRight,Music2} from 'lucide-react';
import {startSignIn} from '@/lib/sign-in';
import {useSession} from '@/components/shell/session';
/** `next` is the page sign-in returns to; it defaults to this one. */
type Copy={title?:React.ReactNode;blurb?:string;next?:string};
export default function SignIn({title=<>Your music.<br/>Written down.</>,blurb='Turn your audio recordings into a score you can play, edit, and make your own.',next}:Copy={}){
 const [retry,setRetry]=useState(false),[embedded,setEmbedded]=useState(true),[waiting,setWaiting]=useState(false),[login,setLogin]=useState('/auth/login');
 const [blocked,setBlocked]=useState(false),{refresh}=useSession();
 // A browser that blocks third-party cookies keeps the popup's session from this
 // embedded page until the page is given storage access.
 useEffect(()=>{if(window.self!==window.top)document.hasStorageAccess?.().then(has=>setBlocked(!has),()=>{});},[]);
 async function allowAccess(){
  try{await document.requestStorageAccess();setBlocked(false);}catch{}
  refresh();
 }
 // Come back to the page sign-in started from; the server only honours known pages.
 useEffect(()=>{setRetry(new URLSearchParams(location.search).get('signIn')==='retry');setEmbedded(window.self!==window.top);
  const back=next??location.pathname;setLogin(back!=='/'?'/auth/login?next='+encodeURIComponent(back):'/auth/login');},[next]);
 useEffect(()=>{
  if(typeof BroadcastChannel==='undefined')return;
  const channel=new BroadcastChannel('kiku-auth');
  channel.onmessage=event=>{if(event.data!=='signed-in')setWaiting(false);};
  return()=>channel.close();
 },[]);
 function signIn(event:React.MouseEvent<HTMLAnchorElement>){
  event.preventDefault();
  setWaiting(startSignIn(next));
 }
 return <section className="sign-in-view view-enter">
  <div className="sign-in-content">
   <span className="sign-in-symbol"><Music2 size={31}/></span>
   <h1>{title}</h1>
   <p>{blurb}</p>
   <a className="hf-sign-in" href={login} onClick={signIn} target={embedded?undefined:'_self'} rel="noopener noreferrer"><span aria-hidden="true">🤗</span> Sign in with Hugging Face <ArrowUpRight size={18}/></a>
   <p className="sign-in-note">Use your account’s free processing allowance.<br/>New here? You can create an account when you sign in.</p>
   {embedded&&<p className="sign-in-tab-note">{waiting
    ?'Finish signing in through the pop-up window. This page updates by itself.'
    :'Hugging Face opens sign-in in a small window, then brings you straight back here.'}</p>}
   {embedded&&blocked&&waiting&&<p className="sign-in-tab-note">Signed in, but this page still asks? Your browser keeps
    embedded pages apart. <button type="button" className="link-button" onClick={allowAccess}>Continue here</button> or{' '}
    <a href="/" target="_blank" rel="noopener noreferrer">open Kiku AI in its own tab</a>.</p>}
   {retry&&<p className="error-message" role="alert">Sign-in didn’t complete. Please try again.</p>}
  </div>
 </section>;
}
