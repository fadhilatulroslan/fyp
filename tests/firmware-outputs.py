"""Host regression of actual firmware hysteresis, GPIO commands and valve latch.
This does not operate hardware or compile the full ESP sketch.
"""
from pathlib import Path
import re,subprocess,tempfile
repo=Path(__file__).resolve().parents[1]
s=(repo/'firmware/GLiPS/GLiPS.ino').read_text()
def block(start,end):
 a=s.index(start);return s[a:s.index(end,a)]
definitions='\n'.join(line for line in s.splitlines() if re.match(r'#define (LED_GREEN|LED_RED|RELAY_FAN|RELAY_VALVE|BUZZER_PIN|BUZZER_ON|BUZZER_OFF|FAN_ON|FAN_OFF|VALVE_RELAY_TEST|VALVE_RELAY_DANGER|VALVE_RELAY_SAFE)\b',line) or re.match(r'const (float GAS_|unsigned long SENSOR_INTERVAL)',line))
source=r'''
#include <cassert>
#include <iostream>
#include <string>
#include <cstring>
#include <cmath>
using std::isfinite;
const int HIGH=1,LOW=0;
int gpio[64]={};bool sensorValid=true,danger=false,dfReady=true,alertSent=false,photoSent=false;
bool valveLatched=false,valveStorageReady=false,voicePlaybackRequested=false;
float gasPPM=80;unsigned long lastAlert=0,lastSensor=1000,nowMs=1000;
unsigned long millis(){return nowMs;}
void digitalWrite(int pin,int value){gpio[pin]=value;}
void delay(int){} void updateLCD(){}
struct DF{int plays=0,stops=0;void volume(int){}void play(int track){assert(track==1);plays++;}void stop(){stops++;}}dfPlayer;
struct Preferences {bool stored=false,beginOK=true,writeOK=true;bool begin(const char*,bool){return beginOK;}bool getBool(const char*,bool fallback){return stored?true:fallback;}size_t putBool(const char*,bool value){if(!writeOK)return 0;stored=value;return 1;}}safetyPreferences;
struct SerialMock{std::string incoming;int available(){return incoming.size();}int read(){char c=incoming[0];incoming.erase(0,1);return c;}void println(const char*){}}Serial;
'''+definitions+'\n'+block('bool nextDangerState(', '\nvoid buzzerONFunction()')+'\n'+block('void buzzerONFunction()', '\n// ====')+'\n'+block('void playAlarm()', 'String dashboardURL()')
source+=r'''
void sample(float ppm){gasPPM=ppm;sensorValid=isfinite(ppm)&&ppm>=0;lastSensor=nowMs;changeStatus(nextDangerState(danger,sensorValid,ppm));updateOutputs();}
int main(){
restoreValveLatch();sample(80);assert(!valveLatched&&gpio[RELAY_VALVE]==VALVE_RELAY_SAFE);assert(std::string(currentGasStatus())=="SAFE");
sample(100);assert(std::string(currentGasStatus())=="SAFE");
sample(101);assert(std::string(currentGasStatus())=="WARNING");assert(gpio[LED_GREEN]==LOW&&gpio[LED_RED]==HIGH);assert(gpio[RELAY_FAN]==FAN_OFF);
sample(299);assert(!danger);sample(300);assert(danger&&valveLatched&&safetyPreferences.stored);assert(gpio[RELAY_FAN]==FAN_ON&&gpio[BUZZER_PIN]==BUZZER_ON&&gpio[RELAY_VALVE]==VALVE_RELAY_DANGER);assert(dfPlayer.plays==1);
sample(350);sample(290);sample(251);assert(danger&&dfPlayer.plays==1);assert(!resetValveLatch());
sample(250);assert(!danger&&std::string(currentGasStatus())=="WARNING");assert(gpio[RELAY_FAN]==FAN_OFF&&gpio[BUZZER_PIN]==BUZZER_OFF);assert(gpio[RELAY_VALVE]==VALVE_RELAY_DANGER&&valveLatched);assert(!resetValveLatch());assert(dfPlayer.stops==1);
sample(80);assert(std::string(currentGasStatus())=="SAFE"&&valveLatched);valveLatched=false;restoreValveLatch();updateValveRelay();assert(valveLatched&&gpio[RELAY_VALVE]==VALVE_RELAY_DANGER);
nowMs+=5000;assert(!resetValveLatch());lastSensor=nowMs;sample(NAN);assert(!resetValveLatch());assert(valveLatched);sample(80);
Serial.incoming=std::string(40,'X')+"RESET_VALVE\n";processSerialCommands();assert(valveLatched);
Serial.incoming="RESET_VALVE\r\n";processSerialCommands();assert(!valveLatched&&!safetyPreferences.stored&&gpio[RELAY_VALVE]==VALVE_RELAY_SAFE);
sample(300);sample(80);safetyPreferences.writeOK=false;assert(!resetValveLatch());assert(valveLatched&&!valveStorageReady);safetyPreferences.writeOK=true;restoreValveLatch();assert(valveLatched);assert(resetValveLatch());
safetyPreferences.beginOK=false;valveLatched=false;restoreValveLatch();updateValveRelay();assert(valveLatched&&!valveStorageReady&&gpio[RELAY_VALVE]==VALVE_RELAY_DANGER);assert(!resetValveLatch());
std::cout<<"PASS 100/300/250 boundaries, danger hysteresis, GPIO/DFPlayer, persistent valve latch, fresh SAFE-only serial reset, invalid/stale/overflow/storage-failure rejection; physical operation untested\n";
}
'''
with tempfile.TemporaryDirectory() as tmp:
 cpp=Path(tmp)/'outputs.cpp';exe=Path(tmp)/'outputs';cpp.write_text(source)
 subprocess.run(['g++','-std=c++17','-Wall','-Wextra',str(cpp),'-o',str(exe)],check=True)
 subprocess.run([str(exe)],check=True)
