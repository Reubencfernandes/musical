import {type Model,modelOf} from '@/lib/studio/models';
import {readScore,writeScore} from '@/lib/studio/score';
import type {CoverResult,Download,LyricsResult,PartResult,ScoreRead,ScoreResult,ScoreTiming,SongResult,StemsResult} from '@/lib/types';

/**
 * Every engine job the app runs: which Space serves it, how the request is
 * checked and turned into the endpoint's arguments, and how the reply is read.
 *
 * YuE2-Turbo runs on the Kiku-Engine ZeroGPU Space first, and on a private
 * Modal GPU through /api/modal/jobs when ZeroGPU cannot serve it. The browser
 * calls the Hugging Face engines itself (see lib/studio/engine.ts).
 * Hugging Face
 * rate-limits Spaces by the caller's address, and this app's Docker Space shares
 * its outgoing address with other Spaces, so calls made from the server were
 * turned away with 429s that each user's own connection never sees.
 */
export type Engine={space:string;origin:string};
export const ENGINE:Engine={
 space:process.env.NEXT_PUBLIC_HF_ENGINE_SPACE||'Reubencf/Kiku-Engine',
 origin:process.env.NEXT_PUBLIC_HF_ENGINE_ORIGIN||'https://reubencf-kiku-engine.hf.space'};
export const YUE2:Engine={space:'Modal YuE2',origin:'https://konkanillm--kiku-yue2-engine-web.modal.run'};
/** Song artwork: Z-Image Turbo on its own ZeroGPU Space, called with the user's token like the engine. */
export const ART:Engine={
 space:process.env.NEXT_PUBLIC_HF_ART_SPACE||'Reubencf/Kiku-Art',
 origin:process.env.NEXT_PUBLIC_HF_ART_ORIGIN||'https://reubencf-kiku-art.hf.space'};
export const engineOf=(model:Model)=>model==='yue2'?YUE2:ENGINE;

/** Resolve a Gradio file payload, refusing anything not served by that Space. */
export function asFile(engine:Engine,value:unknown):Download|undefined{
 if(!value||typeof value!=='object')return;
 const data=value as {url?:string;path?:string;orig_name?:string};
 const url=data.url||(data.path?engine.origin+'/gradio_api/file='+data.path:'');
 try{if(new URL(url).origin!==engine.origin)return;}catch{return;}
 return {url,name:data.orig_name||data.path?.split('/').pop()||'download'};
}

/** Friendly text for the failures users actually hit, so the UI never shows a stack. */
export function explain(message:string){
 // Hugging Face's gateway answers some failures with a whole HTML error page.
 if(/<!doctype html|<html/i.test(message)){
  const code=/<h1>\s*(\d{3})\s*<\/h1>/i.exec(message)?.[1];
  return `Hugging Face's servers had a hiccup${code?` (error ${code})`:''} and the job didn't go through. `
   +'Your project is safe. Run it again.';
 }
 if(/quota|GPU.*duration|exceeded|allowance/i.test(message))
  return 'Your Hugging Face GPU allowance is used up for now. It resets 24 hours after your first '
   +'generation, or you can upgrade to PRO for a larger daily allowance.';
 if(/gpu task aborted|timed out|timeout/i.test(message))
  return 'The generation ran out of GPU time. Try a shorter piece.';
 if(/no gpu|unavailable|503|starting/i.test(message))
  return 'The engine is waking up. Wait a moment and try again.';
 if(/\b429\b|too many requests|rate.?limit/i.test(message))
  return 'Hugging Face is busy right now. Wait a minute and try again; your project is safe.';
 return message;
}

/** A request: the studio's form, or a plain object for jobs without audio. */
export type Input=FormData|Record<string,unknown>;
const field=(input:Input,name:string)=>input instanceof FormData?input.get(name):input[name];

/** A number from the request, clamped so no request can ask the GPU for more than the job allows. */
export function num(input:Input,name:string,fallback:number,min:number,max:number){
 const raw=field(input,name),value=raw===null||raw===undefined||raw===''?NaN:Number(raw);
 return Math.min(max,Math.max(min,Number.isFinite(value)?value:fallback));
}
export function text(input:Input,name:string){const value=field(input,name);return typeof value==='string'?value.trim():typeof value==='number'||typeof value==='boolean'?String(value):'';}
export function seed(input:Input){return num(input,'seed',-1,-1,2**31-1);}
/** Style prompts and lyrics share the engine's limits. */
export function tooLong(style:string,lyrics=''){
 return style.length>2000||lyrics.length>8000?'That is longer than the engine accepts. Shorten it and try again.':'';
}
/** The engine reports what it measured as a JSON string. */
export function json(value:unknown){try{return typeof value==='string'?JSON.parse(value):undefined;}catch{return undefined;}}
/**
 * A score the user read and edited in the studio: the ABC, the time each bar
 * starts in the recording, and the edits. Sent as strings; the engine checks them.
 */
function scoreFields(input:Input):{error:string}|{abc:string;clock:string;edits:string}{
 let abc=text(input,'abc');const clock=text(input,'clock'),edits=text(input,'edits');
 if(abc.length>200000||clock.length>50000||edits.length>20000)return {error:'That score is too long to send.'};
 for(const value of [clock,edits])if(value){try{JSON.parse(value);}catch{return {error:'That score could not be read.'};}}
 if(abc){try{abc=writeScore(readScore(abc));}catch(e){return {error:e instanceof Error?e.message:'That score is invalid.'};}}
 return {abc,clock,edits};
}
/** The engine's bar timing, if it sent a usable one: rising times, one per bar line. */
function timing(value:unknown):ScoreTiming|undefined{
 if(!value||typeof value!=='object')return;
 const {bpm,bars,clock}=value as Partial<ScoreTiming>;
 const rising=(list:unknown)=>Array.isArray(list)&&list.length>1&&list.every((v,i)=>Number.isFinite(v)&&(!i||v>list[i-1]));
 if(typeof bpm!=='number'||!rising(bars)||!rising(clock)||bars!.length!==clock!.length)return;
 return {bpm,bars:bars!,clock:clock!};
}

type Files=(value:unknown)=>Download|undefined;
export type Spec={
 /** The Space endpoint, or one per model when models differ in how they do the job. */
 endpoint:string|((model:Model)=>string);
 /** Models that can serve this job; the first is used when none is named. */
 models?:Model[];
 /** Jobs only the engine serves (SheetSage2, Demucs, HeartTranscriptor), whatever model is picked. */
 fixed?:Engine;
 /** Whether the job sends audio. Parts can be written from a prompt alone. */
 audio?:'required'|'optional'|'none';
 /** Seconds of audio the job accepts. */
 limits?:{min:number;max:number};
 /** Shown while the job waits in the ZeroGPU queue. */
 waiting?:string;
 /** Checks the request. The audio argument arrives once it is uploaded. */
 build:(input:Input,model:Model)=>{error:string}|{args:(audio:unknown)=>unknown[]};
 shape:(data:unknown[],file:Files,model:Model)=>unknown;
};
const LABEL:Record<Model,string>={ace1:'ACE-Step',yue2:'YuE2-Turbo'};
const VOICES=new Set(['sing','play']),HARMONY=new Set(['keep','free']);
const PARTS=new Set(['drums','bass','keys','guitar','strings','synth','band']),MODES=new Set(['full','melody','off']);
const audioOnly=(data:unknown[],file:Files)=>({status:String(data[0]??''),audio:file(data[1])});
/** Restyle and rewrite may also report whether the new music was locked to the source's beat. */
const onBeat=(data:unknown[],file:Files)=>({...audioOnly(data,file),report:json(data[2])});
/** Tempo, key and metre: planned by the writer, or measured from the audio when `measured`. */
export type Meta={bpm?:number;keyscale?:string;timesignature?:string;language?:string;duration?:number;measured?:boolean};

export const JOBS:Record<string,Spec>={
 /** Restyle a clip or selection, keeping its structure while the prompt changes its sound. */
 remix:{endpoint:'/remix',build(input,model){
  const style=text(input,'style'),lyrics=text(input,'lyrics');
  if(!style)return {error:'Describe the style to move towards.'};
  if(tooLong(style,lyrics))return {error:tooLong(style,lyrics)};
  // The engine's strength is how closely to keep the source; the studio asks how much to change.
  // Rounded because 1-0.9 is 0.09999999999999998, which the engine's 0.1 minimum rejects.
  const strength=Math.round((1-num(input,'change',0.5,0.1,0.9))*100)/100;
  return {args:audio=>[audio,style,lyrics,strength,num(input,'steps',60,20,120),seed(input)]};
 },shape:onBeat},
 /**
  * Rewrite one stretch of audio in context. The studio sends the selection with
  * some audio either side, so the new part joins what surrounds it.
  */
 repaint:{endpoint:'/repaint',limits:{min:1,max:240},build(input,model){
  const style=text(input,'style'),lyrics=text(input,'lyrics');
  const start=num(input,'start',0,0,240),end=num(input,'end',0,0,240);
  if(end-start<1)return {error:'Select at least one second to rewrite.'};
  if(tooLong(style,lyrics))return {error:tooLong(style,lyrics)};
  return {args:audio=>[audio,style,lyrics,start,end,num(input,'variance',0.5,0.1,1),num(input,'steps',60,20,120),seed(input)]};
 },shape:onBeat},
 /** Continue a clip past its end. The result holds the original followed by the new music. */
 extend:{endpoint:'/extend',limits:{min:3,max:200},build(input){
  const style=text(input,'style'),lyrics=text(input,'lyrics');
  if(tooLong(style,lyrics))return {error:tooLong(style,lyrics)};
  return {args:audio=>[audio,style,lyrics,num(input,'seconds',20,5,40),num(input,'steps',60,20,120),seed(input)]};
 },shape:audioOnly},
 /**
  * Perform a stretch's tune in a new style with YuE2. SheetSage2 reads the
  * melody, chords and bar lines (unless the studio sends an edited score) and
  * the result is warped onto the recording's bars. Empty lyrics on a sung
  * cover means the song's own words, which the engine transcribes.
  */
 cover:{endpoint:'/restage',models:['yue2'],limits:{min:3,max:300},waiting:'Waiting for a GPU. Covers are queued one at a time…',build(input){
  const style=text(input,'style'),lyrics=text(input,'lyrics');
  const voice=text(input,'voice')||'sing',harmony=text(input,'harmony')||'keep';
  if(tooLong(style,lyrics))return {error:tooLong(style,lyrics)};
  if(!VOICES.has(voice)||!HARMONY.has(harmony))return {error:'Choose how the melody is performed.'};
  const score=scoreFields(input);
  if('error' in score)return score;
  return {args:audio=>[audio,style,lyrics,voice,harmony,score.abc,score.clock,score.edits,seed(input)]};
 },shape:(data,file)=>({status:String(data[0]??''),audio:file(data[1]),abc:String(data[2]??''),
  lyrics:String(data[3]??''),prompt:String(data[4]??''),report:json(data[5])}) as CoverResult},
 /** Write one instrument's part, following the project mix when one is attached. */
 part:{endpoint:'/part',audio:'optional',waiting:'Waiting for a GPU. Parts are queued one at a time…',build(input){
  const instrument=text(input,'instrument'),style=text(input,'style'),key=text(input,'key');
  if(!PARTS.has(instrument))return {error:'Choose an instrument.'};
  if(tooLong(style)||key.length>20)return {error:tooLong(style)||'Name the key like "A minor".'};
  return {args:audio=>[audio,instrument,style,num(input,'bpm',0,0,300),key,num(input,'duration',30,5,240),
   num(input,'strength',0.45,0.2,0.8),num(input,'steps',60,20,120),seed(input)]};
 },shape:(data,file)=>({status:String(data[0]??''),audio:file(data[1]),prompt:typeof data[2]==='string'?data[2]:'',
  analysis:json(data[3])}) as PartResult},
 /** Separate a clip into vocals, drums, bass and everything else. */
 split:{endpoint:'/split',fixed:ENGINE,limits:{min:3,max:360},build:()=>({args:audio=>[audio]}),
  shape:(data,file)=>({status:String(data[0]??''),vocals:file(data[1]),drums:file(data[2]),bass:file(data[3]),other:file(data[4])}) as StemsResult},
 /** Read a stretch into a score: bars with start times, chords and sections, and optionally the sung words. */
 score:{endpoint:'/score',fixed:ENGINE,limits:{min:3,max:300},waiting:'Waiting for a GPU to read the score…',
  build:input=>({args:audio=>[audio,text(input,'words')!=='false']}),
  shape:data=>({status:String(data[0]??''),abc:String(data[1]??''),summary:json(data[2])}) as ScoreRead},
 /** The words sung in a stretch, grouped under its sections. */
 lyrics:{endpoint:'/lyrics',fixed:ENGINE,limits:{min:3,max:300},waiting:'Waiting for a GPU to listen to the words…',
  build:()=>({args:audio=>[audio]}),shape:data=>({status:String(data[0]??''),lyrics:String(data[1]??'')}) as LyricsResult},
 /** Turn a whole recording into a lead sheet for the Score page. */
 transcribe:{endpoint:'/transcribe',fixed:ENGINE,limits:{min:5,max:600},build:input=>({args:audio=>[audio,0,num(input,'duration',30,5,600),false,false]}),
  shape:(data,file)=>{
   if(typeof data[5]!=='string'||!data[5].trim())return null;
   return {abc:data[5],status:String(data[0]),downloads:Array.isArray(data[4])?data[4].map(file).filter((d):d is Download=>!!d):[],
    pdf:file(data[2])?.url,audio:file(data[3])?.url,timing:timing(data[6])} as ScoreResult;
  }},
 /** A full song with vocals from a style prompt and lyrics, sung by YuE2-Turbo. */
 song:{endpoint:'/song',models:['yue2'],audio:'none',waiting:'Waiting for a GPU. Songs are queued one at a time…',build(input,model){
  const style=text(input,'style'),lyrics=text(input,'lyrics');let abc=text(input,'abc');
  const cot=MODES.has(text(input,'cot'))?text(input,'cot'):'full';
  if(!style)return {error:'Describe the style you want.'};
  if(!lyrics)return {error:'Add lyrics. Mark sections with [verse] and [chorus].'};
  if(style.length>2000||lyrics.length>8000||abc.length>60000)return {error:'That is longer than the engine accepts. Shorten it and try again.'};
  if(cot==='melody'&&!abc)return {error:'Melody planning needs a score. Transcribe a recording first.'};
  if(abc){try{abc=writeScore(readScore(abc));}catch(e){return {error:(e as Error).message};}}
  return {args:()=>[style,lyrics,cot,seed(input),abc]};
 },shape:(data,file)=>({status:String(data[0]??''),audio:file(data[1]),artifacts:file(data[2]),abc:typeof data[3]==='string'?data[3]:'',
   seed:Number(data[4]),report:json(data[5])}) as SongResult},
 /** A backing track or instrumental from a style prompt, or YuE2 playing a score. */
 instrumental:{endpoint:model=>model==='yue2'?'/score_instrumental':'/instrumental',models:['yue2','ace1'],audio:'none',build(input,model){
  const style=text(input,'style'),lyrics=text(input,'lyrics');let abc=text(input,'abc');
  if(!style)return {error:'Describe the music you want.'};
  if(style.length>2000||lyrics.length>8000||abc.length>200000)return {error:'That is longer than the engine accepts.'};
  const duration=num(input,'duration',60,10,240);
  if(model==='yue2'){
   if(abc){try{abc=writeScore(readScore(abc));}catch(e){return {error:(e as Error).message};}}
   return {args:()=>[style,abc,duration,seed(input)]};
  }
  if(abc)return {error:'Edited scores are rendered by YuE2. Choose YuE2 to use this score.'};
  return {args:()=>[style,lyrics,duration,num(input,'steps',60,20,120),num(input,'guidance',15,3,25),seed(input)]};
 },shape:(data,file,model)=>model==='yue2'?{status:String(data[0]??''),audio:file(data[1]),abc:String(data[2]??''),seed:Number(data[3]),report:json(data[4])}
  :{status:String(data[0]??''),audio:file(data[1]),abc:''}},
 /**
  * Expand a short description into a full style prompt with the engine's writer
  * (Qwen3-4B). With audio, it also measures the selection's tempo and key.
  */
 enhance:{endpoint:'/enhance',fixed:ENGINE,audio:'optional',limits:{min:3,max:240},build(input){
  const caption=text(input,'caption'),lyrics=text(input,'lyrics');
  if(!caption)return {error:'Describe the sound first, then enhance it.'};
  if(tooLong(caption,lyrics))return {error:tooLong(caption,lyrics)};
  return {args:audio=>[audio,caption,lyrics]};
 },shape:data=>({status:String(data[0]??''),caption:String(data[1]??''),meta:(json(data[2])||{}) as Meta})},
 /** Simple mode: the engine's writer (Qwen3-4B) writes a style, lyrics, tempo and key from a one-line idea. */
 sample:{endpoint:'/sample',fixed:ENGINE,audio:'none',build(input){
  const query=text(input,'query');
  if(!query)return {error:'Describe the song you want.'};
  if(query.length>512)return {error:'Keep the idea under 500 characters.'};
  return {args:()=>[query,text(input,'instrumental')==='true',text(input,'language')]};
 },shape:data=>({status:String(data[0]??''),caption:String(data[1]??''),lyrics:String(data[2]??''),meta:(json(data[3])||{}) as Meta})},
 /** A song's cover art from its title and style. The Space keeps the title out of the picture's lettering. */
 art:{endpoint:'/cover',fixed:ART,audio:'none',waiting:'Waiting for a GPU to paint the cover…',build(input){
  const title=text(input,'title'),style=text(input,'style');
  if(!style)return {error:'Describe the song before painting its cover.'};
  if(title.length>80||style.length>2000)return {error:'That title or style is too long for a cover.'};
  return {args:()=>[title,style,seed(input)]};
 },shape:(data,file)=>({image:file(data[0]),seed:Number(data[1])||undefined})},
 /** YuE2 drafts a score from a prompt and lyrics, for the user to edit before it is performed. */
 plan:{endpoint:'/plan_score',models:['yue2'],audio:'none',waiting:'Waiting for a GPU to write your score…',build(input){
  const style=text(input,'style'),lyrics=text(input,'lyrics'),instrumental=input instanceof FormData?text(input,'instrumental')==='true':!!input.instrumental;
  if(!style||style.length>2000||lyrics.length>8000||!instrumental&&!lyrics)
   return {error:!style?'Describe the style first.':!instrumental&&!lyrics?'Add lyrics before planning a song.':'Shorten the prompt or lyrics.'};
  return {args:()=>[style,lyrics,seed(input),instrumental]};
 },shape:data=>({status:String(data[0]??''),abc:String(data[1]??''),report:json(data[2])})},
};
export type Job=keyof typeof JOBS;

/** The Space and model a request runs on, refusing a model that cannot do the job rather than quietly running another. */
export function route(spec:Spec,input:Input):{engine:Engine;model:Model}|{error:string}{
 if(spec.fixed)return {engine:spec.fixed,model:'ace1'};
 const allowed=spec.models||['ace1'],named=field(input,'model');
 const model=(named?modelOf(named):null)??allowed[0];
 if(!allowed.includes(model))return {error:`${LABEL[model]} cannot do this. Choose ${allowed.map(m=>LABEL[m]).join(' or ')}.`};
 return {engine:engineOf(model),model};
}
