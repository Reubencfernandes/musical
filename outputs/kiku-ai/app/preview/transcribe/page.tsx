import {notFound} from 'next/navigation';
import TranscriptionPreview from '@/components/TranscriptionPreview';

export default function Page(){
 if(process.env.NODE_ENV!=='development')notFound();
 return <TranscriptionPreview/>;
}
