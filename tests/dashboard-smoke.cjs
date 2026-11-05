// Run with `node tests/dashboard-smoke.cjs` after installing Playwright externally.
// Uses a local server and intercepted backend/camera responses; never sends real alerts.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const base = 'http://127.0.0.1:8765';
const backend = 'https://fkfgimyelgvlsbtxhvih.supabase.co';
const row = (id, gas, age = 0) => ({id, gas_ppm:gas, created_at:new Date(Date.now()-age).toISOString(),temperature:27,humidity:65,wifi_connected:true,gas_valve:'CLOSED',exhaust_fan:true});
(async () => {
  const server = spawn('python3', ['-u','-m','http.server','8765','--bind','127.0.0.1'], {cwd:repo,stdio:['ignore','ignore','pipe']});
  let browser;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { const response = await fetch(base); if(response.ok) {ready=true;break;} } catch {}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert(ready, 'Local server did not start');
    browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox'],...(process.env.HTTPS_PROXY ? {proxy:{server:process.env.HTTPS_PROXY,bypass:'127.0.0.1,localhost'}} : {})});
    const page = await browser.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    let rows=[row(1,45)], fail=false, aiFail=false, telegramCalls=0;
    // Use the real SDK with a test-only session, without needing a real account.
    await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2*', async route => {
      const response = await route.fetch();
      const body = await response.text();
      await route.fulfill({response,body:body+`;(() => {const create=window.supabase.createClient;window.supabase.createClient=(...args)=>{const client=create(...args);client.auth.getSession=async()=>({data:{session:{access_token:'test-only'}},error:null});return client}})();`});
    });
    await page.route(backend+'/**', async route => {
      const url = new URL(route.request().url());
      if(url.pathname.startsWith('/rest/v1/')) return route.fulfill({status:fail?503:200,contentType:'application/json',body:JSON.stringify(fail?{message:'Simulated outage'}:rows)});
      if(url.pathname.endsWith('/glips-ai')) return route.fulfill({status:aiFail?500:200,contentType:'application/json',body:JSON.stringify(aiFail?{error:'Simulated AI failure'}:{answer:'**Live response**\n<script>bad()</script>'})});
      if(url.pathname.endsWith('/test-telegram')) {telegramCalls++;return route.fulfill({contentType:'application/json',body:'{"ok":true}'});}
      return route.fulfill({status:401,contentType:'application/json',body:'{"message":"No real authentication in tests"}'});
    });
    await page.route('https://chemical-plenty-reasons-experiments.trycloudflare.com/stream*', r=>r.fulfill({contentType:'image/png',path:path.join(repo,'esp.png')}));
    await page.goto(base+'/dashboard.html',{waitUntil:'networkidle'});
    await page.waitForFunction(()=>!isLoading && databaseConnected && historyLoadedFromServer);
    const text=id=>page.locator('#'+id).innerText();
    assert.equal(await text('heroStatus'),'SYSTEM SAFE');
    assert.equal(await text('quickSupabase'),'Connected');
    assert.equal(await text('quickWiFi'),'ON');
    assert.equal(await text('quickDHT'),'Reporting');
    assert.equal(await text('quickTelegram'),'Delivery not verified');
    assert.match(await text('quickUpdate'),/ago/);
    assert.equal(await page.evaluate(()=>sensorChart.data.labels.length),1);
    assert.equal(await page.evaluate(()=>currentChartPeriod),10);
    assert.equal(await page.locator('#chartEmptyState').isVisible(),false);
    assert.equal(await text('gasValveStatus'),'CLOSED');
    // Every inline button/change handler must have an existing global function.
    assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('[onclick],[onchange]')].flatMap(el=>[el.getAttribute('onclick'),el.getAttribute('onchange')]).filter(Boolean).flatMap(code=>[...code.matchAll(/\b([A-Za-z_$][\w$]*)\(/g)].map(m=>m[1])).filter(name=>!['stopPropagation','if'].includes(name)&&typeof window[name]!=='function')),[]);
    console.log('PASS live data, connectivity, hardware, chart defaults, inline handlers');
    for (const [id,gas,status] of [[2,150,'WARNING'],[3,400,'DANGER DETECTED'],[4,40,'SYSTEM SAFE']]) {
      rows=[row(id,gas),...rows];await page.evaluate(()=>manualRefresh());assert.equal(await text('heroStatus'),status);
    }
    assert.equal(await page.locator('#alertTableBody .danger').count(),1);assert.equal(await page.locator('#alertTableBody .warning').count(),1);
    assert.match(await page.locator('#eventLog').innerText(),/DANGER/);
    const download=page.waitForEvent('download');await page.evaluate(()=>exportAlertsToExcel());assert.match((await download).suggestedFilename(),/\.xlsx$/);
    await page.evaluate(()=>{window.__printed=false;window.open=()=>({document:{write(){},close(){}},focus(){},print(){window.__printed=true}});printAlerts()});
    assert.equal(await page.evaluate(()=>window.__printed),true);
    console.log('PASS safe/warning/danger/recovery, live history, export, print');
    rows=[row(5,70,25000)];await page.evaluate(()=>manualRefresh());
    assert.equal(await page.evaluate(()=>sensorChart.data.labels.length),0);assert.match(await text('chartEmptyState'),/ESP32 offline/);
    await page.locator('.chart-btn[data-period="50"]').click();assert.equal(await page.evaluate(()=>sensorChart.data.labels.length),0);
    assert.equal(await text('gasValveStatus'),'UNKNOWN');assert.equal(await text('quickDHT'),'Unknown');
    fail=true;await page.evaluate(()=>manualRefresh());assert.equal(await text('quickSupabase'),'Disconnected');assert.equal(await text('heroStatus'),'DATABASE DISCONNECTED');assert.match(await text('chartEmptyState'),/Database unavailable/);
    fail=false;rows=[];await page.evaluate(()=>manualRefresh());assert.match(await text('chartEmptyState'),/No sensor data/);
    rows=[{...row(55,0),status:'SENSOR ERROR'}];await page.evaluate(()=>manualRefresh());
    assert.equal(await text('heroStatus'),'SENSOR ERROR');assert.equal(await text('gasPpm'),'--');
    assert.match(await text('quickESP32'),/Reporting/);assert.match(await text('chartEmptyState'),/Sensor error/);
    assert.equal(await page.evaluate(()=>sensorChart.data.labels.length),0);
    assert.equal(await page.evaluate(()=>getGasStatus(getSensorGas(currentSensor))),'UNKNOWN');
    console.log('PASS firmware SENSOR ERROR with zero ppm is never SAFE or a plotted measurement');
    rows=[row(6,40)];await page.evaluate(()=>manualRefresh());assert.equal(await text('heroStatus'),'SYSTEM SAFE');
    // Staleness timer must work without waiting for a successful database response.
    await page.clock.install();await page.evaluate(()=>{clearInterval(refreshTimer);clearInterval(countdownTimer);currentSensor.created_at=new Date(Date.now()-19000).toISOString();startRefreshTimers();clearInterval(refreshTimer)});
    await page.clock.fastForward(2001);assert.equal(await page.evaluate(()=>sensorChart.data.labels.length),0);assert.equal(await text('heroStatus'),'ESP32 NOT REPORTING');
    console.log('PASS offline, period switch, database outage, empty results, reconnect, expiry timer');
    await page.clock.resume();rows=[row(7,50)];await page.evaluate(()=>manualRefresh());
    await page.evaluate(()=>{sb.auth.getSession=async()=>({data:{session:{access_token:'test-only'}},error:null})});
    await page.evaluate(()=>callAI('Explain reading','main'));assert.match(await page.locator('#chatHistory').innerText(),/Live response/);assert.equal(await page.locator('#chatHistory script').count(),0);
    aiFail=true;await page.evaluate(()=>callAI('Try again','floating'));assert.match(await page.locator('#floatingChatBody').innerText(),/Simulated AI failure/);assert.equal(await page.evaluate(()=>isAIWorking),false);
    await page.evaluate(()=>sendTelegramAlert());assert.equal(telegramCalls,0);
    await page.evaluate(()=>{CONFIG.telegramAlertEndpoint=CONFIG.supabaseUrl+'/functions/v1/test-telegram'});await page.evaluate(()=>Promise.all([sendTelegramAlert(),sendTelegramAlert()]));assert.equal(telegramCalls,1);assert.equal(await text('quickTelegram'),'Last send succeeded');
    console.log('PASS simulated AI response/error, escaped content, Telegram config and duplicate-send guard');
    await page.locator('#cameraToggleBtn').click();await page.waitForFunction(()=>document.getElementById('cameraStatusText').textContent==='Streaming');await page.locator('#cameraToggleBtn').click();assert.equal(await text('cameraStatusText'),'Offline');
    await page.route('https://chemical-plenty-reasons-experiments.trycloudflare.com/stream*',r=>r.abort());await page.locator('#cameraToggleBtn').click();await page.waitForFunction(()=>document.getElementById('cameraStatusText').textContent==='Connection failed');
    assert.equal(await page.locator('#captureBtn,#sendPhotoBtn').count(),0);
    await page.locator('#soundBtn').click();assert.equal(await page.locator('#soundBtn').getAttribute('aria-pressed'),'false');
    await page.evaluate(()=>openAIChat());await page.keyboard.press('Escape');assert.equal(await page.locator('#chatModal').isVisible(),false);
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth),true);
    console.log('PASS camera start/stop/failure, sound, modal close, mobile width');
    await page.evaluate(()=>{sb.auth.signOut=async()=>({error:null})});page.once('dialog',d=>d.accept());await page.evaluate(()=>logout());await page.waitForURL('**/index.html');
    await page.waitForFunction(()=>loginReady);await page.locator('#password').fill('test-only');await page.locator('.toggle-pass').click();assert.equal(await page.locator('#password').getAttribute('type'),'text');
    await page.evaluate(()=>{document.getElementById('username').value='unknown';return handleLogin()});assert.match(await text('errorText'),/Invalid username/);
    await page.evaluate(()=>{document.getElementById('username').value='admin';loginSupabase.auth.signInWithPassword=async()=>({error:new Error('Invalid login credentials')});return handleLogin()});assert.equal(await page.locator('#loginBtn').isEnabled(),true);assert.equal(await page.evaluate(()=>isLoggingIn),false);
    assert.deepEqual(errors,[]);console.log('PASS logout, login toggle, unknown user, failed login, no uncaught JS errors');
    await page.evaluate(()=>{loginSupabase.auth.signInWithPassword=async()=>({error:null,data:{session:{access_token:'test-only'},user:{email:'admin@gmail.com'}}});document.getElementById('rememberMe').checked=true;return handleLogin()});
    await page.waitForURL('**/dashboard.html');await page.waitForFunction(()=>!isLoading && databaseConnected);
    assert.equal(await page.evaluate(()=>localStorage.getItem('lpg_remember_user')),'admin');
    assert.equal(await page.evaluate(()=>getMonthKey(new Date('2026-10-31T17:00:00Z'))),'2026-11');
    assert.equal(await page.evaluate(()=>numberOrNull('   ')),null);assert.equal(await page.evaluate(()=>numberOrNull(false)),null);
    assert.equal(await page.evaluate(()=>getGasStatus(-1)),'UNKNOWN');
    await page.evaluate(()=>{alertHistory=[{id:10,created_at:'2026-10-31T17:00:00Z',status:'WARNING',gas_ppm:150},{id:11,created_at:'2026-09-01T00:00:00Z',status:'DANGER',gas_ppm:400}];updateMonthFilter();document.getElementById('monthFilter').value='2026-11';filterAlertsByMonth()});
    assert.equal(await page.locator('#alertTableBody tr').count(),1);assert.match(await page.locator('#alertTableBody').innerText(),/WARNING/);
    const hardware=page.locator('[onclick="toggleHardware(this)"]').first();await hardware.click();assert.match(await hardware.getAttribute('class'),/expanded/);
    await page.clock.install();await page.route('https://chemical-plenty-reasons-experiments.trycloudflare.com/stream*',()=>{});await page.locator('#cameraToggleBtn').click();await page.clock.fastForward(15001);assert.equal(await text('cameraStatusText'),'Connection timed out');
    await page.clock.resume();
    // A new dashboard navigation with no session must go back to login without reading data.
    await page.unroute('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2*');
    await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+`;(() => {const create=window.supabase.createClient;window.supabase.createClient=(...args)=>{const client=create(...args);client.auth.getSession=async()=>({data:{session:null},error:null});return client}})();`})});
    let unauthenticatedReads=0;page.on('request',request=>{if(request.url().startsWith(backend+'/rest/v1/'))unauthenticatedReads++});
    await page.goto(base+'/dashboard.html');await page.waitForURL('**/index.html');assert.equal(unauthenticatedReads,0);
    assert.deepEqual(errors,[]);console.log('PASS successful login, remember username, Malaysia month filter, invalid readings, hardware expansion, camera timeout, unauthenticated redirect');
  } finally {if(browser)await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1});
