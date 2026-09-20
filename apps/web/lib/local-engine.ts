import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {ScoreResult} from './types';
import {engineRun,engineError} from './engine-http';

/** Desktop builds run models on this computer through a loopback audio.cpp server. */
export const LOCAL_ENGINE=process.env.SCORE_BACKEND==='local';
const MODEL=process.env.LOCAL_TRANSCRIBE_MODEL||'sheetsage2';

export async function transcribeLocally(audio:File,send:(status:string)=>void,signal:AbortSignal):Promise<ScoreResult>{
 // The engine reads audio from disk, so hand it a private file it can open.
 const dir=await mkdtemp(path.join(tmpdir(),'score-engine-'));
 try{
  const wav=path.join(dir,'recording.wav');
  await writeFile(wav,new Uint8Array(await audio.arrayBuffer()));
  send('Listening and writing your score on this computer…');
  const {status,json}=await engineRun({model:MODEL,request:{audio:wav}},signal);
  const body=json as {text?:string}|null;
  if(status>=400){
   const detail=engineError(json);
   if(detail?.includes('unknown model id'))throw new Error('The transcription model is not installed on this computer yet.');
   throw new Error(detail?'The local music engine could not finish: '+detail:'The local music engine could not finish this recording.');
  }
  if(typeof body?.text!=='string'||!body.text.trim())throw new Error('No editable score was returned. Try another recording.');
  return {abc:body.text,status:'Transcribed on this computer.',downloads:[]};
 }finally{await rm(dir,{recursive:true,force:true});}
}
