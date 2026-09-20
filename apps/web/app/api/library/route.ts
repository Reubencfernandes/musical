import {authorize} from '@/lib/auth';
import {LOCAL_ENGINE} from '@/lib/local-engine';
import {listSongs} from '@/lib/library';
export const runtime='nodejs';
export async function GET(req:Request){
 const auth=await authorize(req);if(auth.error)return auth.error;
 return Response.json({songs:LOCAL_ENGINE?await listSongs():[]},{headers:{'Cache-Control':'no-store'}});
}
