import Link from 'next/link';
import {useId} from 'react';
import {KIKU_MARK} from './logo-mark';

/**
 * A listening K: one curved receiver, two swept sound ribbons and a signal
 * in the aperture. branding/generate.py shares its geometry with every icon.
 */
export function Mark({size=24}:{size?:number}){
 const id=useId();
 const {receiver,upper,lower,signal}=KIKU_MARK;
 return <svg className="kiku-mark" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
  <defs><linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100"><stop stopColor="#ff864a"/><stop offset="1" stopColor="#f24d24"/></linearGradient></defs>
  <g fill={`url(#${id})`}>
   <g className="kiku-receiver-entry"><path d={receiver}/></g>
   <g className="kiku-upper-entry"><path className="kiku-ribbon kiku-ribbon-upper" d={upper}/></g>
   <g className="kiku-lower-entry"><path className="kiku-ribbon kiku-ribbon-lower" d={lower}/></g>
   <g className="kiku-point-entry"><circle className="kiku-listen-point" cx={signal.x} cy={signal.y} r={signal.radius}/></g>
  </g>
  <circle className="kiku-signal-flight" cx={signal.x} cy={signal.y} r="2.2" fill="#fff0d9"/>
 </svg>;
}

/** The mark and name, linking home. */
export default function Logo({className,size=24,documentNavigation=false}:{className:string;size?:number;documentNavigation?:boolean}){
 const mark=<><Mark size={size}/><span>Kiku</span></>;
 // The editor's document exit must retain its existing beforeunload protection.
 return documentNavigation?<a href="/" className={className} aria-label="Kiku AI home">{mark}</a>
  :<Link href="/" className={className} aria-label="Kiku AI home">{mark}</Link>;
}
