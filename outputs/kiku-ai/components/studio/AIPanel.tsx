'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {Sparkles,WandSparkles,Wand2,Paintbrush,Split,MoveRight,X,Download,Mic2,ListMusic,ArrowUp,Music2,Guitar,Radio,Piano,AudioWaveform} from 'lucide-react';
import {type Project,type Selection} from '@/lib/studio/model';
import {type Target,targetOf,targetSignature,useJobs} from './useJobs';
import {type Sheet,draftOf} from './ScoreSheet';
import ScoreEditor,{sheetFromAbc,emptySheet} from './ScoreEditor';
import ComposerSelect,{type ComposerOption} from './ComposerSelect';
import StrengthSlider from './StrengthSlider';
import PromptHelper from './PromptHelper';
import {type Meta} from '@/lib/jobs';
import {SignedOut,runJob} from '@/lib/studio/engine';
import {MODELS,PREFERRED,SUPPORTS,modelFor,type Model,type Task} from '@/lib/studio/models';
export type Create={kind:'part';instrument:string;label:string}|{kind:'instrumental'}|{kind:'song'};
type Action='restyle'|'rewrite'|'cover'|'score'|'stems'|'extend';
type Menu='model'|'mode'|'harmony'|'instrument'|null;
type Props={project:Project;selection:Selection;create:Create;jobs:ReturnType<typeof useJobs>;download:(target:Target,format:'mp3'|'wav')=>void;close:()=>void;
 /** Adopt the tempo and key Enhance measured, when the project has none of its own yet. */
 adopt:(meta:Meta)=>void;signedOut:()=>void};
const ACTIONS:{id:Action;label:string;icon:typeof Sparkles}[]=[
 {id:'restyle',label:'Restyle',icon:Paintbrush},{id:'rewrite',label:'Rewrite',icon:Wand2},{id:'cover',label:'Cover',icon:Mic2},
 {id:'score',label:'Score',icon:ListMusic},{id:'stems',label:'Stems',icon:Split},{id:'extend',label:'Extend',icon:MoveRight}];
const COVER_OPTIONS:ComposerOption[]=[
 {value:'sing',label:'New AI performance',description:'Same musical idea, a new singer and arrangement',icon:Mic2,color:'#c6a5df'},
 {value:'play',label:'Instrumental melody',description:'Play the sung tune on instruments',icon:Piano,color:'#e2bf83'}];
const INSTRUMENTS:ComposerOption[]=[{value:'',label:'Full arrangement',icon:Music2},{value:'solo piano',label:'Piano',icon:Piano},
 {value:'acoustic guitar',label:'Acoustic guitar',icon:Guitar},{value:'electric guitar',label:'Electric guitar',icon:Guitar},
 {value:'string ensemble',label:'Strings',icon:Music2},{value:'warm synthesizer',label:'Synth',icon:Radio}];
export default function AIPanel({project,selection,create,jobs,download,close,adopt,signedOut}:Props){
 const [action,setAction]=useState<Action>('restyle'),[mode,setMode]=useState<'sing'|'play'>('sing'),[harmony,setHarmony]=useState<'keep'|'free'>('keep'),[instrument,setInstrument]=useState('');
 const [prompt,setPrompt]=useState(''),[lyricsBySelection,setLyricsBySelection]=useState<Record<string,string>>({}),[error,setError]=useState('');
 const [picked,setPicked]=useState<Model|null>(null),[sheet,setSheet]=useState<Sheet|null>(null),[editor,setEditor]=useState<Sheet|null>(null);
 const [menu,setMenu]=useState<Menu>(null),[editorLocked,setEditorLocked]=useState(false);
 const [restyleStrength,setRestyleStrength]=useState(50);
 const [measured,setMeasured]=useState<Record<string,Meta>>({}),[enhancing,setEnhancing]=useState(false);
 // Restyle and rewrite keep the recorded voice (the engine lifts it off, changes the music
 // and lays it back on the beat), or let ACE-Step sing the part again from new lyrics.
 const [voice,setVoice]=useState<'keep'|'new'>('keep');
 const closeMenu=useCallback(()=>setMenu(null),[]);
 const target=targetOf(project,selection),sig=target?targetSignature(target):'new:'+create.kind;
 const lyrics=lyricsBySelection[sig]||'';
 const setLyrics=(text:string)=>setLyricsBySelection(previous=>({...previous,[sig]:text}));
 const read=sheet?.sig===sig?sheet:null,canExtend=!!target?.sole&&!target.range;
 const current=action==='extend'&&!canExtend?'restyle':action;
 const task:Task|null=target?(current==='stems'||current==='score'?null:current):create.kind;
 const model:Model=task?(read&&!target&&create.kind!=='part'?'yue2':modelFor(task,picked??PREFERRED[task]??SUPPORTS[task][0])):'ace1';
 // Only models that can do the chosen job are offered; a score the user edited can only be played by YuE2.
 const modelOptions=useMemo<ComposerOption[]>(()=>task?MODELS.filter(m=>SUPPORTS[task].includes(m.id)
  &&!(read&&m.id!=='yue2'&&!target&&create.kind!=='part')).map(m=>({value:m.id,label:m.label,
  description:m.id==='yue2'?'Plan and perform melodies, chords and sections':'Generate parts and edit audio directly',icon:m.id==='yue2'?Music2:AudioWaveform,color:m.id==='yue2'?'#b9a2d9':'#e7a887'}))
  :[{value:current,label:current==='score'?'SheetSage2':'Demucs'}],[task,current,read,target,create.kind]);
 const style=[prompt.trim(),instrument].filter(Boolean).join(', ');
 const hasAudio=project.clips.some(c=>!c.muted),score=read?draftOf(read):undefined;
 useEffect(()=>{setError('');setMenu(null);},[sig,action,create.kind,mode,picked]);
 // A whole generated clip can reopen its stored score. Trimmed clips need a fresh transcription.
 useEffect(()=>{
  const clip=target?.sole;
  if(clip?.score&&!target?.range&&clip.offset===0){try{setSheet(sheetFromAbc(clip.score.abc,sig,clip.score.lyrics,clip.score.clock||[],clip.generation?.seed));}catch{}}
 },[sig]); // Source signature changes only when the selected audio changes.
 function openEditor(next:Sheet,lock=false){jobs.pause();setEditorLocked(lock);setEditor(next);}
 function readSelection(){
  jobs.readScore(selection,{words:true},(result,from)=>{
   const next=sheetFromAbc(result.abc,targetSignature(from),result.summary?.lyrics||'',result.summary?.clock||[]);
   next.summary.beats=result.summary?.beats;setSheet(next);openEditor(next);
  });
 }
 function editScore(){
  setError('');try{
   if(read){openEditor(read);return;}
   if(target){readSelection();return;}
   const next=emptySheet(sig,project.bpm);next.lyrics=lyrics;openEditor(next,false);
  }catch(e){setError((e as Error).message);}
 }
 function plan(){
  setError('');try{jobs.plan({style,lyrics,instrumental:create.kind==='instrumental'},result=>{
   const next=sheetFromAbc(result.abc,sig,lyrics,[],result.report?.seed);setSheet(next);openEditor(next,false);
  });}catch(e){setError((e as Error).message);}
 }
 // Measured values only: Enhance's reading of this selection, else what the engine measured for the project.
 const known:Meta|undefined=measured[sig]||(project.key?{bpm:project.bpm,keyscale:project.key}:undefined);
 const reshaping=!!target&&(current==='restyle'||current==='rewrite');
 const sung=(!target&&create.kind==='song')||(!!target&&current==='cover'&&mode==='sing')||reshaping&&voice==='new';
 /**
  * The engine's writer (Qwen3-4B) turns the short description into a full style prompt.
  * With a selection it listens first, so the tempo, key and metre come from the
  * recording; restyle and rewrite then send them along.
  */
 async function enhance(){
  if(enhancing)return;
  if(!prompt.trim()){setError('Describe the sound first, then enhance it.');return;}
  setEnhancing(true);setError('');
  try{
   const form=new FormData();form.append('caption',prompt.trim());form.append('lyrics',sung?(read?.lyrics??lyrics):'');
   if(target)try{form.append('audio',new File([await jobs.source(selection)],'selection.wav',{type:'audio/wav'}));}catch{}
   const result=await runJob<{caption:string;meta:Meta}>('enhance',form,{signal:new AbortController().signal,status:()=>{}});
   setPrompt(result.caption.slice(0,2000));
   if(target&&result.meta.measured){setMeasured(m=>({...m,[sig]:result.meta}));adopt(result.meta);}
  }catch(e){if(e instanceof SignedOut)signedOut();setError((e as Error).message);}
  finally{setEnhancing(false);}
 }
 /** Lyrics for a new AI voice; none keeps the recorded voice. */
 function sungLyrics(){
  if(!reshaping||voice==='keep')return '';
  if(!lyrics.trim())throw new Error('Add the lyrics for the new voice to sing, or keep your voice.');
  return lyrics.trim();
 }
 function submit(event:React.FormEvent){
  event.preventDefault();setError('');try{
   if(target){
    if(current==='restyle'){if(!style)throw new Error('Describe the sound you want.');jobs.restyle(selection,{style,change:restyleStrength/100,lyrics:sungLyrics(),model,meta:known});}
    if(current==='rewrite')jobs.rewrite(selection,{style,variance:0.5,lyrics:sungLyrics(),model,meta:known});
    if(current==='cover'){if(!style)throw new Error('Describe the style for the cover.');jobs.cover(selection,{style,voice:mode,harmony,score,lyrics:read?.lyrics||lyrics});}
    if(current==='score')readSelection();
    if(current==='stems')jobs.stems(selection);
    if(current==='extend')jobs.extend(selection,{style,seconds:20,lyrics:'',model});
   }else if(create.kind==='part')jobs.part({instrument:create.instrument,label:create.label,style,follow:hasAudio,duration:30,strength:0.45,model});
   else jobs.generate({kind:create.kind,style,lyrics:read?.lyrics||lyrics,duration:30,model,score,seed:read?.seed});
  }catch(e){setError((e as Error).message);}
 }
 const modeActive=!!target&&current==='cover';
 const scoreActive=target?['cover','score'].includes(current):create.kind!=='part'&&model==='yue2';
 const caption=target?current==='cover'?mode==='play'?'YuE2 performs the melody on instruments.':'YuE2 creates new vocals and instruments.':current==='score'?'Review the transcription before changing the music.'
   :reshaping?voice==='keep'?'Your voice stays. The music under it changes and is locked to your beat.':'ACE-Step sings this part again in a new voice, using your lyrics.'
   :'A new take appears for you to audition.'
  :create.kind==='part'?'Follow your music with a new '+create.label.toLowerCase()+'.':model==='yue2'?'Plan a score first, or generate a complete take.':'Describe your sound and audition a new take.';
 return <aside className="ai-panel" aria-label="Kiku AI">
  <header className="panel-title">
   <ComposerSelect label="AI model" value={task?model:current} options={modelOptions} icon={Sparkles} open={menu==='model'} toggle={()=>setMenu(menu==='model'?null:'model')} close={closeMenu} change={v=>setPicked(v as Model)} disabled={modelOptions.length<2}/>
   <span className="composer-brand"><Sparkles size={12}/> Kiku AI</span><button className="composer-close" onClick={close} aria-label="Hide assistant"><X size={15}/></button>
  </header>
  <form className="ai-body" onSubmit={submit}>
   {target&&<div className="ai-tabs" role="tablist" aria-label="Audio action">{ACTIONS.map(a=>{const Icon=a.icon;return <button key={a.id} type="button" role="tab" aria-selected={current===a.id} className={current===a.id?'chosen':''} disabled={a.id==='extend'&&!canExtend} onClick={()=>setAction(a.id)}><Icon size={13}/>{a.label}</button>;})}</div>}
   {modeActive&&<div className="cover-controls"><ComposerSelect label="Cover mode" value={mode} options={COVER_OPTIONS} icon={Mic2} open={menu==='mode'} toggle={()=>setMenu(menu==='mode'?null:'mode')} close={closeMenu} change={v=>setMode(v as typeof mode)}/>
    <ComposerSelect label="Harmony" value={harmony} options={[{value:'keep',label:'Keep chords',description:'Carry the score’s harmony into the new arrangement',icon:Music2},{value:'free',label:'Reimagine chords',description:'Keep the melody; let YuE2 choose new harmony',icon:Sparkles}]} icon={Music2} open={menu==='harmony'} toggle={()=>setMenu(menu==='harmony'?null:'harmony')} close={closeMenu} change={v=>setHarmony(v as typeof harmony)}/>
   </div>}
   {(!target||!['stems','score'].includes(current))&&<label className="composer-prompt"><span className="sr-only">Describe your sound</span><textarea aria-label="Describe your sound" value={prompt} onChange={e=>setPrompt(e.target.value)} maxLength={2000} rows={2} placeholder={modeActive?'Describe how you want to reimagine this song…':target?'Describe the new sound: genre, mood, instruments, texture…':create.kind==='part'?'Describe the '+create.label.toLowerCase()+' you hear in your head…':'Describe the music you hear in your head…'}/></label>}
   {(!target||!['stems','score'].includes(current))&&<div className="prompt-tools">
    <PromptHelper value={prompt} change={setPrompt} vocals={sung}/>
    <button type="button" className={'enhance-button'+(enhancing?' busy':'')} onClick={()=>void enhance()} disabled={enhancing||!prompt.trim()}
     title={target?'Listen to the selection and write a fuller description':'Write a fuller description'}>{enhancing?<span className="spinner"/>:<WandSparkles size={13}/>}{enhancing?'Enhancing…':'Enhance'}</button>
   </div>}
   {target&&measured[sig]&&<p className="measured">Measured from your selection: {[measured[sig].bpm&&`${measured[sig].bpm} BPM`,measured[sig].keyscale,measured[sig].timesignature&&`${String(measured[sig].timesignature).split('/')[0]}/4`].filter(Boolean).join(' · ')}</p>}
   <p className="composer-task-description">{caption}</p>
   {reshaping&&<div className="voice-choice" role="radiogroup" aria-label="Vocals">
    <span>Vocals</span>
    {([['keep','Keep my voice'],['new','New AI voice']] as const).map(([value,label])=><button key={value} type="button" role="radio" aria-checked={voice===value}
     className={voice===value?'on':''} onClick={()=>setVoice(value)}>{label}</button>)}
   </div>}
   {target&&current==='restyle'&&<StrengthSlider value={restyleStrength} change={setRestyleStrength}/>}
   {scoreActive&&<div className="composer-score-row">
    <button type="button" className="score-open" onClick={editScore}><ListMusic size={14}/>{read?'Edit score':target?'Read & edit score':'Open score editor'}</button>
    {read&&<><span>{read.summary.bars.length} bars · {read.bpm} BPM{read.timingChanged?' · new timing':''}</span><button type="button" className="tool-button" aria-label="Clear reviewed score" onClick={()=>setSheet(null)}><X size={12}/></button></>}
    {!target&&model==='yue2'&&<button type="button" className="score-plan" onClick={plan}><Sparkles size={12}/>{read?'Plan again':'Plan score'}</button>}
   </div>}
   {(modeActive||!target&&create.kind==='instrumental')&&<div className="instrument-choice"><ComposerSelect label="Lead instrument" value={instrument} options={INSTRUMENTS} icon={Piano} open={menu==='instrument'} toggle={()=>setMenu(menu==='instrument'?null:'instrument')} close={closeMenu} change={setInstrument}/></div>}
   {((!target&&create.kind==='song')||(modeActive&&mode==='sing')||reshaping&&voice==='new')&&<label className="composer-prompt composer-lyrics"><span className="sr-only">Song lyrics</span><textarea aria-label="Song lyrics" value={read?.lyrics??lyrics} onChange={e=>{setLyrics(e.target.value);if(read)setSheet({...read,lyrics:e.target.value});}} rows={3} maxLength={8000} placeholder={reshaping?'Lyrics for this part. ACE-Step sings them in a new voice…':target?'Lyrics matching the recording’s sections (optional)…':'[verse]\nYour words…\n[chorus]'}/></label>}
   {error&&<p className="ai-error" role="alert">{error}<button type="button" aria-label="Dismiss" onClick={()=>setError('')}><X size={13}/></button></p>}
   <div className="composer-footer"><span className="composer-caption">{target?target.range?(target.end-target.start).toFixed(1)+' s selected':target.clips.length+' selected clip'+(target.clips.length===1?'':'s'):create.kind==='part'?'Adding '+create.label.toLowerCase():create.kind==='song'?'Song with vocals':'New instrumental'}</span><div className="ai-actions">{target&&<details className="selection-download" onToggle={e=>{const menu=e.currentTarget;if(menu.open)setTimeout(()=>{const shut=(ev:PointerEvent)=>{if(!menu.contains(ev.target as Node)){menu.open=false;window.removeEventListener('pointerdown',shut);}};window.addEventListener('pointerdown',shut);},0);}}>
     <summary className="tool-button" aria-label="Download selection" title="Download selection"><Download size={14}/></summary>
     <div className="selection-download-menu">{(['mp3','wav'] as const).map(format=><button key={format} type="button" onClick={e=>{(e.currentTarget.closest('details') as HTMLDetailsElement).open=false;download(target,format);}}>
      <strong>{format.toUpperCase()}</strong><small>{format==='mp3'?'Smaller file':'Lossless'}</small></button>)}</div>
    </details>}<button type="submit" className="run-button" title={current==='score'&&target?'Read score':'Create a take'}><ArrowUp size={18}/><span className="sr-only">{current==='score'&&target?'Read score':'Create a take'}</span></button></div></div>
  </form>
  {/* Running jobs show as lanes on the timeline; only failures need the panel. */}
  {jobs.jobs.some(j=>j.error)&&<section className="job-list" aria-label="Failed jobs" aria-live="polite">{jobs.jobs.filter(j=>j.error).map(job=><div key={job.id} className="job failed"><X size={14}/><div><strong>{job.label}</strong><span>{job.error}</span></div><button aria-label="Dismiss" onClick={()=>jobs.dismiss(job.id)}><X size={13}/></button></div>)}</section>}
  {editor&&<ScoreEditor sheet={editor} lockedVocal={editorLocked} close={()=>setEditor(null)} save={s=>{setSheet(s);setLyricsBySelection(previous=>({...previous,[s.sig]:s.lyrics}));if(!target)setPicked('yue2');}}
   source={target?()=>jobs.source(selection):undefined}/>}
 </aside>;
}
