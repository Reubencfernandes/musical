'use client';
import {useLayoutEffect,useRef,type ReactNode} from 'react';

/** Let changing form contents move the footer smoothly, including during quick switches. */
export default function AnimatedHeight({children}:{children:ReactNode}){
 const outer=useRef<HTMLDivElement>(null),inner=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  const frame=outer.current,content=inner.current;if(!frame||!content)return;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let initialized=false,animation:Animation|null=null;
  const resize=()=>{
   const next=content.getBoundingClientRect().height,previous=frame.getBoundingClientRect().height;
   animation?.cancel();animation=null;frame.style.height=`${next}px`;
   if(!initialized||reduced.matches||Math.abs(next-previous)<1){initialized=true;frame.style.overflow='visible';return;}
   frame.style.overflow='clip';
   animation=frame.animate([{height:`${previous}px`},{height:`${next}px`}],{duration:280,easing:'cubic-bezier(.22,.68,.22,1)'});
   animation.onfinish=()=>{frame.style.overflow='visible';animation=null;};
  };
  resize();const observer=new ResizeObserver(resize);observer.observe(content);
  const stopMotion=()=>{if(reduced.matches)animation?.finish();};reduced.addEventListener('change',stopMotion);
  return()=>{observer.disconnect();animation?.cancel();reduced.removeEventListener('change',stopMotion);};
 },[]);
 return <div className="gen-mode-region min-w-0 flex-none" ref={outer}><div ref={inner}>{children}</div></div>;
}
