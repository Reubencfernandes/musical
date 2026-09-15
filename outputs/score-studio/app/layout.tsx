import type { Metadata } from 'next';
import './globals.css';
import './identity.css';
export const metadata: Metadata = { title: 'Score Studio — audio into notation', description: 'Turn audio recordings into editable sheet music. Listen, follow the notes, and make it your own.' };
const themeScript=`try{const t=localStorage.getItem('score-theme');document.documentElement.dataset.theme=t==='dark'||t==='light'?t:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}catch{document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}`;
export default function Layout({children}:{children:React.ReactNode}) { return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:themeScript}}/></head><body>{children}</body></html>; }
