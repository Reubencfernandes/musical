const {chromium}=require('C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1000,height:820}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
   window.performerProbe={};
   const arc=CanvasRenderingContext2D.prototype.arc;
   CanvasRenderingContext2D.prototype.arc=function(x,y,r,...args){
    if(this.canvas.classList.contains('musician-canvas')){
     const id=this.canvas.dataset.performer,p=window.performerProbe[id]??={offGrid:0,shifted:0,circles:0,radii:{}};
     p.circles++;if(x%9!==0||y%9!==0)p.offGrid++;
     const m=this.getTransform();if(m.e!==0||m.f!==0)p.shifted++;
     const key=x+','+y,old=p.radii[key]||[r,r];p.radii[key]=[Math.min(old[0],r),Math.max(old[1],r)];
    }
    return arc.call(this,x,y,r,...args);
   };
  });
  await page.goto('http://localhost:3000/preview/transcribe',{waitUntil:'networkidle'});
  for(const [id,label] of [['saxophone','Saxophone'],['guitar','Guitar'],['piano','Piano'],['drums','Drums']]){
   await page.getByRole('button',{name:label,exact:true}).click();
   await page.locator('canvas[data-performer="'+id+'"][data-particles][data-poses="16"]').waitFor();
   await page.waitForTimeout(1200);
   await page.screenshot({path:'work/performer-'+id+'.png'});
   await page.waitForTimeout(4700);
   const probe=await page.evaluate(id=>window.performerProbe[id],id);
   const changed=Object.values(probe.radii).filter(([min,max])=>max-min>1).length;
   assert(probe.circles>10000);assert.equal(probe.offGrid,0);assert.equal(probe.shifted,0);assert(changed>100);
   console.log(id+': 16 poses, fixed grid, '+changed+' changing dots, no positional motion.');
  }
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(150);
  const a=await page.locator('canvas').evaluate(c=>c.toDataURL());await page.waitForTimeout(250);
  assert.equal(a,await page.locator('canvas').evaluate(c=>c.toDataURL()));
  await page.getByRole('button',{name:'Switch to white mode'}).click();await page.waitForTimeout(300);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(255, 255, 255)');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'work/performer-mobile.png'});
  assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)));
  await page.getByRole('button',{name:'Guitar',exact:true}).click();
  await page.getByRole('button',{name:'Piano',exact:true}).click();
  await page.getByRole('button',{name:'Saxophone',exact:true}).click();
  await page.locator('canvas[data-performer="saxophone"][data-particles]').waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: all four performers, reduced motion, light mode, mobile layout and quick switching.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
