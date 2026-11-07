"""Check actual state transitions: warning speaker, danger stop speaker for buzzer."""
from pathlib import Path
import subprocess,tempfile
repo=Path(__file__).resolve().parents[1]
for file in ['current-device','reviewed-legacy']:
 s=(repo/f'firmware/{file}/GLiPS.ino').read_text()
 def fn(name):
  a=s.index('void '+name+'(');start=s.index('{',a);depth=0
  for i in range(start,len(s)):
   if s[i]=='{':depth+=1
   elif s[i]=='}':
    depth-=1
    if depth==0:return s[a:i+1]
 shim='''
#include <cassert>
enum AlertState{STATE_SAFE,STATE_WARNING,STATE_DANGER};
AlertState currentState=STATE_SAFE;bool sensorValid=true;
float gasPPM=80;const float GAS_SAFE_PPM=100,GAS_WARNING_PPM=150,GAS_DANGER_PPM=300;
unsigned long lastAlert=0;int plays=0,stops=0;
void updateOutputs(){} void updateLCD(){} void playAlarm(){plays++;}void stopAlarm(){stops++;}
'''
 main='''
int main(){updateSystemState();assert(plays==0);
gasPPM=200;updateSystemState();assert(plays==1&&currentState==STATE_WARNING);
updateSystemState();assert(plays==1);
gasPPM=350;updateSystemState();assert(plays==1&&stops==1&&currentState==STATE_DANGER);
gasPPM=200;updateSystemState();assert(plays==2);
gasPPM=80;updateSystemState();assert(stops==2&&currentState==STATE_SAFE);
'''
 functions=fn('updateSystemState')
 if 'void changeStatus(' in s:
  functions+=fn('changeStatus')
  main+='changeStatus(true);assert(stops==3&&plays==2);gasPPM=200;changeStatus(false);assert(plays==3);'
 main+='}'
 with tempfile.TemporaryDirectory() as tmp:
  cpp=Path(tmp)/'voice.cpp';exe=Path(tmp)/'voice';cpp.write_text(shim+functions+main)
  subprocess.run(['g++','-std=c++17',str(cpp),'-o',str(exe)],check=True)
  subprocess.run([str(exe)],check=True)
print('PASS both templates start voice on WARNING and stop voice on DANGER/SAFE; no repeat on unchanged state')
