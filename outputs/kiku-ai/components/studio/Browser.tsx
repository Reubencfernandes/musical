'use client';
import {useRef} from 'react';
import {Mic,Square,FolderOpen,Drum,Guitar,Piano,Music2,AudioWaveform,Waves,Users,FileAudio,Download} from 'lucide-react';
import type {Project} from '@/lib/studio/model';
import type {Create} from './AIPanel';

/** A short list on purpose: each maps to a Demucs stem, so the result really is that instrument alone. */
export const INSTRUMENTS=[
 {id:'drums',label:'Drums',icon:Drum},
 {id:'bass',label:'Bass',icon:Waves},
 {id:'keys',label:'Keys',icon:Piano},
 {id:'guitar',label:'Guitar',icon:Guitar},
 {id:'strings',label:'Strings',icon:AudioWaveform},
 {id:'synth',label:'Synth',icon:Music2},
 {id:'band',label:'Full band',icon:Users},
];

type Props={
 project:Project;create:Create|null;choose:(create:Create)=>void;
 recording:boolean;recordSeconds:number;record:()=>void;
 importFiles:(files:File[])=>void;exportMix:(format:'mp3'|'wav')=>void;exporting:boolean;
 setBpm:(bpm:number)=>void;
};

export default function Browser(props:Props){
 const picker=useRef<HTMLInputElement>(null);
 const chosen=(c:Create)=>props.create&&props.create.kind===c.kind&&(c.kind!=='part'||(props.create as {instrument:string}).instrument===c.instrument);
 return <nav className="browser" aria-label="Browser">
  <section>
   <h2>Sources</h2>
   <button className={'browse-item'+(props.recording?' recording':'')} onClick={props.record}>
    {props.recording?<Square size={14}/>:<Mic size={14}/>}
    {props.recording?`Stop recording ${Math.floor(props.recordSeconds/60)}:${String(props.recordSeconds%60).padStart(2,'0')}`:'Record a take'}
   </button>
   <button className="browse-item" onClick={()=>picker.current?.click()}><FolderOpen size={14}/> Import audio</button>
   <input ref={picker} type="file" accept="audio/*" multiple className="sr-only"
    onChange={e=>{props.importFiles([...(e.target.files||[])]);e.target.value='';}}/>
  </section>
  <section>
   <h2>Instruments</h2>
   {INSTRUMENTS.map(item=>{const Icon=item.icon,create:Create={kind:'part',instrument:item.id,label:item.label};
    return <button key={item.id} className={'browse-item'+(chosen(create)?' chosen':'')} onClick={()=>props.choose(create)}>
     <Icon size={14}/>{item.label}</button>;})}
  </section>
  <section>
   <h2>Generate</h2>
   <button className={'browse-item'+(chosen({kind:'instrumental'})?' chosen':'')} onClick={()=>props.choose({kind:'instrumental'})}><FileAudio size={14}/> Instrumental</button>
   <button className={'browse-item'+(chosen({kind:'song'})?' chosen':'')} onClick={()=>props.choose({kind:'song'})}><Music2 size={14}/> Song with vocals</button>
  </section>
  <section className="project-info">
   <h2>Project</h2>
   <label>Tempo<input type="number" min={40} max={300} step={0.1} value={props.project.bpm}
    onChange={e=>{const v=Number(e.target.value);if(v>=40&&v<=300)props.setBpm(v);}}/></label>
   <p>Key <strong>{props.project.key||'—'}</strong></p>
   {props.project.chords.length>0&&<p className="chord-summary">{[...new Set(props.project.chords.map(c=>c.name))].slice(0,8).join(' · ')}</p>}
   <button className="browse-item" onClick={()=>props.exportMix('mp3')} disabled={props.exporting||!props.project.clips.length}>
    <Download size={14}/>{props.exporting?'Rendering…':'Export mix (MP3)'}</button>
   <button className="browse-item" onClick={()=>props.exportMix('wav')} disabled={props.exporting||!props.project.clips.length}>
    <Download size={14}/>Export mix (WAV)</button>
  </section>
 </nav>;
}
