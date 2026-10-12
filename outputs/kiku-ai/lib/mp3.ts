/**
 * MP3 for the library. A three-minute song is about 4 MB at 192 kbps instead of
 * 30 MB of WAV, so saved songs and score recordings load quickly. Studio
 * projects keep WAV: an MP3's encoder delay would shift takes against their source.
 */
export async function toMp3(buffer:AudioBuffer,kbps=192):Promise<Blob>{
 const {Mp3Encoder}=await import('@breezystack/lamejs');
 const channels=Math.min(2,buffer.numberOfChannels),encoder=new Mp3Encoder(channels,buffer.sampleRate,kbps);
 const pcm=(data:Float32Array)=>{const out=new Int16Array(data.length);for(let i=0;i<data.length;i++){const s=Math.max(-1,Math.min(1,data[i]));out[i]=s<0?s*0x8000:s*0x7fff;}return out;};
 const left=pcm(buffer.getChannelData(0)),right=channels>1?pcm(buffer.getChannelData(1)):undefined;
 const parts:BlobPart[]=[],block=1152*40;
 for(let i=0;i<left.length;i+=block){
  const chunk=encoder.encodeBuffer(left.subarray(i,i+block),right?.subarray(i,i+block));
  if(chunk.length)parts.push(new Uint8Array(chunk));
  // Encoding a long song takes a few seconds; yield so the page stays responsive.
  if(i/block%20===19)await new Promise(done=>setTimeout(done,0));
 }
 const tail=encoder.flush();if(tail.length)parts.push(new Uint8Array(tail));
 return new Blob(parts,{type:'audio/mpeg'});
}
