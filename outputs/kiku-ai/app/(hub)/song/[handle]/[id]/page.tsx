import type {Metadata} from 'next';
import {SongScreen} from '@/components/songs/SongPage';
export const metadata:Metadata={title:'Song'};

export default async function Song({params}:{params:Promise<{handle:string;id:string}>}){
 const {handle,id}=await params;
 return <SongScreen handle={handle} id={id}/>;
}
