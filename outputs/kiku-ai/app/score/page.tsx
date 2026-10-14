'use client';
import {useEffect,useRef,useState} from 'react';
import {Check,CloudUpload,Mic,Square,X,LogOut} from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';
import SignIn from '@/components/SignIn';
import CreateScoreButton from '@/components/CreateScoreButton';
import dynamic from 'next/dynamic';
import Processing from '@/components/Processing';
import {choosePerformer,type PerformerId} from '@/lib/performers';
import {type Source,type ScoreResult} from '@/lib/types';
import {monoClip} from '@/lib/studio/audio';
import {SignedOut,runJob,wavFile} from '@/lib/studio/engine';
import {NeedsStorage,allowSaving,loadScore,newId,saveScore,scoreAudio} from '@/lib/library';
import {toMp3} from '@/lib/mp3';
const ScoreWorkspace=dynamic(()=>import('@/components/ScoreWorkspace'),{ssr:false,loading:()=> <p className="loading-score">Opening your score…</p>});
type Stage='input'|'leaving'|'processing'|'score';
export default function Home(){
 const [stage,setStage]=useState<Stage>('input'),[file,setFile]=useState<File|null>(null),[error,setError]=useState(''),[message,setMessage]=useState('Preparing your music…');
 const [drag,setDrag]=useState(false),[recording,setRecording]=useState(false),[recordTime,setRecordTime]=useState(0),[micPending,setMicPending]=useState(false);
 const [user,setUser]=useState<{id:string;name:string}|null>(null),[authReady,setAuthReady]=useState(false);
 const [source,setSource]=useState<Source>({title:''}),[result,setResult]=useState<ScoreResult|null>(null);
 const [performer,setPerformer]=useState<PerformerId|null>(null),[saveNote,setSaveNote]=useState<''|'saving'|'saved'|'needs'|'failed'>('');
 const picker=useRef<HTMLInputElement>(null),abort=useRef<AbortController|null>(null),media=useRef<MediaRecorder|null>(null),tracks=useRef<MediaStream|null>(null),localURL=useRef<string|null>(null),busy=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;abort.current?.abort();tracks.current?.getTracks().forEach(t=>t.stop());if(localURL.current)URL.revokeObjectURL(localURL.current);};},[]);
 useEffect(()=>{let active=true;const check=()=>fetch('/api/auth',{cache:'no-store'}).then(r=>r.json()).then(data=>{if(active){setUser(data.user);setAuthReady(true);}}).catch(()=>{if(active)setAuthReady(true);});check();window.addEventListener('focus',check);const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('kiku-auth'):null;if(channel)channel.onmessage=()=>check();return()=>{active=false;window.removeEventListener('focus',check);channel?.close();};},[]);
 async function signOut(){const response=await fetch('/api/auth',{method:'DELETE'});if(response.ok||response.status===401){reset();setUser(null);setFile(null);}}
 useEffect(()=>{if(!recording)return;const tick=setInterval(()=>setRecordTime(t=>t+1),1000);return()=>clearInterval(tick);},[recording]);
 // ?saved= reopens a score from the user's library, recording and all.
 useEffect(()=>{
  const id=new URLSearchParams(location.search).get('saved');if(!id||!user||stage!=='input'||result)return;
  let active=true;setStage('processing');setMessage('Opening your score…');
  loadScore(id).then(async score=>[score,score&&await scoreAudio(score)] as const).then(([score,audio])=>{
   if(!active)return;if(!score)throw new Error('That score was not found in your library.');
   if(localURL.current)URL.revokeObjectURL(localURL.current);localURL.current=audio?URL.createObjectURL(audio):null;
   setResult({abc:score.abc,status:'',downloads:[],timing:score.timing});setSource({title:score.title,audioUrl:localURL.current||undefined});setSaveNote('saved');setStage('score');
  }).catch(e=>{if(active){setError((e as Error).message);setStage('input');}});
  return()=>{active=false;};
 },[user]); // eslint-disable-line react-hooks/exhaustive-deps
 /** Keep a finished score in the user's library, with an MP3 of the recording it was read from. */
 async function keep(finished:ScoreResult,title:string,original:File,duration:number){
  setSaveNote('saving');
  try{
   const decoded=await new OfflineAudioContext(2,1,44100).decodeAudioData(await original.arrayBuffer());
   const id=newId();
   await saveScore({id,title,createdAt:new Date().toISOString(),abc:finished.abc,timing:finished.timing,duration},await toMp3(decoded,160));
   setSaveNote('saved');
  }catch(e){setSaveNote(e instanceof NeedsStorage?'needs':'failed');}
 }
 useEffect(()=>{if(recordTime>=600&&media.current?.state==='recording')media.current.stop();},[recordTime]);
 function selectFile(next?:File){if(!next)return;if(next.size>100*1024*1024){setError('Choose an audio file under 100 MB.');return;}if(!next.type.startsWith('audio/')&&!/\.(wav|mp3|m4a|ogg|flac|aac|webm|mp4)$/i.test(next.name)){setError('Choose an audio recording, such as MP3, WAV, M4A, OGG, or FLAC.');return;}setFile(next);setError('');}
 async function record(){
  if(recording){media.current?.stop();return;}
  if(!navigator.mediaDevices?.getUserMedia){setError('Recording needs a supported browser and a secure connection. You can upload a file instead.');return;}
  setMicPending(true);setError('');
  try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});if(!mounted.current){stream.getTracks().forEach(t=>t.stop());return;}tracks.current=stream;
   const recorder=new MediaRecorder(stream),parts:Blob[]=[];media.current=recorder;
   recorder.ondataavailable=e=>{if(e.data.size)parts.push(e.data);};
   recorder.onstop=()=>{const type=recorder.mimeType||'audio/webm';selectFile(new File(parts,`My recording.${type.includes('mp4')?'m4a':'webm'}`,{type}));stream.getTracks().forEach(t=>t.stop());setRecording(false);};
   recorder.start(1000);setRecordTime(0);setRecording(true);
  }catch{setError('Microphone access was not available. Allow it in your browser or upload a recording.');}finally{setMicPending(false);}
 }
 function reset(){abort.current?.abort();busy.current=false;setStage('input');setError('');setResult(null);if(localURL.current){URL.revokeObjectURL(localURL.current);localURL.current=null;}}
 async function convert(){
  if(busy.current||recording||!user)return;
  if(!file){picker.current?.click();return;}
  busy.current=true;const controller=new AbortController();abort.current=controller;setPerformer(choosePerformer(performer));setError('');setStage('leaving');
  await new Promise(r=>setTimeout(r,320));if(controller.signal.aborted)return;setStage('processing');
  const submitted=file,meta:Source={title:file.name.replace(/\.[^.]+$/,'')||'Your recording'};
  try{
   if(localURL.current)URL.revokeObjectURL(localURL.current);localURL.current=URL.createObjectURL(submitted);meta.audioUrl=localURL.current;
   setMessage('Preparing the full recording…');
   let clip:AudioBuffer;
   try{clip=await monoClip(await submitted.arrayBuffer());}catch{throw new Error('This recording could not be read. Try an MP3, WAV, M4A, OGG, or FLAC file.');}
   if(clip.duration<5)throw new Error('Use a recording with at least five seconds of audio.');
   if(clip.duration>600)throw new Error('This recording is longer than the current ten-minute limit. Nothing was cut or submitted.');
   const form=new FormData();form.append('audio',wavFile(clip,'recording.wav'));form.append('duration',String(clip.duration));
   const finished=await runJob<ScoreResult|null>('transcribe',form,{signal:controller.signal,status:setMessage}).catch(e=>{if(e instanceof SignedOut)setUser(null);throw e;});
   if(!finished)throw new Error('No editable score was returned. Try another recording.');
   if(!controller.signal.aborted){setResult(finished);setSource(meta);setStage('score');void keep(finished,meta.title,submitted,clip.duration);}
  }catch(e){if(!controller.signal.aborted){setError(e instanceof Error?e.message:'Something went wrong. Please try again.');setStage('input');}}
  finally{if(abort.current===controller)busy.current=false;}
 }
 return <div className="app-shell">
  <ThemeToggle/>
  {user&&stage==='input'&&<button className="account-button" onClick={signOut} aria-label={`Sign out ${user.name}`} title={`Signed in as ${user.name} · Sign out`}><LogOut size={17}/></button>}
  <main>
   {!authReady?<div className="auth-loading" aria-label="Checking sign-in" role="status"><span className="spinner"/></div>:!user?<SignIn/>:null}
   {user&&(stage==='input'||stage==='leaving')&&<section className={`input-view ${stage==='leaving'?'fade-out':'view-enter'}`}>
    <form className="upload-panel" onSubmit={e=>{e.preventDefault();convert();}}>
     <div className="panel-intro"><h1>Turn audio into sheet music.</h1><p>Upload audio or record with your microphone.<br/>Make the notes your own.</p></div>
     <div className={`drop-zone ${drag?'drag-over':''} ${file?'has-file':''}`} onDragOver={e=>{e.preventDefault();if(!recording)setDrag(true);}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDrag(false);}} onDrop={e=>{e.preventDefault();setDrag(false);if(!recording&&stage==='input')selectFile(e.dataTransfer.files[0]);}}>
      <button type="button" className="drop-area" onClick={()=>picker.current?.click()} disabled={recording||stage==='leaving'}>
       <span className="upload-symbol">{file?<Check size={27}/>:<CloudUpload size={27}/>}</span>
       <strong>{file?file.name:<>Click to upload <span>or just use drag &amp; drop.</span></>}</strong>
       <span className="file-hint">{file?`${(file.size/1024/1024).toFixed(1)} MB · click to change`:<>MP3, WAV, M4A &amp; more <span className="size-badge">Max 100 MB</span></>}</span>
      </button>
      <input ref={picker} className="sr-only" type="file" accept="audio/*,.mp4,.webm" aria-label="Upload audio recording" onChange={e=>selectFile(e.target.files?.[0])}/>
      <button type="button" className={`record-button ${recording?'recording':''}`} onClick={record} disabled={micPending||stage==='leaving'}>{recording?<Square size={13} fill="currentColor"/>:<Mic size={15}/>} {recording?`Stop recording · ${Math.floor(recordTime/60)}:${String(recordTime%60).padStart(2,'0')}`:micPending?'Connecting microphone…':'Or record with your microphone'}</button>
     </div>
     {error&&<div className="error-message" role="alert"><p>{error}</p><button type="button" onClick={()=>setError('')} aria-label="Dismiss error"><X size={17}/></button></div>}
     <div className="panel-actions"><span>Full audio · up to 10 min</span><button type="button" className="clear-button" disabled={!file||recording||stage==='leaving'} onClick={()=>{setFile(null);setError('');if(picker.current)picker.current.value='';}}>Clear</button><CreateScoreButton disabled={!file||recording||micPending||stage==='leaving'}/></div>
     <div className="input-footer"><a className="text-button" href="/">← Home</a><a className="text-button" href="/library">Your saved scores →</a></div>
    </form>
   </section>}
   {user&&stage==='processing'&&<Processing message={message} onCancel={reset} performer={performer??'saxophone'}/>}
   {user&&stage==='score'&&result&&<ScoreWorkspace result={result} source={source} onNew={reset}/>}
   {user&&stage==='score'&&saveNote&&<p className={'score-save-note '+saveNote} role="status">{saveNote==='saving'?'Saving to your library…':saveNote==='saved'?'Saved to your library':saveNote==='failed'?'This score could not be saved.'
    :<>Keep this score? <button onClick={()=>{allowSaving('/score');setSaveNote('');}}>Allow saving</button></>}</p>}
  </main>
 </div>;
}
