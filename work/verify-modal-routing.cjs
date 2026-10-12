const {chromium}=require('C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
require(path.resolve('node_modules/@next/env')).loadEnvConfig(process.cwd());
const origin=process.env.MODAL_VERIFY_ORIGIN||'http://localhost:3000';
function cookie(owner){
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',Buffer.from(process.env.SESSION_SECRET,'hex'),iv);
 const encrypted=Buffer.concat([cipher.update(JSON.stringify({token:'hf_local_verification',expires:Date.now()+3600000,user:{id:owner,name:'Modal verification'}})),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
}
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addCookies([{name:'kiku-session',value:cookie('modal-verification'),url:origin,httpOnly:true,sameSite:'Lax'}]);
  const page=await context.newPage(),requests=[],errors=[];
  page.on('request',r=>requests.push(r.url()));page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/studio',{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Library',exact:true}).click();
  await page.getByRole('button',{name:'Instrumental',exact:true}).click();
  await page.getByLabel('Describe your sound',{exact:true}).fill('Warm acoustic pop instrumental, piano and clean guitar, gentle drums, 100 BPM, no vocals');
  await page.getByRole('button',{name:'Create a take',exact:true}).click();
  await page.locator('canvas.job-wave').waitFor();
  console.log('Waiting for actual Modal GPU generation through the app server...');
  const outcome=await Promise.race([
   page.locator('[data-clip]').first().waitFor({timeout:240000}).then(()=>true),
   page.locator('.job.failed').waitFor({timeout:240000}).then(()=>false),
  ]);
  if(!outcome)throw new Error(await page.locator('.job.failed').innerText());
  const downloadURL=requests.find(u=>u.includes('/api/modal/file?'));
  if(!downloadURL)throw new Error('No authenticated Modal download occurred');
  if(requests.some(u=>u.includes('/api/auth/token')||/\.hf\.space$|\.modal\.run$/.test(new URL(u).hostname)))throw new Error('Browser requested an HF token or called an external engine');
  const response=await context.request.get(downloadURL,{timeout:180000});
  if(response.status()!==200)throw new Error('Download failed');
  const audio=await response.body();
  if(audio.toString('ascii',0,4)!=='RIFF'||audio.length<100000)throw new Error('Invalid generated WAV');
  fs.writeFileSync(path.join(__dirname,'modal-app-verification.wav'),audio);
  fs.writeFileSync(path.join(__dirname,'modal-app-verification.json'),JSON.stringify({origin,download:downloadURL,owner:'modal-verification',bytes:audio.length,verifiedAt:new Date().toISOString()},null,2));
  const other=await browser.newContext();
  await other.addCookies([{name:'kiku-session',value:cookie('other-user'),url:origin,httpOnly:true,sameSite:'Lax'}]);
  if((await other.request.get(downloadURL)).status()!==404)throw new Error('Other user could download result');
  if((await context.request.get(downloadURL+'x')).status()!==404)throw new Error('Tampered ticket accepted');
  const anon=await browser.newContext();
  if((await anon.request.post(origin+'/api/modal/jobs?job=instrumental',{form:{style:'test'}})).status()!==401)throw new Error('Anonymous generation permitted');
  const bad=await context.request.post(origin+'/api/modal/jobs?job=instrumental',{headers:{Origin:origin},multipart:{style:'test',model:'ace1'}});
  if(bad.status()!==400)throw new Error('Non-Modal model accepted');
  const cross=await context.request.post(origin+'/api/modal/jobs?job=instrumental',{headers:{Origin:'https://example.com'},multipart:{style:'test'}});
  if(cross.status()!==403)throw new Error('Cross-origin generation permitted');
  if(errors.length)throw new Error(errors.join('\n'));
  await page.screenshot({path:path.join(__dirname,'modal-app-verification.png')});
  console.log('PASS: app generated and placed a valid WAV through Modal; browser used only app routes; auth, download ownership, tampered ticket, model and origin checks passed; no page errors.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message.split('\n')[0]);process.exitCode=1});
