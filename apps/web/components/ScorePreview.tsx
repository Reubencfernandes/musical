'use client';
import ScoreWorkspace from '@/components/ScoreWorkspace';
import ThemeToggle from '@/components/ThemeToggle';
import {DEMO_ABC} from '@/lib/types';
export default function ScorePreview(){return <><ThemeToggle/><ScoreWorkspace result={{abc:DEMO_ABC,status:'Preview',downloads:[]}} source={{title:'A little room for music'}} onNew={()=>{location.href='/';}}/></>;}
