import type { Metadata } from 'next';
import {session} from '@/lib/auth';
import {SessionProvider,type User} from '@/components/shell/session';
import './globals.css';
export const metadata: Metadata = { title: {default:'Kiku AI — sing it, score it, band it',template:'%s · Kiku AI'}, description: 'Record or upload a take, turn it into editable notation, and build a full song around your own voice.' };
const themeScript=`try{const t=localStorage.getItem('kiku-theme');document.documentElement.dataset.theme=t==='dark'||t==='light'?t:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}catch{document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}`;
export default async function Layout({children}:{children:React.ReactNode}) {
 const current=await session();
 const user:User|null=current?{id:current.user.id,name:current.user.name,handle:current.user.handle||current.user.name,storage:!!current.storage,avatar:current.user.avatar,fullname:current.user.fullname}:null;
 return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:themeScript}}/></head><body><SessionProvider initialUser={user}>{children}</SessionProvider></body></html>;
}
