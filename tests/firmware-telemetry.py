"""Validate the real replacement payload function with a host C++ Arduino shim.
This does not compile the full sketch or establish ESP board compatibility.
"""
import json
import sys
from pathlib import Path
import subprocess
import tempfile

repo = Path(__file__).resolve().parents[1]
source = r'''
#include <string>
#include <sstream>
#include <iomanip>
#include <iostream>
#include <cmath>
#include <ctime>
using std::isfinite;
struct String : std::string {
  using std::string::string;
  String(const std::string& s):std::string(s){}
  String(int value):std::string(std::to_string(value)){}
  String(float value, int digits):std::string(format(value,digits)){}
  static std::string format(float value,int digits){std::ostringstream s;s<<std::fixed<<std::setprecision(digits)<<value;return s.str();}
};
const int HIGH=1, LOW=0, RELAY_VALVE=0,RELAY_FAN=1,BUZZER_PIN=2,LED_RED=3,LED_GREEN=4;
const int FAN_OFF=LOW,BUZZER_ON=LOW,WL_CONNECTED=3;
int outputs[5]={LOW,LOW,HIGH,LOW,HIGH};
int digitalRead(int pin){return outputs[pin];}
struct Wifi{int status(){return WL_CONNECTED;}} WiFi;
bool sensorValid=true,danger=false;
float gasPPM=120,temperature=28.5,humidity=65;
'''
if '--complete' in sys.argv:
    sketch = (repo / 'firmware/GLiPS/GLiPS.ino').read_text()
    start = sketch.index('String buildSupabaseJson() {')
    end = sketch.index('\nbool sendToSupabase()', start)
    source += sketch[start:end]
else:
    source += (repo / 'firmware/buildSupabaseJson-replacement.txt').read_text()
source += r'''
int main(){
std::cout<<buildSupabaseJson()<<"\n";
danger=true;gasPPM=1500;outputs[0]=HIGH;outputs[1]=HIGH;outputs[2]=LOW;outputs[3]=HIGH;outputs[4]=LOW;
std::cout<<buildSupabaseJson()<<"\n";
sensorValid=false;gasPPM=NAN;
std::cout<<buildSupabaseJson()<<"\n";
}
'''
with tempfile.TemporaryDirectory() as tmp:
    cpp = Path(tmp) / 'telemetry.cpp'
    binary = Path(tmp) / 'telemetry'
    cpp.write_text(source)
    subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', str(cpp), '-o', str(binary)], check=True)
    rows = [json.loads(line) for line in subprocess.check_output([str(binary)], text=True).splitlines()]
safe, danger, invalid = rows
assert safe['hardware_outputs'] == {
    'kind':'output_commands','gas_valve':'RELAY LOW','exhaust_fan':'OFF',
    'buzzer':'OFF','red_led':'OFF','green_led':'ON',
    'voice_alert':'NOT CONFIGURED','wifi_connected':True,
}
assert danger['hardware_outputs']['gas_valve'] == 'RELAY HIGH'
assert danger['hardware_outputs']['exhaust_fan'] == 'ON'
assert danger['hardware_outputs']['buzzer'] == 'ON'  # active-low buzzer
assert danger['hardware_outputs']['voice_alert'] == 'NOT CONFIGURED'
assert invalid['status'] == 'SENSOR ERROR'
assert invalid['hardware_outputs']['voice_alert'] == 'NOT CONFIGURED'
assert safe['gas_ppm'] == 120 and danger['gas_ppm'] == 1500
print('PASS compiled replacement produces valid JSON and GPIO command states; full ESP sketch untested')
