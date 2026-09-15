import {cookies} from 'next/headers';
import {NextResponse} from 'next/server';
import {appOrigin,CLIENT_ID,FLOW_COOKIE,SESSION_COOKIE,seal,unseal,cookieOptions,type OAuthFlow} from '@/lib/auth';
export const runtime='nodejs';
export async function GET(req:Request){
 const jar=await cookies(),params=new URL(req.url).searchParams;
 const flow=unseal<OAuthFlow>(jar.get(FLOW_COOKIE)?.value);
 jar.set(FLOW_COOKIE,'',cookieOptions(0));
 const failure=()=>NextResponse.redirect(appOrigin()+'/?signIn=retry',{headers:{'Cache-Control':'no-store'}});
 if(!flow||flow.expires<Date.now()||params.get('state')!==flow.state||!params.get('code')||params.has('error'))return failure();
 try{
  const response=await fetch('https://huggingface.co/oauth/token',{method:'POST',body:new URLSearchParams({client_id:CLIENT_ID,grant_type:'authorization_code',code:params.get('code')!,redirect_uri:appOrigin()+'/auth/callback',code_verifier:flow.verifier}),cache:'no-store',signal:AbortSignal.timeout(20000)});
  if(!response.ok)return failure();
  const tokens=await response.json();
  if(typeof tokens.access_token!=='string'||!Number.isFinite(tokens.expires_in)||tokens.expires_in<=0)return failure();
  const profile=await fetch('https://huggingface.co/oauth/userinfo',{headers:{Authorization:'Bearer '+tokens.access_token},cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!profile.ok)return failure();
  const user=await profile.json();if(typeof user.sub!=='string')return failure();
  const age=Math.min(tokens.expires_in,28800);
  jar.set(SESSION_COOKIE,seal({token:tokens.access_token,expires:Date.now()+age*1000,user:{id:user.sub,name:String(user.preferred_username||user.name||'Musician').slice(0,100)}}),cookieOptions(age));
  return NextResponse.redirect(appOrigin(),{headers:{'Cache-Control':'no-store'}});
 }catch{return failure();}
}
