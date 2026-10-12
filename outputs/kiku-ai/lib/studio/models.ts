/**
 * The generation models the studio offers, and which jobs each can do.
 * Both ACE-Steps edit audio directly. YuE2 plays scores: it covers a stretch
 * from the melody and chords SheetSage2 reads out of it, but cannot edit a
 * stretch in place. Stem splitting is Demucs whatever is picked.
 */
export type Model='ace15'|'ace1'|'yue2';
export type Task='restyle'|'rewrite'|'extend'|'part'|'instrumental'|'song'|'cover';

export const MODELS:{id:Model;label:string;blurb:string}[]=[
 {id:'ace15',label:'ACE-Step 1.5',blurb:'Generates songs, instrumentals and individual parts, and edits audio directly.'},
 {id:'yue2',label:'YuE2',blurb:'Plans and performs scores. New vocal covers and instrumental melodies.'},
 {id:'ace1',label:'ACE-Step 1',blurb:'The original engine.'},
];

export const SUPPORTS:Record<Task,Model[]>={
 restyle:['ace15','ace1'],rewrite:['ace15','ace1'],extend:['ace15','ace1'],
 part:['ace15','ace1'],instrumental:['ace15','yue2','ace1'],song:['ace15','yue2'],cover:['yue2'],
};

/** The model a job starts on before the user picks one. */
export const PREFERRED:Partial<Record<Task,Model>>={cover:'yue2'};

export const modelLabel=(model:Model)=>MODELS.find(m=>m.id===model)!.label;
export function modelOf(value:unknown):Model{return value==='ace1'||value==='yue2'?value:'ace15';}
/** The chosen model if it can do the task, otherwise the first one that can. */
export const modelFor=(task:Task,chosen:Model)=>SUPPORTS[task].includes(chosen)?chosen:SUPPORTS[task][0];
