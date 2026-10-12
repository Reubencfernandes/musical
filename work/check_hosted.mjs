import assert from 'node:assert/strict';
const origin='https://reubencf-score-studio.hf.space';
const checks=[['/',200],['/api/auth',200],['/preview/transcribe',404],['/fonts/supreme-regular.woff2',200],['/fonts/bespoke-stencil-bold.woff2',200]];
await Promise.all(checks.map(async([route,status])=>{
 const response=await fetch(origin+route,{signal:AbortSignal.timeout(30000)});
 assert.equal(response.status,status,route);
 if(route==='/api/auth')assert.deepEqual(await response.json(),{user:null});
 console.log('PASS',route,status);
}));
for(const route of ['/api/youtube','/api/transcribe']){
 const response=await fetch(origin+route,{method:'POST',signal:AbortSignal.timeout(30000)});
 assert.equal(response.status,401);console.log('PASS signed-out protection',route);
}
const login=await fetch(origin+'/auth/login',{redirect:'manual',signal:AbortSignal.timeout(30000)});
assert.equal(login.status,307);
const location=new URL(login.headers.get('location'));
assert.equal(location.origin,'https://huggingface.co');
assert.equal(location.searchParams.get('redirect_uri'),origin+'/auth/callback');
assert.equal(location.searchParams.get('code_challenge_method'),'S256');
const cookie=login.headers.get('set-cookie');assert.match(cookie,/HttpOnly/i);assert.match(cookie,/Secure/i);assert.match(cookie,/SameSite=lax/i);
const authorization=await fetch(location,{redirect:'manual',signal:AbortSignal.timeout(30000)});
assert([200,302,303,307].includes(authorization.status),'Hugging Face rejected the hosted OAuth request');
if(authorization.status===200){const text=await authorization.text();assert(!text.includes('Failed to read client metadata'),'OAuth metadata failed');}
console.log('PASS hosted sign-in redirect, secure cookie and PKCE');
