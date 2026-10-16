/**
 * Work kept in this browser (IndexedDB) so a refresh, a crash or a lost
 * connection never loses it: the studio's open project with its audio and
 * running jobs, and the Generate page's songs in progress or not yet in the
 * library. The library on Hugging Face stays the copy that follows the user
 * between devices; this one only covers the gaps.
 */
const DB='kiku-local',VERSION=1;
export type Store='drafts'|'audio'|'songs';

let opening:Promise<IDBDatabase>|null=null;
function db(){
 return opening??=new Promise<IDBDatabase>((resolve,reject)=>{
  const request=indexedDB.open(DB,VERSION);
  request.onupgradeneeded=()=>{
   const base=request.result;
   if(!base.objectStoreNames.contains('drafts'))base.createObjectStore('drafts',{keyPath:'key'});
   if(!base.objectStoreNames.contains('audio'))base.createObjectStore('audio');
   if(!base.objectStoreNames.contains('songs'))base.createObjectStore('songs',{keyPath:'id'});
  };
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>{opening=null;reject(request.error);};
 });
}

/**
 * Run `work` in one transaction and resolve once it commits. Reads and writes
 * made from its request callbacks stay inside the transaction, so a
 * check-then-write cannot interleave with another tab's.
 */
export async function transact(stores:Store[],mode:IDBTransactionMode,work:(tx:IDBTransaction)=>void){
 const tx=(await db()).transaction(stores,mode);
 const done=new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
 work(tx);
 return done;
}

export async function get<T>(store:Store,key:string){
 let value:T|undefined;
 await transact([store],'readonly',tx=>{const request=tx.objectStore(store).get(key);request.onsuccess=()=>{value=request.result as T|undefined;};});
 return value;
}
export async function all<T>(store:Store){
 let values:T[]=[];
 await transact([store],'readonly',tx=>{const request=tx.objectStore(store).getAll();request.onsuccess=()=>{values=request.result as T[];};});
 return values;
}
export async function put(store:Store,value:unknown){await transact([store],'readwrite',tx=>{tx.objectStore(store).put(value);});}
export async function remove(store:Store,key:string){await transact([store],'readwrite',tx=>{tx.objectStore(store).delete(key);});}
