/**
 * The studio's project: tracks holding clips, each clip a window onto an
 * immutable audio buffer. Buffers are never edited in place — an edit makes a
 * new buffer and points the clip at it — so a project snapshot is cheap and
 * undo is just keeping old snapshots.
 */
/**
 * An AI result that can stand in for a stretch of other tracks. It sits on its
 * own track(s) right under its source; using it mutes that stretch of the
 * source (remembering which clips, in `hidden`) and setting it aside restores
 * them, so trying takes never destroys the original.
 */
export type Take={id:string;label:string;selected:boolean;source:{tracks:string[];start:number;end:number};hidden:string[];warnings:string[]};
export type Track={id:string;name:string;color:string;volume:number;pan:number;mute:boolean;solo:boolean;take?:Take};
export type Clip={
 id:string;trackId:string;
 /** Key into the buffer store. */
 buffer:string;
 /** Where the clip sits on the timeline, in seconds. */
 start:number;
 /** How far into its buffer the clip begins, and how much of it plays. */
 offset:number;duration:number;
 name:string;muted?:boolean;
 score?:{abc:string;lyrics:string;clock?:number[];beats?:number[]};
 generation?:{model:string;style:string;lyrics?:string;seed?:number;createdAt:string;sourceClips:string[];status?:string};
};
export type Chord={time:number;name:string};
export type Project={tracks:Track[];clips:Clip[];bpm:number;key:string;chords:Chord[]};
/** A stretch of time across one or more tracks, drawn with the range tool. */
export type Range={start:number;end:number;tracks:string[]};
export type Selection={clips:string[];range:Range|null};

export const COLORS=['#a28d19','#1b6eb7','#9564ba','#3e8d79','#b37043','#b4536b','#498d9b','#73844e'];
export const EMPTY:Project={tracks:[],clips:[],bpm:120,key:'',chords:[]};
export const MIN_CLIP=0.05;

export const uid=()=>crypto.randomUUID();
export const clipEnd=(clip:Clip)=>clip.start+clip.duration;
export const projectEnd=(project:Project)=>project.clips.reduce((end,clip)=>Math.max(end,clipEnd(clip)),0);

export function addTrack(project:Project,name:string,after?:string):[Project,Track]{
 const used=new Set(project.tracks.map(t=>t.color));
 const color=COLORS.find(c=>!used.has(c))||COLORS[project.tracks.length%COLORS.length];
 const track:Track={id:uid(),name,color,volume:1,pan:0,mute:false,solo:false};
 const tracks=[...project.tracks];
 const index=after?tracks.findIndex(t=>t.id===after):-1;
 tracks.splice(index<0?tracks.length:index+1,0,track);
 return [{...project,tracks},track];
}

/** Whether a track is heard, given every track's mute and solo. */
export function audible(project:Project,track:Track){
 const soloed=project.tracks.some(t=>t.solo);
 return soloed?track.solo:!track.mute;
}

/** Cut a clip in two at a timeline position; returns the ids of both halves. */
export function splitClip(project:Project,id:string,at:number):[Project,string[]]{
 const clip=project.clips.find(c=>c.id===id);
 if(!clip||at<=clip.start+MIN_CLIP||at>=clipEnd(clip)-MIN_CLIP)return [project,clip?[clip.id]:[]];
 const cut=at-clip.start;
 const left={...clip,duration:cut};
 const right={...clip,id:uid(),start:at,offset:clip.offset+cut,duration:clip.duration-cut};
 return [{...project,clips:project.clips.flatMap(c=>c.id===id?[left,right]:[c])},[left.id,right.id]];
}

/**
 * Mute exactly the part of each listed track that a range covers, splitting
 * clips at its edges. This is how a result that replaces a stretch of several
 * clips takes over without destroying what it replaced.
 */
export function muteRange(project:Project,range:Range){
 let next=project;
 for(const clip of project.clips.filter(c=>range.tracks.includes(c.trackId))){
  [next]=splitClip(next,clip.id,range.start);
 }
 for(const clip of next.clips.filter(c=>range.tracks.includes(c.trackId))){
  [next]=splitClip(next,clip.id,range.end);
 }
 return {...next,clips:next.clips.map(c=>range.tracks.includes(c.trackId)&&c.start>=range.start-1e-6&&clipEnd(c)<=range.end+1e-6
  ?{...c,muted:true}:c)};
}

/**
 * Where new takes of these tracks go: after the last of them, and after any
 * takes already made of them, so a source's takes stack underneath it.
 */
export function takeAnchor(project:Project,tracks:string[]){
 let anchor:string|undefined;
 for(const track of project.tracks)if(tracks.includes(track.id)||track.take?.source.tracks.some(id=>tracks.includes(id)))anchor=track.id;
 return anchor;
}

const overlaps=(a:Take['source'],b:Take['source'])=>a.start<b.end&&b.start<a.end&&a.tracks.some(id=>b.tracks.includes(id));

/**
 * Use a take in place of its source, or set it aside. Only one take of a
 * stretch plays at once, so using one sets aside any other covering it.
 */
export function selectTake(project:Project,id:string,on:boolean):Project{
 const take=project.tracks.find(t=>t.take?.id===id)?.take;
 if(!take||take.selected===on)return project;
 let next=project,hidden:string[]=[];
 if(on){
  const rivals=new Set(project.tracks.filter(t=>t.take&&t.take.id!==id&&t.take.selected&&overlaps(t.take.source,take.source)).map(t=>t.take!.id));
  for(const rival of rivals)next=selectTake(next,rival,false);
  const range={start:take.source.start,end:take.source.end,tracks:take.source.tracks};
  for(const clip of next.clips.filter(c=>range.tracks.includes(c.trackId)))[next]=splitClip(next,clip.id,range.start);
  for(const clip of next.clips.filter(c=>range.tracks.includes(c.trackId)))[next]=splitClip(next,clip.id,range.end);
  hidden=next.clips.filter(c=>range.tracks.includes(c.trackId)&&!c.muted&&c.start>=range.start-1e-6&&clipEnd(c)<=range.end+1e-6).map(c=>c.id);
  next={...next,clips:next.clips.map(c=>hidden.includes(c.id)?{...c,muted:true}:c)};
 }else next={...next,clips:next.clips.map(c=>take.hidden.includes(c.id)?{...c,muted:false}:c)};
 return {...next,tracks:next.tracks.map(t=>t.take?.id===id?{...t,mute:!on,take:{...t.take,selected:on,hidden}}:t)};
}

/** Clips on the given tracks that overlap a stretch of time. */
export function clipsIn(project:Project,range:Range){
 return project.clips.filter(c=>range.tracks.includes(c.trackId)&&c.start<range.end&&clipEnd(c)>range.start);
}

/** The one clip that covers a range on its own, if there is one: then an edit can go in place. */
export function soleClip(project:Project,range:Range){
 const inside=clipsIn(project,range);
 const clip=inside.length===1?inside[0]:null;
 return clip&&range.tracks.length===1&&clip.start<=range.start+1e-6&&clipEnd(clip)>=range.end-1e-6?clip:null;
}

/** Snap a time to the beat grid. */
export function snap(time:number,bpm:number,division:number){
 if(!division)return time;
 const step=60/bpm/division;
 return Math.max(0,Math.round(time/step)*step);
}

export function formatTime(seconds:number){
 const sign=seconds<0?'-':'';seconds=Math.abs(seconds);
 const m=Math.floor(seconds/60),s=Math.floor(seconds%60),ms=Math.floor((seconds%1)*1000);
 return `${sign}${m}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
}

/** Bars and beats, counted from one like a DAW's position display. */
export function formatBars(seconds:number,bpm:number){
 const beats=Math.max(0,seconds)*bpm/60;
 return `${Math.floor(beats/4)+1}.${Math.floor(beats%4)+1}.${String(Math.floor((beats%1)*100)).padStart(2,'0')}`;
}
