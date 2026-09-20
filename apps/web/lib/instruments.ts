import type {AudioTracks} from 'abcjs';

export const instruments=[
 {program:0,name:'Piano',sample:'acoustic_grand_piano'},
 {program:24,name:'Acoustic guitar',sample:'acoustic_guitar_nylon'},
 {program:27,name:'Electric guitar',sample:'electric_guitar_clean'},
 {program:32,name:'Acoustic bass',sample:'acoustic_bass'},
 {program:40,name:'Violin',sample:'violin'},
 {program:42,name:'Cello',sample:'cello'},
 {program:48,name:'String ensemble',sample:'string_ensemble_1'},
 {program:56,name:'Trumpet',sample:'trumpet'},
 {program:65,name:'Saxophone',sample:'alto_sax'},
 {program:71,name:'Clarinet',sample:'clarinet'},
 {program:73,name:'Flute',sample:'flute'},
] as const;

/** Override embedded MIDI instruments without changing the notation or rhythm. */
export function playbackInstrument(sequence:AudioTracks,program:number):AudioTracks{
 if(!instruments.some(item=>item.program===program))throw new Error('Unsupported playback instrument.');
 return {...sequence,instrument:program,tracks:sequence.tracks.map(track=>track.map(event=>
  event.cmd==='note'||event.cmd==='program'?{...event,instrument:program}:event))};
}
