import {cookies} from 'next/headers';
import {NextResponse} from 'next/server';
import {appOrigin,CLIENT_ID,FLOW_COOKIE,seal,createFlow,challenge,cookieOptions} from '@/lib/auth';
export const runtime='nodejs';
export async function GET(){
 const flow=createFlow();
 (await cookies()).set(FLOW_COOKIE,seal(flow),cookieOptions(600));
 const url=new URL('https://huggingface.co/oauth/authorize');
 url.search=new URLSearchParams({client_id:CLIENT_ID,redirect_uri:appOrigin()+'/auth/callback',response_type:'code',scope:'openid profile',state:flow.state,code_challenge:challenge(flow.verifier),code_challenge_method:'S256'}).toString();
 return NextResponse.redirect(url,{headers:{'Cache-Control':'no-store'}});
}
