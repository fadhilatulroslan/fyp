const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
(async()=>{
 const server=spawn('python3',['-m','http.server','8781','--bind','127.0.0.1'],{cwd:require('node:path').resolve(__dirname,'..'),stdio:'ignore'});
 let browser;
 try {
  const base='http://127.0.0.1:8781';let ready=false;
  for(let i=0;i<40;i++){try{if((await fetch(base)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  assert(ready,'Local server unavailable');
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  // Exercise media independently of the unchanged authentication connector.
  await page.route('**/*',r=>{
   const url=r.request().url();
   if(url.endsWith('/login.js'))return r.fulfill({contentType:'text/javascript',body:''});
   if(!url.startsWith(base))return r.abort();return r.continue();
  });
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/index.html');
  await page.waitForFunction(()=>{const v=document.getElementById('loginFilm');return v.readyState>=2&&v.currentTime>0;});
  assert(await page.locator('#loginFilm').evaluate(v=>v.muted&&v.loop&&v.playsInline&&v.videoWidth>0));
  await page.getByRole('button',{name:'Pause film',exact:true}).click();
  assert(await page.locator('#loginFilm').evaluate(v=>v.paused));
  await page.getByRole('button',{name:'Play film',exact:true}).click();
  await page.waitForFunction(()=>!document.getElementById('loginFilm').paused);
  for(const [width,height]of[[1440,900],[1366,768],[1024,650],[390,844]]){
   await page.setViewportSize({width,height});await page.waitForTimeout(750);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow');
   if(width>780)assert(await page.locator('#loginBtn').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight),'Login button clipped');
  }
  await page.setViewportSize({width:1440,height:900});await page.screenshot({path:'/tmp/login-film-desktop.png'});
  await page.emulateMedia({reducedMotion:'reduce'});await page.reload();await page.waitForTimeout(600);
  assert(await page.locator('#loginFilm').evaluate(v=>v.paused),'Reduced motion must not autoplay');
  await page.getByRole('button',{name:'Play film',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('loginFilm').paused);
  await page.route('**/glips-film.mp4',r=>r.abort());await page.reload();
  await page.waitForFunction(()=>document.getElementById('filmToggle').disabled);
  assert(await page.locator('#loginFilm').getAttribute('poster'));
  assert.deepEqual(errors,[]);
  console.log('PASS real video decode, muted autoplay, pause/play, four layouts, reduced motion and unavailable-video fallback');
 }finally{if(browser)await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
