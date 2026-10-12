const {chromium}=require('C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1000,height:820}});
  const pending=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/transcribe',route=>pending.push(route));
  await page.goto('http://localhost:3000',{waitUntil:'networkidle'});
  await page.getByLabel('Upload audio recording',{exact:true}).setInputFiles('work/test-melody.wav');
  const chosen=[];
  for(let run=0;run<6;run++){
   await page.getByRole('button',{name:'Create score',exact:true}).click();
   const canvas=page.locator('canvas[data-particles][data-poses="16"]');await canvas.waitFor();
   const performer=await canvas.getAttribute('data-performer');
   assert(['saxophone','guitar','piano','drums'].includes(performer));
   assert.notEqual(performer,chosen.at(-1));chosen.push(performer);
   await page.waitForTimeout(150);
   assert.equal(await canvas.getAttribute('data-performer'),performer);
   await page.getByRole('button',{name:'Cancel conversion'}).click();
  }
  for(const route of pending)await route.abort().catch(()=>{});
  await page.goto('http://localhost:3000/preview/transcribe',{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Guitar',exact:true}).click();
  await page.locator('canvas[data-performer="guitar"][data-particles]').waitFor();
  await page.waitForTimeout(900);
  const a=await page.locator('canvas').evaluate(c=>c.toDataURL());
  await page.screenshot({path:'work/performer-guitar.png'});
  await page.waitForTimeout(650);
  assert.notEqual(a,await page.locator('canvas').evaluate(c=>c.toDataURL()));
  assert.deepEqual(errors,[]);
  console.log('PASS: one stable performer per conversion, no immediate repeats, cancellation and guitar motion. Selections: '+chosen.join(', '));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
