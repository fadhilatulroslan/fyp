const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const s=fs.readFileSync(require('node:path').join(__dirname,'../script.js'),'utf8');
const ctx={THRESHOLD:{SAFE_MAX:100,DANGER_MIN:300,DANGER_CLEAR:250},currentSensor:null,numberOrNull:v=>v===null||v===undefined||String(v).trim()===''?null:Number.isFinite(Number(v))?Number(v):null};vm.createContext(ctx);
vm.runInContext(s.slice(s.indexOf('function hasSensorFault('),s.indexOf('function getStatusColor(')),ctx);
const rec=(ppm,status='SAFE')=>({gas_ppm:Math.round(ppm),status,hardware_outputs:{sensor_model:'MQ5',measurement_basis:'experimental_estimate',gas_estimate_ppm:ppm,gas_warning_ppm:80,gas_danger_ppm:100}});
assert.equal(ctx.getReadingStatus(rec(79.9)),'SAFE');assert.equal(ctx.getReadingStatus(rec(80)),'WARNING');assert.equal(ctx.getReadingStatus(rec(99.9)),'WARNING');assert.equal(ctx.getReadingStatus(rec(100)),'DANGER');assert.equal(ctx.getReadingStatus(rec(350)),'DANGER');assert.equal(ctx.getReadingStatus(rec(90,'SENSOR ERROR')),'UNKNOWN');
assert.equal(ctx.getReadingStatus({gas_ppm:80,status:'SAFE'}),'SAFE');assert.equal(ctx.getReadingStatus({gas_ppm:150,status:'WARNING'}),'WARNING');assert.equal(ctx.getReadingStatus({gas_ppm:300,status:'DANGER'}),'DANGER');
const bad=rec(100);bad.hardware_outputs.gas_warning_ppm=150;assert.equal(ctx.getGasProfile(bad).experimental,false);
console.log('PASS MQ5 80/100 record profile, unrounded estimates, sensor faults and unchanged legacy 100/300 thresholds');
