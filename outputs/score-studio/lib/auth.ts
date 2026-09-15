import './server-tls';
import {createCipheriv,createDecipheriv,randomBytes,createHash} from 'node:crypto';
import {cookies} from 'next/headers';

export const SESSION_COOKIE='score-session';
export const FLOW_COOKIE='score-oauth';
export const CLIENT_ID=process.env.HF_OAUTH_CLIENT_ID||'https://reubencf-score-studio-api.hf.space/.well-known/oauth-cimd';
type Session={token:string;expires:number;user:{id:string;name:string}};
export type OAuthFlow={state:string;verifier:string;expires:number};
const devGlobal=globalThis as typeof globalThis & {scoreSessionKey?:Buffer};
function key(){
 const secret=process.env.SESSION_SECRET;
 if(secret){if(!/^[a-f\d]{64}$/i.test(secret))throw new Error('SESSION_SECRET must contain 32 random bytes encoded as hex.');return Buffer.from(secret,'hex');}
 if(process.env.NODE_ENV==='production')throw new Error('SESSION_SECRET is required.');
 return devGlobal.scoreSessionKey??=(randomBytes(32));
}
export function seal(value:unknown){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);
 const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
}
export function unseal<T>(value?:string):T|null{
 if(!value)return null;
 try{const bytes=Buffer.from(value,'base64url');if(bytes.length<29)return null;
  const decipher=createDecipheriv('aes-256-gcm',key(),bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8')) as T;
 }catch{return null;}
}
export function appOrigin(){
 const configured=process.env.APP_ORIGIN||(process.env.SPACE_HOST?'https://'+process.env.SPACE_HOST:undefined);
 if(!configured&&process.env.NODE_ENV==='production')throw new Error('APP_ORIGIN is required.');
 return new URL(configured||'http://localhost:3000').origin;
}
export function cookieOptions(maxAge:number){return {httpOnly:true,secure:appOrigin().startsWith('https:'),sameSite:'lax' as const,path:'/',maxAge};}
export async function session(){
 const value=unseal<Session>((await cookies()).get(SESSION_COOKIE)?.value);
 return value&&typeof value.token==='string'&&value.expires>Date.now()&&value.user?.id?value:null;
}
export async function authorize(req:Request){
 const user=await session();
 if(!user)return {error:Response.json({error:'Sign in with Hugging Face to continue.',signIn:true},{status:401})} as const;
 if(req.method!=='GET'&&(req.headers.get('origin')!==appOrigin()||req.headers.get('sec-fetch-site')==='cross-site'))
  return {error:Response.json({error:'Please submit from Score Studio.'},{status:403})} as const;
 return {session:user} as const;
}
export function createFlow():OAuthFlow{return {state:randomBytes(32).toString('base64url'),verifier:randomBytes(32).toString('base64url'),expires:Date.now()+600000};}
export function challenge(verifier:string){return createHash('sha256').update(verifier).digest('base64url');}
