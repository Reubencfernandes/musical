import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const run=promisify(execFile);

/** Decode the entire input and measure it server-side; never trust client duration. */
export async function prepareAudio(input:File,signal:AbortSignal){
 const dir=await mkdtemp(path.join(tmpdir(),'score-audio-'));
 try{
  const source=path.join(dir,'source'),wav=path.join(dir,'audio.wav');
  await writeFile(source,new Uint8Array(await input.arrayBuffer()));
  // One extra second detects overlong recordings without decoding unbounded input.
  await run('ffmpeg',['-nostdin','-v','error','-protocol_whitelist','file,pipe','-format_whitelist','wav,mp3,mov,matroska,webm,ogg,flac,aac,aiff','-i',source,'-map','0:a:0','-vn','-t','601','-ac','1','-ar','24000','-y',wav],{windowsHide:true,timeout:90000,signal,maxBuffer:1024*1024});
  const {stdout}=await run('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',wav],{windowsHide:true,timeout:15000,signal});
  const duration=Number(stdout.trim());
  if(!Number.isFinite(duration)||duration<5)throw new Error('Use a recording with at least five seconds of audio.');
  if(duration>600)throw new Error('This recording is longer than the current ten-minute limit. Nothing was cut or submitted.');
  const bytes=await readFile(wav);
  return {audio:new File([new Uint8Array(bytes)],'recording.wav',{type:'audio/wav'}),duration};
 }catch(error){
  if(error instanceof Error&&(/five seconds|ten-minute/.test(error.message)||error.name==='AbortError'))throw error;
  throw new Error('This recording could not be read. Try an MP3, WAV, M4A, OGG, or FLAC file.');
 }finally{await rm(dir,{recursive:true,force:true});}
}
