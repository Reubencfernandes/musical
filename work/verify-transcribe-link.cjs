const {chromium}=require('C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const errors=[];context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  await context.route('**/api/auth',route=>route.fulfill({json:{user:{id:'test',name:'Test'}}}));
  let finish;
  await context.route('**/api/transcribe',async route=>{await new Promise(resolve=>finish=resolve);await route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'result',data:{abc:'X:1\nT:Test recording\nM:4/4\nL:1/8\nQ:1/4=96\nK:C\n"C" E2 G2 c2 B2 | "Am" A3 G E2 C2 |]',status:'Test fixture',downloads:[]}})+'\n'});});
  const studio=await context.newPage();await studio.goto('http://127.0.0.1:3002',{waitUntil:'networkidle'});
  const link=studio.getByRole('link',{name:'Transcribe sheet music',exact:true});await link.waitFor();
  assert.equal(await link.evaluate(a=>a.previousElementSibling.textContent),'Export');
  await studio.screenshot({path:'E:/ScoreStudio/work/transcribe-link-desktop.png'});
  for(const width of [1440,1351,1350,1250,1100,1000,820,761,760,640,639,390,320]){
   await studio.setViewportSize({width,height:900});
   const controls=await studio.locator('.studio-bar').evaluate(bar=>[...bar.querySelectorAll('.studio-logo,.project-menu>summary,.history-buttons,.studio-transport>.transport,.lcd,.studio-header-actions>.header-pill')].filter(el=>getComputedStyle(el).display!=='none').map(el=>{const r=el.getBoundingClientRect();return {label:el.textContent||el.className,x:r.x,right:r.right,y:r.y,bottom:r.bottom};}));
   for(const [i,a] of controls.entries()){
    assert(a.x>=0&&a.right<=width,`${width}px: ${a.label} is clipped`);
    for(const b of controls.slice(i+1))assert(!(a.x<b.right&&a.right>b.x&&a.y<b.bottom&&a.bottom>b.y),`${width}px: ${a.label} overlaps ${b.label}`);
   }
   console.log('PASS: header controls visible without overlap at '+width+'px');
  }
  await studio.screenshot({path:'E:/ScoreStudio/work/transcribe-link-mobile.png'});
  const opened=context.waitForEvent('page');await link.click();const score=await opened;await score.waitForLoadState('networkidle');
  assert.equal(new URL(score.url()).pathname,'/score');
  await score.getByRole('heading',{name:'Turn audio into sheet music.'}).waitFor();
  await score.getByLabel('Upload audio recording',{exact:true}).setInputFiles({name:'test.wav',mimeType:'audio/wav',buffer:Buffer.from('test fixture')});
  await score.getByRole('button',{name:'Create score',exact:true}).click();
  await score.getByRole('button',{name:'Cancel conversion',exact:true}).waitFor();
  await score.locator('canvas[data-particles]').waitFor();
  while(!finish)await score.waitForTimeout(50);finish();
  await score.locator('.paper .abcjs-notehead').first().waitFor();
  assert.equal(new URL(studio.url()).pathname,'/');assert.deepEqual(errors,[]);
  console.log('PASS: header link next to Export, new tab, upload, animated processing, sheet music, and original studio preserved. Transcription result mocked.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
