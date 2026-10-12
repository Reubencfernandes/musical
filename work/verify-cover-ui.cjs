const {chromium}=require('C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
require(path.resolve('node_modules/@next/env')).loadEnvConfig(process.cwd());
const origin=process.env.MODAL_VERIFY_ORIGIN||'http://localhost:3000';
function cookie(){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',Buffer.from(process.env.SESSION_SECRET,'hex'),iv);
 const data=Buffer.concat([cipher.update(JSON.stringify({token:'hf_local_verification',expires:Date.now()+3600000,storage:true,user:{id:'cover-verification',name:'cover-verification'}})),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url');}
const files=new Map(),commits=[],unexpected=[],requests=[],errors=[];
const legacy={id:'legacy-song',title:'Old Song',caption:'Acoustic music',lyrics:'',instrumental:true,model:'ace15',duration:30,createdAt:new Date().toISOString()};
files.set('songs/legacy-song.json',Buffer.from(JSON.stringify(legacy)));
const wav=fs.readFileSync(path.join(__dirname,'modal-app-verification.wav'));
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1050}});
  await context.addCookies([{name:'kiku-session',value:cookie(),url:origin,httpOnly:true,sameSite:'Lax'}]);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  // Mock only the user's private HF dataset. The actual artwork API still reaches Modal.
  await page.route('https://huggingface.co/**',async route=>{
   const request=route.request(),url=new URL(request.url());const common={'access-control-allow-origin':origin,'access-control-expose-headers':'content-range,etag,x-error-code'};
   const json=async(body,status=200)=>route.fulfill({status,headers:common,contentType:'application/json',body:JSON.stringify(body)});
   if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{...common,'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'authorization,content-type,range,accept'}});
   if(url.pathname.endsWith('/kiku-ai-library')&&url.pathname.startsWith('/api/datasets/'))return json({});
   if(url.pathname.includes('/tree/main/')){
    const folder=url.pathname.split('/tree/main/')[1];return json([...files.entries()].filter(([name])=>name.startsWith(folder+'/')).map(([name,data])=>({path:name,type:'file',size:data.length,oid:'test'})));
   }
   if(url.pathname.includes('/preupload/'))return json({files:JSON.parse(request.postData()).files.map(f=>({path:f.path,uploadMode:'regular',shouldIgnore:false}))});
   if(url.pathname.includes('/commit/')){
    const operations=request.postData().split('\n').map(line=>JSON.parse(line));
    for(const op of operations){if(op.key==='file')files.set(op.value.path,Buffer.from(op.value.content,'base64'));if(op.key==='deletedFile')files.delete(op.value.path);}
    commits.push(operations);return json({commitOid:'test-commit',commitUrl:'https://huggingface.co/test'});
   }
   if(url.pathname.includes('/resolve/main/')){
    const name=url.pathname.split('/resolve/main/')[1],data=files.get(name);
    if(!data)return route.fulfill({status:404,headers:{...common,'x-error-code':'EntryNotFound'},body:'missing'});
    const range=request.headers().range;let start=0,end=data.length-1;
    if(range){const match=/bytes=(\d+)-(\d*)/.exec(range);if(match){start=Number(match[1]);end=match[2]?Number(match[2]):end;}}
    return route.fulfill({status:range?206:200,headers:{...common,etag:'"test"','content-range':`bytes ${start}-${end}/${data.length}`},contentType:name.endsWith('.json')?'application/json':name.endsWith('.webp')?'image/webp':'audio/mpeg',body:data.subarray(start,end+1)});
   }
   unexpected.push(url.pathname);return json({error:'Unexpected test request'},500);
  });
  await page.route('**/api/modal/jobs?job=*',async route=>{
   const job=new URL(route.request().url()).searchParams.get('job');
   const data=job==='sample'?{caption:'Warm acoustic folk pop, peaceful sunrise by the sea, gentle piano and guitar',lyrics:'[verse]\nThe morning lights our way\nWaves carry yesterday away',meta:{duration:30}}:{audio:{url:'/api/modal/file?ticket=cover-ui-fixture',name:'song.wav'},seed:123};
   await route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'result',data})+'\n'});
  });
  await page.route('**/api/modal/file?ticket=cover-ui-fixture',route=>route.fulfill({contentType:'audio/wav',body:wav}));
  if(process.argv.includes('--reuse-cover'))await page.route('**/api/modal/cover',route=>route.fulfill({contentType:'image/webp',headers:{'x-cover-seed':'1398628461'},body:fs.readFileSync(path.join(__dirname,'dreamlite-cover.webp'))}));
  await page.goto(origin+'/generate',{waitUntil:'networkidle'});
  const old=page.locator('.song-row').filter({hasText:'Old Song'});await old.waitFor();assert.equal(await old.locator('.song-art img').count(),0);
  await page.getByLabel('Describe the song',{exact:true}).fill('Morning by the sea');
  await page.getByRole('button',{name:'Create',exact:true}).click();
  const row=page.locator('.song-row:not(.making)').filter({hasText:'Morning By The Sea'});await row.waitFor({timeout:120000});
  await row.locator('.song-play').click();
  await row.locator('.song-art img').waitFor({timeout:600000});
  await page.locator('.player-now .song-art img').waitFor();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('.song-art img')).every(image=>image.complete&&image.naturalWidth===512));
  await page.waitForFunction(()=>!document.querySelector('.song-row:not(.making) .unsaved'));
  const deadline=Date.now()+30000;while(![...files.keys()].some(name=>name.endsWith('.webp'))&&Date.now()<deadline)await page.waitForTimeout(100);
  const coverPath=[...files.keys()].find(name=>name.endsWith('.webp'));assert.ok(coverPath,'Cover not saved to HF dataset');
  const saved=JSON.parse(files.get(coverPath.replace('.webp','.json')).toString());assert.equal(saved.cover.model,'carlofkl/DreamLite-base');assert.equal(saved.localCover,undefined);assert.equal(saved.local,undefined);
  await page.screenshot({path:path.join(__dirname,'dreamlite-generate.png')});
  console.log('PASS: Generate/player show 512px cover; artwork metadata and WebP saved. Checking reload...');
  await page.goto(origin+'/library',{waitUntil:'networkidle'});
  const libraryRow=page.locator('.song-row').filter({hasText:'Morning By The Sea'});await libraryRow.locator('.song-art img').waitFor();
  await page.reload({waitUntil:'networkidle'});await libraryRow.locator('.song-art img').waitFor();
  await page.waitForFunction(()=>document.querySelector('.song-art img')?.naturalWidth===512);
  await libraryRow.locator('.song-play').click();
  await page.waitForFunction(()=>{const audio=document.querySelector('audio');return audio&&!audio.paused&&audio.duration>0;});
  await page.screenshot({path:path.join(__dirname,'dreamlite-library.png')});
  await page.goto(origin+'/',{waitUntil:'networkidle'});await page.locator('.home-recent .song-art img').waitFor();
  // Failed artwork must leave a playable, saved song with its usual gradient.
  await page.goto(origin+'/generate',{waitUntil:'networkidle'});
  await page.route('**/api/modal/cover',route=>route.fulfill({status:502,contentType:'application/json',body:'{"error":"Test artwork failure"}'}));
  await page.getByLabel('Describe the song',{exact:true}).fill('Fallback song');await page.getByRole('button',{name:'Create',exact:true}).click();
  const fallback=page.locator('.song-row:not(.making)').filter({hasText:'Fallback Song'});await fallback.waitFor({timeout:120000});
  await fallback.locator('.song-play').click();assert.equal(await fallback.locator('.song-art img').count(),0);
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll('.song-row')).find(row=>row.textContent.includes('Fallback Song'))?.querySelector('.unsaved'));
  assert.equal(await page.locator('.making.failed').count(),0);assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
  assert.ok(!requests.some(url=>new URL(url).hostname.endsWith('.modal.run')),'Browser exposed Modal worker');
  fs.writeFileSync(path.join(__dirname,'dreamlite-ui-verification.json'),JSON.stringify({coversSaved:1,commits:commits.length,privateDatasetReload:true,legacyFallback:true,failedArtworkKeepsSong:true,errors},null,2));
  console.log('PASS: real DreamLite cover appears in Generate and player, saved metadata/WebP reload from private HF dataset in Library, legacy and failed covers retain gradients, song remains playable, no browser calls to Modal.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
