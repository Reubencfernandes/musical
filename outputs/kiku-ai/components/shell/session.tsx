'use client';
import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {useRouter} from 'next/navigation';
import {forgetToken} from '@/lib/studio/engine';
import {refreshAccount} from '@/lib/library';
import {SIGN_IN_STARTED} from '@/lib/sign-in';

/**
 * `storage` says whether the user let Kiku AI save to their Hugging Face account.
 * `avatar` and `fullname` come from their Hugging Face profile; sessions from before
 * they were kept have neither, and the avatar is then looked up by handle.
 */
export type User={id:string;name:string;handle:string;storage:boolean;avatar?:string;fullname?:string};

/**
 * The signed-in user. Signing in from an embedded page happens in a popup that
 * broadcasts when it is done, and so does granting permission to save, so every
 * open page picks up the new session without a reload. Inside the Space page on
 * huggingface.co that broadcast never arrives (Chrome keeps an iframe's
 * BroadcastChannel apart from the popup's, and Hugging Face's sign-in pages cut
 * window.opener), so while a popup is open the page asks the server instead.
 */
type SessionState={user:User|null;ready:boolean;signOut:()=>Promise<boolean>;refresh:()=>void};
const SessionContext=createContext<SessionState|null>(null);

/** The server supplies only the public profile; OAuth tokens remain in the HttpOnly session. */
export function SessionProvider({initialUser,children}:{initialUser:User|null;children:ReactNode}){
 const [user,setUser]=useState(initialUser),request=useRef(0),router=useRouter();
 useEffect(()=>{setUser(initialUser);},[initialUser]);
 const check=useCallback(async()=>{
  const id=++request.current;
  try{const response=await fetch('/api/auth',{cache:'no-store'});if(!response.ok)return null;const data=await response.json();if(id===request.current)setUser(data.user??null);return (data.user??null) as User|null;}catch{return null;}
 },[]);
 const refresh=useCallback(()=>{forgetToken();refreshAccount();void check();router.refresh();},[check,router]);
 useEffect(()=>{
  const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('kiku-auth'):null;
  if(channel)channel.onmessage=refresh;
  const focus=()=>{void check();};window.addEventListener('focus',focus);
  return()=>{request.current++;channel?.close();window.removeEventListener('focus',focus);};
 },[check,refresh]);
 useEffect(()=>{
  let timer=0,until=0;
  const poll=async()=>{
   if(Date.now()>until){clearInterval(timer);return;}
   if(await check()){clearInterval(timer);refresh();}
  };
  // Sign-in gets ten minutes, as long as the server keeps its half of the flow.
  const start=()=>{until=Date.now()+600000;clearInterval(timer);timer=window.setInterval(poll,2000);};
  window.addEventListener(SIGN_IN_STARTED,start);
  return()=>{clearInterval(timer);window.removeEventListener(SIGN_IN_STARTED,start);};
 },[check,refresh]);
 const signOut=useCallback(async()=>{
  const response=await fetch('/api/auth',{method:'DELETE'});
  if(!response.ok&&response.status!==401)return false;
  request.current++;forgetToken();refreshAccount();setUser(null);router.refresh();return true;
 },[router]);
 return <SessionContext.Provider value={{user,ready:true,signOut,refresh}}>{children}</SessionContext.Provider>;
}

export function useSession(){
 const value=useContext(SessionContext);if(!value)throw new Error('useSession needs a SessionProvider.');return value;
}
