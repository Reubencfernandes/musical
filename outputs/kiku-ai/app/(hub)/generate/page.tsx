import type {Metadata} from 'next';
import {GenerateScreen} from '@/components/songs/Generate';
export const metadata:Metadata={title:'Generate'};

export default function GeneratePage(){return <GenerateScreen/>;}
