'use client';
import AppShell from '@/components/shell/AppShell';
import Home from '@/components/home/Home';

export default function HomePage(){return <AppShell section="home">{user=><Home user={user}/>}</AppShell>;}
