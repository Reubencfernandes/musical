export const PERFORMERS=[
 {id:'saxophone',label:'Saxophone',person:'saxophonist'},
 {id:'guitar',label:'Guitar',person:'guitarist'},
 {id:'piano',label:'Piano',person:'pianist'},
 {id:'drums',label:'Drums',person:'drummer'},
] as const;
export type PerformerId=typeof PERFORMERS[number]['id'];
export const POSE_COUNT=16;
export const LOOP_SECONDS=5.7;
export const GRID_SIZE=512;
export const GRID_SPACING=9;
export type PerformerDot={x:number;y:number;coverage:Float32Array};
const cache=new Map<PerformerId,Promise<PerformerDot[]>>();

export function choosePerformer(previous:PerformerId|null):PerformerId{
 const options=PERFORMERS.filter(item=>item.id!==previous);
 return options[Math.floor(Math.random()*options.length)].id;
}

// Continuous slopes avoid a stop/start at each illustrated pose.
export function coverageAt(poses:Float32Array,position:number){
 const index=Math.floor(position),t=position-index,n=poses.length;
 const p0=poses[(index+n-1)%n],p1=poses[index%n],p2=poses[(index+1)%n],p3=poses[(index+2)%n];
 const value=.5*(2*p1+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t);
 return Math.max(0,Math.min(1,value));
}

export function loadPerformer(id:PerformerId):Promise<PerformerDot[]>{
 const cached=cache.get(id);if(cached)return cached;
 const pending=new Promise<PerformerDot[]>((resolve,reject)=>{
  const img=new Image();
  img.onload=()=>{
   try{
    const sample=document.createElement('canvas');sample.width=GRID_SIZE;sample.height=GRID_SIZE;
    const scan=sample.getContext('2d',{willReadFrequently:true});
    if(!scan)throw new Error('Canvas is unavailable.');
    const grid:PerformerDot[]=[];
    for(let y=9;y<504;y+=GRID_SPACING)for(let x=9;x<504;x+=GRID_SPACING)
     grid.push({x,y,coverage:new Float32Array(POSE_COUNT)});
    const cellWidth=img.naturalWidth/4,cellHeight=img.naturalHeight/4;
    for(let pose=0;pose<POSE_COUNT;pose++){
     scan.clearRect(0,0,GRID_SIZE,GRID_SIZE);
     scan.drawImage(img,(pose%4)*cellWidth,Math.floor(pose/4)*cellHeight,cellWidth,cellHeight,0,0,GRID_SIZE,GRID_SIZE);
     const pixels=scan.getImageData(0,0,GRID_SIZE,GRID_SIZE).data;
     for(const dot of grid){
      let coverage=0;
      // Preserve the generated alpha silhouette, including dark clothing.
      // Discard faint matte fringes. The grid never moves between poses.
      for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){
       const p=((dot.y+dy)*GRID_SIZE+dot.x+dx)*4;
       const alpha=Math.max(0,(pixels[p+3]-32)/223);
       // Keep the acoustic guitar's soundhole and the strumming hand legible.
       const detail=id==='guitar'?Math.max(0,((pixels[p]+pixels[p+1]+pixels[p+2])/3-24)/231):1;
       coverage+=alpha*detail;
      }
      dot.coverage[pose]=Math.min(1,coverage/81);
     }
    }
    const dots=grid.filter(dot=>dot.coverage.some(value=>value>.01));
    if(!dots.length)throw new Error('The performer artwork is empty.');
    resolve(dots);
   }catch(error){reject(error);}
  };
  img.onerror=()=>reject(new Error('The performer artwork could not load.'));
  img.src='/performers/'+id+'.png';
 });
 cache.set(id,pending);
 pending.catch(()=>cache.delete(id));
 return pending;
}
