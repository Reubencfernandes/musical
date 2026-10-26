'use client';
import {useEffect,useRef,useState} from 'react';
import {AudioLines} from 'lucide-react';
import {useRouter} from 'next/navigation';
import {HANDOFF} from '@/lib/song-handoff';
import {startSignIn} from '@/lib/sign-in';
import type {User} from '@/components/shell/session';

/**
 * Describe a song and go to Generate, which starts it. Signed-out visitors are
 * asked to sign in first; the idea waits in session storage (never in a URL)
 * and Generate picks it up once they are back.
 */
export default function PromptBox({user}:{user:User|null}){
 const [idea,setIdea]=useState(''),[instrumental,setInstrumental]=useState(false),waiting=useRef(false),router=useRouter();
 // Signing in through a popup (the Space embedded on huggingface.co) stays on this page; carry on once it is done.
 useEffect(()=>{if(user&&waiting.current){waiting.current=false;router.push('/generate');}},[user,router]);
 function start(event:React.FormEvent){
  event.preventDefault();if(!idea.trim())return;
  try{sessionStorage.setItem(HANDOFF,JSON.stringify({idea:idea.trim(),instrumental}));}catch{}
  if(user)router.push('/generate');else{waiting.current=true;startSignIn('/generate');}
 }
 return <form className="home-prompt" onSubmit={start}>
  <textarea value={idea} onChange={e=>setIdea(e.target.value)} rows={2} maxLength={500} aria-label="Describe the song you want to make"
   placeholder="Describe the song you want to make…" onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();e.currentTarget.form?.requestSubmit();}}}/>
  <div><label className="gen-switch"><input type="checkbox" checked={instrumental} onChange={e=>setInstrumental(e.target.checked)}/><span>Instrumental</span></label>
   <button type="submit" className="gen-create" disabled={!idea.trim()}><AudioLines size={16}/> Create</button></div>
 </form>;
}
