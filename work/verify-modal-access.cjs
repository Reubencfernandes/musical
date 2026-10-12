const crypto=require('node:crypto'),path=require('node:path'),fs=require('node:fs');
require(path.resolve('node_modules/@next/env')).loadEnvConfig(process.cwd());
const origin=process.env.MODAL_VERIFY_ORIGIN||'http://localhost:3000';
function seal(value){
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',Buffer.from(process.env.SESSION_SECRET,'hex'),iv);
 const encrypted=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
}
function cookie(owner){return 'kiku-session='+seal({token:'hf_local_verification',expires:Date.now()+3600000,user:{id:owner,name:'Access verification'}});}
function unseal(value){
 const bytes=Buffer.from(value,'base64url'),decipher=crypto.createDecipheriv('aes-256-gcm',Buffer.from(process.env.SESSION_SECRET,'hex'),bytes.subarray(0,12));
 decipher.setAuthTag(bytes.subarray(12,28));
 return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString());
}
async function check(url,expected,init){
 const r=await fetch(origin+url,init);
 if(r.status!==expected)throw new Error(`${url.split('?')[0]} returned ${r.status}, expected ${expected}`);
 await r.body?.cancel();
}
(async()=>{
 const user=cookie('yue2-verification'),other=cookie('other-user');
 for(const [model,file] of [['yue2','yue2-app-verification.json'],['ace15','modal-app-verification.json']]){
  const proof=JSON.parse(fs.readFileSync(path.join(__dirname,file),'utf8')),url=new URL(proof.download);
  const ticket=url.searchParams.get('ticket'),data=unseal(ticket),headers={Cookie:cookie(proof.owner)};
  if(data.model!==model||!data.path.startsWith('/results/'))throw new Error('Result is not on the persistent model volume');
  await check(url.pathname+url.search,200,{headers});
  await check(url.pathname+url.search,404,{headers:{Cookie:other}});
  await check(url.pathname+url.search,401);
  for(const damaged of [ticket+'x',ticket+'=',ticket.slice(0,10)+(ticket[10]==='A'?'B':'A')+ticket.slice(11)])
   await check('/api/modal/file?ticket='+encodeURIComponent(damaged),404,{headers});
  for(const change of [{model:'arbitrary'},{path:'/data/yue2/config.json'},{expires:Date.now()-1}])
   await check('/api/modal/file?ticket='+seal({...data,...change}),404,{headers});
 }
 for(const model of ['yue2','ace15']){
  const body=new FormData();body.set('model',model);body.set('style','test');body.set('lyrics','[verse]\ntest');
  await check('/api/modal/jobs?job=song',401,{method:'POST',body,headers:{Origin:origin}});
  await check('/api/modal/jobs?job=song',403,{method:'POST',body,headers:{Cookie:user,Origin:'https://example.com'}});
 }
 const invalid=new FormData();invalid.set('model','ace1');invalid.set('style','test');
 await check('/api/modal/jobs?job=instrumental',400,{method:'POST',body:invalid,headers:{Cookie:user,Origin:origin}});
 console.log('PASS: actual YuE2 and ACE-Step result downloads, user ownership, canonical encoding, ciphertext tampering, backend allowlist, file path, expiry, anonymous, cross-site and non-Modal checks.');
})().catch(e=>{console.error(e.message);process.exitCode=1});
