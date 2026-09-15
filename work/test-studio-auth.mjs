import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createCipheriv,randomBytes} from 'node:crypto';
import {homedir} from 'node:os';
import path from 'node:path';
const origin='http://localhost:3000';
const env=await readFile('outputs/score-studio/.env.local','utf8');
const key=Buffer.from(env.match(/^SESSION_SECRET=(.+)$/m)[1],'hex');
const token=(await readFile(path.join(homedir(),'.cache/huggingface/token'),'utf8')).trim();
function cookie(expires=Date.now()+3600000){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 const value=JSON.stringify({token,expires,user:{id:'local-integration-test',name:'Integration test'}});
 const encrypted=Buffer.concat([cipher.update(value),cipher.final()]);
 return 'score-session='+Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
}
const valid=cookie();
for(const [name,headers,status] of [
 ['anonymous',{},401],['expired',{Cookie:cookie(Date.now()-1000),Origin:origin},401],
 ['tampered',{Cookie:valid.slice(0,-10)+'aaaaaaaaaa',Origin:origin},401],
 ['cross-site',{Cookie:valid,Origin:'https://other.example'},403],
 ['missing origin',{Cookie:valid},403],
]){
 const response=await fetch(origin+'/api/transcribe',{method:'POST',headers});
 assert.equal(response.status,status,name);console.log('PASS',name);
}
const response=await fetch(origin+'/api/auth',{headers:{Cookie:valid}});
const publicSession=await response.text();assert.equal(response.status,200);assert(!publicSession.includes(token));assert(!publicSession.includes('expires'));
console.log('PASS session exposes public profile only');
const callback=await fetch(origin+'/auth/callback?code=invalid&state=invalid',{redirect:'manual'});
assert.equal(callback.status,307);assert.match(callback.headers.get('location'),/signIn=retry/);assert(!callback.headers.get('set-cookie')?.includes('score-session='));
console.log('PASS invalid OAuth state is rejected');
const signout=await fetch(origin+'/api/auth',{method:'DELETE',headers:{Cookie:valid,Origin:origin}});
assert.equal(signout.status,200);assert.match(signout.headers.get('set-cookie'),/Max-Age=0/i);
console.log('PASS sign-out clears the session');
if(process.argv.includes('--youtube')){
 const imported=await fetch(origin+'/api/youtube',{method:'POST',headers:{Cookie:valid,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({url:'https://youtu.be/u10U7BHQQ2Y'})});
 const source=await imported.json();assert.equal(imported.status,200,JSON.stringify(source));assert.equal(source.duration,275);assert.match(source.thumbnail,/u10U7BHQQ2Y/);
 const audio=await fetch(origin+source.audioUrl,{headers:{Cookie:valid}});assert.equal(audio.status,200);
 const bytes=new Uint8Array(await audio.arrayBuffer());assert(bytes.length>1000000);
 await writeFile('work/studio-import.json',JSON.stringify(source,null,2));await writeFile('work/studio-import.wav',bytes);
 console.log('PASS YouTube API imports the full song, metadata, thumbnail, and authenticated audio');
 if(process.argv.includes('--transcribe')){
  const form=new FormData();form.append('audio',new File([bytes],'song.wav',{type:'audio/wav'}));
  const result=await fetch(origin+'/api/transcribe',{method:'POST',headers:{Cookie:valid,Origin:origin},body:form});
  assert.equal(result.status,200);
  const reader=result.body.getReader(),decoder=new TextDecoder();let pending='',score;
  for(;;){const {value,done}=await reader.read();pending+=decoder.decode(value,{stream:!done});const lines=pending.split('\n');pending=lines.pop()||'';
   for(const line of lines){if(!line)continue;const event=JSON.parse(line);if(event.type==='error')throw new Error(event.data);if(event.type==='status')console.log(event.data);if(event.type==='result')score=event.data;}
   if(done)break;
  }
  assert(score?.abc?.trim());assert(score.pdf);assert(score.downloads.some(d=>/\.mid$/.test(d.name)));
  await writeFile('work/studio-real-result.json',JSON.stringify(score,null,2));
  console.log('PASS full YouTube → Next.js → ZeroGPU → editable score, MIDI and PDF');
 }
}
