import {notFound} from 'next/navigation';
import ScorePreview from '@/components/ScorePreview';
export default function Page(){if(process.env.NODE_ENV!=='development')notFound();return <ScorePreview/>;}
