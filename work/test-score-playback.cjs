const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ts=require('../outputs/score-studio/node_modules/typescript');
const root='outputs/score-studio/lib/';
const modules={};
let ticks=new Set(),requests=0;
function load(name){
 if(modules[name])return modules[name];
 const exports={};modules[name]=exports;
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(root+name+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports,require:p=>load(p.replace('./','')),AbortSignal,
  fetch:async()=>{requests++;return {ok:true,arrayBuffer:async()=>new ArrayBuffer(1)};},
  setInterval:fn=>{ticks.add(fn);return fn;},clearInterval:fn=>ticks.delete(fn)
 });return exports;
}
const {prepareScore,SampleCache}=load('score-playback');
const sources=[];
const context={currentTime:0,decodeAudioData:async()=>({duration:3,length:144000,numberOfChannels:1}),
 createBufferSource(){const source={playbackRate:{value:1},connect(){},disconnect(){},start(...args){this.args=args;},stop(){this.stopped=true;this.onended?.();}};sources.push(source);return source;},
 createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}};}
};
const notes=Array.from({length:1200},(_,i)=>({cmd:'note',pitch:60+i%3,start:i/8,duration:1/8,gap:0,volume:96}));
const tune={getMeterFraction:()=>({num:4,den:4}),millisecondsPerMeasure:()=>2000,setUpAudio:()=>({tracks:[notes],totalDuration:150})};
(async()=>{
 const cache=new SampleCache(),start=performance.now();
 const score=await prepareScore(context,tune,0,100,cache);
 assert.equal(score.duration,300.2);assert.equal(requests,3);
 let ended=0;const player=score.start(context,{},0,()=>ended++);
 assert.equal(sources.length,4,'Only schedule upcoming notes, not all 1,200');
 player.stop();assert.equal(ticks.size,0);assert.ok(sources.every(s=>s.stopped));
 const again=await prepareScore(context,tune,0,100,cache);assert.equal(requests,3,'Reuse decoded samples');
 await prepareScore(context,tune,24,100,cache);assert.equal(requests,6,'Load only the new instrument');
 const fast=await prepareScore(context,tune,24,150,cache);assert.ok(Math.abs(fast.duration-200.2)<.001);assert.equal(requests,6);
 const previous=sources.length;const seek=again.start(context,{},150.1,()=>ended++);
 assert.ok(sources.slice(previous).some(source=>Math.abs(source.args[1]-.1)<.001),'Seeking resumes the active note');
 context.currentTime=151;for(const tick of [...ticks])tick();assert.equal(ended,1);assert.equal(ticks.size,0);
 console.log(`PASS: 5-minute score, bounded scheduling, sample reuse, instrument change, speed, seek, stop/end (${Math.round(performance.now()-start)}ms with mocked downloads).`);
})().catch(error=>{console.error(error);process.exitCode=1;});
