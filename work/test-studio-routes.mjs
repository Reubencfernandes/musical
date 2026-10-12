import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createCipheriv,randomBytes} from 'node:crypto';
const origin='http://localhost:3000';
const env=await readFile('outputs/kiku-ai/.env.local','utf8'),key=Buffer.from(env.match(/^SESSION_SECRET=(.+)$/m)[1],'hex');
function cookie(expires=Date.now()+3600000){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([cipher.update(JSON.stringify({token:'hf_validation_only',expires,user:{id:'test',name:'Test'}})),cipher.final()]);return 'kiku-session='+Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url');}
const headers={Cookie:cookie(),Origin:origin,'Content-Type':'application/json'};
for(const route of ['plan','generate','instrumental','cover','accompany']){
 const response=await fetch(origin+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,401,route);console.log('PASS anonymous rejected:',route);
}
for(const [route,body,match] of [
 ['plan',{style:'jazz',lyrics:'',instrumental:false},/lyrics/i],
 ['generate',{style:'jazz',lyrics:'[verse]\nHello',model:'yue2',abc:'bad score'},/native/i],
 ['instrumental',{style:'jazz',model:'yue2',abc:'bad score'},/native/i],
 ['instrumental',{style:'jazz',model:'ace15',abc:'supplied'},/YuE2/i],
]){
 const response=await fetch(origin+'/api/'+route,{method:'POST',headers,body:JSON.stringify(body)}),data=await response.json();assert.equal(response.status,400,JSON.stringify(data));assert.match(data.error,match);console.log('PASS request validation:',route);
}
const cross=await fetch(origin+'/api/plan',{method:'POST',headers:{...headers,Origin:'https://other.example'},body:'{}'});assert.equal(cross.status,403);console.log('PASS origin enforcement');
