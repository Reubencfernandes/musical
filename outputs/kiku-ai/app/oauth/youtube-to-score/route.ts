import {appOrigin} from '@/lib/auth';
export const runtime='nodejs';

/**
 * The YouTube to Score extension's OAuth client, a Client ID Metadata Document
 * like /oauth/client. It asks only who the user is: with that token the Spaces
 * count the extension's transcriptions against the user's own ZeroGPU quota.
 * Hugging Face returns to /auth/extension, which hands the code on.
 */
export function GET(){
 const origin=appOrigin();
 return Response.json({
  client_id:origin+'/oauth/youtube-to-score',client_name:'YouTube to Score',client_uri:origin,
  redirect_uris:[origin+'/auth/extension'],
  token_endpoint_auth_method:'none',grant_types:['authorization_code'],response_types:['code'],
  scope:'openid profile',
 },{headers:{'Cache-Control':'public, max-age=300'}});
}
