import {seal,unseal} from './auth';
import {asFile,type Engine} from './jobs';
import type {Download} from './types';

/** These credentials are used only by Next.js, never by the browser. */
export type ModalModel='ace15'|'yue2';
export function modalEngine(model:ModalModel='ace15'):{engine:Engine;headers:Record<string,string>;model:ModalModel}{
 const origin=new URL(model==='yue2'
  ?process.env.MODAL_YUE2_ORIGIN||'https://konkanillm--kiku-yue2-engine-web.modal.run'
  :process.env.MODAL_ENGINE_ORIGIN||'https://konkanillm--kiku-acestep15-engine-web.modal.run').origin;
 const key=process.env.MODAL_PROXY_KEY,secret=process.env.MODAL_PROXY_SECRET;
 if(!key||!secret)throw new Error('The Modal GPU connection is not configured.');
 return {engine:{space:model==='yue2'?'Modal YuE2':'Modal ACE-Step 1.5',origin},headers:{'Modal-Key':key,'Modal-Secret':secret},model};
}

type Ticket={owner:string;path:string;expires:number;model?:ModalModel};
const validPath=(path:string)=>(path.startsWith('/results/')||/^\/tmp\/gradio\/[a-f0-9]{64}\//.test(path))
 &&!path.split('/').includes('..')&&!/[\\\x00-\x1f]/.test(path);

/** Limit downloads to this job's result files and the user who made the request. */
export function modalFile(engine:Engine,value:unknown,owner:string,model:ModalModel='ace15'):Download|undefined{
 const file=asFile(engine,value);if(!file)return;
 const url=new URL(file.url),prefix='/gradio_api/file=';
 if(!url.pathname.startsWith(prefix))return;
 let path:string;try{path=decodeURIComponent(url.pathname.slice(prefix.length));}catch{return;}
 if(!validPath(path))return;
 const ticket=seal({owner,path,model,expires:Date.now()+24*60*60*1000} satisfies Ticket);
 return {url:'/api/modal/file?ticket='+encodeURIComponent(ticket),name:file.name};
}

export function readModalFile(ticket:string,owner:string):{path:string;model:ModalModel}|null{
 const data=unseal<Ticket>(ticket);
 return data&&data.owner===owner&&data.expires>Date.now()&&typeof data.path==='string'&&validPath(data.path)
  &&(data.model===undefined||data.model==='ace15'||data.model==='yue2')?{path:data.path,model:data.model??'ace15'}:null;
}
