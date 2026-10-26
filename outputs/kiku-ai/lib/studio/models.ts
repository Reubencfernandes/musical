/**
 * The generation models the studio offers, and which jobs each can do.
 * ACE-Step edits audio directly. YuE2-Turbo plays scores: it covers a stretch
 * from the melody and chords SheetSage2 reads out of it, but cannot edit a
 * stretch in place. Stem splitting is Demucs whatever is picked. ACE-Step 1.5
 * is no longer offered; songs saved with it still show its name (see SongList).
 */
export type Model='ace1'|'yue2';
export type Task='restyle'|'rewrite'|'extend'|'part'|'instrumental'|'song'|'cover';

export const MODELS:{id:Model;label:string;blurb:string}[]=[
 {id:'yue2',label:'YuE2-Turbo',blurb:'Songs, instrumentals and covers. Plans and performs scores.'},
 {id:'ace1',label:'ACE-Step',blurb:'Edits audio directly: restyle, rewrite, extend and new parts.'},
];

export const SUPPORTS:Record<Task,Model[]>={
 restyle:['ace1'],rewrite:['ace1'],extend:['ace1'],
 part:['ace1'],instrumental:['yue2','ace1'],song:['yue2'],cover:['yue2'],
};

/** The model a job starts on before the user picks one. */
export const PREFERRED:Partial<Record<Task,Model>>={cover:'yue2'};

export const modelLabel=(model:Model)=>MODELS.find(m=>m.id===model)!.label;
/** A model named in a request, or null for one no longer offered (such as ACE-Step 1.5). */
export function modelOf(value:unknown):Model|null{return value==='ace1'||value==='yue2'?value:null;}
/** The chosen model if it can do the task, otherwise the first one that can. */
export const modelFor=(task:Task,chosen:Model)=>SUPPORTS[task].includes(chosen)?chosen:SUPPORTS[task][0];
