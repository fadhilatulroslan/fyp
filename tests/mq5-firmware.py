"""Compile actual MQ5 sampling/baseline functions with fake ADC/storage, not ESP hardware."""
from pathlib import Path
import subprocess,tempfile,re
repo=Path(__file__).resolve().parents[1]
s=(repo/'firmware/mq5/GLiPS.ino').read_text()
settings='\n'.join(re.findall(r'^constexpr (?:unsigned int|float) (?:MQ5_|DIVIDER_)[^\n]+',s,re.M))
a=s.index('struct MQ5Reading {');b=s.index('\n// ===',s.index('float readLPGppm()',a));functions=s[a:b]
shim=r'''
#include <cassert>
#include <cmath>
#include <cstdint>
#include <iostream>
using std::isfinite;
const int MQ5_PIN=1;unsigned long tick=1000,lastSensor=1000;const unsigned long SENSOR_INTERVAL=2000;
unsigned long millis(){return tick;}void delay(int){}
int adc=1200,mv=1000;int analogRead(int){return adc;}int analogReadMilliVolts(int){return mv;}
enum State{STATE_SAFE,STATE_WARNING,STATE_DANGER};State currentState=STATE_SAFE;
bool sensorValid=false;float R0=NAN;
bool mq5StoreReady=false,mq5Calibrating=false;unsigned int mq5CalSamples=0,mq5CalValid=0;float mq5CalSum=0;unsigned long mq5CalLast=0;
struct Store{float stored=NAN;bool begin(const char*,bool){return true;}float getFloat(const char*,float fallback){return isfinite(stored)?stored:fallback;}size_t putFloat(const char*,float value){stored=value;return sizeof(float);}}mq5Store;
struct Log{void println(const char*){}template<class...Args>void printf(const char*,Args...){}}Serial;
'''
main=r'''
int main(){
restoreMQ5Calibration();assert(!isfinite(R0));assert(!isfinite(readLPGppm()));
auto r=readMQ5();assert(fabs(r.gpioVoltage-1)<.001);assert(fabs(r.aoVoltage-2)<.001);assert(fabs(r.rs-15)<.001);
calibrateMQ5();for(int i=0;i<60;i++){tick+=1000;serviceMQ5Calibration();}
assert(!mq5Calibrating);assert(fabs(R0-15.0/6.5)<.001);assert(fabs(readLPGppm()-1000.0/(6.5*6.5))<.01);
float saved=R0;R0=NAN;restoreMQ5Calibration();assert(R0==saved);
assert(mq5Estimate(saved*sqrtf(1000.0f/80.0f),saved)>79.99f);
sensorValid=true;lastSensor=tick;calibrateMQ5();adc=0;for(int i=0;i<60;i++){tick+=1000;serviceMQ5Calibration();}assert(R0==saved);
adc=1200;lastSensor=tick;calibrateMQ5();currentState=STATE_DANGER;tick+=1000;serviceMQ5Calibration();assert(!mq5Calibrating&&R0==saved);
adc=4095;assert(!isfinite(readLPGppm()));adc=1200;mv=2500;assert(!isfinite(readLPGppm()));
std::cout<<"PASS actual MQ5 averaging, voltage divider, invalid bounds, explicit baseline, persistence, failure retention and elevated-reading abort\n";
}
'''
with tempfile.TemporaryDirectory() as tmp:
 cpp=Path(tmp)/'mq5.cpp';exe=Path(tmp)/'mq5';cpp.write_text(shim+settings+functions+main)
 subprocess.run(['g++','-std=c++17',str(cpp),'-o',str(exe)],check=True)
 subprocess.run([str(exe)],check=True)
for key in ['WIFI_SSID','WIFI_PASS','BOT_TOKEN','CHAT_ID','SUPABASE_KEY']:
 assert re.search(r'const\s+char\s*\*\s*'+key+r'\s*=\s*""',s)
print('PASS public full sketch has no filled private connection settings')
# Compile the actual payload with the existing Arduino String shim.
import json
context={'__file__':str(repo/'tests/firmware-telemetry.py')}
exec((repo/'tests/firmware-telemetry.py').read_text().split('sketch =',1)[0],context)
a=s.index('String buildSupabaseJson()');b=s.index('\nbool sendToSupabase()',a)
code=context['source']+'''\nenum AlertState{STATE_SAFE,STATE_WARNING,STATE_DANGER};AlertState currentState=STATE_WARNING;const float GAS_WARNING_PPM=80,GAS_DANGER_PPM=100;\n'''+s[a:b]+'''\nint main(){gasPPM=99.9;std::cout<<buildSupabaseJson()<<"\\n";sensorValid=false;temperature=NAN;std::cout<<buildSupabaseJson()<<"\\n";}'''
with tempfile.TemporaryDirectory() as tmp:
 cpp=Path(tmp)/'payload.cpp';exe=Path(tmp)/'payload';cpp.write_text(code)
 subprocess.run(['g++','-std=c++17',str(cpp),'-o',str(exe)],check=True)
 rows=[json.loads(line) for line in subprocess.check_output([str(exe)],text=True).splitlines()]
assert rows[0]['hardware_outputs']['sensor_model']=='MQ5'
assert rows[0]['hardware_outputs']['gas_warning_ppm']==80
assert rows[0]['hardware_outputs']['gas_danger_ppm']==100
assert rows[0]['hardware_outputs']['gas_estimate_ppm']==99.9
assert rows[0]['gas_ppm']==100  # integer schema retained; profile uses precise nested estimate
assert rows[1]['hardware_outputs']['gas_estimate_ppm'] is None
assert rows[1]['temperature'] is None
print('PASS actual full JSON: integer DB compatibility, unrounded estimate, profile thresholds and null failures')
