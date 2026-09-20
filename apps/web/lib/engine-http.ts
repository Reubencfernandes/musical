import http from 'node:http';

export const ENGINE_URL=process.env.LOCAL_ENGINE_URL||'http://127.0.0.1:8177';

/** POST JSON to the local engine. A song can take many minutes, so unlike fetch this never times out waiting for headers. */
export function engineRun(body:unknown,signal:AbortSignal):Promise<{status:number;json:Record<string,unknown>|null}>{
 return new Promise((resolve,reject)=>{
  const payload=Buffer.from(JSON.stringify(body));
  const request=http.request(ENGINE_URL+'/v1/tasks/run',{method:'POST',signal,headers:{'Content-Type':'application/json','Content-Length':payload.length}},response=>{
   const parts:Buffer[]=[];
   response.on('data',part=>parts.push(part));
   response.on('error',reject);
   response.on('end',()=>{
    let json:Record<string,unknown>|null=null;
    try{json=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{}
    resolve({status:response.statusCode||500,json});
   });
  });
  request.setTimeout(0);
  request.on('error',error=>reject(error.name==='AbortError'?error:new Error('The local music engine is not running. Restart Kiku Studio and try again.')));
  request.end(payload);
 });
}

export function engineError(json:Record<string,unknown>|null){
 const error=json?.error as {message?:string}|string|undefined;
 return typeof error==='string'?error:error?.message;
}
