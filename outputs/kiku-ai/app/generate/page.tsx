'use client';
import AppShell from '@/components/shell/AppShell';
import Generate from '@/components/songs/Generate';

export default function GeneratePage(){return <AppShell section="generate">{user=><Generate user={user}/>}</AppShell>;}
