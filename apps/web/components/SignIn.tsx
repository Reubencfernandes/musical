'use client';
import {useEffect,useState} from 'react';
import {ArrowUpRight,Music2} from 'lucide-react';
export default function SignIn(){
 const [retry,setRetry]=useState(false),[embedded,setEmbedded]=useState(true);
 useEffect(()=>{setRetry(new URLSearchParams(location.search).get('signIn')==='retry');setEmbedded(window.self!==window.top);},[]);
 return <section className="sign-in-view view-enter">
  <div className="sign-in-content">
   <span className="sign-in-symbol"><Music2 size={31}/></span>
   <h1>Your music.<br/>Written down.</h1>
   <p>Turn your audio recordings into a score you can play, edit, and make your own.</p>
   <a className="hf-sign-in" href="/auth/login" target={embedded?'_blank':'_self'} rel="noopener noreferrer"><span aria-hidden="true">🤗</span> Sign in with Hugging Face <ArrowUpRight size={18}/></a>
   <p className="sign-in-note">Use your account’s free processing allowance.<br/>New here? You can create an account when you sign in.</p>
   {embedded&&<p className="sign-in-tab-note">Sign-in opens your studio in a new tab.</p>}
   {retry&&<p className="error-message" role="alert">Sign-in didn’t complete. Please try again.</p>}
  </div>
 </section>;
}
