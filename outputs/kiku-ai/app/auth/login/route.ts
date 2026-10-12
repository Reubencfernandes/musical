import {cookies} from 'next/headers';
import {NextResponse} from 'next/server';
import {appOrigin,clientId,FLOW_COOKIE,SCOPES,seal,createFlow,challenge,cookieOptions,returnPath} from '@/lib/auth';
export const runtime='nodejs';
export async function GET(req:Request){
 // Hugging Face sends X-Frame-Options on its OAuth page and the Spaces iframe
 // has no allow-top-navigation, so an embedded app must sign in through a
 // popup. The flag rides in the sealed cookie and closes that window at the end.
 const params=new URL(req.url).searchParams;
 // Sign-in always asks to save to the user's own Hugging Face account, so one
 // consent covers the library: asking separately came back with every new session.
 const flow=createFlow(params.get('popup')==='1',returnPath(params.get('next')),true);
 (await cookies()).set(FLOW_COOKIE,seal(flow),cookieOptions(600));
 const url=new URL('https://huggingface.co/oauth/authorize');
 url.search=new URLSearchParams({client_id:clientId(),redirect_uri:appOrigin()+'/auth/callback',response_type:'code',scope:flow.storage?SCOPES.storage:SCOPES.base,state:flow.state,code_challenge:challenge(flow.verifier),code_challenge_method:'S256'}).toString();
 return NextResponse.redirect(url,{headers:{'Cache-Control':'no-store'}});
}
