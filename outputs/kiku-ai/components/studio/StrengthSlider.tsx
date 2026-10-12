'use client';
import {useId} from 'react';

/**
 * How far a restyle moves from the source. The studio asks how much to change;
 * the engine turns that into ACE-Step's cover strength, where a lower strength
 * leaves the model more freedom over the source's structure.
 */
const ZONES=[
 {from:10,to:29,at:20,label:'Subtle',text:'Keeps the melody, groove and arrangement. Mostly changes tone and texture.'},
 {from:30,to:54,at:42,label:'Balanced',text:'Keeps the song’s structure with new instruments and production.'},
 {from:55,to:74,at:64,label:'Bold',text:'Melody and chords guide a new arrangement; details move freely.'},
 {from:75,to:90,at:85,label:'Reimagine',text:'Only the broad shape survives. Expect a different performance.'},
];
const MIN=10,MAX=90;

export default function StrengthSlider({value,change}:{value:number;change:(value:number)=>void}){
 const help=useId(),zone=ZONES.find(z=>value>=z.from&&value<=z.to)||ZONES[0];
 const fill=(value-MIN)/(MAX-MIN)*100;
 return <div className="strength" role="group" aria-label="How much to change">
  <div className="strength-top"><span>How much to change</span><strong>{zone.label}<em>{value}%</em></strong></div>
  <div className="strength-track" style={{['--fill' as string]:`${fill}%`}}>
   <span className="strength-rail" aria-hidden="true">{ZONES.slice(1).map(z=><i key={z.label} style={{left:`${(z.from-MIN)/(MAX-MIN)*100}%`}}/>)}</span>
   <input type="range" min={MIN} max={MAX} step={1} value={value} aria-label="How much to change" aria-valuetext={`${zone.label}, ${value}%`}
    aria-describedby={help} onChange={e=>change(Number(e.target.value))}/>
  </div>
  <div className="strength-zones">{ZONES.map(z=><button key={z.label} type="button" className={z===zone?'on':''} aria-pressed={z===zone} onClick={()=>change(z.at)}>{z.label}</button>)}</div>
  <p id={help} className="strength-text">{zone.text}</p>
 </div>;
}
