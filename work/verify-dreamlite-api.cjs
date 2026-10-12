const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
require(path.resolve('node_modules/@next/env')).loadEnvConfig(process.cwd());
const origin=process.env.MODAL_VERIFY_ORIGIN||'http://localhost:3000';
const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',Buffer.from(process.env.SESSION_SECRET,'hex'),iv);
const encrypted=Buffer.concat([cipher.update(JSON.stringify({token:'hf_local_verification',expires:Date.now()+3600000,user:{id:'cover-verification',name:'Cover verification'}})),cipher.final()]);
const cookie='kiku-session='+Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
(async()=>{
 const url=origin+'/api/modal/cover';
 let response=await fetch(url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,401);
 response=await fetch(url,{method:'POST',headers:{Cookie:cookie,Origin:'https://example.com','Content-Type':'application/json'},body:'{}'});assert.equal(response.status,403);
 response=await fetch(url,{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,400);
 response=await fetch(url,{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({title:'oversized',caption:'x'.repeat(17000)})});assert.equal(response.status,400);
 console.log('PASS: artwork API rejects anonymous, cross-site, invalid and oversized requests. Generating an actual DreamLite cover...');
 response=await fetch(url,{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},
  body:JSON.stringify({title:'Morning By The Sea',caption:'Warm acoustic folk pop, gentle piano and guitar, peaceful sunrise by the sea, hopeful and wistful',lyrics:'The morning lights our way, waves carry yesterday away'}),signal:AbortSignal.timeout(600000)});
 if(!response.ok)throw new Error('Artwork API '+response.status+': '+await response.text());
 assert.ok(response.headers.get('content-type').startsWith('image/webp'));assert.equal(response.headers.get('cache-control'),'private, no-store');
 const data=Buffer.from(await response.arrayBuffer());assert.equal(data.toString('ascii',0,4),'RIFF');assert.equal(data.toString('ascii',8,12),'WEBP');
 fs.writeFileSync(path.join(__dirname,'dreamlite-cover.webp'),data);
 fs.writeFileSync(path.join(__dirname,'dreamlite-api-verification.json'),JSON.stringify({origin,status:response.status,bytes:data.length,seed:response.headers.get('x-cover-seed'),private:true},null,2));
 console.log('PASS: authenticated API generated a real private DreamLite WebP cover ('+data.length+' bytes).');
})().catch(error=>{console.error(error);process.exitCode=1;});
