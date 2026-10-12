'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Check,ChevronDown,type LucideIcon} from 'lucide-react';

export type ComposerOption={value:string;label:string;description?:string;icon?:LucideIcon;color?:string;disabled?:boolean};
type Props={label:string;value:string;options:ComposerOption[];icon:LucideIcon;open:boolean;
 toggle:()=>void;close:()=>void;change:(value:string)=>void;grid?:boolean;disabled?:boolean};

export default function ComposerSelect({label,value,options,icon:Icon,open,toggle,close,change,grid,disabled}:Props){
 const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),items=useRef<(HTMLButtonElement|null)[]>([]);
 const popup=useRef<HTMLDivElement>(null);
 const [position,setPosition]=useState<{left:number;top:number;width:number;maxHeight:number}|null>(null);
 const selected=options.find(option=>option.value===value);
 const displayName=value===''&&label==='Style'?label:selected?.label||value;
 useEffect(()=>{
  if(!open)return;
  const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!root.current?.contains(event.target)&&!popup.current?.contains(event.target))close();};
  document.addEventListener('pointerdown',outside);
  const index=options.findIndex(option=>option.value===value&&!option.disabled);
  items.current[index>=0?index:options.findIndex(option=>!option.disabled)]?.focus();
  return()=>document.removeEventListener('pointerdown',outside);
 },[open,close,options,value,!!position]);
 useLayoutEffect(()=>{
  if(!open){setPosition(null);return;}
  const place=()=>{const rect=trigger.current?.getBoundingClientRect();if(!rect)return;
   const width=Math.min(grid?420:310,window.innerWidth-24),height=Math.min(popup.current?.scrollHeight||260,410);
   const above=rect.top-12,below=window.innerHeight-rect.bottom-12,up=above>=height||above>below;
   const maxHeight=Math.max(100,Math.min(410,(up?above:below)-8));
   setPosition({left:Math.max(12,Math.min(rect.left,window.innerWidth-width-12)),top:up?Math.max(8,rect.top-8-Math.min(height,maxHeight)):rect.bottom+8,width,maxHeight});
  };
  place();const frame=requestAnimationFrame(place);window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
  return()=>{cancelAnimationFrame(frame);window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
 },[open,grid,options]);

 function key(event:React.KeyboardEvent){
  if(event.key==='Enter'||event.key===' '){event.stopPropagation();return;}
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();trigger.current?.focus();return;}
  if(event.key==='Tab'){close();return;}
  const direction=['ArrowDown','ArrowRight'].includes(event.key)?1:['ArrowUp','ArrowLeft'].includes(event.key)?-1:0;
  if(!direction&&event.key!=='Home'&&event.key!=='End')return;
  event.preventDefault();event.stopPropagation();
  if(!open){toggle();return;}
  const enabled=options.map((option,index)=>option.disabled?-1:index).filter(index=>index>=0);
  const current=enabled.findIndex(index=>items.current[index]===document.activeElement);
  const next=event.key==='Home'?enabled[0]:event.key==='End'?enabled.at(-1):enabled[(current+direction+enabled.length)%enabled.length];
  if(next!==undefined)items.current[next]?.focus();
 }

 return <div className="composer-choice" ref={root} onKeyDown={key}>
  <button ref={trigger} type="button" className={'composer-selector'+(open?' expanded':'')} aria-label={`${label}: ${displayName}`}
   aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={toggle}>
   <Icon size={13}/><span>{displayName}</span><ChevronDown className="selector-chevron" size={11}/>
  </button>
  {open&&createPortal(<div ref={popup} className={'composer-menu composer-menu-floating'+(grid?' style-menu':'')}
   style={{position:'fixed',bottom:'auto',left:position?.left||0,top:position?.top||0,width:position?.width||(grid?420:310),maxHeight:position?.maxHeight||410,visibility:position?'visible':'hidden'}}>
   <div className="composer-menu-heading"><span>{label==='Style'?'Find your sound':label==='AI model'?'Choose your AI':'Choose '+label.toLowerCase()}</span><span>{label==='Style'?'STYLE':label==='AI model'?'MODEL':label==='Cover mode'?'COVER':label==='Harmony'?'CHORDS':'INSTRUMENT'}</span></div>
   <div className="composer-options" role="listbox" aria-label={label}>
    {options.map((option,index)=>{const ItemIcon=option.icon||Icon,chosen=value===option.value;
     return <button key={option.value} ref={element=>{items.current[index]=element;}} type="button" role="option"
      aria-selected={chosen} disabled={option.disabled} className={'composer-option'+(chosen?' selected':'')}
      title={option.disabled?'Not available for this action':option.description} onClick={()=>{change(option.value);close();trigger.current?.focus();}}>
      <span className="option-icon" style={{['--option-color' as string]:option.color||'#ad9aca'}}><ItemIcon size={15}/></span>
      <span className="option-copy"><strong>{option.label}</strong>{!grid&&option.description&&<small>{option.description}</small>}</span>
      {chosen&&<Check size={13} className="option-check"/>}
     </button>;
    })}
   </div>
  </div>,document.body)}
 </div>;
}
