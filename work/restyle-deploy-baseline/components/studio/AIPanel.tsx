'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {Sparkles,Wand2,Paintbrush,Drum,Split,MoveRight,X,Download,Mic2,ListMusic,Plus,Palette,ArrowUp,Music2,Headphones,Guitar,Radio,Piano,Cloud,AudioWaveform} from 'lucide-react';
import {type Project,type Selection} from '@/lib/studio/model';
import {type Target,targetOf,targetSignature,useJobs} from './useJobs';
import {type Sheet,draftOf} from './ScoreSheet';
import ScoreEditor,{sheetFromAbc,emptySheet} from './ScoreEditor';
import TakeCard from './TakeCard';
import ComposerSelect,{type ComposerOption} from './ComposerSelect';
import {MODELS,PREFERRED,SUPPORTS,modelFor,type Model,type Task} from '@/lib/studio/models';
export type Create={kind:'part';instrument:string;label:string}|{kind:'instrumental'}|{kind:'song'};
type Action='restyle'|'rewrite'|'cover'|'band'|'score'|'stems'|'extend';
type Menu='style'|'model'|'mode'|'harmony'|'instrument'|null;
type Props={project:Project;selection:Selection;create:Create;jobs:ReturnType<typeof useJobs>;download:(target:Target)=>void;close:()=>void;openLibrary:()=>void};
const ACTIONS:{id:Action;label:string;icon:typeof Sparkles}[]=[
 {id:'restyle',label:'Restyle',icon:Paintbrush},{id:'rewrite',label:'Rewrite',icon:Wand2},{id:'cover',label:'Cover',icon:Mic2},
 {id:'band',label:'Band',icon:Drum},{id:'score',label:'Score',icon:ListMusic},{id:'stems',label:'Stems',icon:Split},{id:'extend',label:'Extend',icon:MoveRight}];
const STYLES=[
 {id:'',label:'Custom',prompt:''},{id:'pop',label:'Pop',prompt:'modern pop, catchy melodies, polished production'},
 {id:'lofi',label:'Lo-fi',prompt:'lo-fi, warm vintage tones, relaxed groove'},{id:'acoustic',label:'Acoustic',prompt:'acoustic, organic instruments, intimate and warm'},
 {id:'rock',label:'Rock',prompt:'rock, electric guitars, energetic live band'},{id:'electronic',label:'Electronic',prompt:'electronic, layered synthesizers, crisp production'},
 {id:'jazz',label:'Jazz',prompt:'jazz, rich harmony, expressive playing, laid-back swing'},{id:'hiphop',label:'Hip-hop',prompt:'hip-hop, punchy drums, deep bass, rhythmic groove'},
 {id:'rnb',label:'R&B',prompt:'R&B, soulful, smooth groove, warm keys'},{id:'classical',label:'Classical',prompt:'classical, orchestral, expressive dynamics'},
 {id:'ambient',label:'Ambient',prompt:'ambient, atmospheric textures, spacious and gentle'}];
const ICONS=[Palette,Sparkles,Headphones,Guitar,Guitar,Radio,Piano,Drum,Mic2,Music2,Cloud];
const COLORS=['#a4a4b7','#e8a988','#c5ae82','#9cbc93','#d7928e','#bba1dd','#dfbe79','#b0a5d2','#c89bbd','#9eb4ca','#86bcb3'];
const STYLE_OPTIONS:ComposerOption[]=STYLES.map((s,i)=>({value:s.id,label:s.label,icon:ICONS[i],color:COLORS[i]}));
const COVER_OPTIONS:ComposerOption[]=[
 {value:'sing',label:'New AI performance',description:'Same musical idea, a new singer and arrangement',icon:Mic2,color:'#c6a5df'},
 {value:'keep',label:'Keep my vocals',description:'Your recorded vocal with newly generated backing',icon:Headphones,color:'#b6c895'},
 {value:'play',label:'Instrumental melody',description:'Play the sung tune on instruments',icon:Piano,color:'#e2bf83'}];
const INSTRUMENTS:ComposerOption[]=[{value:'',label:'Full arrangement',icon:Music2},{value:'solo piano',label:'Piano',icon:Piano},
 {value:'acoustic guitar',label:'Acoustic guitar',icon:Guitar},{value:'electric guitar',label:'Electric guitar',icon:Guitar},
 {value:'string ensemble',label:'Strings',icon:Music2},{value:'warm synthesizer',label:'Synth',icon:Radio}];
export default function AIPanel({project,selection,create,jobs,download,close,openLibrary}:Props){
 const [action,setAction]=useState<Action>('restyle'),[mode,setMode]=useState<'sing'|'keep'|'play'>('sing'),[harmony,setHarmony]=useState<'keep'|'free'>('keep'),[instrument,setInstrument]=useState('');
 const [prompt,setPrompt]=useState(''),[preset,setPreset]=useState(''),[lyricsBySelection,setLyricsBySelection]=useState<Record<string,string>>({}),[error,setError]=useState('');
 const [picked,setPicked]=useState<Model|null>(null),[sheet,setSheet]=useState<Sheet|null>(null),[editor,setEditor]=useState<Sheet|null>(null);
 const [menu,setMenu]=useState<Menu>(null),[editorLocked,setEditorLocked]=useState(false);
 const closeMenu=useCallback(()=>setMenu(null),[]);
 const target=targetOf(project,selection),sig=target?targetSignature(target):'new:'+create.kind;
 const lyrics=lyricsBySelection[sig]||'';
 const setLyrics=(text:string)=>setLyricsBySelection(previous=>({...previous,[sig]:text}));
 const read=sheet?.sig===sig?sheet:null,canExtend=!!target?.sole&&!target.range;
 const current=action==='extend'&&!canExtend?'restyle':action;
 const locked=!!target&&(current==='band'||current==='cover'&&mode==='keep');
 const task:Task|null=target?(current==='stems'||current==='score'?null:current==='cover'&&mode==='keep'?'band':current):create.kind;
 const model=task?(read&&(locked||!target&&create.kind!=='part')?'yue2':modelFor(task,picked??PREFERRED[task]??'ace15')):'ace15';
 const modelOptions=useMemo<ComposerOption[]>(()=>task?MODELS.filter(m=>m.id!=='ace1').map(m=>({value:m.id,label:m.label,
  description:m.id==='yue2'?'Plan and perform melodies, chords and sections':'Generate parts and edit audio directly',icon:m.id==='yue2'?Music2:AudioWaveform,color:m.id==='yue2'?'#b9a2d9':'#e7a887',
  disabled:!SUPPORTS[task].includes(m.id)||!!read&&!target&&create.kind!=='part'&&m.id!=='yue2'||!!read&&locked&&m.id!=='yue2'}))
  :[{value:current,label:current==='score'?'SheetSage2':'Demucs'}],[task,current,read,target,create.kind,locked]);
 const style=[STYLES.find(s=>s.id===preset)?.prompt,prompt.trim(),instrument].filter(Boolean).join(', ');
 const hasAudio=project.clips.some(c=>!c.muted),score=read?draftOf(read):undefined;
 useEffect(()=>{setError('');setMenu(null);},[sig,action,create.kind,mode,picked]);
 // A whole generated clip can reopen its stored score. Trimmed clips need a fresh transcription.
 useEffect(()=>{
  const clip=target?.sole;
  if(clip?.score&&!target?.range&&clip.offset===0){try{setSheet(sheetFromAbc(clip.score.abc,sig,clip.score.lyrics,clip.score.clock||[],clip.generation?.seed));}catch{}}
 },[sig]); // Source signature changes only when the selected audio changes.
 function openEditor(next:Sheet,lock=locked){jobs.pause();setEditorLocked(lock);setEditor(next);}
 function readSelection(){
  jobs.readScore(selection,{words:!locked},(result,from)=>{
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
 function submit(event:React.FormEvent){
  event.preventDefault();setError('');try{
   if(target){
    if(current==='restyle'){if(!style)throw new Error('Choose a style or describe your sound.');jobs.restyle(selection,{style,change:0.5,lyrics:'',model});}
    if(current==='rewrite')jobs.rewrite(selection,{style,variance:0.5,lyrics:'',model});
    if(current==='band'||current==='cover'&&mode==='keep'){if(!style)throw new Error('Describe the new instruments you want.');jobs.band(selection,{style,separate:'auto',strength:0.45,split:true,useTempo:false,model,score});}
    if(current==='cover'&&mode!=='keep'){if(!style)throw new Error('Choose a style for the cover.');jobs.cover(selection,{style,voice:mode,harmony,score,lyrics:read?.lyrics||lyrics});}
    if(current==='score')readSelection();
    if(current==='stems')jobs.stems(selection);
    if(current==='extend')jobs.extend(selection,{style,seconds:20,lyrics:'',model});
   }else if(create.kind==='part')jobs.part({instrument:create.instrument,label:create.label,style,follow:hasAudio,duration:30,strength:0.45,model});
   else jobs.generate({kind:create.kind,style,lyrics:read?.lyrics||lyrics,duration:30,model,score,seed:read?.seed});
  }catch(e){setError((e as Error).message);}
 }
 const modeActive=!!target&&current==='cover';
 const scoreActive=target?['cover','band','score'].includes(current):create.kind!=='part'&&model==='yue2';
 const caption=target?current==='cover'?mode==='keep'?'Your recorded vocal stays; separation may affect its quality.':mode==='play'?'YuE2 performs the melody on instruments.':'YuE2 creates new vocals and instruments.':current==='band'?'Your recorded vocal with new accompaniment.':current==='score'?'Review the transcription before changing the music.':'A new take appears for you to audition.'
  :create.kind==='part'?'Follow your music with a new '+create.label.toLowerCase()+'.':model==='yue2'?'Plan a score first, or generate a complete take.':'Describe your sound and audition a new take.';
 return <aside className="ai-panel" aria-label="Kiku AI">
  {jobs.takes.length>0&&<div className="take-list" aria-label="Takes to review">{jobs.takes.map(t=><TakeCard key={t.id} take={t} stale={jobs.isStale(t.id)} pause={jobs.pause} accept={asNew=>jobs.accept(t.id,asNew)} discard={()=>jobs.discard(t.id)} score={()=>{
   try{openEditor(sheetFromAbc(t.abc!,sig,t.lyrics,[],t.seed),false);}catch(e){setError((e as Error).message);}
  }}/>)}</div>}
  <header className="panel-title"><button className="composer-add" onClick={openLibrary} title="Choose an instrument" aria-label="Choose an instrument"><Plus size={16}/></button>
   <ComposerSelect label="Style" value={preset} options={STYLE_OPTIONS} icon={Palette} grid open={menu==='style'} toggle={()=>setMenu(menu==='style'?null:'style')} close={closeMenu} change={setPreset} disabled={!!target&&['score','stems'].includes(current)}/>
   <ComposerSelect label="AI model" value={task?model:current} options={modelOptions} icon={Sparkles} open={menu==='model'} toggle={()=>setMenu(menu==='model'?null:'model')} close={closeMenu} change={v=>setPicked(v as Model)} disabled={!task}/>
   <span className="composer-brand"><Sparkles size={12}/> Kiku AI</span><button className="composer-close" onClick={close} aria-label="Hide assistant"><X size={15}/></button>
  </header>
  <form className="ai-body" onSubmit={submit}>
   {target&&<div className="ai-tabs" role="tablist" aria-label="Audio action">{ACTIONS.map(a=>{const Icon=a.icon;return <button key={a.id} type="button" role="tab" aria-selected={current===a.id} className={current===a.id?'chosen':''} disabled={a.id==='extend'&&!canExtend} onClick={()=>setAction(a.id)}><Icon size={13}/>{a.label}</button>;})}</div>}
   {modeActive&&<div className="cover-controls"><ComposerSelect label="Cover mode" value={mode} options={COVER_OPTIONS} icon={Mic2} open={menu==='mode'} toggle={()=>setMenu(menu==='mode'?null:'mode')} close={closeMenu} change={v=>setMode(v as typeof mode)}/>
    {mode!=='keep'&&<ComposerSelect label="Harmony" value={harmony} options={[{value:'keep',label:'Keep chords',description:'Carry the score’s harmony into the new arrangement',icon:Music2},{value:'free',label:'Reimagine chords',description:'Keep the melody; let YuE2 choose new harmony',icon:Sparkles}]} icon={Music2} open={menu==='harmony'} toggle={()=>setMenu(menu==='harmony'?null:'harmony')} close={closeMenu} change={v=>setHarmony(v as typeof harmony)}/>}
   </div>}
   {(!target||!['stems','score'].includes(current))&&<label className="composer-prompt"><span className="sr-only">Describe your sound</span><textarea aria-label="Describe your sound" value={prompt} onChange={e=>setPrompt(e.target.value)} maxLength={2000} rows={2} placeholder={locked?'Describe the new backing around your vocal…':modeActive?'Describe how you want to reimagine this song…':create.kind==='part'?'Describe the '+create.label.toLowerCase()+' you hear in your head…':'Describe the music you hear in your head…'}/></label>}
   <p className="composer-task-description">{caption}</p>
   {scoreActive&&<div className="composer-score-row">
    <button type="button" className="score-open" onClick={editScore}><ListMusic size={14}/>{read?'Edit score':target?'Read & edit score':'Open score editor'}</button>
    {read&&<><span>{read.summary.bars.length} bars · {read.bpm} BPM{read.timingChanged?' · new timing':''}</span><button type="button" className="tool-button" aria-label="Clear reviewed score" onClick={()=>setSheet(null)}><X size={12}/></button></>}
    {read&&locked&&!draftOf(read).clock.length&&<button type="button" className="score-plan" onClick={()=>{try{readSelection();}catch(e){setError((e as Error).message);}}}>Read vocal timing</button>}
    {!target&&model==='yue2'&&<button type="button" className="score-plan" onClick={plan}><Sparkles size={12}/>{read?'Plan again':'Plan score'}</button>}
   </div>}
   {(modeActive||locked||!target&&create.kind==='instrumental')&&<div className="instrument-choice"><ComposerSelect label="Lead instrument" value={instrument} options={INSTRUMENTS} icon={Piano} open={menu==='instrument'} toggle={()=>setMenu(menu==='instrument'?null:'instrument')} close={closeMenu} change={setInstrument}/></div>}
   {((!target&&create.kind==='song')||(modeActive&&mode==='sing'))&&<label className="composer-prompt composer-lyrics"><span className="sr-only">Song lyrics</span><textarea aria-label="Song lyrics" value={read?.lyrics??lyrics} onChange={e=>{setLyrics(e.target.value);if(read)setSheet({...read,lyrics:e.target.value});}} rows={3} maxLength={8000} placeholder={target?'Lyrics matching the recording’s sections (optional)…':'[verse]\nYour words…\n[chorus]'}/></label>}
   {error&&<p className="ai-error" role="alert">{error}<button type="button" aria-label="Dismiss" onClick={()=>setError('')}><X size={13}/></button></p>}
   <div className="composer-footer"><span className="composer-caption">{target?target.clips.length+' selected clip'+(target.clips.length===1?'':'s'):create.kind==='part'?'Adding '+create.label.toLowerCase():create.kind==='song'?'Song with vocals':'New instrumental'}</span><div className="ai-actions">{target&&<button type="button" className="tool-button" onClick={()=>download(target)} aria-label="Download selection"><Download size={14}/></button>}<button type="submit" className="run-button" title={current==='score'&&target?'Read score':'Create a take'}><ArrowUp size={18}/><span className="sr-only">{current==='score'&&target?'Read score':'Create a take'}</span></button></div></div>
  </form>
  {jobs.jobs.length>0&&<section className="job-list" aria-label="Queue" aria-live="polite">{jobs.jobs.map(job=><div key={job.id} className={'job'+(job.error?' failed':'')}>{job.error?<X size={14}/>:<span className="spinner"/>}<div><strong>{job.label}</strong><span>{job.error||job.status}</span></div><button aria-label={job.error?'Dismiss':'Cancel'} onClick={()=>job.error?jobs.dismiss(job.id):jobs.cancel(job.id)}><X size={13}/></button></div>)}</section>}
  {editor&&<ScoreEditor sheet={editor} lockedVocal={editorLocked} close={()=>setEditor(null)} save={s=>{setSheet(s);setLyricsBySelection(previous=>({...previous,[s.sig]:s.lyrics}));if(!target)setPicked('yue2');}}
   source={target?()=>jobs.source(selection):undefined}/>}
 </aside>;
}
