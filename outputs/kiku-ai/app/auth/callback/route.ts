import {cookies} from 'next/headers';
import {NextResponse} from 'next/server';
import {appOrigin,clientId,FLOW_COOKIE,SESSION_COOKIE,seal,unseal,cookieOptions,returnPath,type OAuthFlow} from '@/lib/auth';
export const runtime='nodejs';
/**
 * End the popup sign-in.
 *
 * The embedded page cannot be navigated from here, so the popup tells every
 * same-origin tab what happened over a BroadcastChannel and closes itself. If
 * the browser refuses to close a scripted window the user still sees the state.
 */
function closePopup(ok:boolean){
 const body='<!doctype html><html lang="en"><head><meta charset="utf-8"><title>'
  +(ok?'Signed in':'Sign-in failed')+'</title><style>body{margin:0;display:grid;place-items:center;'
  +'height:100vh;font:15px Arial,sans-serif;background:#101010;color:#f5f4f2}</style></head><body><p>'
  +(ok?'Signed in. You can close this window.':'Sign-in did not complete. Close this window and try again.')
  +'</p><script>try{new BroadcastChannel("kiku-auth").postMessage('+(ok?'"signed-in"':'"failed"')
  +');}catch(e){}window.close();<\/script></body></html>';
 return new Response(body,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
}
export async function GET(req:Request){
 const jar=await cookies(),params=new URL(req.url).searchParams;
 const flow=unseal<OAuthFlow>(jar.get(FLOW_COOKIE)?.value);
 jar.set(FLOW_COOKIE,'',cookieOptions(0));
 const back=returnPath(flow?.next||null);
 const failure=()=>flow?.popup?closePopup(false):NextResponse.redirect(appOrigin()+back+'?signIn=retry',{headers:{'Cache-Control':'no-store'}});
 if(!flow||flow.expires<Date.now()||params.get('state')!==flow.state||!params.get('code')||params.has('error'))return failure();
 try{
  const response=await fetch('https://huggingface.co/oauth/token',{method:'POST',body:new URLSearchParams({client_id:clientId(),grant_type:'authorization_code',code:params.get('code')!,redirect_uri:appOrigin()+'/auth/callback',code_verifier:flow.verifier}),cache:'no-store',signal:AbortSignal.timeout(20000)});
  if(!response.ok)return failure();
  const tokens=await response.json();
  if(typeof tokens.access_token!=='string'||!Number.isFinite(tokens.expires_in)||tokens.expires_in<=0)return failure();
  const profile=await fetch('https://huggingface.co/oauth/userinfo',{headers:{Authorization:'Bearer '+tokens.access_token},cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!profile.ok)return failure();
  const user=await profile.json();if(typeof user.sub!=='string')return failure();
  const age=Math.min(tokens.expires_in,28800);
  const granted=typeof tokens.scope==='string'?tokens.scope.split(/\s+/):[];
  const handle=typeof user.preferred_username==='string'?user.preferred_username.slice(0,100):undefined;
  jar.set(SESSION_COOKIE,seal({token:tokens.access_token,expires:Date.now()+age*1000,storage:granted.includes('write-repos')||!!flow.storage&&!granted.length,
   user:{id:user.sub,name:String(user.preferred_username||user.name||'Musician').slice(0,100),handle}}),cookieOptions(age));
  return flow.popup?closePopup(true):NextResponse.redirect(appOrigin()+back,{headers:{'Cache-Control':'no-store'}});
 }catch{return failure();}
}
