export function youtubeId(value:string):string|null {
 try {
  const u=new URL(value.trim()); if(u.protocol!=='https:' && u.protocol!=='http:')return null;
  if(u.username||u.password||u.port)return null;
  const host=u.hostname.toLowerCase();let id:string|null=null;
  if(host==='youtu.be')id=u.pathname.slice(1).split('/')[0];
  else if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'].includes(host)) {
   if(u.pathname==='/watch')id=u.searchParams.get('v');
   else if(/^\/(shorts|embed|live)\//.test(u.pathname))id=u.pathname.split('/')[2];
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id)?id:null;
 }catch{return null;}
}
