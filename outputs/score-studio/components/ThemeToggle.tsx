'use client';
import {useEffect,useRef,useState} from 'react';
import {flushSync} from 'react-dom';
import {Moon,Sun} from 'lucide-react';
type Theme='dark'|'light';
export default function ThemeToggle(){
 const [theme,setTheme]=useState<Theme>('light'),[ready,setReady]=useState(false);
 const transitionRef=useRef<ViewTransition|null>(null),cleanupRef=useRef<(()=>void)|null>(null);
 useEffect(()=>{
  const media=matchMedia('(prefers-color-scheme: dark)');
  const sync=()=>{cleanupRef.current?.();let saved:string|null=null;try{saved=localStorage.getItem('score-theme');}catch{}
   const next:Theme=saved==='light'||saved==='dark'?saved:media.matches?'dark':'light';
   document.documentElement.dataset.theme=next;setTheme(next);setReady(true);
  };sync();media.addEventListener('change',sync);window.addEventListener('storage',sync);
  const interrupt=()=>{cleanupRef.current?.();};
  const visibility=()=>{if(document.hidden)interrupt();};
  document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',interrupt);window.addEventListener('resize',interrupt);
  return()=>{interrupt();media.removeEventListener('change',sync);window.removeEventListener('storage',sync);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',interrupt);window.removeEventListener('resize',interrupt);};
 },[]);
 function toggle(event:React.MouseEvent<HTMLButtonElement>){
  // A new click can always finish the previous wave; never lock the controls.
  cleanupRef.current?.();
  const next:Theme=document.documentElement.dataset.theme==='dark'?'light':'dark';
  const change=()=>{document.documentElement.dataset.theme=next;flushSync(()=>setTheme(next));try{localStorage.setItem('score-theme',next);}catch{}};
  if(!document.startViewTransition||matchMedia('(prefers-reduced-motion: reduce)').matches){change();return;}
  const box=event.currentTarget.getBoundingClientRect(),x=box.left+box.width/2,y=box.top+box.height/2;
  const root=document.documentElement;
  const radius=Math.ceil(Math.hypot(Math.max(x,innerWidth-x),Math.max(y,innerHeight-y)))+2;
  root.style.setProperty('--theme-wave-x',`${x}px`);root.style.setProperty('--theme-wave-y',`${y}px`);root.style.setProperty('--theme-wave-radius',`${radius}px`);
  let watchdog:ReturnType<typeof setTimeout>|undefined,finished=false,applied=false;
  const apply=()=>{if(!applied){applied=true;change();}};
  const finish=()=>{
   if(finished)return;finished=true;clearTimeout(watchdog);
   transitionRef.current?.skipTransition();transitionRef.current=null;cleanupRef.current=null;
   apply();
  };
  cleanupRef.current=finish;
  try{
   const transition=document.startViewTransition(apply);transitionRef.current=transition;
   // CSS owns the finite reveal animation, including when embedded in a Space.
   // Skip stalled snapshots on a timer, tab change, resize, or a subsequent click.
   watchdog=setTimeout(finish,1400);
   void transition.ready.catch(finish);
   void transition.finished.then(finish,finish);
  }catch{finish();}
 }
 return <button className="theme-toggle" onClick={toggle} aria-label={theme==='dark'?'Switch to white mode':'Switch to dark mode'} style={{visibility:ready?'visible':'hidden'}}>{theme==='dark'?<Sun size={19}/>:<Moon size={19}/>}</button>;
}
