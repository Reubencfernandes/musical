const {chromium}=require('C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
require(path.resolve('node_modules/@next/env')).loadEnvConfig(process.cwd());
const origin=process.env.MODAL_VERIFY_ORIGIN||'http://localhost:3000';
function seal(value){
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',Buffer.from(process.env.SESSION_SECRET,'hex'),iv);
 const encrypted=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
}
function cookie(owner){return seal({token:'hf_local_verification',expires:Date.now()+3600000,user:{id:owner,name:'YuE2 verification'}});}
const ndjson=data=>JSON.stringify({type:'result',data})+'\n';
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addCookies([{name:'kiku-session',value:cookie('yue2-verification'),url:origin,httpOnly:true,sameSite:'Lax'}]);
  const page=await context.newPage(),calls=[],errors=[],requests=[];let downloaded;
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  page.on('response',r=>{if(r.url().includes('/api/modal/file?'))downloaded=r;});
  await page.addInitScript(()=>{
   const nativeFetch=window.fetch;
   window.fetch=async(...args)=>{
    const response=await nativeFetch(...args);
    if(response.url.includes('/api/modal/file?'))window.kikuAudioCheck=response.clone().arrayBuffer().then(data=>({
     signature:String.fromCharCode(...new Uint8Array(data,0,4)),bytes:data.byteLength,status:response.status,
    }));
    return response;
   };
  });
  await page.route('**/api/modal/jobs?job=*',async route=>{
   const request=route.request(),job=new URL(request.url()).searchParams.get('job');
   calls.push({job,body:request.postData()});
   if(job==='sample')await route.fulfill({contentType:'application/x-ndjson',body:ndjson({caption:'Warm acoustic pop',lyrics:'[verse]\nThe morning lights our way',meta:{duration:30}})});
   else await route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'error',error:'Verification stopped before audio generation.'})+'\n'});
  });
  await page.goto(origin+'/generate',{waitUntil:'networkidle'});
  await page.getByRole('combobox',{name:'Model',exact:true}).selectOption('yue2');
  await page.getByLabel('Describe the song',{exact:true}).fill('A warm acoustic song about the morning');
  await page.getByRole('button',{name:'Create',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.making.failed'));
  if(calls.length!==2||calls[0].job!=='sample'||calls[1].job!=='song'||!calls[1].body.includes('\r\n\r\nyue2\r\n'))throw new Error('Simple mode ignored YuE2 selection');
  await page.getByRole('button',{name:'Dismiss',exact:true}).click();
  await page.getByRole('tab',{name:'Custom',exact:true}).click();
  if(await page.getByRole('combobox',{name:'Model',exact:true}).inputValue()!=='yue2')throw new Error('Switching mode lost model selection');
  if(!await page.getByRole('combobox',{name:'Length',exact:true}).isDisabled())throw new Error('YuE2 vocal length should be automatic');
  await page.getByLabel('Style',{exact:true}).fill('Warm acoustic folk pop, gentle female vocal, piano and acoustic guitar, 100 BPM');
  await page.getByLabel('Lyrics',{exact:true}).fill('[verse]\nThe morning lights our way\nWe greet a brand new day');
  await page.getByRole('combobox',{name:'Model',exact:true}).selectOption('ace15');
  await page.getByRole('combobox',{name:'Length',exact:true}).selectOption('30');
  await page.getByRole('button',{name:'Create',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.making.failed'));
  if(calls.at(-1).job!=='song'||!calls.at(-1).body.includes('\r\n\r\nace15\r\n'))throw new Error('Custom mode ignored ACE-Step selection');
  await page.getByRole('button',{name:'Dismiss',exact:true}).click();
  await page.getByRole('combobox',{name:'Model',exact:true}).selectOption('yue2');
  if(await page.getByRole('combobox',{name:'Length',exact:true}).inputValue()!=='0')throw new Error('YuE2 vocal duration did not display Auto');
  await page.screenshot({path:path.join(__dirname,'yue2-generate-selector.png')});
  console.log('PASS: Simple YuE2 selection survives planning; Custom ACE-Step selection works; switching modes preserves model; YuE2 vocal duration is automatic.');
  if(process.argv.includes('--ui-only'))return;
  await page.unroute('**/api/modal/jobs?job=*');requests.length=0;
  if(process.argv.includes('--reuse-result')){
   const ticket=seal({owner:'yue2-verification',path:'/results/job-t0dv4074/song.flac',model:'yue2',expires:Date.now()+3600000});
   await page.route('**/api/modal/jobs?job=song',r=>r.fulfill({contentType:'application/x-ndjson',body:ndjson({audio:{url:'/api/modal/file?ticket='+ticket,name:'song.flac'},abc:''})}));
  }
  console.log(process.argv.includes('--reuse-result')?'Verifying the previously generated YuE2 song through Generate and private result API...':'Generating a real YuE2 vocal song through Generate and the private Modal API...');
  await page.getByRole('button',{name:'Create',exact:true}).click();
  const success=await Promise.race([
   page.locator('.song-row:not(.making)').first().waitFor({timeout:900000}).then(()=>true),
   page.locator('.making.failed').waitFor({timeout:900000}).then(()=>false),
  ]);
  if(!success)throw new Error(await page.locator('.making.failed').innerText());
  const generated=page.locator('.song-row:not(.making)').first();
  if(!(await generated.innerText()).includes('YuE2'))throw new Error('Generated song not labeled YuE2');
  const download=requests.find(u=>u.includes('/api/modal/file?'));
  if(!download)throw new Error('No authenticated result download');
  if(requests.some(u=>u.includes('/api/auth/token')||/\.hf\.space$|\.modal\.run$/.test(new URL(u).hostname)))throw new Error('Browser called an external engine or requested HF token for generation');
  const audio=await page.evaluate(()=>window.kikuAudioCheck);
  if(audio.status!==200||audio.signature!=='fLaC'||audio.bytes<100000)throw new Error('Invalid YuE2 FLAC download');
  fs.writeFileSync(path.join(__dirname,'yue2-app-verification.json'),JSON.stringify({origin,download,owner:'yue2-verification',bytes:audio.bytes,reusedResult:process.argv.includes('--reuse-result'),verifiedAt:new Date().toISOString()},null,2));
  const other=await browser.newContext();
  await other.addCookies([{name:'kiku-session',value:cookie('other-user'),url:origin,httpOnly:true,sameSite:'Lax'}]);
  if((await other.request.get(download)).status()!==404)throw new Error('Another user downloaded this YuE2 result');
  if((await context.request.get(download+'x')).status()!==404)throw new Error('Tampered YuE2 ticket accepted');
  const anon=await browser.newContext();
  if((await anon.request.post(origin+'/api/modal/jobs?job=song',{multipart:{model:'yue2',style:'test',lyrics:'test'}})).status()!==401)throw new Error('Anonymous GPU generation allowed');
  if((await context.request.post(origin+'/api/modal/jobs?job=song',{headers:{Origin:'https://example.com'},multipart:{model:'yue2',style:'test',lyrics:'test'}})).status()!==403)throw new Error('Cross-site GPU generation allowed');
  if(errors.length)throw new Error(errors.join('\n'));
  await page.screenshot({path:path.join(__dirname,'yue2-app-verification.png')});
  console.log('PASS: real YuE2 song appears in Generate, FLAC downloaded through user-bound private API; other-user, tampering, anonymous and cross-site checks pass; no browser errors.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message.split('\n')[0]);process.exitCode=1});
