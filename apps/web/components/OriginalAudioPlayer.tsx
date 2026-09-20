'use client';
import {useEffect,useRef,useState} from 'react';
import {Pause,Play,Volume2} from 'lucide-react';
const clock=(s:number)=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
export default function OriginalAudioPlayer({src,onPlay,scorePlaying}:{src:string;onPlay:()=>void;scorePlaying:boolean}){
 const ref=useRef<HTMLAudioElement>(null);
 const [playing,setPlaying]=useState(false),[time,setTime]=useState(0),[duration,setDuration]=useState(0),[volume,setVolume]=useState(1),[error,setError]=useState('');
 useEffect(()=>{if(scorePlaying)ref.current?.pause();},[scorePlaying]);
 return <section className="original-audio original-player" aria-label="Original recording">
  <div className="original-player-heading"><strong>Original recording</strong><span>Your uploaded audio</span></div>
  <audio ref={ref} src={src} preload="metadata" onLoadedMetadata={()=>{const d=ref.current?.duration||0;setDuration(Number.isFinite(d)?d:0);if(ref.current)ref.current.volume=volume;}} onDurationChange={()=>{const d=ref.current?.duration||0;if(Number.isFinite(d))setDuration(d);}} onTimeUpdate={()=>setTime(ref.current?.currentTime||0)} onPlay={()=>{setPlaying(true);onPlay();}} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)} onError={()=>setError('The original audio could not be loaded.')}/>
  <div className="original-player-controls">
   <button className="transport-icon" aria-label={playing?'Pause original recording':'Play original recording'} onClick={async()=>{if(!ref.current)return;if(playing)ref.current.pause();else try{await ref.current.play();}catch{setError('The original audio could not be played.');}}}>{playing?<Pause size={19}/>:<Play size={19}/>}</button>
   <span className="audio-time">{clock(time)}</span><input type="range" aria-label="Original recording position" aria-valuetext={`${clock(time)} of ${clock(duration)}`} min="0" max={duration||1} step=".1" value={Math.min(time,duration||1)} disabled={!duration} onChange={e=>{const value=Number(e.target.value);if(ref.current)ref.current.currentTime=value;setTime(value);}}/><span className="audio-time">{clock(duration)}</span>
   <label className="original-volume"><Volume2 size={17}/><input aria-label="Original recording volume" type="range" min="0" max="1" step=".05" value={volume} onChange={e=>{const v=Number(e.target.value);setVolume(v);if(ref.current)ref.current.volume=v;}}/></label>
  </div>{error&&<p role="alert">{error}</p>}
 </section>;
}
