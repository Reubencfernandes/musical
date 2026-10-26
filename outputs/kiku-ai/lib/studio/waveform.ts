/** Source-resolution extrema, measured across channels so out-of-phase stereo
 * never cancels an audible recording out of its waveform. */
const BLOCK=256;
const cache=new WeakMap<AudioBuffer,{peaks:Float32Array;energy:Float32Array}>();

function measure(buffer:AudioBuffer){
 const cached=cache.get(buffer);if(cached)return cached;
 const blocks=Math.ceil(buffer.length/BLOCK),peaks=new Float32Array(blocks*2),energy=new Float32Array(blocks);
 const channels=Array.from({length:buffer.numberOfChannels},(_,ch)=>buffer.getChannelData(ch));
 for(let b=0;b<blocks;b++){
  let lo=0,hi=0,power=0;
  const end=Math.min(buffer.length,(b+1)*BLOCK);
  for(const data of channels)for(let i=b*BLOCK;i<end;i++){
   const value=Number.isFinite(data[i])?data[i]:0;
   lo=Math.min(lo,value);hi=Math.max(hi,value);power+=value*value;
  }
  peaks[b*2]=lo;peaks[b*2+1]=hi;
  energy[b]=power/Math.max(1,(end-b*BLOCK)*channels.length);
 }
 const result={peaks,energy};cache.set(buffer,result);return result;
}

export const peaks=(buffer:AudioBuffer)=>measure(buffer).peaks;
export const peakRate=(buffer:AudioBuffer)=>buffer.sampleRate/BLOCK;

/** Three values per display column: minimum, maximum and RMS energy. */
export function waveformEnvelope(buffer:AudioBuffer,offset:number,duration:number,columns:number,sourceEnd=Infinity){
 const count=Number.isFinite(columns)?Math.max(0,Math.floor(columns)):0;
 const result=new Float32Array(count*3);
 if(!count||!Number.isFinite(offset)||!Number.isFinite(duration)||duration<=0)return result;
 const {peaks,energy}=measure(buffer);
 const channels=Array.from({length:buffer.numberOfChannels},(_,ch)=>buffer.getChannelData(ch));
 for(let x=0;x<count;x++){
  const start=Math.max(0,Math.floor((offset+duration*x/count)*buffer.sampleRate));
  const end=Math.min(buffer.length,Math.ceil(Math.min(sourceEnd,offset+duration*(x+1)/count)*buffer.sampleRate));
  const from=Math.ceil(start/BLOCK),to=Math.floor(end/BLOCK);
  let lo=0,hi=0,power=0,weight=0;
  const scan=(a:number,b:number)=>{
   for(const channel of channels)for(let i=a;i<b;i++){
    const value=Number.isFinite(channel[i])?channel[i]:0;
    lo=Math.min(lo,value);hi=Math.max(hi,value);power+=value*value;weight++;
   }
  };
  // Read partial edge blocks directly so trimmed-away transients cannot leak in.
  scan(start,Math.min(end,from*BLOCK));
  for(let b=from;b<to;b++){
   lo=Math.min(lo,peaks[b*2]);hi=Math.max(hi,peaks[b*2+1]);
   const samples=BLOCK*channels.length;
   power+=energy[b]*samples;weight+=samples;
  }
  scan(Math.max(start,from*BLOCK,to*BLOCK),end);
  result[x*3]=Math.max(-1,lo);result[x*3+1]=Math.min(1,hi);
  result[x*3+2]=Math.min(1,Math.sqrt(power/Math.max(weight,1e-9)));
 }
 return result;
}

export const WAVE_WINDOW=512;
/** Overscan prevents blank edges during scroll without enormous canvases. */
export function waveformWindow(left:number,width:number,viewLeft:number,viewWidth:number){
 const start=Math.min(width,Math.max(0,viewLeft-WAVE_WINDOW-left));
 const end=Math.max(start,Math.min(width,viewLeft+viewWidth+WAVE_WINDOW*2-left));
 return {start,width:Math.max(0,end-start)};
}
