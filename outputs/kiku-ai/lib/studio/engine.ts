import type {Client} from '@gradio/client';
import type {Download} from '@/lib/types';
import {YUE2,JOBS,type Engine,type Input,type Job,asFile,explain,route} from '@/lib/jobs';
import {encodeWav} from './audio';

/** Raised when the session has lapsed, so the studio can show sign-in without losing the project. */
export class SignedOut extends Error{}

/** How far a job has got: the engine's own fraction when it reports one, and the queue's estimate of the time left. */
export type Progress={fraction:number|null;eta:number|null;queue:number|null;running:boolean};
/**
 * `job` hears the server's ID for a Modal job as soon as it exists, so the
 * caller can keep it and pick the job up again after a refresh (resumeJob).
 * Jobs on the Hugging Face Spaces run in the page itself and have no such ID.
 */
type Call={signal:AbortSignal;status:(text:string)=>void;progress?:(p:Progress)=>void;job?:(id:string)=>void};

/**
 * Abort with this reason when the page is going away rather than the user
 * stopping the job: a Modal job then keeps running, to be picked up again.
 */
export const LEAVING='leaving';

let cached:{token:string;expires:number}|null=null;
/**
 * The signed-in user's Hugging Face token. The browser calls the engines
 * itself, so each user's requests come from their own connection and count
 * against their own GPU allowance.
 */
export async function hfToken(){
 if(cached&&cached.expires-60000>Date.now())return cached.token;
 const response=await fetch('/api/auth/token',{cache:'no-store'});
 const data=await response.json().catch(()=>({}));
 if(response.status===401){cached=null;throw new SignedOut(data.error||'Sign in again to continue.');}
 if(!response.ok||typeof data.token!=='string')throw new Error('Could not reach Kiku AI. Check your connection and try again.');
 cached={token:data.token,expires:Number(data.expires)||Date.now()+600000};
 return cached.token;
}

/** Drop the cached token, after the user signs in again (perhaps with more permissions). */
export function forgetToken(){cached=null;}

const pause=(ms:number,signal:AbortSignal)=>new Promise<void>(done=>{
 const timer=setTimeout(done,ms);
 signal.addEventListener('abort',()=>{clearTimeout(timer);done();},{once:true});
});

/**
 * Failures that are Hugging Face's gateway or a Space waking up, not the job:
 * rate limits, 5xx answers (often as an HTML error page) and dropped
 * connections. These are worth retrying; anything else is a real error.
 */
const PASSING=/\b(429|50[0234])\b|too many requests|starting|bad gateway|<!doctype html|<html|fetch failed|failed to fetch|network/i;

/** Connect to a Space by its own URL, riding out short gateway refusals with a jittered backoff. */
async function connect(engine:Engine,token:string,status:(text:string)=>void,signal:AbortSignal){
 const {Client}=await import('@gradio/client');
 const waits=[3000,6000,12000,24000];
 for(let attempt=0;;attempt++){
  try{return await Client.connect(engine.origin,{events:['status','data'],token:token as `hf_${string}`});}
  catch(error){
   const message=error instanceof Error?error.message:String(error);
   if(!PASSING.test(message)||attempt>=waits.length||signal.aborted)throw error;
   status('Hugging Face is busy. Trying again in a moment…');
   await pause(waits[attempt]+Math.random()*2000,signal);
   if(signal.aborted)throw error;
  }
 }
}

/** Seconds of audio in a 16-bit WAV, read from its header; null for other formats. */
async function wavSeconds(file:Blob){
 const head=new DataView(await file.slice(0,44).arrayBuffer());
 if(head.byteLength<44||head.getUint32(0)!==0x52494646||head.getUint32(8)!==0x57415645)return null;
 const rate=head.getUint32(24,true),channels=head.getUint16(22,true);
 return rate&&channels?(file.size-44)/(rate*channels*2):null;
}

const offline=()=>typeof navigator!=='undefined'&&navigator.onLine===false;
/** Resolves when the browser is back online, or the job is stopped. */
const backOnline=(signal:AbortSignal)=>new Promise<void>(done=>{
 if(!offline()){done();return;}
 const finish=()=>{window.removeEventListener('online',finish);signal.removeEventListener('abort',finish);done();};
 window.addEventListener('online',finish);signal.addEventListener('abort',finish,{once:true});
});

/**
 * YuE2-Turbo runs on our private Modal GPU through the authenticated
 * app server. The job lives on the server, not in this connection: when
 * Hugging Face's proxy drops the stream, or the browser goes offline, this
 * reattaches and carries on from the last event it saw instead of losing the
 * generation.
 */
async function runModal<T>(name:Job,input:Input,call:Call):Promise<T>{
 const {signal,status}=call;
 const form=input instanceof FormData?input:new FormData();
 if(!(input instanceof FormData))for(const [key,value] of Object.entries(input))if(value!==undefined&&value!==null)form.append(key,String(value));
 status('Starting Modal GPU…');
 const response=await fetch('/api/modal/jobs?job='+encodeURIComponent(name),{method:'POST',body:form,signal}).catch(error=>{
  if(signal.aborted)throw error;throw new Error('Could not reach Kiku. Check your connection and try again; nothing was started.');});
 if(!response.ok){
  const data=await response.json().catch(()=>({}));
  if(response.status===401)throw new SignedOut(data.error||'Sign in again to continue.');
  // A 502-504 with no message is Hugging Face's proxy answering while Kiku itself restarts (a new deployment).
  throw new Error(data.error||(response.status>=502&&response.status<=504?'Kiku is restarting. Try again in a minute; nothing was started.'
   :'Could not reach the Modal GPU. Try again.'));
 }
 return followModal<T>(response,'',call);
}

/** Pick up a Modal job started before a refresh, by the ID `job` heard, and follow it to its result. */
export function resumeJob<T>(id:string,call:Call):Promise<T>{
 call.status('Picking up where this left off…');
 return followModal<T>(null,id,call);
}

async function followModal<T>(response:Response|null,id:string,{signal,status,progress,job}:Call):Promise<T>{
 let seq=0,result:T|undefined,failure:string|null=null;
 const receive=(line:string)=>{
  if(!line.trim())return;
  const event=JSON.parse(line);
  if(event.type==='job'){if(!id){id=event.id;job?.(id);}return;}
  if(typeof event.seq==='number'){if(event.seq<=seq)return;seq=event.seq;}
  if(event.type==='error')failure=String(event.error||'The Modal generation could not finish.');
  if(event.type==='status'){status(event.message);if(event.progress)progress?.(event.progress);}
  if(event.type==='result')result=event.data as T;
 };
 const read=async(response:Response)=>{
  if(!response.body)return;
  const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
  try{
   for(;;){
    const {done,value}=await reader.read();signal.throwIfAborted();
    pending+=decoder.decode(value,{stream:!done});
    let newline:number;while((newline=pending.indexOf('\n'))>=0){receive(pending.slice(0,newline));pending=pending.slice(newline+1);}
    if(done){receive(pending);return;}
   }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 };
 // Stopping a job in the studio stops it on the GPU too; leaving the page does not.
 const cancel=()=>{if(id&&signal.reason!==LEAVING&&result===undefined&&failure===null)void fetch('/api/modal/jobs?id='+encodeURIComponent(id),{method:'DELETE',keepalive:true}).catch(()=>{});};
 signal.addEventListener('abort',cancel,{once:true});
 // Before reattaching, wait until the browser is back online, or back off after a
 // dropped connection. Only dropped connections count against the retries.
 let drops=0;
 const wait=async()=>{
  if(offline()){status('You are offline. This carries on by itself when you are back online…');await backOnline(signal);}
  else{
   if(drops>=8)throw new Error('The connection to Kiku dropped and could not be restored. Try again; your project is safe.');
   status('Connection dropped. Reconnecting…');await pause(Math.min(15000,1000*2**drops++),signal);
  }
  signal.throwIfAborted();
 };
 try{
  for(;;){
   if(response){
    await read(response).catch(error=>{if(signal.aborted)throw error;});
    if(failure!==null)throw new Error(failure);
    if(result!==undefined)break;
    if(!id)throw new Error('The connection to Kiku dropped before the job started. Try again; your project is safe.');
    await wait();
   }
   response=await fetch('/api/modal/jobs?id='+encodeURIComponent(id)+'&after='+seq,{signal,cache:'no-store'}).catch(error=>{if(signal.aborted)throw error;return null;});
   if(response?.status===401)throw new SignedOut('Sign in again to continue.');
   if(response?.status===404)throw new Error('Kiku restarted, or this finished too long ago, so the result was lost. Try again; your project is safe.');
   if(response?.ok)drops=0;else{response=null;await wait();}
  }
 }finally{signal.removeEventListener('abort',cancel);}
 progress?.({fraction:1,eta:0,queue:null,running:true});
 return result as T;
}

/**
 * Run a job on its Space and follow it to the result.
 *
 * A job that never reached the queue (the upload or queue join hit a gateway
 * error) is sent again. Once it is queued it is never resent, so a user is
 * never charged GPU time twice for one click.
 */
export async function runJob<T>(name:Job,input:Input,{signal,status,progress,job}:Call):Promise<T>{
 const spec=JOBS[name],picked=route(spec,input);
 if('error' in picked)throw new Error(picked.error);
 const {engine,model}=picked,built=spec.build(input,model);
 if('error' in built)throw new Error(built.error);
 const file=input instanceof FormData?input.get('audio'):null,audio=file instanceof Blob&&file.size?file:null;
 if(!audio&&(spec.audio??'required')==='required')throw new Error('There was no audio to send.');
 if(audio){
  const limits=spec.limits||{min:3,max:240},seconds=await wavSeconds(audio);
  if(audio.size>100*1024*1024)throw new Error('Select less audio. Uploads are limited to 100 MB.');
  if(seconds!==null&&seconds<limits.min-0.05)throw new Error(`Use at least ${limits.min} seconds of audio.`);
  if(seconds!==null&&seconds>limits.max+0.05)throw new Error(`The engine takes up to ${limits.max/60} minutes at once. Select a shorter part; nothing was submitted.`);
 }
 if(engine===YUE2)return runModal<T>(name,input,{signal,status,progress,job});
 const endpoint=typeof spec.endpoint==='function'?spec.endpoint(model):spec.endpoint;
 const token=await hfToken();
 const {handle_file}=await import('@gradio/client');
 const args=built.args(audio?handle_file(audio):null);
 let client:Client|undefined,result:unknown=null,received=false;
 try{
  for(let attempt=0;;attempt++){
   status(attempt?'Hugging Face hiccuped. Sending it again…':audio?'Sending your audio…':'Connecting to the studio…');
   client=await connect(engine,token,status,signal);
   signal.throwIfAborted();
   const job=client.submit(endpoint,args);
   const stop=()=>{void job.cancel();};
   signal.addEventListener('abort',stop,{once:true});
   let queued=false;
   try{
    for await(const event of job){
     if(signal.aborted)break;
     if(event.type==='status'){
      if(event.stage==='error')throw new Error(typeof event.message==='string'?event.message:'Generation failed.');
      queued=true;
      const step=event.progress_data?.find(p=>p.desc||p.progress!==null||p.length);
      const fraction=step?.progress??(step?.index!=null&&step.length?(step.index+1)/step.length:null);
      // Gradio says "pending" both while queued and while running; process_starts marks the switch.
      const running=(event as {original_msg?:string}).original_msg==='process_starts'||!!step||event.stage==='generating';
      progress?.({fraction:typeof fraction==='number'&&Number.isFinite(fraction)?Math.min(1,Math.max(0,fraction)):null,
       eta:typeof event.eta==='number'&&event.eta>0?event.eta:null,queue:!running&&typeof event.position==='number'?event.position:null,running});
      status(step?.desc||(event.stage==='pending'?(spec.waiting||'Waiting for an available GPU…'):'Working on your music…'));
     }
     if(event.type==='data'){received=true;result=spec.shape(event.data as unknown[],value=>asFile(engine,value),model);}
    }
    break;
   }catch(error){
    const message=error instanceof Error?error.message:String(error);
    if(queued||attempt>=2||signal.aborted||!PASSING.test(message))throw error;
    client.close();
    await pause(4000*(attempt+1),signal);
   }finally{signal.removeEventListener('abort',stop);}
  }
  signal.throwIfAborted();
  if(!received||!result)throw new Error('The engine returned nothing. Please try again.');
  progress?.({fraction:1,eta:0,queue:null,running:true});
  return result as T;
 }catch(error){
  if(signal.aborted||error instanceof SignedOut)throw error;
  const message=error instanceof Error?error.message:'Generation could not finish.';
  if(/\b401\b|unauthori[sz]ed|invalid.*token/i.test(message)){cached=null;throw new SignedOut('Sign in again to continue.');}
  throw new Error(explain(message).slice(0,600));
 }finally{client?.close();}
}

/**
 * Fetch a result file straight from the Space that made it. Hugging Face's
 * gateway drops some requests with a 5xx, so those are retried; the finished
 * job is not lost.
 */
export async function fetchResult(file:Download,signal:AbortSignal){
 for(let attempt=0;attempt<5;attempt++){
  if(attempt)await pause(2000*attempt,signal);
  signal.throwIfAborted();
  const response=await fetch(file.url,{signal}).catch(error=>{if(signal.aborted)throw error;return null;});
  // A download cut off partway ("network error") is fetched again from the start.
  if(response?.ok)try{return await response.arrayBuffer();}catch(error){if(signal.aborted)throw error;continue;}
  if(response?.status===404||response?.status===403)throw new Error('That file has expired. Run the step again.');
 }
 throw new Error('The result could not be downloaded. Try again; your project is safe.');
}

export function wavFile(buffer:AudioBuffer,name='selection.wav'){
 return new File([encodeWav(buffer)],name,{type:'audio/wav'});
}
