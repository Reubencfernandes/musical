import type {CSSProperties} from 'react';

/** Reserve the content's space while it loads, without announcing decorative blocks. */
export function Skeleton({className='',style}:{className?:string;style?:CSSProperties}){
 return <span className={'skeleton '+className} style={style} aria-hidden="true"/>;
}

export function SongSkeletons({view='rows',count=4,label='Loading songs…'}:{view?:'rows'|'cards'|'items';count?:number;label?:string}){
 return <div className="loading-placeholder" role="status" aria-label={label} aria-busy="true">
  <span className="sr-only">{label}</span>
  <ul className={view==='cards'?'pub-grid':view==='items'?'lib-list m-0 flex list-none flex-col gap-[2px] p-0':'song-list m-0 flex list-none flex-col gap-[2px] p-0'} aria-hidden="true">
   {Array.from({length:count},(_,i)=>view==='cards'
    ?<li className="pub-card skeleton-card" key={i}>
      <Skeleton className="skeleton-art"/><div className="pub-info flex min-w-0 flex-col gap-[6px]"><Skeleton className="skeleton-title"/>
       <div className="skeleton-byline"><Skeleton className="skeleton-avatar"/><Skeleton className="skeleton-name"/></div><Skeleton className="skeleton-meta"/></div>
     </li>
    :<li className={view==='items'?'lib-row skeleton-row':'song-row skeleton-row'} key={i}>
      <Skeleton className={view==='items'?'skeleton-item-icon':'skeleton-row-art'}/>
      <div className="skeleton-lines flex min-w-0 flex-1 flex-col gap-[9px]"><Skeleton className="skeleton-title" style={{width:`${64-i%3*9}%`}}/><Skeleton className="skeleton-meta"/><Skeleton className="skeleton-detail"/></div>
     </li>)}
  </ul>
 </div>;
}

export function SongPageSkeleton(){
 return <div className="song-page" role="status" aria-label="Loading song…" aria-busy="true">
  <span className="sr-only">Loading song…</span><Skeleton className="skeleton-back"/>
  <div className="song-hero" aria-hidden="true"><Skeleton className="skeleton-hero-art"/>
   <div className="song-hero-info"><Skeleton className="skeleton-meta"/><Skeleton className="skeleton-hero-title"/><Skeleton className="skeleton-title"/><Skeleton className="skeleton-meta"/><Skeleton className="skeleton-action"/></div></div>
  <div className="song-block skeleton-lines flex min-w-0 flex-1 flex-col gap-[9px]" aria-hidden="true"><Skeleton className="skeleton-meta"/><Skeleton className="skeleton-title"/><Skeleton className="skeleton-detail"/></div>
 </div>;
}

function PromptSkeleton(){
 return <div className="home-hero" aria-hidden="true"><Skeleton className="skeleton-heading"/>
  <div className="home-prompt skeleton-prompt"><Skeleton className="skeleton-title"/><Skeleton className="skeleton-detail"/><Skeleton className="skeleton-action"/></div></div>;
}

/** Keep the navigation visible while the session and the requested page are opening. */
export function PageSkeleton({section}:{section:'explore'|'home'|'generate'|'library'|'song'}){
 if(section==='song')return <SongPageSkeleton/>;
 if(section==='generate')return <div className="generate" role="status" aria-label="Loading Generate…" aria-busy="true">
  <span className="sr-only">Loading Generate…</span>
  <div className="gen-form" aria-hidden="true"><Skeleton className="skeleton-tabs"/><Skeleton className="skeleton-meta"/><Skeleton className="skeleton-input"/><Skeleton className="skeleton-detail"/><Skeleton className="skeleton-action"/></div>
  <div className="gen-list"><Skeleton className="skeleton-heading"/><SongSkeletons/></div>
 </div>;
 if(section==='library')return <div className="library"><Skeleton className="skeleton-heading"/><Skeleton className="skeleton-title"/><Skeleton className="skeleton-tabs"/><SongSkeletons label="Loading your library…"/></div>;
 return <div className="home"><PromptSkeleton/><div><Skeleton className="skeleton-section-heading"/><SongSkeletons view="cards" count={section==='home'?4:5}/></div></div>;
}
