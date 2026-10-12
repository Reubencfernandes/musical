import {session} from '@/lib/auth';
export const runtime='nodejs';

/**
 * Hand the signed-in user's Hugging Face token to the studio page, which calls
 * the engines itself so each user's requests come from their own connection.
 * Only this app's own pages may ask: other sites never get a same-origin fetch.
 */
export async function GET(req:Request){
 if(req.headers.get('sec-fetch-site')!=='same-origin')return Response.json({error:'Please use Kiku AI.'},{status:403});
 const current=await session();
 if(!current)return Response.json({error:'Sign in with Hugging Face to continue.',signIn:true},{status:401});
 return Response.json({token:current.token,expires:current.expires},{headers:{'Cache-Control':'no-store, private'}});
}
