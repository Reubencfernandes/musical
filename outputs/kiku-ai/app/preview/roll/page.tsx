'use client';
import dynamic from 'next/dynamic';
import {useState} from 'react';
import {writeScore,type ScoreDocument} from '@/lib/studio/score';
import '../../studio.css';

// Development only: the piano roll on a short sample melody, for checking its look and playback.
const ScoreEditor=dynamic(()=>import('@/components/studio/ScoreEditor'),{ssr:false});
const melody=[[69,0,8],[71,8,8],[73,16,16],[76,32,8],[73,40,8],[71,48,16],[69,64,12],[68,76,4],[69,80,16],[64,96,24],[69,128,8],[71,136,8],[73,144,24],[71,168,8],[69,176,32]];
const score:ScoreDocument={grid:32,bpm:110,bars:Array.from({length:8},(_,i)=>({start:i*32,length:32,meter:[4,4],key:'A',sections:i?[]:['verse']})),
 notes:[...melody.map(([pitch,start,duration],i)=>({id:'v'+i,voice:'Vocal' as const,pitch,start,duration})),
  ...[[57,0,32],[54,32,32],[50,64,32],[52,96,32],[57,128,32],[54,160,32],[50,192,32],[52,224,32]].map(([pitch,start,duration],i)=>({id:'i'+i,voice:'Ins' as const,pitch,start,duration}))],
 chords:[],keys:[[0,'A']]};
export default function Page(){
 const [open,setOpen]=useState(true);
 if(process.env.NODE_ENV!=='development')return null;
 return <main style={{minHeight:'100svh',background:'#101014'}}>{open?<ScoreEditorPreview close={()=>setOpen(false)}/>:<button onClick={()=>setOpen(true)} style={{color:'#fff',padding:20}}>Open piano roll</button>}</main>;
}
function ScoreEditorPreview({close}:{close:()=>void}){
 const [sheet]=useState(()=>{const abc=writeScore(score);return {sig:'preview',abc,document:score,lyrics:'',transpose:0,bpm:score.bpm,chords:{},
  summary:{bpm:score.bpm,key:'A',keyName:'A',duration:0,bars:[],clock:[],lyrics:'',notes:0,fills:0}};});
 return <ScoreEditor sheet={sheet as never} lockedVocal={false} save={()=>{}} close={close}/>;
}
