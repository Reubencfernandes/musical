import {Client,handle_file} from '@gradio/client';
import type {ScoreResult,Download} from '@/lib/types';
import {prepareAudio} from '@/lib/audio';
import {authorize} from '@/lib/auth';
export const runtime='nodejs';
const SPACE=process.env.HF_API_SPACE||'Reubencf/Score-Studio-API';
const ORIGIN=process.env.HF_API_ORIGIN||'https://reubencf-score-studio-api.hf.space';
function file(value:unknown):Download|null {
 if(!value||typeof value!=='object')return null;
 const data=value as {url?:string;path?:string;orig_name?:string};
 const url=data.url||(data.path?ORIGIN+'/gradio_api/file='+data.path:'');
 try{if(new URL(url).origin!==ORIGIN)return null;}catch{return null;}
 return {url,name:data.orig_name||data.path?.split('/').pop()||'download'};
}
export async function POST(req:Request){
 const auth=await authorize(req);if(auth.error)return auth.error;
 if(Number(req.headers.get('content-length')||0)>102*1024*1024)return Response.json({error:'Choose an audio file under 100 MB.'},{status:413});
 const form=await req.formData().catch(()=>null);
 const input=form?.get('audio');
 if(!(input instanceof File)||input.size>100*1024*1024||!input.size)
  return Response.json({error:'Choose an audio file under 100 MB.'},{status:400});
 const enc=new TextEncoder();let cancelJob:(()=>void)|undefined,closed=false,client:Client|undefined;
 const preparation=new AbortController();
 const stream=new ReadableStream({
  async start(controller){
   const send=(type:string,data:unknown)=>{if(!closed)controller.enqueue(enc.encode(JSON.stringify({type,data})+'\n'));};
   const abort=()=>{closed=true;preparation.abort();cancelJob?.();client?.close();};req.signal.addEventListener('abort',abort,{once:true});
   try{
    if(req.signal.aborted){abort();return;}
    send('status','Reading the full recording…');
    const {audio,duration}=await prepareAudio(input,preparation.signal);
    if(closed)return;
    send('status','Connecting to the transcription studio…');
    client=await Client.connect(SPACE,{events:['status','data'],token:auth.session.token as `hf_${string}`});
    if(req.signal.aborted||closed){client.close();return;}
    const job=client.submit('/transcribe',[handle_file(audio),0,duration,false,true]);
    cancelJob=()=>{job.cancel();};let result:ScoreResult|null=null;
    for await(const event of job){
     if(closed)break;
     if(event.type==='status'){
      if(event.stage==='error')throw new Error(typeof event.message==='string'?event.message:'Conversion failed. Please try again.');
      const details=event as unknown as {progress_data?:{desc?:string}[];position?:number};
      send('status',details.progress_data?.find(p=>p.desc)?.desc|| (event.stage==='pending'?'Waiting for an available GPU…':'Listening and writing your score…'));
     }
     if(event.type==='data'){
      const data=event.data as unknown[];
      if(typeof data[5]==='string'&&data[5].trim()){
       result={abc:data[5],status:String(data[0]),downloads:Array.isArray(data[4])?data[4].map(file).filter((d):d is Download=>!!d):[],pdf:file(data[2])?.url,audio:file(data[3])?.url};
      }
     }
    }
    if(!closed){if(!result)throw new Error('No editable score was returned. Try another recording.');send('result',result);}
   }catch(error){
    let message=error instanceof Error?error.message:'Conversion could not finish. Please try again.';
    if(/quota|GPU.*duration|exceeded/i.test(message))message='Your Hugging Face processing allowance is unavailable for this recording. Try a shorter recording or wait for your allowance to reset.';
    send('error',message.slice(0,600));
   }finally{client?.close();req.signal.removeEventListener('abort',abort);if(!closed)controller.close();}
  },cancel(){closed=true;preparation.abort();cancelJob?.();client?.close();}
 });
 return new Response(stream,{headers:{'Content-Type':'application/x-ndjson','Cache-Control':'no-store','X-Accel-Buffering':'no'}});
}
