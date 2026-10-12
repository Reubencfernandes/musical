'use client';
import AppShell from '@/components/shell/AppShell';
import Library from '@/components/library/Library';

export default function LibraryPage(){return <AppShell section="library">{user=><Library user={user}/>}</AppShell>;}
