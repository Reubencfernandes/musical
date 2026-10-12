import type { Metadata } from 'next';
import './globals.css';
import './identity.css';
export const metadata: Metadata = { title: 'Kiku AI — sing it, score it, band it', description: 'Record or upload a take, turn it into editable notation, and build a full song around your own voice.' };
const themeScript=`try{const t=localStorage.getItem('kiku-theme');document.documentElement.dataset.theme=t==='dark'||t==='light'?t:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}catch{document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}`;
export default function Layout({children}:{children:React.ReactNode}) { return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:themeScript}}/></head><body>{children}</body></html>; }
