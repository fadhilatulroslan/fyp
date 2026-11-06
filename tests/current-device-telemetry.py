"""Compile the supplied-device JSON function with a host shim, not an ESP build."""
import json
import subprocess
import tempfile
from pathlib import Path
repo = Path(__file__).resolve().parents[1]
base = (repo / 'tests/firmware-telemetry.py').read_text().split('sketch =', 1)[0]
context = {'__file__': str(repo / 'tests/firmware-telemetry.py')}
exec(base, context)
s = (repo / 'firmware/current-device/GLiPS.ino').read_text()
start = s.index('String buildSupabaseJson() {')
end = s.index('\nbool sendToSupabase()', start)
source = context['source'] + '''
enum AlertState {STATE_SAFE, STATE_WARNING, STATE_DANGER};
AlertState currentState=STATE_SAFE;
''' + s[start:end] + '''
int main(){
 std::cout<<buildSupabaseJson()<<"\\n";
 currentState=STATE_DANGER;gasPPM=884;voicePlaybackRequested=true;
 outputs[0]=HIGH;outputs[1]=HIGH;outputs[2]=LOW;outputs[3]=HIGH;outputs[4]=LOW;
 std::cout<<buildSupabaseJson()<<"\\n";
 dfReady=false;sensorValid=false;
 std::cout<<buildSupabaseJson()<<"\\n";
}
'''
with tempfile.TemporaryDirectory() as tmp:
 cpp=Path(tmp)/'payload.cpp';binary=Path(tmp)/'payload'
 cpp.write_text(source)
 subprocess.run(['g++','-std=c++17',str(cpp),'-o',str(binary)],check=True)
 rows=[json.loads(line) for line in subprocess.check_output([str(binary)],text=True).splitlines()]
assert rows[0]['hardware_outputs']['buzzer']=='OFF'
assert rows[1]['status']=='DANGER'
assert rows[1]['hardware_outputs']['exhaust_fan']=='ON'
assert rows[1]['hardware_outputs']['buzzer']=='ON'
assert rows[1]['hardware_outputs']['gas_valve']=='RELAY HIGH'
assert rows[1]['hardware_outputs']['voice_alert']=='PLAY REQUESTED'
assert 'valve_latched' not in rows[1]['hardware_outputs']  # no latch invented
assert rows[2]['hardware_outputs']['voice_alert']=='UNAVAILABLE'
assert rows[2]['status']=='SENSOR ERROR'
print('PASS current-device JSON reports output commands, active-low buzzer and unavailable voice')
voice_start=s.index('void playAlarm() {')
voice_end=s.index('\nString dashboardURL',voice_start)
# Only compile the two actual voice functions, independent of other helpers.
voice=s[voice_start:s.index('\n}',s.index('void stopAlarm()',voice_start))+2]
voice_source='''
#include <cassert>
bool dfReady=false,voicePlaybackRequested=false;
struct Log {void println(const char*){}} Serial;
struct Player {int plays=0,stops=0;void volume(int){} void play(int n){assert(n==1);plays++;}void stop(){stops++;}} dfPlayer;
void delay(int){}
'''+voice+'''
int main(){playAlarm();assert(dfPlayer.plays==0);assert(!voicePlaybackRequested);
dfReady=true;playAlarm();assert(dfPlayer.plays==1);assert(voicePlaybackRequested);
stopAlarm();assert(dfPlayer.stops==1);assert(!voicePlaybackRequested);}
'''
with tempfile.TemporaryDirectory() as tmp:
 cpp=Path(tmp)/'voice.cpp';binary=Path(tmp)/'voice'
 cpp.write_text(voice_source)
 subprocess.run(['g++','-std=c++17',str(cpp),'-o',str(binary)],check=True)
 subprocess.run([str(binary)],check=True)
print('PASS actual voice functions report unavailable player and track play/stop requests')
