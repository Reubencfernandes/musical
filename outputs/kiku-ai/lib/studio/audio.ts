import {type Clip,type Project,audible,clipEnd} from './model';

/** Rate for audio sent to the engine. ACE-Step works at 44.1 kHz, so more would only cost upload time. */
export const RENDER_RATE=44100;
const FADE=0.04;

/** Copy part of a buffer, in seconds. */
export function sliceBuffer(source:AudioBuffer,from:number,to:number){
 const rate=source.sampleRate;
 const a=Math.max(0,Math.floor(from*rate)),b=Math.min(source.length,Math.max(a+1,Math.floor(to*rate)));
 const out=new AudioBuffer({length:b-a,numberOfChannels:source.numberOfChannels,sampleRate:rate});
 for(let ch=0;ch<source.numberOfChannels;ch++)out.copyToChannel(source.getChannelData(ch).subarray(a,b),ch);
 return out;
}

/**
 * Lay `insert` over `base` starting at `at` seconds, with equal-power
 * crossfades at both joins so the seam is inaudible. The model's version of
 * the surrounding audio never quite matches the original, which is why only
 * the edited stretch is taken from it.
 */
export function spliceBuffer(base:AudioBuffer,at:number,insert:AudioBuffer,fade=FADE){
 const rate=base.sampleRate,start=Math.max(0,Math.round(at*rate));
 const length=Math.max(base.length,start+insert.length),channels=Math.max(base.numberOfChannels,insert.numberOfChannels);
 const out=new AudioBuffer({length,numberOfChannels:channels,sampleRate:rate});
 const edge=Math.min(Math.round(fade*rate),Math.floor(insert.length/2));
 for(let ch=0;ch<channels;ch++){
  const target=out.getChannelData(ch);
  const old=base.getChannelData(Math.min(ch,base.numberOfChannels-1));
  const fresh=insert.getChannelData(Math.min(ch,insert.numberOfChannels-1));
  target.set(old);
  for(let i=0;i<insert.length;i++){
   const j=start+i,prior=j<old.length?old[j]:0;
   let mixIn=1;
   if(i<edge)mixIn=i/edge;
   else if(i>=insert.length-edge&&j<old.length)mixIn=(insert.length-i)/edge;
   const angle=mixIn*Math.PI/2;
   target[j]=fresh[i]*Math.sin(angle)+prior*Math.cos(angle);
  }
 }
 return out;
}

/** Resample through an offline context; the engine's 48 kHz files must match the studio's rate. */
export async function resample(buffer:AudioBuffer,rate:number){
 if(buffer.sampleRate===rate)return buffer;
 const offline=new OfflineAudioContext(buffer.numberOfChannels,Math.ceil(buffer.duration*rate),rate);
 const source=offline.createBufferSource();source.buffer=buffer;source.connect(offline.destination);source.start();
 return offline.startRendering();
}

/** Decode a recording and mix it down to mono at SheetSage2's 24 kHz, so a ten-minute song uploads small. */
export async function monoClip(data:ArrayBuffer,rate=24000){
 const decoded=await new OfflineAudioContext(1,1,rate).decodeAudioData(data);
 const offline=new OfflineAudioContext(1,Math.max(1,Math.ceil(decoded.duration*rate)),rate);
 const source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start();
 return offline.startRendering();
}

/** 16-bit PCM WAV, the one format every decoder on the other end accepts. */
export function encodeWav(buffer:AudioBuffer){
 const channels=buffer.numberOfChannels,length=buffer.length,rate=buffer.sampleRate;
 const view=new DataView(new ArrayBuffer(44+length*channels*2));
 const word=(o:number,s:string)=>{for(let i=0;i<s.length;i++)view.setUint8(o+i,s.charCodeAt(i));};
 word(0,'RIFF');view.setUint32(4,36+length*channels*2,true);word(8,'WAVE');word(12,'fmt ');
 view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels,true);
 view.setUint32(24,rate,true);view.setUint32(28,rate*channels*2,true);view.setUint16(32,channels*2,true);
 view.setUint16(34,16,true);word(36,'data');view.setUint32(40,length*channels*2,true);
 const data=Array.from({length:channels},(_,ch)=>buffer.getChannelData(ch));
 let offset=44;
 for(let i=0;i<length;i++)for(let ch=0;ch<channels;ch++){
  const s=Math.max(-1,Math.min(1,data[ch][i]));view.setInt16(offset,s<0?s*0x8000:s*0x7fff,true);offset+=2;
 }
 return new Blob([view.buffer],{type:'audio/wav'});
}

export {peaks,peakRate} from './waveform';

type Store=Map<string,AudioBuffer>;
type RenderOptions={
 start:number;end:number;
 /** Only these clips; otherwise every clip that is heard. */
 clips?:string[];
 /** Apply the mixer's volume, pan, mute and solo. A selection sent to the engine keeps volume and pan but ignores mute. */
 mixer?:boolean;
 rate?:number;
 /** Master gain, for exports. */
 gain?:number;
};

/** Render part of the project to a buffer, faster than real time. */
export async function renderMix(project:Project,buffers:Store,options:RenderOptions){
 const rate=options.rate||RENDER_RATE;
 const span=Math.max(0.05,options.end-options.start);
 const offline=new OfflineAudioContext(2,Math.ceil(span*rate),rate);
 const chosen=options.clips?new Set(options.clips):null;
 const buses=new Map<string,AudioNode>();
 const out=offline.createGain();out.gain.value=options.gain??1;out.connect(offline.destination);
 for(const track of project.tracks){
  const gain=offline.createGain(),pan=offline.createStereoPanner();
  gain.gain.value=options.mixer===false?1:track.volume*(chosen||audible(project,track)?1:0);
  pan.pan.value=options.mixer===false?0:track.pan;
  gain.connect(pan).connect(out);buses.set(track.id,gain);
 }
 for(const clip of project.clips){
  if(chosen?!chosen.has(clip.id):clip.muted)continue;
  schedule(offline,clip,buffers.get(clip.buffer),buses.get(clip.trackId),options.start,0,options.end);
 }
 return offline.startRendering();
}

/** Start a clip's source so that timeline position `from` plays at context time `when`. */
function schedule(ctx:BaseAudioContext,clip:Clip,buffer:AudioBuffer|undefined,bus:AudioNode|undefined,from:number,when:number,until=Infinity){
 if(!buffer||!bus||clipEnd(clip)<=from||clip.start>=until)return null;
 const skip=Math.max(0,from-clip.start);
 const length=Math.min(clip.duration-skip,until-Math.max(from,clip.start));
 if(length<=0)return null;
 const source=ctx.createBufferSource();
 source.buffer=buffer;source.connect(bus);
 source.start(when+Math.max(0,clip.start-from),clip.offset+skip,length);
 return source;
}

type Bus={gain:GainNode;pan:StereoPannerNode;meter:AnalyserNode};

/**
 * Real-time playback through a small mixer: a gain, pan and meter per track
 * into a master bus. Mixer moves apply live; clip edits reschedule playback.
 */
export class Player{
 ctx:AudioContext|null=null;
 private master:GainNode|null=null;
 private masterMeter:AnalyserNode|null=null;
 private buses=new Map<string,Bus>();
 private sources:AudioBufferSourceNode[]=[];
 private anchor=0;private startedAt=0;
 playing=false;
 private scratch=new Float32Array(2048);

 context(){
  if(!this.ctx){
   this.ctx=new AudioContext({latencyHint:'interactive'});
   this.master=this.ctx.createGain();
   this.masterMeter=this.ctx.createAnalyser();this.masterMeter.fftSize=2048;
   this.master.connect(this.masterMeter);this.master.connect(this.ctx.destination);
  }
  return this.ctx;
 }

 /** Bring the mixer nodes in line with the project's tracks. */
 mix(project:Project,masterVolume=1){
  const ctx=this.context();
  for(const [id,bus] of this.buses)if(!project.tracks.some(t=>t.id===id)){bus.gain.disconnect();bus.pan.disconnect();this.buses.delete(id);}
  for(const track of project.tracks){
   let bus=this.buses.get(track.id);
   if(!bus){
    const gain=ctx.createGain(),pan=ctx.createStereoPanner(),meter=ctx.createAnalyser();meter.fftSize=2048;
    gain.connect(pan);pan.connect(meter);pan.connect(this.master!);
    bus={gain,pan,meter};this.buses.set(track.id,bus);
   }
   bus.gain.gain.setTargetAtTime(track.volume*(audible(project,track)?1:0),ctx.currentTime,0.01);
   bus.pan.pan.setTargetAtTime(track.pan,ctx.currentTime,0.01);
  }
  this.master!.gain.setTargetAtTime(masterVolume,ctx.currentTime,0.01);
 }

 async play(project:Project,buffers:Store,from:number,masterVolume=1){
  this.halt();
  const ctx=this.context();
  if(ctx.state!=='running')await ctx.resume();
  this.mix(project,masterVolume);
  const when=ctx.currentTime+0.05;
  for(const clip of project.clips){
   if(clip.muted)continue;
   const source=schedule(ctx,clip,buffers.get(clip.buffer),this.buses.get(clip.trackId)?.gain,from,when);
   if(source)this.sources.push(source);
  }
  this.anchor=from;this.startedAt=when;this.playing=true;
  return when;
 }

 private halt(){
  for(const source of this.sources){try{source.stop();}catch{}source.disconnect();}
  this.sources=[];
 }

 stop(){
  const at=this.position();
  this.halt();this.playing=false;this.anchor=at;
  return at;
 }

 seek(time:number){this.anchor=Math.max(0,time);}

 position(){
  if(!this.playing||!this.ctx)return this.anchor;
  return this.anchor+Math.max(0,this.ctx.currentTime-this.startedAt);
 }

 /** Seconds between scheduling a sound and hearing it, for placing recorded takes. */
 latency(){return (this.ctx?.baseLatency||0)+(this.ctx?.outputLatency||0);}

 /** Peak level of a track or the master bus over the last few milliseconds, 0 to 1+. */
 level(track?:string){
  const meter=track?this.buses.get(track)?.meter:this.masterMeter;
  if(!meter||!this.playing)return 0;
  meter.getFloatTimeDomainData(this.scratch);
  let peak=0;for(let i=0;i<this.scratch.length;i++){const v=Math.abs(this.scratch[i]);if(v>peak)peak=v;}
  return peak;
 }

 async decode(data:ArrayBuffer){return this.context().decodeAudioData(data);}

 close(){this.halt();void this.ctx?.close();this.ctx=null;this.buses.clear();}
}
