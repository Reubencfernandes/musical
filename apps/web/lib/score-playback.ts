import type {TuneObject} from 'abcjs';
import {instruments} from './instruments';

type Note={pitch:number;start:number;end:number;volume:number;cents:number};
export type Playback={duration:number;start:(context:AudioContext,destination:AudioNode,offset:number,onEnd:()=>void)=>{stop:()=>void}};

/** Cache small reusable samples, never a rendered copy of the entire recording. */
export class SampleCache {
 private samples=new Map<string,AudioBuffer>();
 private pending=new Map<string,Promise<AudioBuffer>>();
 private bytes=0;
 async load(context:AudioContext,bank:string,pitch:number){
  const key=`${bank}:${pitch}`,cached=this.samples.get(key);
  if(cached){this.samples.delete(key);this.samples.set(key,cached);return cached;}
  const pending=this.pending.get(key);if(pending)return pending;
  const name=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'][pitch%12]+(Math.floor(pitch/12)-1);
  const request=(async()=>{
   const response=await fetch(`/soundfonts/${bank}-mp3/${name}.mp3`,{signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw new Error('Instrument sounds could not load. Please try again.');
   const sample=await context.decodeAudioData(await response.arrayBuffer());
   const size=sample.length*sample.numberOfChannels*4;
   while(this.bytes+size>64*1024*1024&&this.samples.size){
    const oldest=this.samples.keys().next().value!,value=this.samples.get(oldest)!;
    this.bytes-=value.length*value.numberOfChannels*4;this.samples.delete(oldest);
   }
   this.samples.set(key,sample);this.bytes+=size;return sample;
  })();
  this.pending.set(key,request);
  try{return await request;}finally{this.pending.delete(key);}
 }
}

export async function prepareScore(context:AudioContext,tune:TuneObject,program:number,speed:number,cache:SampleCache,isCurrent=()=>true):Promise<Playback>{
 const bank=instruments.find(item=>item.program===program)?.sample;
 if(!bank)throw new Error('Unsupported instrument.');
 const sequence=tune.setUpAudio({program}),meter=tune.getMeterFraction();
 const seconds=tune.millisecondsPerMeasure()*100/speed/1000/(meter.den?meter.num/meter.den:1);
 const notes:Note[]=sequence.tracks.flatMap(track=>track.flatMap(event=>{
  if(event.cmd!=='note'||event.duration<=0)return [];
  const gap=Math.min(event.gap||0,event.duration*2/3);
  return [{pitch:event.pitch,start:event.start*seconds,end:(event.start+event.duration-gap)*seconds,volume:event.volume/96,cents:('cents' in event?Number(event.cents):0)||0}];
 })).sort((a,b)=>a.start-b.start);
 const samples=new Map<number,AudioBuffer>();
 const pitches=[...new Set(notes.map(note=>note.pitch))];
 let next=0;
 await Promise.all(Array.from({length:Math.min(8,pitches.length)},async()=>{
  while(next<pitches.length&&isCurrent()){const pitch=pitches[next++];samples.set(pitch,await cache.load(context,bank,pitch));}
 }));
 if(!isCurrent())throw new Error('Playback selection changed.');
 const duration=sequence.totalDuration*seconds+.2;
 return {duration,start(ctx,destination,offset,onEnd){
  const origin=ctx.currentTime-offset,active=new Set<AudioBufferSourceNode>();
  let index=0,stopped=false;
  while(index<notes.length&&notes[index].end+.2<=offset)index++;
  const tick=()=>{
   if(stopped)return;
   const now=ctx.currentTime,position=now-origin;
   while(index<notes.length&&notes[index].start<position+1){
    const note=notes[index++],sample=samples.get(note.pitch)!;
    const elapsed=Math.max(0,position-note.start),rate=2**(note.cents/1200);
    if(note.end+.2<=position||elapsed*rate>=sample.duration)continue;
    const source=ctx.createBufferSource(),envelope=ctx.createGain();
    source.buffer=sample;source.playbackRate.value=rate;
    const when=Math.max(now,origin+note.start),end=origin+note.end;
    envelope.gain.setValueAtTime(note.volume*Math.min(1,Math.max(0,(end+.2-when)/.2)),when);
    if(end>when)envelope.gain.setValueAtTime(note.volume,end);
    envelope.gain.linearRampToValueAtTime(0,Math.max(when+.001,end+.2));
    source.connect(envelope);envelope.connect(destination);active.add(source);
    source.onended=()=>{active.delete(source);source.disconnect();envelope.disconnect();};
    source.start(when,elapsed*rate);source.stop(Math.max(when+.001,end+.2));
   }
   if(position>=duration){stop();onEnd();}
  };
  const timer=setInterval(tick,100);
  function stop(){stopped=true;clearInterval(timer);for(const source of active){source.stop();}active.clear();}
  tick();return {stop};
 }};
}
