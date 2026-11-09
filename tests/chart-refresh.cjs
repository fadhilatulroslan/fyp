// Exercise the actual chart updater: duplicate polls must not repaint, stale must clear.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../script.js'),'utf8').replace(/\r\n/g,'\n');
const start=source.indexOf('function updateChart(records = allSensors)');
const end=source.indexOf('/* =====================================================\n   CHART PERIOD',start);
assert(end>start);
const context={getGasProfile:()=>({warning:100,danger:300,experimental:false}),Date,JSON,CONFIG:{staleAfterMs:20000},THRESHOLD:{SAFE_MAX:100,DANGER_MIN:300},currentChartPeriod:10,lastReadingFresh:true,databaseConnected:true,currentSensor:{created_at:new Date().toISOString()},allSensors:[],updates:0,
 $:()=>null,isReadingStale:r=>Date.now()-new Date(r.created_at)>20000,hasSensorFault:()=>false,getReadingStatus:r=>r.status||'UNKNOWN',getSensorGas:r=>r.gas_ppm??null,formatTimeOnly:t=>t};
context.sensorChart={data:{datasets:[{},{},{}]},update(){context.updates++;}};
vm.createContext(context);vm.runInContext(source.slice(start,end),context);
context.allSensors=[{created_at:context.currentSensor.created_at,gas_ppm:80,status:'SAFE'}];
context.updateChart();context.updateChart();assert.equal(context.updates,1);
context.allSensors[0].gas_ppm=200;context.allSensors[0].status='WARNING';context.updateChart();assert.equal(context.updates,2);
context.currentSensor.created_at=new Date(Date.now()-21000).toISOString();context.updateChart();assert.equal(context.updates,3);assert.equal(context.sensorChart.data.datasets[0].data.length,0);
context.updateChart();assert.equal(context.updates,3);
context.currentSensor.created_at=new Date().toISOString();context.updateChart();assert.equal(context.updates,4);
console.log('PASS unchanged chart polls preserve plot; changed readings repaint; offline clears immediately; recovery redraws');
