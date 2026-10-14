import {createRepo,deleteFiles,downloadFile,listFiles,repoExists,uploadFiles,type RepoId} from '@huggingface/hub';
import {hfToken} from '@/lib/studio/engine';
import {encodeWav} from '@/lib/studio/audio';
import type {Project} from '@/lib/studio/model';
import type {Meta} from '@/lib/jobs';
import type {ScoreTiming} from '@/lib/types';
import {clearCovers} from '@/lib/song-covers';

/**
 * Each user's library: a private dataset in their own Hugging Face account,
 * `<username>/kiku-ai-library`, written straight from the browser with their
 * token. Their music stays theirs and in their storage; the app keeps no copy.
 *
 *   songs/<id>.json + songs/<id>.mp3        songs from Generate
 *   projects/<id>/project.json              a studio project
 *   projects/<id>/audio/<buffer>.wav        its audio, uploaded once per buffer
 *   scores/<id>.json + scores/<id>.mp3      a transcription and its recording
 *
 * The Flutter app has no MP3 encoder, so its songs and scores keep their audio
 * as FLAC or WAV and name the file in the JSON's `audio` field.
 */
export const LIBRARY='kiku-ai-library';

/** Saving needs the user's permission to create and write repos, asked for the first time. */
export class NeedsStorage extends Error{constructor(){super('Allow Kiku AI to save to your Hugging Face account.');}}

export type Song={id:string;title:string;caption:string;lyrics:string;instrumental:boolean;model:string;seed?:number;duration:number;createdAt:string;meta?:Meta;idea?:string;
 cover?:{model:'carlofkl/DreamLite-base';license:'CC-BY-NC-4.0';seed?:number};
 /** The audio's path when it is not songs/<id>.mp3 (songs saved by the Flutter app). */
 audio?:string};
export type SavedProject={id:string;name:string;createdAt:string;updatedAt:string;duration:number;tracks:number;project:Project;
 /** Buffer key to its file and shape, so the studio can rebuild the project. */
 audio:Record<string,{path:string}>};
export type SavedScore={id:string;title:string;createdAt:string;abc:string;timing?:ScoreTiming;duration:number;
 /** The recording's path when it is not scores/<id>.mp3 (scores saved by the Flutter app). */
 audio?:string};

const AUDIO_TYPES:Record<string,string>={mp3:'audio/mpeg',flac:'audio/flac',wav:'audio/wav',m4a:'audio/mp4',ogg:'audio/ogg'};
/** The audio file of a song or score: its own file in its folder, never a path elsewhere in the repo. */
function audioPath(folder:'songs'|'scores',item:{id:string;audio?:string}){
 const named=item.audio,extension=named?.split('.').pop()?.toLowerCase()||'';
 return named&&named===`${folder}/${item.id}.${extension}`&&AUDIO_TYPES[extension]?named:`${folder}/${item.id}.mp3`;
}

export const newId=()=>Date.now().toString(36)+'-'+crypto.randomUUID().slice(0,8);

let me:Promise<{handle:string;storage:boolean}>|null=null;
async function account(){
 me??=fetch('/api/auth',{cache:'no-store'}).then(r=>r.json()).then(d=>{if(!d.user)throw new Error('Sign in to use your library.');return {handle:String(d.user.handle||d.user.name),storage:!!d.user.storage};});
 return me.catch(error=>{me=null;throw error;});
}
/** Forget the cached account, after the user signs in again with more permissions. */
export function refreshAccount(){me=null;ready=null;clearCovers();}

const status=(error:unknown)=>Number((error as {statusCode?:number})?.statusCode)||0;
let ready:Promise<RepoId>|null=null;
/** The user's library repo, created private the first time something is saved. */
async function library(create:boolean):Promise<{repo:RepoId;accessToken:string}>{
 const [{handle},accessToken]=await Promise.all([account(),hfToken()]);
 const repo:RepoId={type:'dataset',name:`${handle}/${LIBRARY}`};
 if(!create)return {repo,accessToken};
 ready??=(async()=>{
  if(await repoExists({repo,accessToken}))return repo;
  try{await createRepo({repo,accessToken,visibility:'private'});}
  catch(error){if(status(error)===409)return repo;throw error;}
  return repo;
 })().catch(error=>{ready=null;throw error;});
 return {repo:await ready.catch(error=>{throw [401,403].includes(status(error))?new NeedsStorage():error;}),accessToken};
}
async function upload(files:{path:string;content:Blob}[],title:string){
 const {repo,accessToken}=await library(true);
 try{await uploadFiles({repo,accessToken,files,commitTitle:title});}
 catch(error){throw [401,403].includes(status(error))?new NeedsStorage():error;}
}
async function remove(paths:string[],title:string){
 const {repo,accessToken}=await library(true);
 try{await deleteFiles({repo,accessToken,paths,commitTitle:title});}
 catch(error){throw [401,403].includes(status(error))?new NeedsStorage():error;}
}
/** A file from the library, or null when it (or the library) does not exist yet. */
async function read(path:string){
 const {repo,accessToken}=await library(false);
 try{
  const file=await downloadFile({repo,accessToken,path});
  // Hub's WebBlob fetches lazily; native object URLs otherwise see an empty blob.
  return file?new Blob([await file.arrayBuffer()],{type:path.endsWith('.webp')?'image/webp':AUDIO_TYPES[path.split('.').pop()||'']||file.type}):null;
 }
 catch(error){if([401,403,404].includes(status(error)))return null;throw error;}
}
async function readJson<T>(path:string){const blob=await read(path);return blob?JSON.parse(await blob.text()) as T:null;}
/** Paths in one folder, newest first: ids start with their creation time. */
async function folder(path:string){
 const {repo,accessToken}=await library(false);
 const found:{path:string;type:string}[]=[];
 try{for await(const entry of listFiles({repo,accessToken,path}))found.push(entry);}
 catch(error){if([401,403,404].includes(status(error)))return [];throw error;}
 return found.sort((a,b)=>b.path.localeCompare(a.path));
}
const json=(value:unknown)=>new Blob([JSON.stringify(value,null,1)],{type:'application/json'});
const LIMIT=60;

/** Persist metadata, never page-only audio/image blobs or UI state. */
function songJson(song:Song){
 const {id,title,caption,lyrics,instrumental,model,seed,duration,createdAt,meta,idea,cover,audio}=song;
 return json({id,title,caption,lyrics,instrumental,model,seed,duration,createdAt,meta,idea,cover,audio});
}
const songWrites=new Map<string,Promise<unknown>>();
function writeSong<T>(id:string,work:()=>Promise<T>):Promise<T>{
 const pending=(songWrites.get(id)??Promise.resolve()).catch(()=>{}).then(work);
 songWrites.set(id,pending);void pending.finally(()=>{if(songWrites.get(id)===pending)songWrites.delete(id);}).catch(()=>{});
 return pending;
}
export async function saveSong(song:Song,audio:Blob,cover?:Blob){
 await writeSong(song.id,()=>upload([{path:`songs/${song.id}.json`,content:songJson(song)},{path:`songs/${song.id}.mp3`,content:audio},
  ...(cover?[{path:`songs/${song.id}.webp`,content:cover}]:[])],'Save song: '+song.title));
}
/** Merge into the latest metadata, preserving renames and never recreating a deleted song. */
export async function saveSongCover(song:Song,cover:Blob){
 await writeSong(song.id,async()=>{
  const current=await loadSong(song.id);if(!current)return;
  await upload([{path:`songs/${song.id}.json`,content:songJson({...current,cover:song.cover})},{path:`songs/${song.id}.webp`,content:cover}],'Save artwork: '+current.title);
 });
}
export async function listSongs(){
 const files=(await folder('songs')).filter(f=>f.path.endsWith('.json')).slice(0,LIMIT);
 return (await Promise.all(files.map(f=>readJson<Song>(f.path).catch(()=>null)))).filter((s):s is Song=>!!s);
}
export async function songAudio(song:{id:string;audio?:string}){return read(audioPath('songs',song));}
export async function songCover(id:string){return read(`songs/${id}.webp`);}
export async function loadSong(id:string){return readJson<Song>(`songs/${id}.json`);}
export async function deleteSong(song:Song){await writeSong(song.id,async()=>{
 const current=await loadSong(song.id);
 await remove([`songs/${song.id}.json`,audioPath('songs',current??song),...(current?.cover?[`songs/${song.id}.webp`]:[])],'Delete song: '+song.title);
});}
export async function renameSong(song:Song,title:string){await writeSong(song.id,async()=>{
 const current=await loadSong(song.id);if(!current)return;
 await upload([{path:`songs/${song.id}.json`,content:songJson({...current,title})}],'Rename song: '+title);
});}

/**
 * Save a studio project. Buffers never change once made, so each is uploaded
 * once; later saves send the project file and any new audio only.
 */
export async function saveProject(entry:Omit<SavedProject,'audio'>,buffers:Map<string,AudioBuffer>,uploaded:Set<string>){
 const keys=new Set(entry.project.clips.map(c=>c.buffer)),audio:SavedProject['audio']={},files:{path:string;content:Blob}[]=[];
 for(const key of keys){
  const path=`projects/${entry.id}/audio/${key}.wav`;audio[key]={path};
  const buffer=buffers.get(key);
  if(!uploaded.has(key)&&buffer)files.push({path,content:encodeWav(buffer)});
 }
 files.unshift({path:`projects/${entry.id}/project.json`,content:json({...entry,audio})});
 await upload(files,'Save project: '+entry.name);
 for(const key of keys)uploaded.add(key);
}
export async function listProjects(){
 const dirs=(await folder('projects')).filter(f=>f.type==='directory').slice(0,LIMIT);
 const found=await Promise.all(dirs.map(d=>readJson<SavedProject>(d.path+'/project.json').catch(()=>null)));
 return found.filter((p):p is SavedProject=>!!p).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}
export async function loadProject(id:string){return readJson<SavedProject>(`projects/${id}/project.json`);}
export async function projectAudio(path:string){return read(path);}
export async function deleteProject(entry:SavedProject){
 await remove([`projects/${entry.id}/project.json`,...Object.values(entry.audio).map(a=>a.path)],'Delete project: '+entry.name);
}

export async function saveScore(score:SavedScore,audio:Blob){
 await upload([{path:`scores/${score.id}.json`,content:json(score)},{path:`scores/${score.id}.mp3`,content:audio}],'Save score: '+score.title);
}
export async function listScores(){
 const files=(await folder('scores')).filter(f=>f.path.endsWith('.json')).slice(0,LIMIT);
 return (await Promise.all(files.map(f=>readJson<SavedScore>(f.path).catch(()=>null)))).filter((s):s is SavedScore=>!!s);
}
export async function loadScore(id:string){return readJson<SavedScore>(`scores/${id}.json`);}
export async function scoreAudio(score:{id:string;audio?:string}){return read(audioPath('scores',score));}
export async function deleteScore(score:SavedScore){await remove([`scores/${score.id}.json`,audioPath('scores',score)],'Delete score: '+score.title);}

/** Ask for permission to save, in a popup so nothing on the page is lost. */
export function allowSaving(next='/'){
 window.open(`/auth/login?popup=1&storage=1&next=${encodeURIComponent(next)}`,'kiku-sign-in','width=520,height=730');
}
