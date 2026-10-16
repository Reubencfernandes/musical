import {useId} from 'react';

/** A bold pixel K: [column, row] on a 6 × 7 grid. */
const K:[number,number][]=[
 [0,0],[1,0],[4,0],[5,0],
 [0,1],[1,1],[3,1],[4,1],
 [0,2],[1,2],[2,2],[3,2],
 [0,3],[1,3],[2,3],
 [0,4],[1,4],[2,4],[3,4],
 [0,5],[1,5],[3,5],[4,5],
 [0,6],[1,6],[4,6],[5,6],
];
const PITCH=10,PIXEL=9,LEFT=50-(6*PITCH-1)/2,TOP=50-(7*PITCH-1)/2;

/**
 * The Kiku AI mark: a pixel K on the orange tile. The pixels drop in when the
 * mark appears, then a wave runs through them now and then, like sound passing.
 */
export function Mark({size=24}:{size?:number}){
 const id=useId();
 return <svg className="kiku-mark" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
  <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff8540"/><stop offset="1" stopColor="#f2541c"/></linearGradient></defs>
  <rect width="100" height="100" rx="23.5" fill={`url(#${id})`}/>
  <g fill="#fff5ec">{K.map(([x,y])=><rect key={x+'-'+y} className="kiku-pixel" x={LEFT+x*PITCH} y={TOP+y*PITCH} width={PIXEL} height={PIXEL} rx="1.2"
   style={{['--in' as string]:`${(x+y)*35}ms`,['--wave' as string]:`${x*90+y*25}ms`}}/>)}</g>
 </svg>;
}

/** The mark and name, linking home. */
export default function Logo({className,size=24}:{className:string;size?:number}){
 return <a href="/" className={className} aria-label="Kiku AI home"><Mark size={size}/><span>Kiku</span></a>;
}
