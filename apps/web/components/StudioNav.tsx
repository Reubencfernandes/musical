'use client';
import Link from 'next/link';
import {FileMusic,AudioLines} from 'lucide-react';

/** The studio's two rooms: notation on one side, generated music on the other. */
export default function StudioNav({current}:{current:'score'|'music'}){
 return <nav className="studio-nav" aria-label="Studio">
  <Link href="/" className={current==='score'?'chosen':''} aria-current={current==='score'?'page':undefined}><FileMusic size={16}/> Score</Link>
  <Link href="/music" className={current==='music'?'chosen':''} aria-current={current==='music'?'page':undefined}><AudioLines size={16}/> Music</Link>
 </nav>;
}
