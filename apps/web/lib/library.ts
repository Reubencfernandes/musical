import {mkdir,readdir,readFile,writeFile,stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';

/** Everything the desktop app makes is kept on this computer, one folder per song. */
export const LIBRARY_DIR=process.env.KIKU_LIBRARY_DIR||path.join(homedir(),'Music','Kiku Studio');
export type Song={id:string;title:string;style:string;lyrics:string;seconds:number;requestedSeconds:number;created:string;elapsedMs:number;seed:number;hasScore:boolean;followsMelody:boolean};

const ID=/^\d{8}-\d{6}-[a-z0-9]{4}$/;
export function songDir(id:string){
 if(!ID.test(id))throw new Error('Unknown song.');
 return path.join(LIBRARY_DIR,id);
}

export async function saveSong(song:Omit<Song,'id'|'created'|'hasScore'>,wav:Buffer,abc?:string):Promise<Song>{
 const now=new Date(),pad=(n:number)=>String(n).padStart(2,'0');
 const id=`${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${Math.random().toString(36).slice(2,6).padEnd(4,'0')}`;
 const dir=songDir(id),saved:Song={...song,id,created:now.toISOString(),hasScore:!!abc?.trim()};
 await mkdir(dir,{recursive:true});
 await writeFile(path.join(dir,'song.wav'),wav);
 if(saved.hasScore)await writeFile(path.join(dir,'score.abc'),abc!);
 // Written last: a folder without it is an unfinished save and is never listed.
 await writeFile(path.join(dir,'song.json'),JSON.stringify(saved,null,2));
 return saved;
}

export async function listSongs():Promise<Song[]>{
 const names=await readdir(LIBRARY_DIR).catch(()=>[] as string[]);
 const songs=await Promise.all(names.filter(name=>ID.test(name)).map(async name=>{
  try{return JSON.parse(await readFile(path.join(LIBRARY_DIR,name,'song.json'),'utf8')) as Song;}catch{return null;}
 }));
 return songs.filter((song):song is Song=>!!song).sort((a,b)=>b.created.localeCompare(a.created));
}

export async function songFile(id:string,kind:'audio'|'score'){
 const file=path.join(songDir(id),kind==='audio'?'song.wav':'score.abc');
 return {file,size:(await stat(file)).size};
}
