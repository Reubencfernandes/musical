import {randomUUID} from 'node:crypto';

/**
 * Modal jobs outlive the browser connection that started them. Hugging Face's
 * proxy drops long streams now and then, browsers go offline and pages get
 * refreshed; the job keeps running here and the browser reattaches with the
 * job ID (the studio and Generate page keep it locally), picking up the events
 * it missed, rather than losing a generation that was nearly done. Jobs live
 * in this server's memory, so a restart (a new deployment) still loses the
 * ones in flight.
 */
type Entry={owner:string;events:string[];done:boolean;listeners:Set<()=>void>;cancel:()=>void;detached:number|null;finished:number|null};
export type Push=(event:Record<string,unknown>)=>void;

const KEEP=60*60*1000,ORPHAN=15*60*1000;
const store=globalThis as typeof globalThis&{kikuModalJobs?:Map<string,Entry>;kikuModalSweep?:ReturnType<typeof setInterval>};
const jobs=store.kikuModalJobs??=new Map<string,Entry>();
// Finished jobs are kept an hour, so a page reopened later still gets its result; a
// job nobody has followed for fifteen minutes (the tab was closed for good) is
// cancelled to free the GPU.
store.kikuModalSweep??=setInterval(()=>{
 const now=Date.now();
 for(const [id,entry] of jobs){
  if(entry.finished&&now-entry.finished>KEEP)jobs.delete(id);
  else if(!entry.done&&!entry.listeners.size&&entry.detached&&now-entry.detached>ORPHAN)entry.cancel();
 }
},30000);

export function startJob(owner:string,run:(push:Push,signal:AbortSignal)=>Promise<void>):string{
 const id=randomUUID(),abort=new AbortController();
 const entry:Entry={owner,events:[],done:false,listeners:new Set(),cancel:()=>abort.abort(),detached:Date.now(),finished:null};
 jobs.set(id,entry);
 const push:Push=event=>{if(entry.done)return;entry.events.push(JSON.stringify({...event,seq:entry.events.length+1}));for(const listener of entry.listeners)listener();};
 void run(push,abort.signal).catch(()=>{}).finally(()=>{entry.done=true;entry.finished=Date.now();for(const listener of entry.listeners)listener();});
 return id;
}

/** The job, only for the user who started it. */
export function jobOf(id:string,owner:string){const entry=jobs.get(id);return entry&&entry.owner===owner?entry:null;}

/** Stream a job's events after `after`, then live ones, as NDJSON, with a heartbeat so idle proxies keep the connection. */
export function follow(id:string,entry:Entry,after:number){
 const encoder=new TextEncoder();
 let closed=false,cleanup=()=>{};
 const stream=new ReadableStream<Uint8Array>({
  start(controller){
   let sent=Math.max(0,Math.min(after,entry.events.length));
   const write=(line:string)=>{if(!closed)controller.enqueue(encoder.encode(line+'\n'));};
   const flush=()=>{
    while(sent<entry.events.length)write(entry.events[sent++]);
    if(entry.done&&!closed){cleanup();closed=true;controller.close();}
   };
   const heartbeat=setInterval(()=>write('{"type":"heartbeat"}'),15000);
   cleanup=()=>{clearInterval(heartbeat);entry.listeners.delete(flush);if(!entry.listeners.size)entry.detached=Date.now();};
   write(JSON.stringify({type:'job',id}));
   entry.listeners.add(flush);entry.detached=null;flush();
  },
  cancel(){closed=true;cleanup();},
 });
 return new Response(stream,{headers:{'Content-Type':'application/x-ndjson','Cache-Control':'private, no-store','X-Accel-Buffering':'no'}});
}
