export type Download = {name:string;url:string};
export type Source = {title:string;artist?:string;thumbnail?:string;url?:string;audioUrl?:string};
/** Where each score bar starts: `bars` in quarter notes, `clock` in seconds of the recording. */
export type ScoreTiming = {bpm:number;bars:number[];clock:number[]};
export type ScoreResult = {abc:string;status:string;downloads:Download[];pdf?:string;audio?:string;timing?:ScoreTiming};
export type GenerationReport={seed?:number;locked?:boolean;truncated?:boolean;matched?:number;bars?:number;model?:string;decoder?:string};
export type SongResult = {status:string;audio?:Download;artifacts?:Download;abc:string;seed?:number;report?:GenerationReport};
/** What the engine measured in a take: the grid and chords a band was written to. */
export type Analysis = {tempo:number;key:string;duration?:number;offset?:number;beats?:number[];chords:{time:number;name:string}[];separated?:boolean;
 /** YuE2 bands: when each bar starts, and whether the band was warped onto them. */
 bars?:number[];locked?:boolean;truncated?:boolean;abc?:string;seed?:number;voice?:boolean;mix?:{vocal:number;backing:number}};
export type PartResult = {status:string;audio?:Download;prompt:string;analysis?:Analysis};
/** One bar of a score SheetSage2 read, timed in the recording it came from. */
export type ScoreBar = {start:number;end:number;chords:string[];section:string};
export type ScoreSummary = {bpm:number;key:string;keyName:string;duration:number;bars:ScoreBar[];clock:number[];beats?:number[];lyrics:string;notes:number;fills:number};
export type ScoreRead = {status:string;abc:string;summary?:ScoreSummary};
export type CoverResult = {status:string;audio?:Download;abc:string;lyrics:string;prompt:string;report?:GenerationReport};
export type PlanResult={status:string;abc:string;report?:GenerationReport};
export type LyricsResult = {status:string;lyrics:string};
export type StemsResult = {status:string;vocals?:Download;drums?:Download;bass?:Download;other?:Download};
export const DEMO_ABC = 'X:1\nT:A little room for music\nC:Kiku AI demo\nM:4/4\nL:1/8\nQ:1/4=96\nK:C\n"C" E2 G2 c2 B2 | "Am" A3 G E2 C2 | "F" F2 A2 c2 A2 | "G" B2 G2 D4 |\n"C" E2 G2 c2 e2 | "Am" d2 c2 A4 | "F" A2 G2 F2 E2 | "C" D2 E2 C4 |]';
