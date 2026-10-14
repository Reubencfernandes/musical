import {useId} from 'react';
import {LARGE,SMALL} from './logo-dots';

/**
 * The Kiku AI mark: a chrysanthemum of dots (kiku, 菊) that swirls like sound
 * (kiku, 聞く, to listen) on an orange tile. branding/generate.py draws it and
 * writes the dot positions; small sizes use the simpler two-ring version.
 */
export function Mark({size=24}:{size?:number}){
 const id=useId(),dots=size<=32?SMALL:LARGE;
 return <svg className="kiku-mark" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
  <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff8540"/><stop offset="1" stopColor="#f2541c"/></linearGradient></defs>
  <rect width="100" height="100" rx="23.5" fill={`url(#${id})`}/>
  <g fill="#fff5ec">{dots.map(([x,y,r],i)=><circle key={i} cx={50+x*100} cy={50+y*100} r={r*100}/>)}</g>
 </svg>;
}

/** The mark and name, linking home. */
export default function Logo({className,size=24}:{className:string;size?:number}){
 return <a href="/" className={className} aria-label="Kiku AI home"><Mark size={size}/><span>Kiku</span></a>;
}
