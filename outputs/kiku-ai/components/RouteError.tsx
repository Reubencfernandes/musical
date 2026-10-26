'use client';
import Link from 'next/link';

export default function RouteError({reset}:{error:Error&{digest?:string};reset:()=>void}){
 return <section role="alert" className="mx-auto flex max-w-md flex-col items-start gap-4 rounded-2xl border border-line bg-panel p-6 text-ink">
  <h1 className="m-0 text-2xl">This page couldn’t open.</h1>
  <p className="m-0 text-sm leading-relaxed text-muted">Try again, or return to Explore. Your saved music stays in your library.</p>
  <div className="flex flex-wrap gap-3"><button onClick={reset} className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white">Try again</button>
   <Link href="/" className="rounded-full border border-line px-5 py-2.5 text-sm">Explore</Link></div>
 </section>;
}
