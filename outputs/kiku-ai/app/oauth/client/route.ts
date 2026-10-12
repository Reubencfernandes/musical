import {appOrigin,SCOPES} from '@/lib/auth';
export const runtime='nodejs';

/**
 * This app's OAuth client, as a Client ID Metadata Document: Hugging Face
 * fetches it from the client id, which is this URL. `scope` lists everything
 * the app may ask for; sign-in asks for all of them, including the repo
 * scopes the user's library needs, so saving never asks again.
 */
export function GET(){
 const origin=appOrigin();
 return Response.json({
  client_id:origin+'/oauth/client',client_name:'Kiku AI',client_uri:origin,
  redirect_uris:[origin+'/auth/callback','http://localhost/auth/callback','http://127.0.0.1/auth/callback'],
  token_endpoint_auth_method:'none',grant_types:['authorization_code'],response_types:['code'],
  scope:SCOPES.storage,
 },{headers:{'Cache-Control':'public, max-age=300'}});
}
