// Uses synthetic credentials only. Verifies local merging, copying and no uploads.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');
const {mergeWorkingSketch} = require('../firmware/prepare-sketch.js');
const repo = path.resolve(__dirname,'..');
const template = fs.readFileSync(path.join(repo,'firmware/GLiPS/GLiPS.ino'),'utf8');
const fields = {
  WIFI_SSID:'"TEST local network"', WIFI_PASS:'"TEST-$1-\\\\pass"',
  BOT_TOKEN:'"TEST_private_bot_token"', CHAT_ID:'"TEST_chat_id"', SUPABASE_KEY:'"sb_publishable_TEST_only"'
};
let working = template;
for(const [name,literal] of Object.entries(fields)) {
  const pattern=new RegExp('(const\\s+char\\s*\\*\\s*'+name+'\\s*=\\s*)""');
  working=working.replace(pattern,(_,prefix)=>prefix+literal);
}
const merged = mergeWorkingSketch(template,working);
for(const literal of Object.values(fields)) assert(merged.includes(literal),'Private literal was not preserved');
assert(merged.includes('SITE_NAME = "IKM Lumut"'));
assert(merged.includes('resetValveLatch()'));
assert.throws(()=>mergeWorkingSketch(template,working.replace('#define RELAY_FAN 40','#define RELAY_FAN 99')),/manual review/i);
assert.throws(()=>mergeWorkingSketch(template,working.replace('#define DEMO_MODE true','#define DEMO_MODE false')),/manual review/i);
assert.throws(()=>mergeWorkingSketch(template,working.replace('const float MQ_R0 = NAN;','const float MQ_R0 = 123.0;')),/Calibration/);
assert.throws(()=>mergeWorkingSketch(template,working+'\nvoid customDeviceFunction() {}'),/Function/);
assert.throws(()=>mergeWorkingSketch(template,working.replace(fields.BOT_TOKEN,'""')),/BOT_TOKEN/);
console.log('PASS private literal preservation, full sketch, pin/mode/calibration/function/missing-setting guards');
(async()=>{
 const base='http://127.0.0.1:8766';
 const server=spawn('python3',['-u','-m','http.server','8766','--bind','127.0.0.1'],{cwd:repo,stdio:'ignore'});
 let browser;
 try {
  let ready=false;
  for(let n=0;n<50;n++){try{if((await fetch(base)).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}
  assert(ready,'Test server did not start');
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({permissions:['clipboard-read','clipboard-write']});
  const page=await context.newPage();const errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>requests.push({url:r.url(),method:r.method(),body:r.postData()}));
  await page.goto(base+'/firmware/prepare-sketch.html');
  await page.locator('#workingSketch').setInputFiles({name:'working.ino',mimeType:'text/plain',buffer:Buffer.from(working)});
  await page.locator('#prepareButton').click();await page.waitForFunction(()=>!document.getElementById('resultSection').hidden);
  const actual=await page.locator('#completeSketch').inputValue();assert(actual===merged,'Browser merge differs from tested merge');
  await page.locator('#copyButton').click();assert((await page.evaluate(()=>navigator.clipboard.readText()))===actual,'Clipboard does not contain the complete code');
  const pending=page.waitForEvent('download');await page.locator('#downloadButton').click();const download=await pending;assert.equal(download.suggestedFilename(),'GLiPS.ino');assert(fs.readFileSync(await download.path(),'utf8')===actual,'Downloaded sketch differs');
  assert(requests.every(r=>r.method==='GET'&&r.body===null),'This utility must not upload code or credentials');
  assert(requests.every(r=>r.url.startsWith(base+'/')),'Unexpected external request');
  assert(requests.every(r=>!r.url.includes('TEST_private_bot_token')),'Private data in request URL');
  await page.locator('#workingSketch').setInputFiles({name:'wrong-pins.txt',mimeType:'text/plain',buffer:Buffer.from(working.replace('#define RELAY_FAN 40','#define RELAY_FAN 99'))});
  assert.equal(await page.locator('#resultSection').isVisible(),false);await page.locator('#prepareButton').click();await page.waitForFunction(()=>!document.getElementById('prepareButton').disabled);
  assert.match(await page.locator('#prepareStatus').innerText(),/manual review/i);assert.equal(await page.locator('#completeSketch').inputValue(),'');assert.equal(await page.locator('#copyButton').isDisabled(),true);
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile overflow');
  assert.deepEqual(errors,[]);
  console.log('PASS browser-only selection, complete code copy/download, no upload/external request, mismatch rejection, stale-output clearing and mobile layout');
 } finally {if(browser)await browser.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
