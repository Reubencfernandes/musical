const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const s=require('./score-tests-build/studio/score.js');
const out=path.join(__dirname,'score-editor-proof');fs.mkdirSync(out,{recursive:true});
const sourceDir=path.join(__dirname,'../outputs/kiku-engine-space/fixtures');
const events=score=>score.notes.map(n=>[n.voice,n.start/score.grid,n.duration/score.grid,n.pitch]).sort();
const chords=score=>score.chords.map(c=>[c.start/score.grid,c.name]);
for(const file of fs.readdirSync(sourceDir).filter(f=>f.endsWith('.abc'))){
 const original=s.readScore(fs.readFileSync(path.join(sourceDir,file),'utf8'));
 const round=s.readScore(s.writeScore(original));
 assert.deepEqual(events(round),events(original));assert.deepEqual(chords(round),chords(original));assert.deepEqual(round.bars,original.bars);
 const note=original.notes[0],changed={...original,notes:original.notes.map(n=>n.id===note.id?{...n,pitch:n.pitch+1,duration:n.duration/2}:n)};
 const saved=s.writeScore(changed);assert.deepEqual(events(s.readScore(saved)),events(changed));assert.deepEqual(chords(s.readScore(saved)),chords(original));
 fs.writeFileSync(path.join(out,file),saved);
 const up=s.transposeScore(original,2),back=s.transposeScore(up,-2);assert.deepEqual(events(back),events(original));
 const deleted=s.changeBar(original,0,'delete');assert.equal(deleted.bars.length,original.bars.length-1);assert.equal(s.readScore(s.writeScore(deleted)).bars.length,deleted.bars.length);
 const duplicated=s.changeBar(original,0,'duplicate');assert.equal(duplicated.bars.length,original.bars.length+1);s.writeScore(duplicated);
 assert.throws(()=>s.writeScore({...original,notes:[...original.notes,{...note,id:'overlap'}]}),/overlap/);
 assert.throws(()=>s.writeScore({...original,notes:original.notes.map((n,i)=>i? n:{...n,start:-1})}),/invalid/);
 assert.throws(()=>s.writeScore({...original,chords:[{id:'bad',start:0,name:'H13'}]}),/supported chord/);
 console.log('PASS native editor: round trip, semitone/length edit, transpose, form edits and validation — '+file);
}
// Native accidentals carry across octaves. Ties must survive key/bar boundaries.
const special='X:1\nT:\nM:4/4\nL:1/32\nQ:1/4=100\nV: Vocal clef=treble name="Vocal Melody" snm="Vocal"\nV: Ins clef=treble name="Ins Melody" snm="Inst."\nK:C\n% verse\nV: Vocal\n"C"^F8f8c16-|\nV: Ins\nZ|\nV: Vocal\nc8z8[K:G]G16|\nV: Ins\nZ|\n';
const parsed=s.readScore(special);assert.equal(parsed.notes[0].pitch,66);assert.equal(parsed.notes[1].pitch,78);assert.equal(parsed.notes[2].duration,24);
assert.deepEqual(events(s.readScore(s.writeScore(parsed))),events(parsed));fs.writeFileSync(path.join(out,'native-edge-cases.abc'),s.writeScore(parsed));
assert.throws(()=>s.changeBar(parsed,0,'duplicate'),/crosses/);
console.log('PASS cross-octave accidentals, cross-bar ties, inline key changes and tied form guard');
