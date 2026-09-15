import {cookies} from 'next/headers';
import {authorize,cookieOptions,session,SESSION_COOKIE} from '@/lib/auth';
export const runtime='nodejs';
export async function GET(){
 const current=await session();
 return Response.json({user:current?.user??null},{headers:{'Cache-Control':'no-store'}});
}
export async function DELETE(req:Request){
 const auth=await authorize(req);if(auth.error)return auth.error;
 (await cookies()).set(SESSION_COOKIE,'',cookieOptions(0));
 return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
}
