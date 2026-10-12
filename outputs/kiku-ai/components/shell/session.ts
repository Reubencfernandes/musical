'use client';
import {useCallback,useEffect,useState} from 'react';
import {forgetToken} from '@/lib/studio/engine';
import {refreshAccount} from '@/lib/library';

/** `storage` says whether the user let Kiku AI save to their Hugging Face account. */
export type User={id:string;name:string;handle:string;storage:boolean};

/**
 * The signed-in user. Signing in from an embedded page happens in a popup that
 * broadcasts when it is done, and so does granting permission to save, so every
 * open page picks up the new session without a reload.
 */
export function useSession(){
 const [user,setUser]=useState<User|null>(null),[ready,setReady]=useState(false);
 const check=useCallback(()=>fetch('/api/auth',{cache:'no-store'}).then(r=>r.json())
  .then(d=>{setUser(d.user);setReady(true);}).catch(()=>setReady(true)),[]);
 useEffect(()=>{
  void check();
  const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('kiku-auth'):null;
  if(channel)channel.onmessage=()=>{forgetToken();refreshAccount();void check();};
  return()=>channel?.close();
 },[check]);
 const signOut=useCallback(async()=>{
  const response=await fetch('/api/auth',{method:'DELETE'});
  if(response.ok||response.status===401){forgetToken();refreshAccount();setUser(null);}
 },[]);
 return {user,ready,signOut,refresh:check};
}
