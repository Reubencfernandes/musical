import {useId} from 'react';
import {K} from './logo-pixels';

// branding/generate.py draws the same K for every icon and writes its cells.
const PITCH=10,PIXEL=9,LEFT=50-((K.cols-1)*PITCH+PIXEL)/2,TOP=50-((K.rows-1)*PITCH+PIXEL)/2;

/**
 * The Kiku AI mark: a pixel K on the orange tile. The pixels drop in when the
 * mark appears, then a wave runs through them now and then, like sound passing.
 */
export function Mark({size=24}:{size?:number}){
 const id=useId();
 return <svg className="kiku-mark" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
  <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff8540"/><stop offset="1" stopColor="#f2541c"/></linearGradient></defs>
  <rect width="100" height="100" rx="23.5" fill={`url(#${id})`}/>
  <g fill="#fff5ec">{K.cells.map(([x,y])=><rect key={x+'-'+y} className="kiku-pixel" x={LEFT+x*PITCH} y={TOP+y*PITCH} width={PIXEL} height={PIXEL} rx="1.2"
   style={{['--in' as string]:`${(x+y)*35}ms`,['--wave' as string]:`${x*90+y*25}ms`}}/>)}</g>
 </svg>;
}

/** The mark and name, linking home. */
export default function Logo({className,size=24}:{className:string;size?:number}){
 return <a href="/" className={className} aria-label="Kiku AI home"><Mark size={size}/><span>Kiku</span></a>;
}
