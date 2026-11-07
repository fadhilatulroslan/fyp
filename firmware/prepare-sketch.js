'use strict';

function mergeWorkingSketch(template, working, options = {}) {
  const includes = code => new Set([...code.matchAll(/^\s*#include\s+[<"]([^>"]+)[>"]/gm)].map(match => match[1]));
  const availableIncludes = includes(template);
  for (const name of includes(working)) {
    if (!availableIncludes.has(name)) throw new Error(`Library ${name} needs a manual review before merging.`);
  }
  const functions = code => new Set([...code.matchAll(/^(?:static\s+)?(?:void|bool|String|float|esp_err_t)\s+(\w+)\s*\(/gm)].map(match => match[1]));
  const availableFunctions = functions(template);
  for (const name of functions(working)) {
    if (!availableFunctions.has(name)) throw new Error(`Function ${name} needs a manual review before merging.`);
  }
  const definitions = code => new Map([...code.matchAll(/^\s*#define\s+(\w+)\s+([^\r\n]+)/gm)].map(match => [match[1], match[2].split('//')[0].replace(/\s+/g, '')]));
  const targetDefinitions = definitions(template);
  const protectedSetting = /^(DEMO_MODE|MQ6_PIN|DHT_PIN|DHT_TYPE|LED_\w+|RELAY_\w+|BUZZER_\w+|FAN_\w+|VALVE_RELAY_\w+|LCD_\w+|DF_\w+|CAM_\w+)$/;
  for (const [name, value] of definitions(working)) {
    if (protectedSetting.test(name) && targetDefinitions.get(name) !== value) throw new Error(`Pin, polarity or mode differs for ${name}. A manual review is needed.`);
  }
  const calibration = code => new Map([...code.matchAll(/^\s*const\s+float\s+((?:MQ_|LPG_|DIVIDER_)\w+)\s*=\s*([^;]+);/gm)].map(match => [match[1], match[2].replace(/\s+/g, '')]));
  const targetCalibration = calibration(template);
  for (const [name, value] of calibration(working)) {
    if (targetCalibration.get(name) !== value) throw new Error(`Calibration differs for ${name}. A manual review is needed.`);
  }
  const declaration = name => new RegExp('(const\\s+char\\s*\\*\\s*' + name + '\\s*=\\s*)("(?:\\\\.|[^"\\\\])*")(\\s*;)');
  let code = template;
  const required = ['WIFI_SSID', 'WIFI_PASS', 'BOT_TOKEN', 'CHAT_ID', 'SUPABASE_KEY'];
  const optional = ['SUPABASE_URL', 'SUPABASE_TABLE', 'PUBLIC_STREAM_URL'];
  for (const name of [...required, ...optional]) {
    const match = working.match(declaration(name));
    if (required.includes(name) && (!match || (name !== 'WIFI_PASS' && match[2] === '""'))) throw new Error(`The working file has no setting for ${name}. Choose the filled sketch that already works.`);
    if (!match || (optional.includes(name) && match[2] === '""')) continue;
    if (!declaration(name).test(code)) throw new Error(`The template has no setting for ${name}.`);
    const literal = match[2];
    // Callback substitution preserves literal $ and backslashes in private values.
    code = code.replace(declaration(name), (_, prefix, previous, suffix) => prefix + literal + suffix);
  }
  if (options.cameraUrl) {
    let url;
    try { url = new URL(options.cameraUrl); } catch { throw new Error('Enter a valid HTTPS camera URL.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Use an HTTPS camera URL without a password or fragment.');
    if (url.pathname === '/') url.pathname = '/stream';
    code = code.replace(declaration('PUBLIC_STREAM_URL'), (_, prefix, previous, suffix) => prefix + JSON.stringify(url.href) + suffix);
  }
  return '// PRIVATE COMPLETE SKETCH: contains your connection settings. Do not publish.\n' + code.replace(/^\/\/ Public full-system sketch:.*\n/, '');
}

if (typeof module !== 'undefined' && module.exports) module.exports = { mergeWorkingSketch };

if (typeof document !== 'undefined') {
  const input = document.getElementById('workingSketch');
  const prepare = document.getElementById('prepareButton');
  const result = document.getElementById('resultSection');
  const output = document.getElementById('completeSketch');
  const copy = document.getElementById('copyButton');
  const download = document.getElementById('downloadButton');
  const status = document.getElementById('prepareStatus');
  const clear = () => { output.value = ''; result.hidden = true; copy.disabled = true; download.disabled = true; };
  const tell = (message, error = false) => { status.textContent = message; status.classList.toggle('error', error); };
  input.addEventListener('change', () => { clear(); tell('Ready to prepare your selected file.'); });
  document.getElementById('telegramCameraUrl')?.addEventListener('input', () => { clear(); tell('Camera URL changed. Prepare the code again before copying.'); });
  prepare.addEventListener('click', async () => {
    clear();
    const file = input.files[0];
    if (!file) { tell('Choose your working .ino or .txt file first.', true); return; }
    if (file.size > 300000) { tell('Choose the Arduino sketch text file, not a project archive.', true); return; }
    input.disabled = true; prepare.disabled = true; tell('Preparing the complete sketch in this browser...');
    try {
      const working = await file.text();
      const currentDevice = new URLSearchParams(window.location.search).get('version') === 'current';
      const reviewedLegacy = /\bvoid\s+changeStatus\s*\(/.test(working);
      const templatePath = reviewedLegacy ? 'reviewed-legacy/GLiPS.ino' : currentDevice ? 'current-device/GLiPS.ino' : 'GLiPS/GLiPS.ino';
      const url = new URL(templatePath, window.location.href);
      url.searchParams.set('v', String(Date.now()));
      const response = await fetch(url, {cache: 'no-store'});
      if (!response.ok) throw new Error('The public template could not be loaded. Try again after deployment finishes.');
      const template = await response.text();
      output.value = mergeWorkingSketch(template, working, {cameraUrl: document.getElementById('telegramCameraUrl')?.value.trim()});
      result.hidden = false; copy.disabled = false; download.disabled = false;
      tell('Complete code is ready. Your existing connection settings are included.');
      result.scrollIntoView({behavior:'smooth', block:'start'});
    } catch (error) { clear(); tell(error.message || 'The sketch could not be prepared.', true); }
    finally { input.disabled = false; prepare.disabled = false; }
  });
  copy.addEventListener('click', async () => {
    if (!output.value) return;
    try { await navigator.clipboard.writeText(output.value); tell('Full code copied. Paste it into Arduino IDE, compile, then upload.'); }
    catch { output.focus(); output.select(); tell('Code selected. Press Ctrl+C to copy, then paste into Arduino IDE.'); }
  });
  download.addEventListener('click', () => {
    if (!output.value) return;
    const url = URL.createObjectURL(new Blob([output.value], {type:'text/plain;charset=utf-8'}));
    const link = document.createElement('a'); link.href = url; link.download = 'GLiPS.ino'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
