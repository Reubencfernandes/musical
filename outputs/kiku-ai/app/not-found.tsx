import Link from 'next/link';

export default function NotFound(){
 return <main className="grid min-h-svh place-items-center px-6 py-16 text-ink"><div className="flex max-w-md flex-col items-start gap-4">
  <p className="m-0 text-sm font-semibold text-accent">404</p><h1 className="m-0 text-3xl">This page isn’t here.</h1>
  <p className="m-0 leading-relaxed text-muted">Return to Explore to listen to music or start a new song.</p>
  <Link href="/" className="rounded-full bg-accent px-5 py-3 text-sm font-semibold text-white">Open Explore</Link>
 </div></main>;
}
