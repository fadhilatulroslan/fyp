"""Compile the actual GPIO and DFPlayer control functions with host stubs.
No device operation or full ESP board compilation is performed.
"""
from pathlib import Path
import re,subprocess,tempfile
repo=Path(__file__).resolve().parents[1]
s=(repo/'firmware/GLiPS/GLiPS.ino').read_text()
def block(start,end):
 a=s.index(start);return s[a:s.index(end,a)]
definitions='\n'.join(line for line in s.splitlines() if re.match(r'#define (LED_GREEN|LED_RED|RELAY_FAN|RELAY_VALVE|BUZZER_PIN|BUZZER_ON|BUZZER_OFF|FAN_ON|FAN_OFF|VALVE_RELAY_TEST|VALVE_RELAY_DANGER|VALVE_RELAY_SAFE)\b',line))
source=r'''
#include <cassert>
#include <iostream>
const int HIGH=1,LOW=0;
int gpio[64]={};bool sensorValid=true,danger=false,dfReady=true,alertSent=false,photoSent=false;
unsigned long lastAlert=0;
void digitalWrite(int pin,int value){gpio[pin]=value;}
void delay(int){}
void updateLCD(){}
struct DF {int plays=0,stops=0,track=0;void volume(int){}void play(int t){plays++;track=t;}void stop(){stops++;}}dfPlayer;
'''+definitions+'\n'+block('void buzzerONFunction()', '\n// ====')+'\n'+block('void playAlarm()', '\n// ====')
source+=r'''
int main(){
updateOutputs();assert(gpio[LED_GREEN]==HIGH&&gpio[LED_RED]==LOW);assert(gpio[RELAY_FAN]==FAN_OFF);assert(gpio[BUZZER_PIN]==BUZZER_OFF);assert(gpio[RELAY_VALVE]==VALVE_RELAY_SAFE);
changeStatus(true);assert(gpio[LED_GREEN]==LOW&&gpio[LED_RED]==HIGH);assert(gpio[RELAY_FAN]==FAN_ON);assert(gpio[BUZZER_PIN]==BUZZER_ON);assert(gpio[RELAY_VALVE]==VALVE_RELAY_DANGER);assert(dfPlayer.plays==1&&dfPlayer.track==1);
changeStatus(true);assert(dfPlayer.plays==1);
changeStatus(false);assert(gpio[RELAY_FAN]==FAN_OFF&&gpio[BUZZER_PIN]==BUZZER_OFF&&gpio[RELAY_VALVE]==VALVE_RELAY_SAFE);assert(dfPlayer.stops==1);
sensorValid=false;danger=true;updateOutputs();assert(gpio[LED_RED]==HIGH&&gpio[LED_GREEN]==LOW&&gpio[RELAY_FAN]==FAN_OFF&&gpio[BUZZER_PIN]==BUZZER_OFF&&gpio[RELAY_VALVE]==VALVE_RELAY_SAFE);
std::cout<<"PASS provided safe/danger/recovery/invalid GPIO commands and DFPlayer play/stop preserved; physical operation untested\n";
}
'''
with tempfile.TemporaryDirectory() as tmp:
 cpp=Path(tmp)/'outputs.cpp';exe=Path(tmp)/'outputs';cpp.write_text(source)
 subprocess.run(['g++','-std=c++17','-Wall','-Wextra',str(cpp),'-o',str(exe)],check=True)
 subprocess.run([str(exe)],check=True)
