'use client';
import {useState} from 'react';
import {Check,Copy} from 'lucide-react';

const TAG=/^\s*\[([^\]\n]{1,30})\]\s*$/;
const NAMES:Record<string,string>={inst:'Instrumental',instrumental:'Instrumental','pre-chorus':'Pre-chorus',prechorus:'Pre-chorus'};
/** "[chorus]" reads as "Chorus", "[verse 2]" as "Verse 2". */
const nameOf=(tag:string)=>{const t=tag.trim().toLowerCase();return NAMES[t]??t.charAt(0).toUpperCase()+t.slice(1);};

/** Lyrics with their section tags shown as small headings, and a button to copy them as written. */
export default function Lyrics({text}:{text:string}){
 const [copied,setCopied]=useState(false),lyrics=text.trim();
 async function copy(){try{await navigator.clipboard.writeText(lyrics+'\n');setCopied(true);setTimeout(()=>setCopied(false),1600);}catch{}}
 const sections:{tag?:string;lines:string[]}[]=[];
 for(const line of lyrics.split('\n')){
  const tag=TAG.exec(line);
  if(tag)sections.push({tag:nameOf(tag[1]),lines:[]});
  else{if(!sections.length)sections.push({lines:[]});sections[sections.length-1].lines.push(line);}
 }
 return <>
  <div className="lyrics-head"><h3>Lyrics</h3><button onClick={()=>void copy()}>{copied?<Check size={13}/>:<Copy size={13}/>}{copied?'Copied':'Copy'}</button></div>
  <div className="lyrics-text">{sections.map((s,i)=>{
   const words=s.lines.join('\n').trim();
   return <section key={i}>{s.tag&&<h4 className="lyrics-tag">{s.tag}</h4>}{words?<p>{words}</p>:s.tag&&<p className="lyrics-music">♪</p>}</section>;
  })}</div>
 </>;
}
