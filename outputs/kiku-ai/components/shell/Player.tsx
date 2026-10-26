'use client';
import {createContext,useCallback,useContext,useEffect,useRef,useState} from 'react';
import {Pause,Play,Volume2,VolumeX} from 'lucide-react';
import SongArt from '@/components/songs/SongArt';

/** Something the bottom player can play. `load` fetches the audio only when it is first played; `art` is a public song's artwork. */
export type Playable={id:string;title:string;subtitle?:string;cover?:boolean;art?:string;load:()=>Promise<string>};
type PlayerState={current:Playable|null;playing:boolean;loading:boolean;error:string;play:(item:Playable)=>void;stop:()=>void};
const Context=createContext<PlayerState|null>(null);
export const usePlayer=()=>{const value=useContext(Context);if(!value)throw new Error('usePlayer needs a PlayerProvider.');return value;};

const clock=(s:number)=>Number.isFinite(s)?`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`:'0:00';

/** One audio element for the whole page, so starting a song stops the last one. */
export function PlayerProvider({children}:{children:React.ReactNode}){
 const audio=useRef<HTMLAudioElement>(null),request=useRef(0);
 const [current,setCurrent]=useState<Playable|null>(null),[playing,setPlaying]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const [time,setTime]=useState(0),[duration,setDuration]=useState(0),[volume,setVolume]=useState(1),[muted,setMuted]=useState(false);
 useEffect(()=>{
  const element=audio.current;
  return()=>{request.current++;element?.pause();element?.removeAttribute('src');element?.load();};
 },[]);
 const play=useCallback((item:Playable)=>{
  const element=audio.current;if(!element)return;
  if(current?.id===item.id&&element.src){if(element.paused)void element.play();else element.pause();return;}
  const id=++request.current;setCurrent(item);setLoading(true);setError('');element.pause();
  item.load().then(url=>{if(id!==request.current)return;element.src=url;return element.play();})
   .catch(()=>{if(id===request.current)setError('This song could not be played.');})
   .finally(()=>{if(id===request.current)setLoading(false);});
 },[current]);
 const stop=useCallback(()=>{audio.current?.pause();},[]);
 useEffect(()=>{if(audio.current){audio.current.volume=volume;audio.current.muted=muted;}},[volume,muted]);
 return <Context.Provider value={{current,playing,loading,error,play,stop}}>
  {children}
  <audio ref={audio} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)}
   onTimeUpdate={e=>setTime(e.currentTarget.currentTime)} onDurationChange={e=>setDuration(e.currentTarget.duration)}/>
  <footer className={'player'+(current?'':' idle')} aria-label="Player">
   <div className="player-now">{current?<><SongArt id={current.id} size={40} cover={current.cover} src={current.art}/><div><strong>{current.title}</strong><span>{error||current.subtitle||''}</span></div></>:<span className="player-hint">Pick a song to play it here.</span>}</div>
   <div className="player-controls">
    <button className="player-play" disabled={!current} onClick={()=>current&&play(current)} aria-label={playing?'Pause':'Play'}>{loading?<span className="spinner"/>:playing?<Pause size={17} fill="currentColor"/>:<Play size={17} fill="currentColor"/>}</button>
    <span className="player-time">{clock(time)}</span>
    <input type="range" min={0} max={duration||0} step={0.1} value={Math.min(time,duration||0)} disabled={!current} aria-label="Position"
     style={{['--fill' as string]:`${duration?time/duration*100:0}%`}} onChange={e=>{if(audio.current)audio.current.currentTime=Number(e.target.value);}}/>
    <span className="player-time">{clock(duration)}</span>
   </div>
   <div className="player-volume"><button onClick={()=>setMuted(m=>!m)} aria-label={muted?'Unmute':'Mute'}>{muted?<VolumeX size={16}/>:<Volume2 size={16}/>}</button>
    <input type="range" min={0} max={1} step={0.01} value={muted?0:volume} aria-label="Volume" style={{['--fill' as string]:`${(muted?0:volume)*100}%`}} onChange={e=>{setVolume(Number(e.target.value));setMuted(false);}}/></div>
  </footer>
 </Context.Provider>;
}
