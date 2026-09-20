import {Client,handle_file} from '../apps/web/node_modules/@gradio/client/dist/index.js';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
const token=(await readFile(path.join(homedir(),'.cache/huggingface/token'),'utf8')).trim();
const bytes=await readFile('work/api-test-media/audio.wav');
const duration=275;
console.log('Connecting to the dedicated API. Full recording:',Math.round(duration),'seconds.');
const client=await Client.connect('Reubencf/Score-Studio-API',{token,events:['status','data']});
const job=client.submit('/transcribe',[handle_file(new File([bytes],'music.wav',{type:'audio/wav'})),0,Math.min(duration,275),false,true]);
const timeout=setTimeout(()=>{job.cancel();console.error('API timeout');process.exitCode=1;},600000);
let result;
try{
 for await(const event of job){
  if(event.type==='status'){
   console.log(event.stage,event.progress_data?.map(p=>p.desc).filter(Boolean).join(' ')||'');
   if(event.stage==='error')throw new Error(event.message||'API failed');
  }
  if(event.type==='data'&&event.data[5]?.trim())result=event.data;
 }
 if(!result)throw new Error('No notation returned.');
 await writeFile('work/dedicated-api-result.json',JSON.stringify(result,null,2));
 const files=result[4];
 if(!result[2]?.url||!result[3]?.url||!files?.some(f=>/\.mid$/i.test(f.orig_name||f.path)))throw new Error('Missing PDF, piano audio or MIDI.');
 const pdf=await fetch(result[2].url);const pdfBytes=new Uint8Array(await pdf.arrayBuffer());
 if(new TextDecoder().decode(pdfBytes.slice(0,4))!=='%PDF')throw new Error('Invalid PDF');
 console.log('PASS: full song returned editable ABC, score pages, PDF, MIDI, piano audio and downloads. ABC characters:',result[5].length);
}finally{clearTimeout(timeout);client.close();}
