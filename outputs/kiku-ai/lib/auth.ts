import 'server-only';
import './server-tls';
import {createCipheriv,createDecipheriv,randomBytes,createHash} from 'node:crypto';
import {cookies} from 'next/headers';

export const SESSION_COOKIE='kiku-session';
export const FLOW_COOKIE='kiku-oauth';
/**
 * The OAuth client: a Client ID Metadata Document this app publishes at
 * /oauth/client (the document's URL is the client id). Locally, where Hugging
 * Face cannot fetch the document, the engine's older client is used instead.
 */
export function clientId(){
 if(process.env.HF_OAUTH_CLIENT_ID)return process.env.HF_OAUTH_CLIENT_ID;
 return process.env.NODE_ENV==='production'?appOrigin()+'/oauth/client':'https://reubencf-kiku-engine.hf.space/.well-known/oauth-cimd';
}
/**
 * Signing in asks only who the user is. Saving to their library needs their
 * permission to create and write repos, asked for the first time they save.
 */
export const SCOPES={base:'openid profile',storage:'openid profile read-repos write-repos manage-repos'};
/** `avatar` is the Hugging Face profile picture, shown instead of an initial; `fullname` the name on the profile. */
type Session={token:string;expires:number;user:{id:string;name:string;handle?:string;avatar?:string;fullname?:string};storage?:boolean};
export type OAuthFlow={state:string;verifier:string;expires:number;popup?:boolean;next?:string;storage?:boolean};
/** Pages sign-in may return to. A fixed list, so the parameter can never become an open redirect. */
const RETURNS=new Set(['/','/score','/studio','/generate','/library','/home']);
export const returnPath=(value:string|null)=>value&&RETURNS.has(value)?value:'/';
const devGlobal=globalThis as typeof globalThis & {kikuSessionKey?:Buffer};
function key(){
 const secret=process.env.SESSION_SECRET;
 if(secret){if(!/^[a-f\d]{64}$/i.test(secret))throw new Error('SESSION_SECRET must contain 32 random bytes encoded as hex.');return Buffer.from(secret,'hex');}
 if(process.env.NODE_ENV==='production')throw new Error('SESSION_SECRET is required.');
 return devGlobal.kikuSessionKey??=(randomBytes(32));
}
export function seal(value:unknown){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);
 const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
}
export function unseal<T>(value?:string):T|null{
 if(!value)return null;
 try{if(!/^[A-Za-z0-9_-]+$/.test(value))return null;
  const bytes=Buffer.from(value,'base64url');if(bytes.length<29||bytes.toString('base64url')!==value)return null;
  const decipher=createDecipheriv('aes-256-gcm',key(),bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8')) as T;
 }catch{return null;}
}
export function appOrigin(){
 const configured=process.env.APP_ORIGIN||(process.env.SPACE_HOST?'https://'+process.env.SPACE_HOST:undefined);
 if(!configured&&process.env.NODE_ENV==='production')throw new Error('APP_ORIGIN is required.');
 return new URL(configured||'http://localhost:3000').origin;
}
/**
 * On huggingface.co the app runs in an iframe from another site, where browsers
 * only send SameSite=None cookies. Requests that change anything are still
 * checked against the app's origin in authorize(), and the token route takes
 * same-origin requests only. Plain-http local runs cannot use None, so keep Lax.
 */
export function cookieOptions(maxAge:number){
 const secure=appOrigin().startsWith('https:');
 return {httpOnly:true,secure,sameSite:secure?'none' as const:'lax' as const,path:'/',maxAge};
}
export async function session(){
 const value=unseal<Session>((await cookies()).get(SESSION_COOKIE)?.value);
 return value&&typeof value.token==='string'&&value.expires>Date.now()&&value.user?.id?value:null;
}
/**
 * Native apps (the Kiku AI Flutter app) sign in with Hugging Face themselves
 * and send the user's own token as a bearer header instead of a cookie. The
 * token is checked with Hugging Face and the answer kept for a few minutes, so
 * a job's many requests cost one check. No cookie is involved, so a forged
 * cross-site request has nothing to ride on and the origin check is not needed.
 */
const BEARER_TTL=5*60*1000;
const bearerStore=globalThis as typeof globalThis & {kikuBearers?:Map<string,{session:Session;checked:number}>};
const bearers=bearerStore.kikuBearers??=new Map();
async function bearerSession(header:string):Promise<Session|null>{
 const token=/^Bearer\s+(hf_[A-Za-z0-9_-]{20,250})$/i.exec(header.trim())?.[1];
 if(!token)return null;
 const key=createHash('sha256').update(token).digest('base64url'),known=bearers.get(key);
 if(known&&Date.now()-known.checked<BEARER_TTL)return known.session;
 bearers.delete(key);
 try{
  const response=await fetch('https://huggingface.co/api/whoami-v2',{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!response.ok)return null;
  const who=await response.json();
  if(who?.type!=='user'||typeof who.id!=='string'||typeof who.name!=='string')return null;
  const handle=who.name.slice(0,100);
  const current:Session={token,expires:Date.now()+BEARER_TTL,user:{id:who.id,name:handle,handle}};
  if(bearers.size>=1000)bearers.delete(bearers.keys().next().value!);
  bearers.set(key,{session:current,checked:Date.now()});
  return current;
 }catch{return null;}
}
export async function authorize(req:Request){
 const header=req.headers.get('authorization');
 if(header){
  const app=await bearerSession(header);
  return app?{session:app} as const:{error:Response.json({error:'Sign in with Hugging Face to continue.',signIn:true},{status:401})} as const;
 }
 const user=await session();
 if(!user)return {error:Response.json({error:'Sign in with Hugging Face to continue.',signIn:true},{status:401})} as const;
 if(req.method!=='GET'&&(req.headers.get('origin')!==appOrigin()||req.headers.get('sec-fetch-site')==='cross-site'))
  return {error:Response.json({error:'Please submit from Kiku AI.'},{status:403})} as const;
 return {session:user} as const;
}
export function createFlow(popup=false,next='/',storage=false):OAuthFlow{return {state:randomBytes(32).toString('base64url'),verifier:randomBytes(32).toString('base64url'),expires:Date.now()+600000,popup,next,storage};}
export function challenge(verifier:string){return createHash('sha256').update(verifier).digest('base64url');}
