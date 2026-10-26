'use client';
import {useState} from 'react';
import {Plus} from 'lucide-react';

/**
 * Words to build a caption from. ACE-Step follows its caption more than
 * anything else, and works best when it names several dimensions at once
 * (genre, mood, instruments, texture, era, production) rather than one vague
 * word. Tempo and key are left out on purpose: they belong in their own settings.
 */
const DIMENSIONS=[
 {id:'mood',label:'Mood',words:['melancholic','uplifting','energetic','dreamy','dark','nostalgic','euphoric','intimate']},
 {id:'instruments',label:'Instruments',words:['acoustic guitar','grand piano','synth pads','808 drums','string section','brass','electric bass','brushed drums']},
 {id:'texture',label:'Texture',words:['warm','bright','crisp','airy','punchy','lush','raw','polished']},
 {id:'groove',label:'Groove',words:['groovy','driving','laid-back','gentle swing','half-time feel','four-on-the-floor']},
 {id:'era',label:'Era',words:['80s synth-pop','90s grunge','70s funk','vintage soul','2010s EDM','modern trap']},
 {id:'production',label:'Production',words:['lo-fi','high-fidelity','live recording','studio-polished','bedroom pop','wide stereo']},
 {id:'vocals',label:'Vocals',words:['female vocal','male vocal','breathy','powerful belting','falsetto','raspy','choir harmonies']},
];

export default function PromptHelper({value,change,vocals}:{value:string;change:(next:string)=>void;vocals:boolean}){
 const [open,setOpen]=useState<string|null>(null);
 const text=value.toLowerCase(),shown=DIMENSIONS.filter(d=>vocals||d.id!=='vocals');
 const dimension=shown.find(d=>d.id===open);
 const add=(word:string)=>change(value.trim()?value.trim().replace(/[,\s]+$/,'')+', '+word:word);
 return <div className="prompt-helper">
  <div className="prompt-dimensions" role="group" aria-label="Add to the description">
   {shown.map(d=>{const covered=d.words.some(w=>text.includes(w.toLowerCase()));return <button key={d.id} type="button" aria-expanded={open===d.id}
    className={(open===d.id?'on ':'')+(covered?'covered':'')} title={covered?`${d.label} is described`:`Add ${d.label.toLowerCase()}`}
    onClick={()=>setOpen(open===d.id?null:d.id)}>{covered&&<i aria-hidden="true"/>}{d.label}</button>;})}
  </div>
  {dimension&&<div className="prompt-words">{dimension.words.map(w=>{const used=text.includes(w.toLowerCase());
   return <button key={w} type="button" disabled={used} onClick={()=>add(w)}><Plus size={10}/>{w}</button>;})}</div>}
 </div>;
}
