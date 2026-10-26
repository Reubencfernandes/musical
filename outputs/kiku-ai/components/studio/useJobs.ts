'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {type Clip,type Project,type Range,type Selection,addTrack,clipEnd,clipsIn,projectEnd,selectTake,soleClip,takeAnchor,uid} from '@/lib/studio/model';
import {type Player,encodeWav,renderMix,sliceBuffer,spliceBuffer,resample} from '@/lib/studio/audio';
import {type Progress,LEAVING,SignedOut,resumeJob,runJob,fetchResult,wavFile} from '@/lib/studio/engine';
import type {PendingJob} from '@/lib/studio/drafts';
import type {Analysis,CoverResult,Download,GenerationReport,LyricsResult,PartResult,PlanResult,ScoreRead,SongResult,StemsResult} from '@/lib/types';
import {type Model,modelLabel} from '@/lib/studio/models';
import type {Meta} from '@/lib/jobs';
import {readScore as parseScore,writeScore,scoreSeconds} from '@/lib/studio/score';

/**
 * A running job. `tracks` are the tracks it works on, so its lane can sit
 * under them; `progress` is the engine's own fraction when it reports one and
 * `etaAt` when the queue expects it done, which together drive the lane's reveal.
 */
export type Job={id:string;label:string;status:string;start:number;end:number;tracks:string[];began:number;running:number|null;progress:number|null;etaAt:number|null;queue:number|null;error?:string};
export type ScoreDraft={abc:string;clock:number[];beats?:number[];edits:{transpose?:number;bpm?:number;chords?:Record<number,string[]>}};
function addScore(form:FormData,score?:ScoreDraft){
 if(score){form.append('abc',score.abc);form.append('clock',JSON.stringify({bars:score.clock,beats:score.beats||[]}));form.append('edits',JSON.stringify(score.edits));}
}
export type Target={start:number;end:number;clips:Clip[];tracks:string[];range:Range|null;sole:Clip|null};
export function targetOf(project:Project,selection:Selection):Target|null{
 const range=selection.range;
 if(range&&range.end-range.start>0.05){
  const clips=clipsIn(project,range).filter(c=>!c.muted);if(!clips.length)return null;
  const start=Math.max(range.start,Math.min(...clips.map(c=>c.start))),end=Math.min(range.end,Math.max(...clips.map(clipEnd)));
  const clamped={...range,start,end};return {start,end,clips,tracks:range.tracks,range:clamped,sole:soleClip(project,clamped)};
 }
 const clips=project.clips.filter(c=>selection.clips.includes(c.id));if(!clips.length)return null;
 return {start:Math.min(...clips.map(c=>c.start)),end:Math.max(...clips.map(clipEnd)),clips,tracks:[...new Set(clips.map(c=>c.trackId))],range:null,sole:clips.length===1?clips[0]:null};
}
export function targetSignature(target:Target){
 return JSON.stringify([target.start,target.end,target.clips.map(c=>[c.id,c.buffer,c.offset,c.duration,c.start,c.muted]).sort()]);
}
type Deps={player:Player;buffers:Map<string,AudioBuffer>;project:()=>Project;playhead:()=>number;commit:(fn:(p:Project)=>Project)=>void;signedOut:()=>void;pause:()=>void};
/** One track of a result. `muted` items (an original backing kept for reference) stay silent when the take is used. */
type Placed={name:string;buffer:AudioBuffer;muted?:boolean;score?:false};
/** `job` hears a Modal job's server ID, which makes the job resumable after a refresh. */
type Work=(signal:AbortSignal,status:(text:string)=>void,progress:(p:Progress)=>void,job:(server:string)=>void)=>Promise<void>;
/** Where a result goes, as plain data, so a job picked up after a refresh can still place it. */
type Spot={start:number;end:number;tracks:string[];clips:string[]};
/** The tempo, key and chords when a job started: an engine's measurement replaces only what the user has not changed since. */
type Was={bpm:number;key:string;chords:Project['chords']};
const spot=(target:Target):Spot=>({start:target.start,end:target.end,tracks:target.tracks,clips:target.clips.map(c=>c.id)});
const wasOf=(project:Project):Was=>({bpm:project.bpm,key:project.key,chords:project.chords});
type Edited={audio?:Download;status:string;report?:GenerationReport};
/** What each resumable job needs to place its result, and what its engine returns. */
type Params={
 restyle:{target:Spot;model:Model;style:string;was:Was};
 rewrite:{target:Spot;model:Model;style:string;from:number;to:number;was:Was};
 cover:{target:Spot;style:string;voice:'sing'|'play';clock?:number[];beats?:number[];was:Was};
 extend:{target:Spot;model:Model;style:string;clip:{start:number;offset:number;duration:number;buffer:string};was:Was};
 part:{at:number;label:string;model:Model;style:string;measure:boolean;was:Was};
 generate:{at:number;kind:'song'|'instrumental';model:Model;style:string;lyrics:string;abc?:string;was:Was};
};
type Results={restyle:Edited;rewrite:Edited;cover:CoverResult;extend:Edited;part:PartResult;generate:SongResult};
type Kind=keyof Params;
type Keep={kind:Kind;params:Params[Kind];began?:number};
const MAX=240,SCORE_MAX=300;
export function useJobs({player,buffers,project,playhead,commit,signedOut,pause}:Deps){
 const [jobs,setJobs]=useState<Job[]>([]);
 // Modal jobs with a server ID: the studio keeps these in its local draft and resumes them after a refresh.
 const [pending,setPending]=useState<PendingJob[]>([]);
 const controllers=useRef(new Map<string,AbortController>());
 const alive=useRef(true);
 // Unmounting is leaving, not stopping: Modal jobs carry on and are resumed from the draft.
 useEffect(()=>{alive.current=true;const running=controllers.current;return()=>{alive.current=false;running.forEach(c=>c.abort(LEAVING));};},[]);
 const load=useCallback(async(file:Download|undefined,signal:AbortSignal)=>{
  if(!file)throw new Error('The engine did not return that audio.');return player.decode(await fetchResult(file,signal));
 },[player]);
 const run=useCallback((label:string,start:number,end:number,tracks:string[],work:Work,keep?:Keep)=>{
  const id=uid(),controller=new AbortController(),began=keep?.began??Date.now();controllers.current.set(id,controller);
  setJobs(list=>[...list,{id,label,status:'Starting…',start,end,tracks,began,running:null,progress:null,etaAt:null,queue:null}]);
  const update=(patch:Partial<Job>)=>{if(alive.current)setJobs(list=>list.map(j=>j.id===id?{...j,...patch}:j));};
  const status=(text:string)=>update({status:text});
  const progress=(p:Progress)=>{if(alive.current)setJobs(list=>list.map(j=>j.id!==id?j:{...j,progress:p.fraction,
   etaAt:p.eta===null?j.etaAt:Date.now()+p.eta*1000,queue:p.queue,running:j.running??(p.running?Date.now():null)}));};
  const job=(server:string)=>{if(keep&&alive.current)setPending(list=>[...list.filter(p=>p.id!==id),{id,server,kind:keep.kind,label,start,end,tracks,began,params:keep.params}]);};
  const settle=()=>setPending(list=>list.filter(p=>p.id!==id));
  work(controller.signal,status,progress,job).then(()=>{if(alive.current){setJobs(list=>list.filter(j=>j.id!==id));settle();}},error=>{
   if(!alive.current)return;settle();
   if(controller.signal.aborted){setJobs(list=>list.filter(j=>j.id!==id));return;}
   if(error instanceof SignedOut)signedOut();
   update({error:error instanceof Error?error.message:'That could not finish.'});
  }).finally(()=>controllers.current.delete(id));
 },[signedOut]);
 const cancel=useCallback((id:string)=>{
  controllers.current.get(id)?.abort();setJobs(list=>list.filter(j=>j.id!==id));setPending(list=>list.filter(p=>p.id!==id));
 },[]);

 /**
  * Put a result in the project. A result made from a selection becomes a take
  * under its source and is used straight away, so it is heard in context;
  * switching it off brings the original back. Anything else is a new track.
  */
 const place=(options:{label:string;was:Was;target:Spot|null;at:number;items:Placed[];replace:boolean;model:string;style:string;lyrics?:string;abc?:string;report?:GenerationReport;analysis?:Analysis;status?:string;clock?:number[];beats?:number[]})=>{
  if(!alive.current)return;const warnings:string[]=[];
  if(options.report?.truncated||options.analysis?.truncated)warnings.push('The model stopped early. Listen for an incomplete ending.');
  if(options.target&&options.report?.locked===false&&(options.clock?.length||!options.abc))warnings.push('The bar timing could not be matched. Check the alignment with your recording.');
  if(options.target&&options.analysis?.locked===false)warnings.push('The backing could not be locked to your bars. Check its timing.');
  if(options.analysis?.voice===false)warnings.push('No vocal was detected. This take keeps your original recording with the new backing.');
  const generation={model:options.model,style:options.style,lyrics:options.lyrics,seed:options.report?.seed??options.analysis?.seed,createdAt:new Date().toISOString(),sourceClips:options.target?.clips||[],status:options.status};
  let analysis=options.analysis;
  if(!analysis&&options.abc){try{const score=parseScore(options.abc),key=score.bars[0].key;analysis={tempo:score.bpm,key:key.endsWith('m')?key.slice(0,-1)+' minor':key+' major',chords:score.chords.map(c=>({time:c.start*240/score.grid/score.bpm,name:c.name}))};}catch{}}
  const made=options.items.map(item=>{const key=uid();buffers.set(key,item.buffer);return {...item,key};});
  const source=options.replace&&options.target?{tracks:options.target.tracks,start:options.target.start,end:options.target.end}:null;
  const takeId=uid();
  commit(current=>{
   let next=current,after=source?takeAnchor(current,source.tracks):undefined;
   for(const item of made){
    const [withTrack,track]=addTrack(next,item.name,after);after=track.id;
    next={...withTrack,tracks:source?withTrack.tracks.map(t=>t.id===track.id?{...t,mute:true,take:{id:takeId,label:options.label,selected:false,source,hidden:[],warnings}}:t):withTrack.tracks,
     clips:[...withTrack.clips,{id:uid(),trackId:track.id,buffer:item.key,start:options.at,offset:0,duration:item.buffer.duration,name:item.name,muted:item.muted,
      generation,score:options.abc&&item.score!==false?{abc:options.abc,lyrics:options.lyrics||'',clock:options.clock,beats:options.beats}:undefined}]};
   }
   if(source)next=selectTake(next,takeId,true);
   // Adopt what the engine measured unless the user changed it while the job ran.
   const was=options.was;
   if(analysis)next={...next,bpm:analysis.tempo>0&&current.bpm===was.bpm?Math.round(analysis.tempo*10)/10:next.bpm,
    key:current.key===was.key?analysis.key||next.key:next.key,
    chords:analysis.chords.length&&JSON.stringify(current.chords)===JSON.stringify(was.chords)?analysis.chords.map(c=>({time:c.time+options.at,name:c.name})):next.chords};
   return next;
  });
 };

 /** Turn each resumable job's result into tracks, from plain data only, so it works the same after a refresh. */
 const finish:{[K in Kind]:(result:Results[K],p:Params[K],signal:AbortSignal)=>Promise<void>}={
  restyle:async(result,p,signal)=>{
   const full=await load(result.audio,signal),buffer=sliceBuffer(full,0,Math.min(full.duration,p.target.end-p.target.start));
   if(!signal.aborted)place({label:'Restyle',was:p.was,target:p.target,at:p.target.start,items:[{name:'Restyled',buffer}],replace:true,model:p.model,style:p.style,report:result.report,status:result.status});
  },
  rewrite:async(result,p,signal)=>{
   const full=await load(result.audio,signal),buffer=sliceBuffer(full,p.from,p.to);
   if(!signal.aborted)place({label:'Rewrite',was:p.was,target:p.target,at:p.target.start,items:[{name:'Rewritten',buffer}],replace:true,model:p.model,style:p.style,report:result.report,status:result.status});
  },
  cover:async(result,p,signal)=>{
   const buffer=await load(result.audio,signal),name=p.voice==='sing'?'AI cover':'Instrumental cover';
   if(!signal.aborted)place({label:name,was:p.was,target:p.target,at:p.target.start,items:[{name,buffer}],replace:true,model:'yue2',style:p.style,lyrics:result.lyrics,abc:result.abc,report:result.report,status:result.status,clock:p.clock,beats:p.beats});
  },
  extend:async(result,p,signal)=>{
   const original=buffers.get(p.clip.buffer);if(!original)throw new Error('The original audio is unavailable.');
   const full=await resample(await load(result.audio,signal),original.sampleRate),join=Math.max(0.5,p.clip.duration-0.3);
   if(full.duration<=join)throw new Error('The model did not return a continuation.');
   const kept=sliceBuffer(original,p.clip.offset,p.clip.offset+p.clip.duration),buffer=spliceBuffer(kept,join,sliceBuffer(full,join,full.duration),0.3);
   if(!signal.aborted)place({label:'Extend',was:p.was,target:p.target,at:p.clip.start,items:[{name:'Extended',buffer}],replace:true,model:p.model,style:p.style,status:result.status});
  },
  part:async(result,p,signal)=>{
   const buffer=await load(result.audio,signal);
   if(!signal.aborted)place({label:p.label,was:p.was,target:null,at:p.at,items:[{name:p.label,buffer}],replace:false,model:p.model,style:p.style,analysis:p.measure?result.analysis:undefined,status:result.status});
  },
  generate:async(result,p,signal)=>{
   const buffer=await load(result.audio,signal),name=p.kind==='song'?'Song':'Instrumental';
   if(!signal.aborted)place({label:name,was:p.was,target:null,at:p.at,items:[{name,buffer}],replace:false,model:p.model,style:p.style,lyrics:p.lyrics,abc:result.abc||p.abc,report:result.report||{seed:result.seed},status:result.status});
  },
 };
 /** Pick up the Modal jobs a refreshed page was following, and place their results as they would have been. */
 const resume=(list:PendingJob[])=>{
  for(const p of list){
   if(!Object.hasOwn(finish,p.kind))continue;
   const kind=p.kind as Kind,done=finish[kind] as (result:unknown,params:unknown,signal:AbortSignal)=>Promise<void>;
   run(p.label,p.start,p.end,p.tracks,async(signal,status,progress,job)=>{
    job(p.server);
    await done(await resumeJob<unknown>(p.server,{signal,status,progress}),p.params,signal);
   },{kind,params:p.params as Params[Kind],began:p.began});
  }
 };

 const check=(target:Target|null,min=3,max=MAX)=>{
  if(!target)throw new Error('Select a clip, or drag across one, first.');const length=target.end-target.start;
  if(length<min)throw new Error('Select at least '+min+' seconds.');
  if(length>max)throw new Error('Select '+max/60+' minutes or less at a time.');return target;
 };
 const render=(snapshot:Project,target:Target,start=target.start,end=target.end)=>renderMix(snapshot,buffers,{start,end,clips:target.clips.map(c=>c.id),mixer:target.clips.length>1});
 const source=async(selection:Selection)=>{const snapshot=project(),target=check(targetOf(snapshot,selection));return encodeWav(await render(snapshot,target));};
 const restyle=(selection:Selection,options:{style:string;change:number;lyrics:string;model:Model;meta?:Meta})=>{
  const snapshot=project(),target=check(targetOf(snapshot,selection));
  const params:Params['restyle']={target:spot(target),model:options.model,style:options.style,was:wasOf(snapshot)};
  run('Restyle · '+modelLabel(options.model),target.start,target.end,target.tracks,async(signal,status,progress,job)=>{
   const form=new FormData();form.append('audio',wavFile(await render(snapshot,target)));form.append('model',options.model);form.append('style',options.style);form.append('change',String(options.change));form.append('lyrics',options.lyrics);form.append('meta',JSON.stringify(options.meta||{}));
   await finish.restyle(await runJob<Edited>('remix',form,{signal,status,progress,job}),params,signal);
  },{kind:'restyle',params});
 };
 const rewrite=(selection:Selection,options:{style:string;variance:number;lyrics:string;model:Model;meta?:Meta})=>{
  const snapshot=project(),target=check(targetOf(snapshot,selection),1),from=Math.min(...target.clips.map(c=>c.start)),to=Math.max(...target.clips.map(clipEnd));
  let lo=Math.max(from,target.start-8),hi=Math.min(to,target.end+8);if(hi-lo<3){lo=Math.max(0,Math.min(lo,target.end-3));hi=Math.max(hi,lo+3);}if(hi-lo>MAX)throw new Error('Select four minutes or less.');
  const params:Params['rewrite']={target:spot(target),model:options.model,style:options.style,from:target.start-lo,to:target.end-lo,was:wasOf(snapshot)};
  run('Rewrite · '+modelLabel(options.model),target.start,target.end,target.tracks,async(signal,status,progress,job)=>{
   const form=new FormData();form.append('audio',wavFile(await render(snapshot,target,lo,hi)));form.append('model',options.model);form.append('style',options.style);form.append('lyrics',options.lyrics);form.append('start',String(target.start-lo));form.append('end',String(target.end-lo));form.append('variance',String(options.variance));form.append('meta',JSON.stringify(options.meta||{}));
   await finish.rewrite(await runJob<Edited>('repaint',form,{signal,status,progress,job}),params,signal);
  },{kind:'rewrite',params});
 };
 const cover=(selection:Selection,options:{style:string;lyrics:string;voice:'sing'|'play';harmony:'keep'|'free';score?:ScoreDraft})=>{
  const snapshot=project(),target=check(targetOf(snapshot,selection),3,SCORE_MAX);
  const params:Params['cover']={target:spot(target),style:options.style,voice:options.voice,clock:options.score?.clock,beats:options.score?.beats,was:wasOf(snapshot)};
  run('Cover · YuE2',target.start,target.end,target.tracks,async(signal,status,progress,job)=>{
   const form=new FormData();form.append('audio',wavFile(await render(snapshot,target)));form.append('model','yue2');form.append('style',options.style);form.append('lyrics',options.lyrics);form.append('voice',options.voice);form.append('harmony',options.harmony);addScore(form,options.score);
   await finish.cover(await runJob<CoverResult>('cover',form,{signal,status,progress,job}),params,signal);
  },{kind:'cover',params});
 };
 const readScore=(selection:Selection,options:{words:boolean},done:(read:ScoreRead,target:Target)=>void)=>{
  const snapshot=project(),target=check(targetOf(snapshot,selection),3,SCORE_MAX);
  run('Reading the score',target.start,target.end,target.tracks,async(signal,status,progress)=>{
   const form=new FormData();form.append('audio',wavFile(await render(snapshot,target)));form.append('words',String(options.words));
   const read=await runJob<ScoreRead>('score',form,{signal,status,progress});if(!read.summary||!read.abc)throw new Error('No score came back. Try a longer stretch.');
   parseScore(read.abc);if(!signal.aborted)done(read,target);
  });
 };
 const words=(selection:Selection,done:(lyrics:string)=>void)=>{
  const snapshot=project(),target=check(targetOf(snapshot,selection),3,SCORE_MAX);
  run('Reading the words',target.start,target.end,target.tracks,async(signal,status,progress)=>{
   const form=new FormData();form.append('audio',wavFile(await render(snapshot,target)));const result=await runJob<LyricsResult>('lyrics',form,{signal,status,progress});
   if(!result.lyrics.trim())throw new Error('No words were found in this stretch.');if(!signal.aborted)done(result.lyrics);
  });
 };
 const stems=(selection:Selection)=>{
  const snapshot=project(),target=check(targetOf(snapshot,selection));
  run('Separate stems',target.start,target.end,target.tracks,async(signal,status,progress)=>{
   const form=new FormData();form.append('audio',wavFile(await render(snapshot,target)));
   const result=await runJob<StemsResult>('split',form,{signal,status,progress}),parts=await Promise.all([load(result.vocals,signal),load(result.drums,signal),load(result.bass,signal),load(result.other,signal)]);
   if(signal.aborted)return;place({label:'Stems',was:wasOf(snapshot),target:spot(target),at:target.start,items:parts.map((buffer,i)=>({name:['Vocals','Drums','Bass','Other'][i],buffer})),replace:true,model:'Demucs',style:'Stem separation',status:result.status});
  });
 };
 const extend=(selection:Selection,options:{style:string;seconds:number;lyrics:string;model:Model})=>{
  const snapshot=project(),target=check(targetOf(snapshot,selection));if(target.range||!target.sole)throw new Error('Select one clip to extend.');if(target.end-target.start>200)throw new Error('Extend works on clips up to 200 seconds.');
  const clip=target.sole;if(!buffers.get(clip.buffer))throw new Error('The original audio is unavailable.');
  const params:Params['extend']={target:spot(target),model:options.model,style:options.style,clip:{start:clip.start,offset:clip.offset,duration:clip.duration,buffer:clip.buffer},was:wasOf(snapshot)};
  run('Extend · '+modelLabel(options.model),clip.start,clipEnd(clip)+options.seconds,target.tracks,async(signal,status,progress,job)=>{
   const form=new FormData();form.append('audio',wavFile(await render(snapshot,target)));form.append('model',options.model);form.append('style',options.style);form.append('seconds',String(options.seconds));form.append('lyrics',options.lyrics);
   await finish.extend(await runJob<Edited>('extend',form,{signal,status,progress,job}),params,signal);
  },{kind:'extend',params});
 };
 const part=(options:{instrument:string;label:string;style:string;follow:boolean;duration:number;strength:number;model:Model})=>{
  const snapshot=project(),end=projectEnd(snapshot),follow=options.follow&&snapshot.clips.some(c=>!c.muted);if(follow&&end<3)throw new Error('Add at least three seconds of music to follow.');
  const cursor=playhead(),at=follow?(end>MAX&&cursor<end-3?cursor:0):cursor,until=follow?Math.min(end,at+MAX):at+options.duration;
  const params:Params['part']={at,label:options.label,model:options.model,style:options.style,measure:!snapshot.chords.length,was:wasOf(snapshot)};
  run(options.label+' · '+modelLabel(options.model),at,until,[],async(signal,status,progress,job)=>{
   const form=new FormData();if(follow)form.append('audio',wavFile(await renderMix(snapshot,buffers,{start:at,end:until})));form.append('model',options.model);form.append('instrument',options.instrument);form.append('style',options.style);form.append('bpm',String(snapshot.chords.length||!follow?snapshot.bpm:0));form.append('key',snapshot.key);form.append('duration',String(options.duration));form.append('strength',String(options.strength));
   await finish.part(await runJob<PartResult>('part',form,{signal,status,progress,job}),params,signal);
  },{kind:'part',params});
 };
 const plan=(options:{style:string;lyrics:string;instrumental:boolean},done:(result:PlanResult)=>void)=>{
  if(!options.style.trim())throw new Error('Describe the music first.');if(!options.instrumental&&!options.lyrics.trim())throw new Error('Add lyrics with section labels first.');
  const at=playhead();run('Plan score · YuE2',at,at+30,[],async(signal,status,progress)=>{const result=await runJob<PlanResult>('plan',{...options,model:'yue2'},{signal,status,progress});parseScore(result.abc);if(result.report?.truncated)throw new Error('The draft was cut short. Try shorter lyrics.');if(!signal.aborted)done(result);});
 };
 const generate=(options:{kind:'instrumental'|'song';style:string;lyrics:string;duration:number;model:Model;score?:ScoreDraft;seed?:number})=>{
  if(!options.style.trim())throw new Error('Describe the sound you want.');if(options.kind==='song'&&!options.lyrics.trim())throw new Error('Add lyrics, marked with [verse] and [chorus].');
  if(options.score&&options.model!=='yue2')throw new Error('Choose YuE2 to render an edited score.');
  const at=playhead(),snapshot=project();let abc=options.score?.abc;
  if(abc){const score=parseScore(abc);if(!score.notes.length&&!score.chords.length)throw new Error('Add notes or chords to the score first.');abc=writeScore(score);}
  const length=abc?scoreSeconds(parseScore(abc)):options.duration;
  const params:Params['generate']={at,kind:options.kind,model:options.model,style:options.style,lyrics:options.lyrics,abc,was:wasOf(snapshot)};
  run((options.kind==='song'?'Song':'Instrumental')+' · '+modelLabel(options.model),at,at+length,[],async(signal,status,progress,job)=>{
   const result=options.kind==='song'?await runJob<SongResult>('song',{style:options.style,lyrics:options.lyrics,cot:'full',model:options.model,abc:abc||'',seed:options.seed??-1},{signal,status,progress,job})
    :await runJob<SongResult>('instrumental',{style:options.style,lyrics:'',duration:options.duration,model:options.model,abc:abc||'',seed:options.seed??-1},{signal,status,progress,job});
   await finish.generate(result,params,signal);
  },{kind:'generate',params});
 };
 // Running jobs a refresh would lose: on the Hugging Face Spaces, or not started on Modal yet.
 const fragile=jobs.some(j=>!j.error&&!pending.some(p=>p.id===j.id));
 return {jobs,pending,fragile,resume,cancel,pause,source,restyle,rewrite,cover,readScore,words,stems,extend,part,generate,plan,dismiss:(id:string)=>setJobs(list=>list.filter(j=>j.id!==id))};
}
