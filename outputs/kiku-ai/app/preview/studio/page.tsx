'use client';
import dynamic from 'next/dynamic';
import {useEffect,useState} from 'react';
import {saveDraft} from '@/lib/studio/drafts';
import type {Project} from '@/lib/studio/model';

// Development only: the studio without signing in, for checking editing and playback.
// Engine calls from here return "sign in" errors, which is expected.
const Studio=dynamic(()=>import('@/components/studio/Studio'),{ssr:false});
export default function Page(){
 const [q,setQuery]=useState<URLSearchParams|null>(null);
 useEffect(()=>setQuery(new URLSearchParams(location.search)),[]);
 const demo=q?.get('demo')==='waveform';
 const [draft,setDraft]=useState<string>(),[error,setError]=useState('');
 useEffect(()=>{
  if(process.env.NODE_ENV!=='development'||!demo)return;
  let disposed=false;
  const rate=12000,seconds=90,audio=new AudioBuffer({length:rate*seconds,numberOfChannels:2,sampleRate:rate});
  const left=audio.getChannelData(0),right=audio.getChannelData(1);
  for(let i=0;i<audio.length;i++){
   const t=i/rate,beat=t%.5,phrase=.25+.75*(.5+.5*Math.sin(t*.68));
   const pulse=Math.exp(-beat*19)*Math.sin(t*2*Math.PI*(62+Math.exp(-beat*25)*90));
   const tone=(Math.sin(t*1382)+.3*Math.sin(t*2073))*.22*phrase;
   const value=t>10&&t<11?0:(pulse*.63+tone)*Math.min(1,t*3,(seconds-t)*3);
   left[i]=value;right[i]=-value*.7;
  }
  const key='kiku-waveform-visual-fixture',buffer=key+'-audio';
  const project:Project={bpm:120,key:'',chords:[],
   tracks:[{id:'rhythm',name:'Warm rhythm',color:'#c89360',volume:.6,pan:0,mute:false,solo:false},{id:'detail',name:'Musical detail',color:'#83b8ac',volume:.5,pan:0,mute:true,solo:false}],
   clips:[{id:'rhythm-clip',trackId:'rhythm',buffer,start:0,offset:0,duration:seconds,name:'Warm rhythm · stereo'},
    {id:'detail-clip',trackId:'detail',buffer,start:4,offset:7,duration:16,name:'Detail · cropped source'}]};
  const createdAt=new Date().toISOString();
  void saveDraft({key,name:'Waveform visual fixture',projectId:null,project,saved:true,createdAt,uploaded:[],updatedAt:Date.now(),jobs:[]},new Map([[buffer,audio]]))
   .then(()=>{if(!disposed)setDraft(key);}).catch(()=>{if(!disposed)setError('The local waveform fixture could not be prepared.');});
  return()=>{disposed=true;};
 },[demo]);
 if(process.env.NODE_ENV!=='development')return null;
 if(!q)return <p role="status">Loading studio preview…</p>;
 if(demo&&!draft)return <p role="status">{error||'Preparing waveform preview…'}</p>;
 return <Studio user={{name:'Preview'}} signOut={()=>{}} open={{draft:demo?draft:q?.get('draft')||undefined}}/>;
}
