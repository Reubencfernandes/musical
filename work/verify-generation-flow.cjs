// Local browser integration test. All Hugging Face requests are fixtures; no GPU jobs or uploads run.
// Run from outputs/kiku-ai with its dev server on port 3010. Playwright is not an app dependency:
// PLAYWRIGHT_MODULE names any installed copy, and CHROME_PATH overrides the browser.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
require(path.resolve('node_modules/@next/env')).loadEnvConfig(process.cwd());
const origin=process.env.GENERATION_VERIFY_ORIGIN||'http://localhost:3010';
const engine=process.env.NEXT_PUBLIC_HF_ENGINE_ORIGIN||'https://reubencf-kiku-engine.hf.space';
const art=process.env.NEXT_PUBLIC_HF_ART_ORIGIN||'https://reubencf-kiku-art.hf.space';
const brief='An empty rain-soaked road leading toward a warm sunrise, hopeful gold against cool blue.';
const lyrics='[verse]\nThe rain carries yesterday away\nI follow the road toward the day';
function cookie(){
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',Buffer.from(process.env.SESSION_SECRET,'hex'),iv);
 const bytes=Buffer.concat([cipher.update(JSON.stringify({token:'hf_local_fixture',expires:Date.now()+3600000,storage:false,
  user:{id:'generation-fixture',name:'generation-fixture'}})),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64url');
}
function api(root){
 const specs={sample:[3,4],song:[7,6],artwork:[4,1],cover:[3,2],score_instrumental:[6,5]};
 let next=1;const components=[],dependencies=[],named_endpoints={};
 for(const [name,[inputCount,outputCount]] of Object.entries(specs)){
  const inputs=Array.from({length:inputCount},()=>next++),outputs=Array.from({length:outputCount},()=>next++);
  components.push(...[...inputs,...outputs].map(id=>({id,type:'textbox',props:{}})));
  dependencies.push({id:dependencies.length+1,api_name:name,inputs,outputs,queue:true,types:{generator:false,cancel:false}});
  named_endpoints['/'+name]={parameters:inputs.map((id,i)=>({parameter_name:'arg'+i,parameter_has_default:false,type:{type:'string'},component:'Textbox'})),returns:outputs.map(()=>({type:{type:'string'},component:'Textbox'}))};
 }
 return {config:{version:'6.2.0',root,api_prefix:'/gradio_api',protocol:'sse_v3',enable_queue:true,run_history:false,components,dependencies},info:{named_endpoints,unnamed_endpoints:{}}};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function until(test){for(let i=0;i<200;i++){if(test())return;await new Promise(r=>setTimeout(r,50));}throw new Error('Fixture requests did not arrive');}
function wav(){
 const rate=8000,bytes=Buffer.alloc(44+rate*2);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);
 bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(rate,24);
 bytes.writeUInt32LE(rate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(rate*2,40);
 return bytes;
}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'dark'});
  await context.addCookies([{name:'kiku-session',value:cookie(),url:origin,httpOnly:true,sameSite:'Lax'}]);
  const page=await context.newPage(),calls=[],unexpected=[],errors=[],sessions=new Map();
  let songGate=deferred(),artGate=deferred(),failArt=false,failSong=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.origin===origin)return route.continue();
   const headers={'access-control-allow-origin':origin,'access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'};
   const json=(data,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(data)});
   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
   // The host's antivirus injects this script into local HTML; it is unrelated to the app.
   if(url.hostname.endsWith('.kaspersky-labs.com'))return route.fulfill({contentType:'application/javascript',body:''});
   if(url.origin==='https://huggingface.co'){
    if(url.pathname.includes('/tree/'))return json([]);
    if(url.pathname.startsWith('/api/datasets'))return json({error:'fixture has no remote library'},404);
    if(url.pathname.endsWith('/overview'))return json({});
   }
   if([engine,art].includes(url.origin)){
    if(url.pathname==='/config')return json(api(url.origin).config);
    if(url.pathname==='/gradio_api/info')return json(api(url.origin).info);
    if(url.pathname==='/gradio_api/queue/join'){
     const payload=req.postDataJSON(),name=api(url.origin).config.dependencies.find(d=>d.id===payload.fn_index).api_name;
     const event={name,input:payload.data,at:Date.now(),id:'fixture-'+calls.length};calls.push(event);sessions.set(payload.session_hash,event);
     return json({event_id:event.id});
    }
    if(url.pathname==='/gradio_api/queue/data'){
     const job=sessions.get(url.searchParams.get('session_hash')),{name}=job;let data,error;
     if(name==='sample')data=['Written','hopeful acoustic folk, warm guitar',lyrics,JSON.stringify({artwork:brief})];
     if(name==='artwork')data=[brief];
     if(name==='song'){
      await songGate.promise;
      if(failSong)error='Fixture audio failure';else data=['Finished',{url:engine+'/fixture.wav'},null,'',123,'{}'];
     }
     if(name==='cover'){
      await artGate.promise;
      if(failArt)error='Fixture artwork failure';else data=[{url:art+'/fixture.png'},0];
     }
     return route.fulfill({headers,contentType:'text/event-stream',body:[{msg:'process_starts',event_id:job.id,eta:1},
      {msg:'process_completed',event_id:job.id,success:!error,output:error?{error}:{data}}].map(e=>'data: '+JSON.stringify(e)+'\n\n').join('')});
    }
    if(url.pathname==='/fixture.wav')return route.fulfill({headers,contentType:'audio/wav',body:wav()});
    if(url.pathname==='/fixture.png')return route.fulfill({headers,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')});
    if(/cancel|reset/.test(url.pathname))return json({success:true});
   }
   unexpected.push(url.origin+url.pathname);return json({error:'Unexpected external request'},400);
  });
  await page.goto(origin+'/generate',{waitUntil:'networkidle'});
  await page.getByLabel('Describe the song',{exact:true}).fill('A hopeful journey through the rain');
  await page.getByRole('button',{name:'Create',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.making .song-art-skeleton'));
  await assert.doesNotReject(async()=>page.locator('.making[aria-busy="true"]').waitFor());
  assert.equal(await page.locator('.making .skeleton').count(),3);
  assert.equal(await page.locator('.making .song-meter').count(),0);
  assert.doesNotMatch(await page.locator('.making .song-time').textContent(),/%/);
  // Let the fixture requests arrive while both jobs are held open.
  try{await until(()=>calls.some(c=>c.name==='song')&&calls.some(c=>c.name==='cover'));}
  catch(e){console.error({calls:calls.map(c=>c.name),unexpected,errors,status:await page.locator('.making').textContent()});throw e;}
  assert.ok(calls.some(c=>c.name==='song')&&calls.some(c=>c.name==='cover'),'artwork overlaps audio');
  assert.equal(calls.filter(c=>c.name==='artwork').length,0,'simple mode reuses its writer pass');
  assert.ok(calls.find(c=>c.name==='cover').input[1].includes(brief));
  assert.ok(!calls.find(c=>c.name==='cover').input[1].includes(lyrics),'image service does not receive raw lyrics');
  const before=await page.locator('.making').boundingBox();
  await page.screenshot({path:path.join(__dirname,'generation-skeleton-desktop.png')});
  await page.setViewportSize({width:390,height:844});
  await page.locator('.making').scrollIntoViewIfNeeded();
  await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
  assert.ok(await page.locator('.making .song-art-skeleton').isVisible());
  await page.screenshot({path:path.join(__dirname,'generation-skeleton-mobile.png')});
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.making .skeleton').first().evaluate(el=>getComputedStyle(el,'::after').animationName),'none');
  await page.setViewportSize({width:1440,height:1000});
  songGate.resolve();
  const ready=page.locator('.song-row:not(.making)').filter({hasText:'A Hopeful Journey Through The Rain'});
  await ready.waitFor();assert.ok(await ready.locator('.song-art-skeleton').isVisible(),'audio is ready while art is pending');
  const after=await ready.boundingBox();assert.ok(Math.abs(before.height-after.height)<4,'skeleton preserves row height');
  await ready.locator('.song-play').click();
  await page.waitForFunction(()=>{const audio=document.querySelector('audio');return audio&&!audio.paused&&audio.duration>0;});
  assert.ok(await page.locator('.player-now .song-art-skeleton').isVisible(),'player reflects pending artwork');
  artGate.resolve();
  await page.waitForFunction(()=>document.querySelector('.song-row:not(.making) .song-art img')?.naturalWidth===768);
  await page.waitForFunction(()=>!document.querySelector('.song-row:not(.making) .song-art-skeleton'));
  await page.waitForFunction(()=>new Promise(resolve=>{
   const open=indexedDB.open('kiku-local');open.onsuccess=()=>{
    const db=open.result,read=db.transaction('songs').objectStore('songs').getAll();
    read.onsuccess=()=>{db.close();resolve(read.result.some(r=>r.kind==='unsaved'&&r.item.cover&&r.item.localCover));};
   };
  }));
  await page.reload({waitUntil:'networkidle'});
  await ready.waitFor();await ready.locator('.song-art img').waitFor();
  assert.equal(calls.filter(c=>c.name==='song').length,1,'refresh restores completed local song');
  await page.getByRole('tab',{name:'Custom',exact:true}).click();
  await page.getByRole('textbox',{name:'Style',exact:true}).fill('quiet folk');await page.getByRole('textbox',{name:'Lyrics',exact:true}).fill(lyrics);
  songGate=deferred();artGate=deferred();failArt=true;
  await page.getByRole('button',{name:'Create',exact:true}).click();
  await until(()=>calls.some(c=>c.name==='artwork'));
  assert.ok(calls.some(c=>c.name==='artwork'&&c.input[2]===lyrics),'custom mode interprets lyrics on the existing engine');
  artGate.resolve();songGate.resolve();
  const fallback=page.locator('.song-row:not(.making)').filter({hasText:'Quiet Folk'});await fallback.waitFor();
  await page.waitForFunction(()=>!document.querySelector('.song-row:not(.making) .song-art-skeleton'));
  await fallback.locator('.song-play').click();
  await page.waitForFunction(()=>{const audio=document.querySelector('audio');return audio&&!audio.paused;});
  assert.equal(await fallback.locator('.song-art img').count(),0,'failed artwork leaves playable audio');
  songGate=deferred();artGate=deferred();failArt=false;
  await page.getByRole('button',{name:'Create',exact:true}).click();await page.locator('.making').waitFor();
  await page.locator('.making').getByRole('button',{name:'Cancel',exact:true}).click();
  songGate.resolve();artGate.resolve();await page.waitForTimeout(500);
  assert.equal(await page.locator('.making').count(),0);assert.equal(await page.locator('.song-row:not(.making)').count(),2,'cancel cannot restore the song');
  songGate=deferred();artGate=deferred();failSong=true;
  await page.getByRole('button',{name:'Create',exact:true}).click();await page.locator('.making').waitFor();
  songGate.resolve();await page.locator('.making.failed').waitFor();artGate.resolve();
  assert.equal(await page.locator('.making.failed').getAttribute('aria-busy'),'false');
  assert.equal(await page.locator('.making.failed .skeleton').count(),0,'failed song stops shimmering');
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  console.log('PASS: parallel art/audio; brief reuse and custom analysis; skeletons at desktop/mobile; reduced motion; audio before art; local restore; artwork failure; cancel; audio failure. No remote generation.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
