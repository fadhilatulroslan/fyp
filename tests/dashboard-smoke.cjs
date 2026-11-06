// Run with `node tests/dashboard-smoke.cjs` after installing Playwright externally.
// Uses a local server and intercepted backend/camera responses; never sends real alerts.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const base = 'http://127.0.0.1:8765';
const backend = 'https://fkfgimyelgvlsbtxhvih.supabase.co';
const CONFIG_TEST_CAMERA_URL = 'https://include-soviet-iowa-mere.trycloudflare.com/stream';
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
    let rows=[row(1,45)], fail=false, aiFail=false, telegramCalls=0, aiRequests=0;
    let pendingAI = null, releaseAI = null, lastAIPayload = null;
    // Use the real SDK with a test-only session, without needing a real account.
    await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2*', async route => {
      const response = await route.fetch();
      const body = await response.text();
      await route.fulfill({response,body:body+`;(() => {const create=window.supabase.createClient;window.supabase.createClient=(...args)=>{const client=create(...args);client.auth.getSession=async()=>({data:{session:{access_token:'test-only'}},error:null});return client}})();`});
    });
    await page.route(backend+'/**', async route => {
      const url = new URL(route.request().url());
      if(url.pathname.startsWith('/rest/v1/')) return route.fulfill({status:fail?503:200,contentType:'application/json',body:JSON.stringify(fail?{message:'Simulated outage'}:rows)});
      if(url.pathname.endsWith('/glips-ai')) {
        if(route.request().method()==='POST') { aiRequests++; lastAIPayload=route.request().postDataJSON(); if(pendingAI) await pendingAI; }
        return route.fulfill({status:aiFail?500:200,contentType:'application/json',body:JSON.stringify(aiFail?{error:'Simulated AI failure'}:{answer:'**Live response**\n<script>bad()</script>'})});
      }
      if(url.pathname.endsWith('/test-telegram')) {telegramCalls++;return route.fulfill({contentType:'application/json',body:'{"ok":true}'});}
      return route.fulfill({status:401,contentType:'application/json',body:'{"message":"No real authentication in tests"}'});
    });
    await page.route('https://include-soviet-iowa-mere.trycloudflare.com/stream*', r=>r.fulfill({contentType:'image/png',path:path.join(repo,'esp.png')}));
    await page.goto(base+'/dashboard.html',{waitUntil:'networkidle'});
    await page.waitForFunction(()=>!isLoading && databaseConnected && historyLoadedFromServer);
    const text=async id=>(await page.locator('#'+id).textContent()).trim();
    assert.equal(await text('heroStatus'),'Gas level is normal');
    assert.equal(await page.locator('#heroStatus').isVisible(),true);assert.equal(await page.locator('#responseHeadline').isVisible(),true);assert.equal(await page.locator('#manualAlertButton').isVisible(),false);
    assert.equal(await text('quickSupabase'),'Connected');
    assert.match(await text('quickUpdate'),/ago/);
    assert.equal(await page.evaluate(()=>sensorChart.data.labels.length),1);
    assert.equal(await page.evaluate(()=>currentChartPeriod),10);
    assert.equal(await page.locator('#chartEmptyState').isVisible(),false);
    assert.equal(await text('gasValveStatus'),'CLOSED');
    assert.equal(await text('heroTemp'),'27.0');assert.equal(await text('heroHumid'),'65.0');
    assert.equal(await page.locator('#aiAssistantPanel').isVisible(),true);assert.equal(await page.locator('#floatingChat,#gasBadge,#tempBadge').count(),0);
    assert.equal(await page.locator('#assistantQuestionForm').isVisible(),true);
    assert.equal(await page.locator('#gaugeCanvas').isVisible(),true);assert.equal(await page.locator('#gaugeCanvas').getAttribute('data-live'),'true');assert.match(await page.locator('#gaugeCanvas').getAttribute('aria-label'),/45 ppm/);
    const meterBox=await page.locator('#gaugeCanvas').boundingBox(), messageBox=await page.locator('#heroMessage').boundingBox();assert(meterBox.y>=messageBox.y+messageBox.height, 'Meter must not overlap the safety message');
    // Every inline button/change handler must have an existing global function.
    assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('[onclick],[onchange]')].flatMap(el=>[el.getAttribute('onclick'),el.getAttribute('onchange')]).filter(Boolean).flatMap(code=>[...code.matchAll(/\b([A-Za-z_$][\w$]*)\(/g)].map(m=>m[1])).filter(name=>!['stopPropagation','if'].includes(name)&&typeof window[name]!=='function')),[]);
    assert.equal(await page.locator('.hardware-grid > .hardware-card').count(),3);
    assert.equal(await page.locator('#quickWiFi,#quickDHT,#quickTelegram,#voiceAlertStatus,.connectivity-grid').count(),0);
    assert.equal(await page.locator('.connection-strip .connection-item').count(),3);
    assert.equal(await text('quickESP32'),'Online');
    assert.equal(await text('responseValve'),'Valve command reported');
    console.log('PASS live data, connectivity, hardware, chart defaults, inline handlers');
    rows=[{...row(100,45),gas_valve:undefined,exhaust_fan:undefined,wifi_connected:undefined,hardware_outputs:{kind:'output_commands',gas_valve:'RELAY HIGH',exhaust_fan:'ON',buzzer:'ON',red_led:'ON',green_led:'OFF',voice_alert:'PLAY REQUESTED',wifi_connected:true}}];
    await page.evaluate(()=>manualRefresh());
    assert.equal(await text('gasValveStatus'),'RELAY HIGH');assert.equal(await text('gasValveDetail'),'RELAY HIGH');
    assert.equal(await text('exhaustFanStatus'),'ON');assert.equal(await text('alarmStatus'),'Active');
    assert.match(await page.locator('#dotGasValve').getAttribute('class'),/active/);
    if (process.env.GLIPS_SCREENSHOT_DIR) {
      await page.evaluate(()=>openDeviceDetails());
      await page.locator('.hardware-grid').screenshot({path:path.join(process.env.GLIPS_SCREENSHOT_DIR,'glips-safety-response.png')});
      await page.locator('.connection-strip').screenshot({path:path.join(process.env.GLIPS_SCREENSHOT_DIR,'glips-connections.png')});
    }
    rows=[{...rows[0],id:103,status:'SAFE',gas_ppm:80,hardware_outputs:{gas_valve:'RELAY HIGH',valve_latched:true,buzzer:'OFF',red_led:'OFF',green_led:'ON'}}];await page.evaluate(()=>manualRefresh());
    assert.equal(await text('heroStatus'),'Gas level has dropped');assert.equal(await text('gasValveStatus'),'Latched');
    assert.equal(await text('responseHeadline'),'Manual valve reset required');
    assert.match(await text('responseNextStep'),/checked before an operator resets/);
    assert.equal(await text('responseValve'),'Shut-off requested');
    assert.match(await text('gasValveDetail'),/manual reset required/);assert.match(await text('valveResetStatus'),/required/);
    assert.equal(await text('alarmStatus'),'Inactive');
    rows=[{...rows[0],id:104,hardware_outputs:{gas_valve:'RELAY LOW',valve_latched:false,buzzer:'OFF',red_led:'OFF',green_led:'ON'}}];await page.evaluate(()=>manualRefresh());
    assert.equal(await text('responseValve'),'Normal valve command reported');
    assert.match(await page.locator('#eventLog').innerText(),/Valve reset reported/);
    rows=[{...rows[0],id:102,hardware_outputs:{buzzer:'OFF',red_led:'OFF',green_led:'ON'}}];await page.evaluate(()=>manualRefresh());
    assert.equal(await text('alarmStatus'),'Inactive');
    rows=[{...rows[0],id:101,hardware_outputs:{buzzer:'ON'}}];await page.evaluate(()=>manualRefresh());
    assert.equal(await text('alarmStatus'),'Active · partial report');assert.equal(await text('redLEDStatus'),'Not reported');
    rows=[row(1,45)];await page.evaluate(()=>manualRefresh());
    assert.equal(await text('alarmStatus'),'Not reported');
    assert.equal(await page.locator('#dotAlarm').evaluate(el=>el.classList.contains('active')),false);
    console.log('PASS ESP nested output commands, expanded details, reporting indicators, missing fields');

    for (const [id,gas,status] of [[2,200,'Gas level is above normal'],[3,350,'Gas leak warning'],[4,80,'Gas level is normal']]) {
      rows=[row(id,gas),...rows];await page.evaluate(()=>manualRefresh());assert.equal(await text('heroStatus'),status);
    }
    assert.equal(await page.locator('#alertTableBody .danger').count(),1);assert.equal(await page.locator('#alertTableBody .warning').count(),1);
    assert.match(await page.locator('#eventLog').innerText(),/DANGER/);
    const download=page.waitForEvent('download');await page.evaluate(()=>exportAlertsToExcel());assert.match((await download).suggestedFilename(),/\.xlsx$/);
    await page.evaluate(()=>{window.__printed=false;window.open=()=>({document:{write(){},close(){}},focus(){},print(){window.__printed=true}});printAlerts()});
    assert.equal(await page.evaluate(()=>window.__printed),true);
    console.log('PASS safe/warning/danger/recovery, live history, export, print');
    rows=[row(250,80),row(249,70,60000)];await page.evaluate(()=>manualRefresh());
    assert.equal(await page.evaluate(()=>sensorChart.data.datasets[0].data.includes(null)),true);
    assert.equal(await page.evaluate(()=>sensorChart.options.spanGaps || sensorChart.data.datasets[0].spanGaps),false);
    rows=[row(5,70,25000)];await page.evaluate(()=>manualRefresh());
    assert.equal(await page.evaluate(()=>sensorChart.data.labels.length),0);assert.match(await text('chartEmptyState'),/ESP32 offline/);
    await page.locator('.chart-btn[data-period="50"]').click();assert.equal(await page.evaluate(()=>sensorChart.data.labels.length),0);
    assert.equal(await text('responseHeadline'),'Device response is unknown');assert.equal(await text('heroGas'),'--');
    assert.equal(await text('assistantContext'),'Live readings unavailable');
    assert.equal(await page.locator('#gaugeCanvas').getAttribute('data-live'),'false');assert.match(await page.locator('#gaugeCanvas').getAttribute('aria-label'),/no live reading/);assert.equal(await text('heroReadingNote'),'No live reading');
    assert.equal(await text('gasValveStatus'),'Unknown — ESP offline');assert.equal(await text('alarmStatus'),'Unknown — ESP offline');
    fail=true;await page.evaluate(()=>manualRefresh());assert.equal(await text('quickSupabase'),'Disconnected');assert.equal(await text('heroStatus'),'Monitoring connection lost');assert.match(await text('chartEmptyState'),/Database unavailable/);
    fail=false;rows=[];await page.evaluate(()=>manualRefresh());assert.match(await text('chartEmptyState'),/No sensor data/);
    rows=[{...row(55,0),status:'SENSOR ERROR'}];await page.evaluate(()=>manualRefresh());
    assert.equal(await text('heroStatus'),'Gas sensor needs attention');assert.equal(await text('heroGas'),'--');
    assert.match(await text('quickESP32'),/Online/);assert.match(await text('chartEmptyState'),/Sensor error/);
    assert.equal(await page.evaluate(()=>sensorChart.data.labels.length),0);
    assert.equal(await page.evaluate(()=>getGasStatus(getSensorGas(currentSensor))),'UNKNOWN');
    console.log('PASS firmware SENSOR ERROR with zero ppm is never SAFE or a plotted measurement');
    rows=[row(500,0)];await page.evaluate(()=>manualRefresh());assert.equal(await text('heroGas'),'0');assert.equal(await page.locator('#gaugeCanvas').getAttribute('data-live'),'true');
    rows=[{...row(501,275),status:'DANGER'}];await page.evaluate(()=>manualRefresh());assert.equal(await page.locator('#meterHint').isVisible(),true);assert.match(await text('meterHint'),/250/);assert.equal(await text('heroStatus'),'Gas leak warning');
    rows=[row(6,40)];await page.evaluate(()=>manualRefresh());assert.equal(await text('heroStatus'),'Gas level is normal');
    // Staleness timer must work without waiting for a successful database response.
    await page.clock.install();await page.evaluate(()=>{clearInterval(refreshTimer);clearInterval(countdownTimer);currentSensor.created_at=new Date(Date.now()-19000).toISOString();startRefreshTimers();clearInterval(refreshTimer)});
    await page.clock.fastForward(2001);assert.equal(await page.evaluate(()=>sensorChart.data.labels.length),0);assert.equal(await text('heroStatus'),'Gas readings are unavailable');
    console.log('PASS offline, period switch, database outage, empty results, reconnect, expiry timer');
    await page.clock.resume();rows=[row(7,50)];await page.evaluate(()=>manualRefresh());
    await page.evaluate(()=>{sb.auth.getSession=async()=>({data:{session:{access_token:'test-only'}},error:null})});
    await page.evaluate(()=>callAI('Explain reading','main'));assert.match(await page.locator('#chatHistory').innerText(),/Live response/);assert.equal(await page.locator('#chatHistory script').count(),0);
    assert.equal(lastAIPayload.telemetry.output_reports_are_commands,true);assert.equal(lastAIPayload.telemetry.hardware_outputs.gas_valve,'CLOSED');assert.equal(lastAIPayload.telemetry.hardware_outputs.exhaust_fan,true);
    aiFail=true;await page.evaluate(()=>callAI('Try again','main'));assert.match(await page.locator('#chatHistory').innerText(),/Simulated AI failure/);assert.equal(await page.evaluate(()=>isAIWorking),false);
    await page.evaluate(()=>sendTelegramAlert());assert.equal(telegramCalls,0);
    await page.evaluate(()=>{CONFIG.telegramAlertEndpoint=CONFIG.supabaseUrl+'/functions/v1/test-telegram'});await page.evaluate(()=>Promise.all([sendTelegramAlert(),sendTelegramAlert()]));assert.equal(telegramCalls,1);assert.match(await page.locator('.glips-toast').innerText(),/Manual alert request accepted/);
    console.log('PASS simulated AI response/error, escaped content, Telegram config and duplicate-send guard');
    await page.locator('.camera-settings summary').click();
    await page.locator('#cameraStreamUrlInput').fill('https://include-soviet-iowa-mere.trycloudflare.com');
    await page.getByRole('button',{name:'Save camera URL',exact:true}).click();
    assert.equal(await page.evaluate(()=>CAMERA.stream),CONFIG_TEST_CAMERA_URL);
    await page.locator('#cameraStreamUrlInput').fill('http://invalid.example/stream');
    await page.getByRole('button',{name:'Save camera URL',exact:true}).click();
    assert.equal(await page.evaluate(()=>CAMERA.stream),CONFIG_TEST_CAMERA_URL);
    await page.evaluate(()=>initializeCameraSettings());
    assert.equal(await page.locator('#cameraStreamUrlInput').inputValue(),CONFIG_TEST_CAMERA_URL);
    console.log('PASS editable HTTPS camera URL, base URL normalization, persistence, invalid URL rejection');
    await page.locator('#cameraToggleBtn').click();await page.waitForFunction(()=>document.getElementById('cameraStatusText').textContent==='Streaming');await page.locator('#cameraToggleBtn').click();assert.equal(await text('cameraStatusText'),'Offline');
    await page.route('https://include-soviet-iowa-mere.trycloudflare.com/stream*',r=>r.abort());await page.locator('#cameraToggleBtn').click();await page.waitForFunction(()=>document.getElementById('cameraStatusText').textContent==='Connection failed');
    assert.equal(await page.locator('#captureBtn,#sendPhotoBtn').count(),0);
    await page.locator('#soundBtn').click();assert.equal(await page.locator('#soundBtn').getAttribute('aria-pressed'),'false');
    await page.evaluate(()=>openAIChat());await page.keyboard.press('Escape');assert.equal(await page.locator('#chatModal').isVisible(),false);
    await page.getByRole('button',{name:'Open AI assistant'}).click();assert.equal(await page.locator('#chatModal').isVisible(),true);
    await page.keyboard.press('Tab');await page.keyboard.press('Tab');assert.equal(await page.locator('[aria-label="Close AI chat"]').evaluate(el=>document.activeElement===el),true);
    await page.keyboard.press('Escape');assert.equal(await page.locator('#chatModal').isVisible(),false);assert.equal(await page.locator('#aiHeaderButton').evaluate(el=>document.activeElement===el),true);
    aiFail=false;pendingAI=new Promise(resolve=>{releaseAI=resolve});
    await page.locator('#assistantQuestion').fill('Explain the current reading');await page.locator('#assistantQuestionForm button').click();
    await page.waitForFunction(()=>isAIWorking);assert.equal(await page.locator('#assistantQuestion').isDisabled(),true);assert.equal(await page.locator('[aria-label="Close AI chat"]').isEnabled(),true);
    await page.locator('[aria-label="Close AI chat"]').click();assert.equal(await page.locator('#chatModal').isVisible(),false);
    releaseAI();pendingAI=null;await page.waitForFunction(()=>!isAIWorking);assert.equal(await page.locator('#assistantQuestion').isEnabled(),true);
    const beforeSuggestion=aiRequests;await page.getByRole('button',{name:'Explain this reading',exact:true}).click();await page.waitForFunction(()=>!isAIWorking);assert.equal(aiRequests,beforeSuggestion+1);assert.equal(await page.locator('#chatModal').isVisible(),true);
    const beforeFollowup=aiRequests;await page.locator('#chatInput').fill('Explain that more simply');await page.locator('#chatInput').press('Enter');await page.waitForFunction(()=>!isAIWorking);assert.equal(aiRequests,beforeFollowup+1);
    await page.keyboard.press('Escape');console.log('PASS visible AI panel, header entry, focus trap, close while waiting, suggestions and one-request Enter follow-up');
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
    assert.equal(await page.evaluate(()=>getReadingStatus({gas_ppm:80,status:'SAFE'})),'SAFE');
    assert.equal(await page.evaluate(()=>getReadingStatus({gas_ppm:275,status:'DANGER'})),'DANGER');
    assert.equal(await page.evaluate(()=>getReadingStatus({gas_ppm:275,status:'SAFE'})),'WARNING');
    assert.equal(await page.evaluate(()=>getReadingStatus({gas_ppm:0,status:'SENSOR ERROR'})),'UNKNOWN');
    assert.equal(await page.evaluate(()=>getReadingStatus({gas_ppm:250,status:'DANGER'})),'WARNING');
    assert.equal(await page.evaluate(()=>getReadingStatus({gas_ppm:300,status:'SAFE'})),'DANGER');
    await page.evaluate(()=>{alertHistory=[{id:10,created_at:'2026-10-31T17:00:00Z',status:'WARNING',gas_ppm:150},{id:11,created_at:'2026-09-01T00:00:00Z',status:'DANGER',gas_ppm:400}];updateMonthFilter();document.getElementById('monthFilter').value='2026-11';filterAlertsByMonth()});
    assert.equal(await page.locator('#alertTableBody tr').count(),1);assert.match(await page.locator('#alertTableBody').innerText(),/WARNING/);
    await page.evaluate(()=>{document.getElementById('monthFilter').value='all';document.getElementById('historyFrom').value='2026-11-01';document.getElementById('historyTo').value='2026-11-01';document.getElementById('historyStatus').value='WARNING';filterAlertsByMonth()});
    assert.equal(await page.locator('#alertTableBody tr').count(),1);assert.match(await page.locator('#alertTableBody').innerText(),/WARNING/);
    await page.evaluate(()=>{document.getElementById('historyTo').value='2026-10-01';filterAlertsByMonth()});assert.equal(await page.locator('#historyFilterError').isVisible(),true);
    await page.evaluate(()=>resetHistoryFilters());assert.equal(await page.locator('#historyFilterError').isVisible(),false);assert.equal(await page.locator('#alertTableBody tr').count(),2);
    await page.evaluate(()=>openDeviceDetails());
    const hardware=page.locator('[onclick="toggleHardware(this)"]').first();await hardware.click();assert.match(await hardware.getAttribute('class'),/expanded/);
    const alarmCard=page.locator('.hardware-card').filter({has:page.locator('#alarmStatus')});await alarmCard.focus();await page.keyboard.press('Enter');assert.equal(await alarmCard.getAttribute('aria-expanded'),'true');
    await page.clock.install();await page.route('https://include-soviet-iowa-mere.trycloudflare.com/stream*',()=>{});await page.locator('#cameraToggleBtn').click();await page.clock.fastForward(15001);assert.equal(await text('cameraStatusText'),'Connection timed out');
    await page.clock.resume();
    // A new dashboard navigation with no session must go back to login without reading data.
    await page.unroute('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2*');
    await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+`;(() => {const create=window.supabase.createClient;window.supabase.createClient=(...args)=>{const client=create(...args);client.auth.getSession=async()=>({data:{session:null},error:null});return client}})();`})});
    let unauthenticatedReads=0;page.on('request',request=>{if(request.url().startsWith(backend+'/rest/v1/'))unauthenticatedReads++});
    await page.goto(base+'/dashboard.html');await page.waitForURL('**/index.html');assert.equal(unauthenticatedReads,0);
    assert.deepEqual(errors,[]);console.log('PASS successful login, remember username, Malaysia month filter, invalid readings, hardware expansion, camera timeout, unauthenticated redirect');
  } finally {if(browser)await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1});
