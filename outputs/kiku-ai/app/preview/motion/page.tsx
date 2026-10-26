'use client';
import {useEffect,useRef,useState} from 'react';
import Logo from '@/components/Logo';
import Processing from '@/components/Processing';
import Waveform from '@/components/studio/Waveform';
import JobWaveform from '@/components/studio/JobWaveform';
import {waveformWindow} from '@/lib/studio/waveform';
import type {PerformerId} from '@/lib/performers';

/** Deterministic visual fixtures; this route is disabled outside development. */
export default function MotionPreview(){
 const [buffer,setBuffer]=useState<AudioBuffer>(),[progress,setProgress]=useState(.42),[performer,setPerformer]=useState<PerformerId>('saxophone');
 const [width,setWidth]=useState(480),[scroll,setScroll]=useState(0);
 const column=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(process.env.NODE_ENV!=='development')return;
  const rate=12000,seconds=24,audio=new AudioBuffer({length:rate*seconds,numberOfChannels:2,sampleRate:rate});
  const left=audio.getChannelData(0),right=audio.getChannelData(1);
  for(let i=0;i<left.length;i++){
   const t=i/rate,beat=t%.5,phrase=Math.pow(.5+.5*Math.sin(t*.68),1.4);
   const pulse=Math.exp(-beat*19)*Math.sin(t*2*Math.PI*(62+Math.exp(-beat*25)*90));
   const tone=(Math.sin(t*1382)+.3*Math.sin(t*2073))*.22*phrase;
   const value=t>10&&t<11?0:(pulse*.63+tone)*Math.min(1,t*3,(seconds-t)*3);
   left[i]=value;right[i]=-value;
  }
  setBuffer(audio);
  const node=column.current;if(!node)return;
  const observer=new ResizeObserver(()=>setWidth(node.clientWidth));observer.observe(node);
  setWidth(node.clientWidth);return()=>observer.disconnect();
 },[]);
 if(process.env.NODE_ENV!=='development')return null;
 const window=waveformWindow(0,72000,scroll,width);
 return <main className="motion-preview">
  <header><Logo className="motion-brand" size={44}/><span>MOTION & SOUND · LOCAL PREVIEW</span></header>
  <h1>A little rhythm. A lot of detail.</h1>
  <p>Real stereo peaks, musical energy, and Kiku’s dot-grid processing motion.</p>
  <div className="motion-columns">
   <section className="studio motion-studio">
    <div ref={column}>
     <p className="motion-caption">STUDIO / STEREO AUDIO</p>
     <div className="motion-clip" style={{background:'#3b4942'}}>
      <div className="clip-head">Warm rhythm · Stereo</div>
      <Waveform buffer={buffer} offset={0} duration={24} width={width} height={98} color="#111f19"/>
     </div>
     <div className="motion-clip" style={{background:'#3b4942'}}>
      <div className="clip-head">Detail · 4 seconds</div>
      <Waveform buffer={buffer} offset={7} duration={4} width={width} height={98} color="#111f19"/>
     </div>
     <p className="motion-caption">CREATING YOUR NEXT TAKE</p>
     <div className="job-lane motion-job">
      <JobWaveform seed="motion-preview" progress={progress} width={width} height={76}/>
      <span className="job-lane-label">Writing the melody · {Math.round(progress*100)}%</span>
     </div>
     <label className="motion-slider">Progress<input aria-label="Preview progress" type="range" min="0" max="1" step=".01" value={progress} onChange={e=>setProgress(Number(e.target.value))}/></label>
     <p className="motion-caption">LONG CLIP / VISIBLE WINDOW</p>
     <div className="motion-clip" style={{background:'#3b4942'}}>
      <div className="clip-head">72000 px source · viewport rendering</div>
      <div style={{overflow:'hidden',width,height:98}}>
       <div style={{width:72000,transform:`translateX(-${scroll}px)`}}>
        <Waveform buffer={buffer} offset={0} duration={24} width={72000} height={98} color="#111f19" viewStart={window.start} viewWidth={window.width}/>
       </div>
      </div>
     </div>
     <label className="motion-slider">Scroll<input aria-label="Long clip scroll" type="range" min="0" max={72000-width} step="1" value={scroll} onChange={e=>setScroll(Number(e.target.value))}/></label>
    </div>
   </section>
   <section className="motion-performer">
    <nav>{(['saxophone','guitar','piano','drums'] as const).map(id=><button key={id} aria-pressed={performer===id} onClick={()=>setPerformer(id)}>{id}</button>)}</nav>
    <Processing performer={performer} message="Finding the shape of your sound." cancelLabel="Next performer" onCancel={()=>setPerformer(performer==='saxophone'?'guitar':performer==='guitar'?'piano':performer==='piano'?'drums':'saxophone')}/>
   </section>
  </div>
  <style>{`.motion-preview{max-width:1120px;margin:0 auto;padding:40px 24px;color:var(--ink)}.motion-preview>header{display:flex;align-items:center;justify-content:space-between;margin-bottom:36px;gap:20px}.motion-preview>header>span{font-size:11px;color:var(--muted);letter-spacing:1px}.motion-brand{display:flex;align-items:center;gap:12px;font-size:24px;font-weight:600}.motion-preview h1{font-size:36px;letter-spacing:-1px;margin-bottom:8px}.motion-preview>p{color:var(--muted);margin-bottom:32px}.motion-columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:32px}.studio.motion-studio{display:block;height:auto;min-height:0;padding:20px;border-radius:18px;overflow:hidden}.motion-caption{font-size:10px;color:#b1b1ba;letter-spacing:1.5px;margin:8px 0 14px}.motion-clip{position:relative;height:98px;margin-bottom:16px;border-radius:8px;overflow:hidden}.job-lane.motion-job{position:relative;height:100px;width:100%}.motion-slider{display:flex;gap:16px;align-items:center;font-size:12px;color:#aaa;margin:16px 0 24px}.motion-slider input{flex:1;min-width:0;accent-color:#ff7133}.motion-performer{min-width:0;border:1px solid var(--line);border-radius:18px;overflow:hidden}.motion-performer nav{display:flex;justify-content:center;padding:24px 12px 0;gap:18px}.motion-performer nav button{font-size:12px;color:var(--muted);text-transform:capitalize}.motion-performer nav button[aria-pressed=true]{color:var(--accent)}.motion-performer .processing{min-height:480px;padding:18px}.motion-performer .musician-canvas{width:min(300px,75vw);margin:-12px 0 0}.motion-performer .processing p{margin:14px 0 0}.motion-performer .text-button{margin:0}`}</style>
 </main>;
}
