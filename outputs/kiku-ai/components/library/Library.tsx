'use client';
import {useCallback,useEffect,useState} from 'react';
import {CloudUpload,FileMusic,SlidersHorizontal,Trash2,Check,X,AudioLines} from 'lucide-react';
import {SongRow} from '@/components/songs/SongList';
import {useSongs} from '@/components/songs/useSongs';
import {type SavedProject,type SavedScore,LIBRARY,allowSaving,deleteProject,deleteScore,listProjects,listScores} from '@/lib/library';
import type {User} from '@/components/shell/session';

type Tab='songs'|'projects'|'scores';
const when=(iso:string)=>new Date(iso).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
const clock=(s:number)=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;

/** A row with a two-step delete, so nothing goes with one stray click. */
function Row({icon,title,detail,href,remove}:{icon:React.ReactNode;title:string;detail:string;href:string;remove:()=>void}){
 const [confirming,setConfirming]=useState(false);
 return <li className="lib-row"><a href={href} className="lib-open"><span className="lib-icon">{icon}</span><span><strong>{title}</strong><small>{detail}</small></span></a>
  <div className="song-actions">{confirming?<><span className="confirm-text">Delete?</span><button onClick={()=>{setConfirming(false);remove();}} aria-label="Delete for good"><Check size={15}/></button><button onClick={()=>setConfirming(false)} aria-label="Keep it"><X size={15}/></button></>
   :<button onClick={()=>setConfirming(true)} aria-label={`Delete ${title}`} title="Delete"><Trash2 size={15}/></button>}</div></li>;
}

export default function Library({user}:{user:User}){
 const [tab,setTab]=useState<Tab>('songs');
 const songs=useSongs(user.storage);
 const [projects,setProjects]=useState<SavedProject[]|null>(null),[scores,setScores]=useState<SavedScore[]|null>(null),[error,setError]=useState('');
 const load=useCallback(()=>{
  listProjects().then(setProjects).catch(e=>{setProjects([]);setError((e as Error).message);});
  listScores().then(setScores).catch(e=>{setScores([]);setError((e as Error).message);});
 },[]);
 useEffect(()=>{load();},[load,user.storage]);
 const counts={songs:songs.songs.length,projects:projects?.length??0,scores:scores?.length??0};
 return <div className="library">
  <header className="lib-head"><div><h1>Library</h1>
   <p>{user.storage?<>Saved privately to <a href={`https://huggingface.co/datasets/${user.handle}/${LIBRARY}`} target="_blank" rel="noopener noreferrer">{user.handle}/{LIBRARY}</a> on Hugging Face.</>:'Your songs, studio projects and scores, saved to your own Hugging Face account.'}</p></div></header>
  {!user.storage&&<div className="storage-banner"><CloudUpload size={18}/><div><strong>Turn on saving</strong><span>Kiku AI creates a private dataset in your account and keeps everything you make there.</span></div>
   <button onClick={()=>allowSaving('/library')}>Allow saving</button></div>}
  <div className="lib-tabs" role="tablist">{(['songs','projects','scores'] as Tab[]).map(t=><button key={t} role="tab" aria-selected={tab===t} className={tab===t?'on':''} onClick={()=>setTab(t)}>
   {t==='songs'?'Songs':t==='projects'?'Studio projects':'Scores'}<em>{counts[t]}</em></button>)}</div>
  {error&&<p className="gen-error" role="alert">{error}</p>}
  {tab==='songs'&&<ul className="song-list">{songs.songs.map(s=><SongRow key={s.id} item={s} audioUrl={songs.audioUrl} remove={i=>void songs.remove(i)} rename={(i,t)=>void songs.rename(i,t)} paint={i=>void songs.paint(i)} painting={songs.painting.has(s.id)}/>)}
   {!songs.loading&&!songs.songs.length&&<p className="gen-empty"><AudioLines size={16}/> No songs yet. <a href="/generate">Make one</a>.</p>}</ul>}
  {tab==='projects'&&<ul className="lib-list">{projects===null?<p className="gen-empty"><span className="spinner"/> Loading…</p>
   :projects.length?projects.map(p=><Row key={p.id} icon={<SlidersHorizontal size={17}/>} title={p.name} href={`/studio?project=${encodeURIComponent(p.id)}`}
    detail={`${p.tracks} track${p.tracks===1?'':'s'} · ${clock(p.duration)} · saved ${when(p.updatedAt)}`}
    remove={()=>void deleteProject(p).then(()=>setProjects(list=>list?.filter(x=>x.id!==p.id)??null)).catch(e=>setError((e as Error).message))}/>)
   :<p className="gen-empty"><SlidersHorizontal size={16}/> Projects you save in the <a href="/studio">studio</a> appear here.</p>}</ul>}
  {tab==='scores'&&<ul className="lib-list">{scores===null?<p className="gen-empty"><span className="spinner"/> Loading…</p>
   :scores.length?scores.map(s=><Row key={s.id} icon={<FileMusic size={17}/>} title={s.title} href={`/score?saved=${encodeURIComponent(s.id)}`}
    detail={`${clock(s.duration)} · ${when(s.createdAt)}`}
    remove={()=>void deleteScore(s).then(()=>setScores(list=>list?.filter(x=>x.id!==s.id)??null)).catch(e=>setError((e as Error).message))}/>)
   :<p className="gen-empty"><FileMusic size={16}/> Sheet music you make on the <a href="/score">Score</a> page appears here.</p>}</ul>}
 </div>;
}
