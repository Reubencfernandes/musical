const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../outputs/kiku-ai');
const ts=require(path.join(root,'node_modules/typescript'));
const files=new Map(),deleted=[],created=[];
let handle='cover-test',refreshes=0;
const hub={
 repoExists:async()=>false,
 createRepo:async options=>{assert.equal(options.visibility,'private');created.push(options.repo.name);},
 uploadFiles:async options=>{for(const file of options.files)files.set(options.repo.name+'/'+file.path,file.content);},
 downloadFile:async options=>files.get(options.repo.name+'/'+options.path)||null,
 deleteFiles:async options=>{deleted.push(options.paths);for(const file of options.paths)files.delete(options.repo.name+'/'+file);},
 listFiles:async function*(options){for(const key of files.keys())if(key.startsWith(options.repo.name+'/'+options.path+'/'))yield{path:key.slice(options.repo.name.length+1),type:'file'};},
};
const output=ts.transpileModule(fs.readFileSync(path.join(root,'lib/library.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const moduleObject={exports:{}};
const context={module:moduleObject,exports:moduleObject.exports,Blob,crypto:globalThis.crypto,fetch:async()=>({json:async()=>({user:{handle,storage:true}})}),
 require:name=>name==='@huggingface/hub'?hub:name==='@/lib/studio/engine'?{hfToken:async()=>'test-token'}:name==='@/lib/song-covers'?{clearCovers:()=>refreshes++}:{}};
vm.runInNewContext(output,context);
const library=moduleObject.exports;
(async()=>{
 const audio=new Blob(['test audio']),cover=new Blob(['test art'],{type:'image/webp'});
 const song={id:'song-test',title:'First title',caption:'Warm acoustic music',lyrics:'Sunrise',instrumental:false,model:'ace15',duration:30,createdAt:new Date().toISOString(),local:audio,saved:false};
 await library.saveSong(song,audio);
 let stored=await library.loadSong(song.id);assert.equal(stored.local,undefined);assert.equal(stored.saved,undefined);
 await library.renameSong(song,'Renamed while cover renders');
 const withCover={...song,cover:{model:'carlofkl/DreamLite-base',license:'CC-BY-NC-4.0',seed:123}};
 await library.saveSongCover(withCover,cover);
 stored=await library.loadSong(song.id);assert.equal(stored.title,'Renamed while cover renders');assert.equal(stored.cover.model,'carlofkl/DreamLite-base');
 assert.equal(await (await library.songCover(song.id)).text(),'test art');
 await Promise.all([library.renameSong(stored,'Final title'),library.saveSongCover(withCover,cover)]);
 stored=await library.loadSong(song.id);assert.equal(stored.title,'Final title');assert.equal(stored.cover.seed,123);
 assert.equal((await library.listSongs()).length,1);
 await library.deleteSong(stored);assert.equal(deleted.at(-1).length,3);
 await library.saveSongCover(withCover,cover);assert.equal(await library.loadSong(song.id),null);
 await library.saveSong({...song,id:'legacy'},audio);await library.deleteSong({...song,id:'legacy'});assert.equal(deleted.at(-1).length,2);
 await library.saveSong({...withCover,id:'atomic'},audio,cover);assert.ok(await library.songCover('atomic'));
 handle='second-user';library.refreshAccount();await library.saveSong({...song,id:'second'},audio);assert.equal(created.at(-1),'second-user/kiku-ai-library');assert.equal(refreshes,1);
 console.log('PASS: private cover persistence, metadata excludes UI blobs, rename/artwork concurrency, deletion of covers and legacy songs, no resurrection after deletion, account cache isolation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
