export type Download = {name:string;url:string};
export type Source = {title:string;artist?:string;thumbnail?:string;url?:string;audioUrl?:string};
export type ScoreResult = {abc:string;status:string;downloads:Download[];pdf?:string;audio?:string};
export const DEMO_ABC = 'X:1\nT:A little room for music\nC:Score Studio demo\nM:4/4\nL:1/8\nQ:1/4=96\nK:C\n"C" E2 G2 c2 B2 | "Am" A3 G E2 C2 | "F" F2 A2 c2 A2 | "G" B2 G2 D4 |\n"C" E2 G2 c2 e2 | "Am" d2 c2 A4 | "F" A2 G2 F2 E2 | "C" D2 E2 C4 |]';
