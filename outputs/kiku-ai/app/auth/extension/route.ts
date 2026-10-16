export const runtime='nodejs';

/**
 * Where Hugging Face returns when the YouTube to Score extension signs in.
 * Hugging Face only returns to fixed addresses, but every unpacked copy of the
 * extension has its own ID, so the extension puts its ID at the start of
 * `state` and this forwards the answer to that extension's chromiumapp.org
 * address, where chrome.identity picks it up. Only extension callback
 * addresses are reachable from here, and the code is useless without the
 * PKCE verifier the extension kept.
 */
export function GET(req:Request){
 const query=new URL(req.url).searchParams;
 const id=/^([a-p]{32})\./.exec(query.get('state')||'')?.[1];
 if(!id)return new Response('This address finishes signing in to the YouTube to Score extension.',{status:400,headers:{'Content-Type':'text/plain; charset=utf-8'}});
 return new Response(null,{status:302,headers:{Location:`https://${id}.chromiumapp.org/callback?${query}`,'Cache-Control':'no-store'}});
}
