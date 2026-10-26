import {Client,handle_file} from '@gradio/client';
import {authorize} from '@/lib/auth';
import {YUE2,JOBS,route} from '@/lib/jobs';
import {modalEngine,modalFile} from '@/lib/modal-engine';
import {follow,jobOf,startJob} from '@/lib/modal-jobs';
export const runtime='nodejs';
export const maxDuration=1200;
/** A failure the engine explained itself; its message is meant for the user. */
class EngineError extends Error{}

/** Keep private Modal credentials on the server while streaming queue and GPU progress. The job outlives the connection; see modal-jobs. */
export async function POST(req:Request){
 const auth=await authorize(req);if(auth.error)return auth.error;
 const name=new URL(req.url).searchParams.get('job')||'';
 if(!Object.hasOwn(JOBS,name))return Response.json({error:'Unknown generation action.'},{status:400});
 const spec=JOBS[name];
 const limit=101*1024*1024;
 if(Number(req.headers.get('content-length'))>limit)return Response.json({error:'Select less audio. Uploads are limited to 100 MB.'},{status:413});
 let input:FormData,bytes=0,oversized=false;
 try{
  if(!req.body)throw new Error('Empty request');
  const bounded=req.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){
   bytes+=chunk.byteLength;
   if(bytes>limit){oversized=true;throw new Error('Upload too large');}
   controller.enqueue(chunk);
  }}));
  const init:RequestInit&{duplex:'half'}={method:'POST',headers:req.headers,body:bounded,duplex:'half'};
  input=await new Request(req.url,init).formData();
 }catch{return Response.json({error:oversized?'Select less audio. Uploads are limited to 100 MB.':'That request could not be read.'},{status:oversized?413:400});}
 const picked=route(spec,input);
 if('error' in picked)return Response.json(picked,{status:400});
 if(picked.engine!==YUE2)return Response.json({error:'This action does not use a Modal engine.'},{status:400});
 const built=spec.build(input,picked.model);
 if('error' in built)return Response.json(built,{status:400});
 const file=input.get('audio'),audio=file instanceof Blob&&file.size?file:null;
 if(!audio&&(spec.audio??'required')==='required')return Response.json({error:'There was no audio to send.'},{status:400});
 if(audio){
  if(audio.size>100*1024*1024)return Response.json({error:'Select less audio. Uploads are limited to 100 MB.'},{status:413});
  const head=new DataView(await audio.slice(0,44).arrayBuffer());
  if(head.byteLength>=44&&head.getUint32(0)===0x52494646&&head.getUint32(8)===0x57415645){
   const rate=head.getUint32(24,true),channels=head.getUint16(22,true),seconds=rate&&channels?(audio.size-44)/(rate*channels*2):0;
   const limits=spec.limits||{min:3,max:240};
   if(seconds<limits.min-.05||seconds>limits.max+.05)return Response.json({error:`Use between ${limits.min} and ${limits.max} seconds of audio.`},{status:400});
  }
 }
 let config:ReturnType<typeof modalEngine>;
 try{config=modalEngine('yue2');}catch{return Response.json({error:'The Modal GPU connection is not configured.'},{status:503});}
 const id=startJob(auth.session.user.id,async(send,cancelled)=>{
  const signal=AbortSignal.any([cancelled,AbortSignal.timeout(1200000)]);
  let client:Client|undefined,job:ReturnType<Client['submit']>|undefined;
  const stop=()=>{void job?.cancel().catch(()=>{});client?.close();};
  signal.addEventListener('abort',stop,{once:true});
  try{
   send({type:'status',message:'Starting Modal GPU…'});
   client=await Client.connect(config.engine.origin,{headers:config.headers,events:['status','data']});
   signal.throwIfAborted();
   const endpoint=typeof spec.endpoint==='function'?spec.endpoint(picked.model):spec.endpoint;
   job=client.submit(endpoint,built.args(audio?handle_file(audio):null));
   let received=false;
   for await(const event of job){
    signal.throwIfAborted();
    if(event.type==='status'){
     // The engine's own message (a gr.Error) says what to change, such as a section with no clear beat.
     if(event.stage==='error')throw new EngineError(typeof event.message==='string'?event.message.trim().slice(0,400):'');
     const step=event.progress_data?.find(p=>p.desc||p.progress!==null||p.length);
     const fraction=step?.progress??(step?.index!=null&&step.length?(step.index+1)/step.length:null);
     const running=(event as {original_msg?:string}).original_msg==='process_starts'||!!step||event.stage==='generating';
     send({type:'status',message:step?.desc||(running?'Working on your music on Modal…':'Waiting for the Modal GPU…'),progress:{
      fraction:typeof fraction==='number'&&Number.isFinite(fraction)?Math.min(1,Math.max(0,fraction)):null,
      eta:typeof event.eta==='number'&&event.eta>0?event.eta:null,
      queue:!running&&typeof event.position==='number'?event.position:null,running}});
    }
    if(event.type==='data'){
     const result=spec.shape(event.data as unknown[],value=>modalFile(config.engine,value,auth.session.user.id,config.model),picked.model);
     if(!result)throw new Error('No result');
     received=true;send({type:'result',data:result});
    }
   }
   if(!received)throw new Error('No result');
  }catch(error){
   send({type:'error',error:signal.aborted?'The Modal generation was cancelled or timed out.'
    :error instanceof EngineError&&error.message?error.message
    :'The Modal generation could not finish. Try again; your project is safe.'});
  }finally{signal.removeEventListener('abort',stop);client?.close();}
 });
 return follow(id,jobOf(id,auth.session.user.id)!,0);
}

/** Reattach to a running job after a dropped connection, from the last event the browser saw. */
export async function GET(req:Request){
 const auth=await authorize(req);if(auth.error)return auth.error;
 const params=new URL(req.url).searchParams,id=params.get('id')||'',entry=jobOf(id,auth.session.user.id);
 if(!entry)return Response.json({error:'That generation is no longer running here.'},{status:404});
 return follow(id,entry,Number(params.get('after'))||0);
}

/** Cancel a job the user stopped. */
export async function DELETE(req:Request){
 const auth=await authorize(req);if(auth.error)return auth.error;
 jobOf(new URL(req.url).searchParams.get('id')||'',auth.session.user.id)?.cancel();
 return new Response(null,{status:204});
}
