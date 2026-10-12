'use client';
import {useEffect,useState} from 'react';
import {ArrowUpRight,Music2} from 'lucide-react';
type Copy={title?:React.ReactNode;blurb?:string};
export default function SignIn({title=<>Your music.<br/>Written down.</>,blurb='Turn your audio recordings into a score you can play, edit, and make your own.'}:Copy={}){
 const [retry,setRetry]=useState(false),[embedded,setEmbedded]=useState(true),[waiting,setWaiting]=useState(false),[login,setLogin]=useState('/auth/login');
 // Come back to the page sign-in started from; the server only honours known pages.
 useEffect(()=>{setRetry(new URLSearchParams(location.search).get('signIn')==='retry');setEmbedded(window.self!==window.top);
  if(location.pathname!=='/')setLogin('/auth/login?next='+encodeURIComponent(location.pathname));},[]);
 useEffect(()=>{
  if(typeof BroadcastChannel==='undefined')return;
  const channel=new BroadcastChannel('kiku-auth');
  channel.onmessage=event=>{if(event.data!=='signed-in')setWaiting(false);};
  return()=>channel.close();
 },[]);
 // Viewed at huggingface.co the app sits in an iframe whose sandbox omits
 // allow-top-navigation, and Hugging Face sends X-Frame-Options on its OAuth
 // page. Signing in without leaving this page is therefore impossible; a popup
 // that closes itself is the closest the embed policy allows. Opened directly
 // at the Space's own domain the link is an ordinary same-page navigation.
 function signIn(event:React.MouseEvent<HTMLAnchorElement>){
  if(!embedded)return;
  event.preventDefault();
  const popup=window.open('/auth/login?popup=1','kiku-sign-in',
   'width=520,height=730,menubar=no,toolbar=no');
  if(popup){setWaiting(true);popup.focus();}
  else window.open(login,'_blank','noopener');
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
   {retry&&<p className="error-message" role="alert">Sign-in didn’t complete. Please try again.</p>}
  </div>
 </section>;
}
