import type {AudioTracks} from 'abcjs';

/** Scores are lead sheets (melody and chord names), which read best on piano. */
export const instruments=[
 {program:0,name:'Piano',sample:'acoustic_grand_piano'},
] as const;

/** Override embedded MIDI instruments without changing the notation or rhythm. */
export function playbackInstrument(sequence:AudioTracks,program:number):AudioTracks{
 if(!instruments.some(item=>item.program===program))throw new Error('Unsupported playback instrument.');
 return {...sequence,instrument:program,tracks:sequence.tracks.map(track=>track.map(event=>
  event.cmd==='note'||event.cmd==='program'?{...event,instrument:program}:event))};
}
