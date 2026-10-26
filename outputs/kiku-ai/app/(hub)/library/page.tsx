import type {Metadata} from 'next';
import {LibraryScreen} from '@/components/library/Library';
export const metadata:Metadata={title:'Library'};

export default function LibraryPage(){return <LibraryScreen/>;}
