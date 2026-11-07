"""Compile actual startup and output functions for both configured modes."""
from pathlib import Path
import subprocess,tempfile,re
repo=Path(__file__).resolve().parents[1]
s=(repo/'firmware/current-device/GLiPS.ino').read_text()
a=s.index('void buzzerONFunction()');b=s.index('\n// ===',s.index('void initializeStartupReading()',a))
functions=s[a:b]
settings='\n'.join(l for l in s.splitlines() if re.match(r'#define (LED_GREEN|LED_RED|RELAY_FAN|RELAY_VALVE|BUZZER_PIN|BUZZER_ON|BUZZER_OFF|FAN_ON|FAN_OFF|VALVE_RELAY_TEST|VALVE_RELAY_DANGER|VALVE_RELAY_SAFE)\b',l))
shim=r'''
#include <cassert>
#include <cmath>
#include <cstdint>
#include <iostream>
const int HIGH=1,LOW=0;
enum AlertState{STATE_SAFE,STATE_WARNING,STATE_DANGER};
AlertState currentState=STATE_DANGER;
bool sensorValid=false,hasSensorSample=false;float gasPPM=NAN;
int gpio[64]={};unsigned long tick=0;
unsigned long millis(){return tick;}
void digitalWrite(int pin,int v){gpio[pin]=v;}
int digitalRead(int pin){return gpio[pin];}
using esp_timer_handle_t=void*;
struct Log{template<class... Args>void printf(const char*,Args...){}}Serial;
'''
main=r'''
int main(){
initializeStartupReading();updateOutputs();
assert(currentState==STATE_SAFE);assert(sensorValid==DEMO_MODE);
assert(gpio[LED_GREEN]==(DEMO_MODE?HIGH:LOW));assert(gpio[LED_RED]==LOW);
assert(gpio[RELAY_VALVE]==VALVE_RELAY_SAFE);assert(gpio[RELAY_FAN]==FAN_OFF);
assert(gpio[BUZZER_PIN]==BUZZER_OFF);
sensorValid=true;hasSensorSample=true;currentState=STATE_WARNING;updateOutputs();
for(tick=0;tick<2000;tick+=250){refreshIndicators(nullptr);assert(gpio[LED_RED]==HIGH&&gpio[LED_GREEN]==LOW);}
currentState=STATE_DANGER;tick=0;updateOutputs();assert(gpio[LED_RED]==HIGH);
assert(gpio[RELAY_VALVE]==VALVE_RELAY_DANGER);assert(gpio[RELAY_FAN]==FAN_ON);assert(gpio[BUZZER_PIN]==BUZZER_ON);
tick=500;refreshIndicators(nullptr);assert(gpio[LED_RED]==LOW);
tick=1000;refreshIndicators(nullptr);assert(gpio[LED_RED]==HIGH);
}
'''
with tempfile.TemporaryDirectory() as tmp:
 for mode in ['true','false']:
  cpp=Path(tmp)/(mode+'.cpp');exe=Path(tmp)/mode
  cpp.write_text(shim+'\n#define DEMO_MODE '+mode+'\n'+settings+'\n'+functions+main)
  subprocess.run(['g++','-std=c++17',str(cpp),'-o',str(exe)],check=True)
  subprocess.run([str(exe)],check=True)
assert 'dfPlayer.volume(30)' in s
assert 'dfPlayer.play(1)' in s
assert 'dfPlayer.playMp3Folder(1)' in s
print('PASS test startup green/SAFE, real startup unknown, WARNING solid red, DANGER blink, relay/fan/buzzer command polarity')
