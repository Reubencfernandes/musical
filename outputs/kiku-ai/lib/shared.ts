import {commit,createRepo,downloadFile,repoExists,type CommitOperation,type RepoId} from '@huggingface/hub';
import {hfToken} from '@/lib/studio/engine';
import type {Song} from '@/lib/library';
import type {Meta} from '@/lib/jobs';

/**
 * Songs shared on Explore. Each user shares from a public dataset in their own
 * Hugging Face account, `<username>/kiku-ai-shared`, next to their private
 * library, so what they share stays theirs and Kiku AI holds no copy:
 *
 *   index.json                   who shared, and the songs in the order shared
 *   songs/<id>.mp3, <id>.webp    each song's audio and artwork
 *
 * Explore finds these datasets with Hugging Face's search and reads each
 * index. The owner shown is the dataset's namespace, which nobody else can
 * write to, so a song can never claim to be by someone else.
 */
export const SHARED='kiku-ai-shared';

export type Creator={handle:string;name?:string;avatar?:string};
/** A song as shared: what Explore shows, without the private library's bookkeeping. */
export type SharedEntry={id:string;title:string;caption:string;lyrics:string;instrumental:boolean;model:string;duration:number;
 createdAt:string;sharedAt:string;meta?:Meta;cover:boolean};
type Index={version:1;creator:Creator;songs:SharedEntry[]};
/** A song on Explore, with where to play it from and who made it. */
export type PublicSong=SharedEntry&{repo:string;creator:Creator;audio:string;art?:string};

const HUB='https://huggingface.co';
const status=(error:unknown)=>Number((error as {statusCode?:number})?.statusCode)||0;
const ID=/^[a-z0-9]{6,14}-[a-f0-9]{8}$/;
const file=(repo:string,path:string)=>`${HUB}/datasets/${repo}/resolve/main/${path}`;
/** The README that says what the dataset is, written when it is created. */
const CARD=(handle:string)=>`---\nlicense: other\ntags:\n- kiku-ai\n- music\npretty_name: Songs shared from Kiku AI\n---\n\n# Songs ${handle} shared from Kiku AI\n\nThese songs were made with [Kiku AI](https://reubencf-kiku-ai.hf.space) and shared on its Explore page. `
 +'Making a song private in Kiku AI removes it from here.\n';

let ready:Promise<RepoId>|null=null;
/** Forget the shared dataset, after a different user signs in. */
export function forgetShared(){ready=null;}
async function shared(handle:string){
 const accessToken=await hfToken(),repo:RepoId={type:'dataset',name:`${handle}/${SHARED}`};
 ready??=(async()=>{
  if(await repoExists({repo,accessToken}))return repo;
  try{await createRepo({repo,accessToken,visibility:'public',files:[{path:'README.md',content:new Blob([CARD(handle)])}]});}
  catch(error){if(status(error)!==409)throw error;}
  return repo;
 })().catch(error=>{ready=null;throw error;});
 return {repo:await ready,accessToken};
}
async function readIndex(repo:RepoId,accessToken:string,creator:Creator):Promise<Index>{
 try{
  const found=await downloadFile({repo,accessToken,path:'index.json'});
  const index=found?JSON.parse(await found.text()) as Index:null;
  if(index&&Array.isArray(index.songs))return {version:1,creator,songs:index.songs};
 }catch(error){if(status(error)!==404)throw error;}
 return {version:1,creator,songs:[]};
}
const json=(value:unknown)=>new Blob([JSON.stringify(value,null,1)],{type:'application/json'});
let writes:Promise<unknown>=Promise.resolve();
/** One change at a time, so two quick toggles never write over each other's index. */
function change<T>(work:()=>Promise<T>){const next=writes.catch(()=>{}).then(work);writes=next;return next;}

const entry=(song:Song,cover:boolean,sharedAt:string):SharedEntry=>({id:song.id,title:song.title,caption:song.caption,lyrics:song.lyrics,
 instrumental:song.instrumental,model:song.model,duration:song.duration,createdAt:song.createdAt,sharedAt,meta:song.meta,cover});

/** Share a song on Explore: its audio, artwork and words go to the user's public dataset. */
export function publishSong(song:Song,audio:Blob,cover:Blob|null,creator:Creator){
 return change(async()=>{
  const {repo,accessToken}=await shared(creator.handle);
  const index=await readIndex(repo,accessToken,creator);
  const sharedAt=index.songs.find(s=>s.id===song.id)?.sharedAt??new Date().toISOString();
  index.songs=[entry(song,!!cover,sharedAt),...index.songs.filter(s=>s.id!==song.id)];
  const operations:CommitOperation[]=[{operation:'addOrUpdate',path:`songs/${song.id}.mp3`,content:audio},
   ...(cover?[{operation:'addOrUpdate' as const,path:`songs/${song.id}.webp`,content:cover}]:[]),
   {operation:'addOrUpdate',path:'index.json',content:json(index)}];
  await commit({repo,accessToken,title:'Share '+song.title,operations});
 });
}
/** Update a shared song's title and words, leaving its audio as it is. */
export function updateShared(song:Song,creator:Creator){
 return change(async()=>{
  const {repo,accessToken}=await shared(creator.handle);
  const index=await readIndex(repo,accessToken,creator),known=index.songs.find(s=>s.id===song.id);
  if(!known)return;
  index.songs=index.songs.map(s=>s.id===song.id?entry(song,known.cover,known.sharedAt):s);
  await commit({repo,accessToken,title:'Update '+song.title,operations:[{operation:'addOrUpdate',path:'index.json',content:json(index)}]});
 });
}
/**
 * Make a song private again. Its files are deleted and the dataset's history is
 * squashed, so earlier commits no longer hold the audio either.
 */
export function unpublishSong(song:{id:string;title:string},creator:Creator){
 return change(async()=>{
  const {repo,accessToken}=await shared(creator.handle);
  const index=await readIndex(repo,accessToken,creator),known=index.songs.find(s=>s.id===song.id);
  index.songs=index.songs.filter(s=>s.id!==song.id);
  const operations:CommitOperation[]=[{operation:'addOrUpdate',path:'index.json',content:json(index)},
   {operation:'delete',path:`songs/${song.id}.mp3`},...(known?.cover?[{operation:'delete' as const,path:`songs/${song.id}.webp`}]:[])];
  try{await commit({repo,accessToken,title:'Make '+song.title+' private',operations});}
  // Deleting a file that is already gone fails the commit; the index alone still removes the song.
  catch{await commit({repo,accessToken,title:'Make '+song.title+' private',operations:operations.slice(0,1)});}
  await fetch(`${HUB}/api/datasets/${repo.name}/super-squash/main`,{method:'POST',
   headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},body:JSON.stringify({message:'Songs shared from Kiku AI'})}).catch(()=>{});
 });
}

const text=(value:unknown,max:number)=>typeof value==='string'?value.slice(0,max):'';
const picture=(value:unknown)=>typeof value==='string'&&/^https:\/\/(cdn-avatars\.huggingface\.co|huggingface\.co)\//.test(value)&&value.length<500?value:undefined;
/** Everything read from someone else's dataset is checked and trimmed before it is shown. */
function clean(repo:string,index:unknown):PublicSong[]{
 if(!index||typeof index!=='object'||!Array.isArray((index as Index).songs))return [];
 const handle=repo.split('/')[0],given=(index as Index).creator||{} as Creator;
 const creator:Creator={handle,name:text(given.name,100)||undefined,avatar:picture(given.avatar)};
 return (index as Index).songs.slice(0,200).filter(s=>s&&typeof s.id==='string'&&ID.test(s.id)&&typeof s.title==='string').map(s=>({
  id:s.id,title:text(s.title,80)||'Untitled song',caption:text(s.caption,2000),lyrics:text(s.lyrics,8000),instrumental:!!s.instrumental,
  model:text(s.model,20),duration:Number(s.duration)||0,createdAt:text(s.createdAt,40),sharedAt:text(s.sharedAt,40)||text(s.createdAt,40),
  meta:s.meta&&typeof s.meta==='object'?{bpm:Number(s.meta.bpm)||undefined,keyscale:text(s.meta.keyscale,20)||undefined}:undefined,
  cover:!!s.cover,repo,creator,audio:file(repo,`songs/${s.id}.mp3`),art:s.cover?file(repo,`songs/${s.id}.webp`):undefined,
 }));
}

const readShared=(repo:string,signal?:AbortSignal)=>fetch(file(repo,'index.json'),{signal,cache:'no-cache'})
 .then(r=>r.ok?r.json():null).then(index=>clean(repo,index)).catch(()=>[] as PublicSong[]);

/** The most recently shared songs from everyone, newest first. Anyone can read them; no sign-in needed. */
export async function listPublic(signal?:AbortSignal):Promise<PublicSong[]>{
 const search=await fetch(`${HUB}/api/datasets?search=${SHARED}&sort=lastModified&direction=-1&limit=60`,{signal,cache:'no-store'});
 if(!search.ok)throw new Error('Explore could not reach Hugging Face. Try again in a moment.');
 const repos=((await search.json()) as {id:string}[]).map(d=>d.id).filter(id=>/^[\w.-]+\/kiku-ai-shared$/.test(id));
 const found=await Promise.all(repos.map(repo=>readShared(repo,signal)));
 return found.flat().sort((a,b)=>b.sharedAt.localeCompare(a.sharedAt));
}
/** Everything one person has shared, newest first; empty when they have shared nothing. */
export function listShared(handle:string,signal?:AbortSignal):Promise<PublicSong[]>{
 return /^[\w.-]{1,96}$/.test(handle)?readShared(`${handle}/${SHARED}`,signal):Promise.resolve([]);
}
