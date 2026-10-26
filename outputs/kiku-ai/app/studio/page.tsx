import type {Metadata} from 'next';
import StudioScreen from '@/components/studio/StudioScreen';
export const metadata:Metadata={title:'Studio'};

export default async function StudioPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const params=await searchParams;
 const value=(name:string)=>typeof params[name]==='string'?params[name] as string:undefined;
 return <StudioScreen open={{project:value('project'),song:value('song'),draft:value('draft')}}/>;
}
