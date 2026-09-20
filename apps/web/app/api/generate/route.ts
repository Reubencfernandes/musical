import {authorize} from '@/lib/auth';
import {LOCAL_ENGINE} from '@/lib/local-engine';
import {engineRun,engineError} from '@/lib/engine-http';
import {saveSong,LIBRARY_DIR} from '@/lib/library';
export const runtime='nodejs';
// The model writes 25 audio tokens for every second of music.
const TOKENS_PER_SECOND=25,MIN_SECONDS=10,MAX_SECONDS=180;
const MODEL=process.env.LOCAL_GENERATE_MODEL||'yue2';

export async function GET(){
 return Response.json({available:LOCAL_ENGINE,minSeconds:MIN_SECONDS,maxSeconds:MAX_SECONDS,library:LOCAL_ENGINE?LIBRARY_DIR:null},{headers:{'Cache-Control':'no-store'}});
}

export async function POST(req:Request){
 const auth=await authorize(req);if(auth.error)return auth.error;
 if(!LOCAL_ENGINE)return Response.json({error:'Music generation runs in the Kiku Studio desktop app.'},{status:501});
 const input=await req.json().catch(()=>null) as {title?:unknown;style?:unknown;lyrics?:unknown;seconds?:unknown;melody?:unknown;keepScore?:unknown;seed?:unknown}|null;
 const style=typeof input?.style==='string'?input.style.trim().slice(0,2000):'';
 const lyrics=typeof input?.lyrics==='string'?input.lyrics.trim().slice(0,12000):'';
 const melody=typeof input?.melody==='string'?input.melody.trim().slice(0,20000):'';
 const seconds=Math.round(Number(input?.seconds));
 if(!style||!lyrics)return Response.json({error:'Describe the style and add some lyrics first.'},{status:400});
 if(!Number.isFinite(seconds)||seconds<MIN_SECONDS||seconds>MAX_SECONDS)return Response.json({error:`Choose a length between ${MIN_SECONDS} seconds and ${MAX_SECONDS/60} minutes.`},{status:400});
 const seed=Number.isInteger(input?.seed)?Number(input!.seed):Math.floor(Math.random()*2**31);
 const title=(typeof input?.title==='string'&&input.title.trim()?input.title.trim():lyrics.split('\n').find(line=>line.trim()&&!line.trim().startsWith('['))||'Untitled').slice(0,80);

 const enc=new TextEncoder(),work=new AbortController();let closed=false;
 const stream=new ReadableStream({
  async start(controller){
   const send=(type:string,data:unknown)=>{if(!closed)controller.enqueue(enc.encode(JSON.stringify({type,data})+'\n'));};
   const abort=()=>{closed=true;work.abort();};req.signal.addEventListener('abort',abort,{once:true});
   const started=Date.now();
   // Long jobs send nothing for minutes; a heartbeat keeps the connection visibly alive.
   const beat=setInterval(()=>send('status',melody?'Arranging your score on this computer…':'Composing and rendering on this computer…'),15000);
   try{
    send('status','Loading the music model…');
    // Upstream's two symbolic routes: a cover keeps only the tune and lets the model
    // rewrite the arrangement, while an edited score is rendered as written.
    const options:Record<string,string>={style,seed:String(seed),cot:melody&&!input?.keepScore?'melody':'full',
     semantic_max_tokens:String(seconds*TOKENS_PER_SECOND),
     // The planner writes the melody first; longer songs need a longer plan.
     abc_max_tokens:String(Math.min(4096,Math.max(512,seconds*20)))};
    if(melody)options.abc=melody;
    const {status,json}=await engineRun({model:MODEL,request:{text:lyrics,options}},work.signal);
    if(status>=400||typeof json?.audio!=='string'){
     const detail=engineError(json);
     if(detail?.includes('unknown model id'))throw new Error('The music model is not installed on this computer yet.');
     throw new Error(detail?'The music engine could not finish: '+detail:'The music engine could not finish this song.');
    }
    const timing=json.timing as {audio_duration_ms?:number}|undefined;
    const artifacts=Array.isArray(json.artifacts)?json.artifacts as {id?:string;payload?:string}[]:[];
    const score=artifacts.find(a=>a.id==='score')?.payload;
    const song=await saveSong({title,style,lyrics,seed,requestedSeconds:seconds,followsMelody:!!melody,
     seconds:Math.round((timing?.audio_duration_ms||0)/100)/10,elapsedMs:Date.now()-started},
     Buffer.from(json.audio,'base64'),score?Buffer.from(score,'base64').toString('utf8'):undefined);
    send('result',song);
   }catch(error){
    if(!closed)send('error',(error instanceof Error?error.message:'The song could not be made.').slice(0,600));
   }finally{clearInterval(beat);req.signal.removeEventListener('abort',abort);if(!closed)controller.close();}
  },cancel(){closed=true;work.abort();}
 });
 return new Response(stream,{headers:{'Content-Type':'application/x-ndjson','Cache-Control':'no-store','X-Accel-Buffering':'no'}});
}
