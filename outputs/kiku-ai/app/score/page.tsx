import type {Metadata} from 'next';
import ScoreScreen from '@/components/score/ScoreScreen';
export const metadata:Metadata={title:'Score'};

export default async function ScorePage({searchParams}:{searchParams:Promise<{saved?:string|string[]}>}){
 const params=await searchParams;
 return <ScoreScreen saved={typeof params.saved==='string'?params.saved:undefined}/>;
}
