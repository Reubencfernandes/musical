'use client';
import {RotateCcw,SlidersHorizontal} from 'lucide-react';
import {type Controls,DEFAULT_CONTROLS} from '@/lib/jobs';

/** YuE2-Turbo's temperature and guidance, folded away until someone wants them. */
export default function YuE2Controls({value,change}:{value:Controls;change:(next:Controls)=>void}){
 const custom=value.temperature!==DEFAULT_CONTROLS.temperature||value.cfg!==DEFAULT_CONTROLS.cfg;
 return <details className="yue2-controls">
  <summary><SlidersHorizontal size={13} aria-hidden="true"/>Advanced{custom&&<em>Custom</em>}</summary>
  <label><span>Temperature<output>{value.temperature.toFixed(2)}</output></span>
   <input type="range" min={0.5} max={1.5} step={0.05} value={value.temperature} onChange={e=>change({...value,temperature:Number(e.target.value)})}/>
   <small>Lower is steadier and more predictable; higher is more adventurous. 1 is YuE2’s own.</small></label>
  <label><span>Guidance (CFG)<output>{value.cfg.toFixed(1)}</output></span>
   <input type="range" min={1} max={2} step={0.1} value={value.cfg} onChange={e=>change({...value,cfg:Number(e.target.value)})}/>
   <small>{value.cfg>1?'Follows your style more closely, but takes about twice as long: it runs off YuE2-Turbo’s fast path.'
    :'Off (1): YuE2-Turbo’s fast path. Raise it to follow your style more closely.'}</small></label>
  {custom&&<button type="button" onClick={()=>change(DEFAULT_CONTROLS)}><RotateCcw size={12} aria-hidden="true"/>Reset</button>}
 </details>;
}
