// Exercise the real job controller with delayed engine responses and queued project edits.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ts=require('../outputs/kiku-ai/node_modules/typescript');
const modelCode=ts.transpileModule(fs.readFileSync('outputs/kiku-ai/lib/studio/model.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const modelModule={exports:{}};new Function('exports','module',modelCode)(modelModule.exports,modelModule);const model=modelModule.exports;
class Buffer{constructor(){this.duration=8;this.length=80;this.sampleRate=10;this.numberOfChannels=1;this.data=new Float32Array(80);}getChannelData(){return this.data;}copyToChannel(d){this.data.set(d);}}
const input=new Buffer(),output=new Buffer(),store=new Map([['original-buffer',input]]);
const track={id:'track',name:'My voice',color:'#aaaa00',volume:1,pan:0,mute:false,solo:false};
const original={id:'clip',trackId:'track',buffer:'original-buffer',start:0,offset:0,duration:8,name:'My voice'};
let project={tracks:[track],clips:[original],bpm:100,key:'C',chords:[]},engineResolve,queued=null,delayCommit=false;
const slots=[],effects=[];let cursor=0;
const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
 useRef(initial){const i=cursor++;return slots[i]??=( {current:initial});},useEffect(effect){const i=cursor++;if(!slots[i]){slots[i]=true;effects.push(effect());}},useCallback(fn){cursor++;return fn;}};
class SignedOut extends Error{}
const audio={encodeWav:()=>new Blob(['audio']),renderMix:async()=>input,sliceBuffer:b=>b,spliceBuffer:(a,b,c)=>c,resample:async b=>b};
const engine={SignedOut,wavFile:()=>new File(['test'],'test.wav'),callEngine:()=>new Promise(resolve=>engineResolve=resolve),fetchResult:async()=>new ArrayBuffer(1)};
const modules={'react':react,'@/lib/studio/model':model,'@/lib/studio/audio':audio,'@/lib/studio/engine':engine,'@/lib/studio/models':{modelLabel:()=> 'ACE-Step 1.5'},'@/lib/studio/score':require('./score-tests-build/studio/score.js')};
const code=ts.transpileModule(fs.readFileSync('outputs/kiku-ai/components/studio/useJobs.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const moduleUnderTest={exports:{}};
vm.runInNewContext(code,{exports:moduleUnderTest.exports,module:moduleUnderTest,require:n=>{assert(modules[n],n);return modules[n];},
 Blob,File,FormData,URL,AbortController,AudioBuffer:Buffer,crypto,queueMicrotask,console});
function hook(){cursor=0;return moduleUnderTest.exports.useJobs({player:{decode:async()=>output},buffers:store,project:()=>project,playhead:()=>0,
 commit:fn=>{if(delayCommit)queued=fn;else project=fn(project);},pause:()=>{},signedOut:()=>{}});}
const selection={clips:['clip'],range:null};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function take(){hook().restyle(selection,{style:'jazz',change:0.5,lyrics:'',model:'ace15'});await flush();engineResolve({audio:{name:'result',url:'test'},status:'done'});await flush();return hook().takes.at(-1);}
(async()=>{
 let candidate=await take();assert.equal(project.clips.length,1);assert.equal(project.clips[0].buffer,'original-buffer');assert.equal(hook().takes.length,1);
 console.log('PASS generated audio remains temporary until accepted');
 project={...project,clips:project.clips.map(c=>({...c,start:2}))};assert(hook().isStale(candidate.id));assert.throws(()=>hook().accept(candidate.id),/source changed/i);
 assert.equal(project.clips.length,1);hook().accept(candidate.id,true);await flush();assert.equal(project.clips.length,2);assert.equal(project.clips[0].start,2);assert(!project.clips[0].muted);assert.equal(project.clips[0].buffer,'original-buffer');
 console.log('PASS delayed result protects changed source; accept on new tracks preserves edits');
 candidate=await take();const before=project;hook().accept(candidate.id);await flush();assert(project.clips.find(c=>c.id==='clip').muted);assert.equal(project.clips.find(c=>c.id==='clip').buffer,'original-buffer');project=before;
 console.log('PASS accept mutes the source without changing its samples; undo snapshot restores it');
 candidate=await take();const count=project.clips.length;hook().discard(candidate.id);assert.equal(project.clips.length,count);
 console.log('PASS discard leaves the project untouched');
 candidate=await take();delayCommit=true;hook().accept(candidate.id);assert(queued);project={...project,clips:project.clips.map(c=>c.id==='clip'?{...c,duration:7}:c)};
 project=queued(project);await flush();assert(hook().takes.some(t=>t.id===candidate.id));assert.equal(project.clips.length,count);
 console.log('PASS edits queued in the acceptance frame retain the pending take');
 delayCommit=false;hook().discard(candidate.id);
 const abc=fs.readFileSync('work/score-editor-proof/score.abc','utf8');
 hook().generate({kind:'song',style:'jazz',lyrics:'[verse]\nHello music',duration:20,model:'yue2',score:{abc,clock:[],edits:{}},seed:42});await flush();engineResolve({audio:{name:'result',url:'test'},status:'done',abc,report:{seed:42}});await flush();candidate=hook().takes.at(-1);
 const priorTempo=project.bpm;project={...project,bpm:135};hook().accept(candidate.id);await flush();assert.equal(project.bpm,135);assert.equal(project.clips.at(-1).score.abc,abc);assert.equal(project.clips.at(-1).generation.seed,42);
 console.log('PASS score and seed persist with accepted audio; later tempo edits remain intact');
 effects.forEach(cleanup=>cleanup?.());assert.equal(project.clips[0].buffer,'original-buffer');
})().catch(e=>{console.error(e);process.exitCode=1;});
