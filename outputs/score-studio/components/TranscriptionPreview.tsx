'use client';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import ThemeToggle from './ThemeToggle';
import {choosePerformer,type PerformerId} from '@/lib/performers';
import Processing from './Processing';

export default function TranscriptionPreview(){
 const router=useRouter();
 const [performer,setPerformer]=useState<PerformerId|null>(null);
 useEffect(()=>{
  setPerformer(choosePerformer(null));
 },[]);
 return <>
  <ThemeToggle/>
  {performer&&<Processing cancelLabel="Back to upload" performer={performer} onCancel={()=>router.push('/')}/>}
 </>;
}
