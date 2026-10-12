'use client';
import {Minus,Plus} from 'lucide-react';
import type {ScoreSummary} from '@/lib/types';
import type {ScoreDraft} from './useJobs';
import {formatTime} from '@/lib/studio/model';
import type {ScoreDocument} from '@/lib/studio/score';

/** A score read from one selection, with the user's edits kept alongside the original. */
export type Sheet={sig:string;abc:string;summary:ScoreSummary;transpose:number;bpm:number;chords:Record<number,string>;lyrics:string;
 document?:ScoreDocument;sourceTiming?:string;timingChanged?:boolean;seed?:number};

const SHARPS=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const FLATS=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const FLAT_KEYS=new Set(['F','Bb','Eb','Ab','Db','Gb','Cb','Dm','Gm','Cm','Fm','Bbm','Ebm','Abm']);

/** The key name after moving `steps` semitones, spelled the way that key usually is. */
export function keyAfter(key:string,steps:number){
 const minor=key.endsWith('m'),root=minor?key.slice(0,-1):key;
 const index=SHARPS.indexOf(root)>=0?SHARPS.indexOf(root):FLATS.indexOf(root);
 if(index<0)return key;
 let name=root;
 if(steps){
  const next=(index+steps+120)%12;
  name=FLAT_KEYS.has(FLATS[next]+(minor?'m':''))?FLATS[next]:SHARPS[next];
 }
 return name+(minor?' minor':' major');
}

/** What the engine needs to play this sheet: only the bars the user changed are sent. */
export function draftOf(sheet:Sheet):ScoreDraft{
 const chords:Record<number,string[]>={};
 sheet.summary.bars.forEach((bar,i)=>{
  const typed=sheet.chords[i];
  if(typed!==undefined&&typed.trim()!==bar.chords.join(' '))chords[i]=typed.split(/\s+/).filter(Boolean);
 });
 return {abc:sheet.abc,clock:sheet.timingChanged?[]:sheet.summary.clock,beats:sheet.timingChanged?[]:sheet.summary.beats,edits:{transpose:sheet.transpose||undefined,
  bpm:sheet.bpm!==sheet.summary.bpm?sheet.bpm:undefined,chords}};
}

export function changes(sheet:Sheet){
 const edits=draftOf(sheet).edits;
 return Object.keys(edits.chords||{}).length+(edits.transpose?1:0)+(edits.bpm?1:0);
}

export default function ScoreSheet({sheet,set}:{sheet:Sheet;set:(sheet:Sheet)=>void}){
 const s=sheet.summary;
 const move=(by:number)=>set({...sheet,transpose:Math.max(-6,Math.min(6,sheet.transpose+by))});
 return <div className="score-sheet">
  <div className="score-meta">
   <div className="field"><span>Key</span>
    <div className="stepper">
     <button type="button" aria-label="Down a semitone" onClick={()=>move(-1)}><Minus size={13}/></button>
     <strong>{keyAfter(s.key,sheet.transpose)}{sheet.transpose?<em> {sheet.transpose>0?'+':''}{sheet.transpose}</em>:null}</strong>
     <button type="button" aria-label="Up a semitone" onClick={()=>move(1)}><Plus size={13}/></button>
    </div>
   </div>
   <label className="field"><span>Tempo</span>
    <input type="number" min={30} max={300} value={sheet.bpm}
     onChange={e=>set({...sheet,bpm:Math.round(Number(e.target.value)||s.bpm)})}/></label>
  </div>
  {sheet.bpm!==s.bpm&&<p className="ai-where">A new tempo moves every bar, so the result starts on your first bar
   but is not locked to the rest of them.</p>}
  <div className="score-bars" role="list" aria-label="Chords by bar">
   {s.bars.map((bar,i)=>{
    const opens=bar.section&&(i===0||s.bars[i-1].section!==bar.section);
    return <label key={i} role="listitem" className={'score-bar'+(opens?' opens':'')}>
     <span className="bar-no">{i+1}<small>{formatTime(bar.start)}</small></span>
     {opens?<em>{bar.section}</em>:null}
     <input value={sheet.chords[i]??bar.chords.join(' ')} placeholder="no chord" spellCheck={false}
      onChange={e=>set({...sheet,chords:{...sheet.chords,[i]:e.target.value}})}/>
    </label>;})}
  </div>
  <p className="score-hint">Chords are written in the key it was read in; the key control moves them with the melody.
   Several chords in one bar share it evenly.</p>
  <label className="field"><span>Words</span>
   <textarea value={sheet.lyrics} rows={5} maxLength={8000} onChange={e=>set({...sheet,lyrics:e.target.value})}
    placeholder="No words were read. Type them here to have Cover sing them."/></label>
 </div>;
}
