"""Exercise actual Telegram episode scheduling with fake delivery, no network."""
from pathlib import Path
import subprocess,tempfile
repo=Path(__file__).resolve().parents[1]
s=(repo/'firmware/current-device/GLiPS.ino').read_text()
a=s.index('void processTelegramAlerts() {');b=s.index('\nvoid updateSystemState()',a)
function=s[a:b]
shim=r'''
#include <string>
#include <cassert>
#include <iostream>
struct String:std::string {using std::string::string;String(const std::string& v):std::string(v){} String(float,int):std::string("884.0"){} };
enum State{STATE_SAFE,STATE_WARNING,STATE_DANGER};
State currentState=STATE_DANGER;
bool sensorValid=true,cameraReady=true,warningSent=false,dangerTextSent=false,dangerPhotoSent=false,dangerPhotoAttempted=false,alertSafeTiming=false;
unsigned int warningTextAttempts=0,dangerTextAttempts=0;
unsigned long alertSafeSince=0,lastAlert=0,clockMs=1;
const unsigned long ALERT_REARM_SAFE_MS=60000,ALERT_RETRY=20000;
const unsigned int ALERT_MAX_TEXT_ATTEMPTS=3;
const float GAS_SAFE_PPM=100;float gasPPM=884;
String dangerEventTime="";
const int WL_CONNECTED=3;struct Wifi{int status(){return WL_CONNECTED;}}WiFi;
struct Log{void println(const char*){}}Serial;
unsigned long millis(){return clockMs;}
bool reservePhotoAttempt(){if(dangerPhotoAttempted)return false;dangerPhotoAttempted=true;return true;}
String getTimeText(){return "07/11/2026 00:12:00 MYT (UTC+8)";}
String buildTelegramAlert(bool critical){return critical?"DANGER":"WARNING";}
int texts=0,photos=0;bool textOK=true;
bool sendTelegramText(const String&){texts++;return textOK;}
bool sendTelegramPhoto(const String&){assert(dangerTextSent);photos++;return false;}
'''
shim += '\nconst bool persistentPhoto = ' + ('true' if 'bool reservePhotoAttempt()' in s else 'false') + ';\n'
main=r'''
int main(){
currentState=STATE_WARNING;gasPPM=200;
processTelegramAlerts();assert(texts==1&&photos==0);
currentState=STATE_DANGER;gasPPM=884;lastAlert=0;
processTelegramAlerts();assert(texts==2&&photos==1);
for(int i=0;i<100;i++){clockMs+=21000;processTelegramAlerts();}
assert(texts==2&&photos==1); // failed/ambiguous photo is never retried
currentState=STATE_WARNING;gasPPM=200;clockMs+=21000;processTelegramAlerts();
currentState=STATE_DANGER;gasPPM=884;lastAlert=0;processTelegramAlerts();
assert(photos==1); // flapping does not rearm photos
currentState=STATE_SAFE;gasPPM=80;processTelegramAlerts();clockMs+=59000;processTelegramAlerts();
assert(dangerPhotoAttempted);
sensorValid=false;processTelegramAlerts();sensorValid=true;processTelegramAlerts();
clockMs+=59000;processTelegramAlerts();assert(dangerPhotoAttempted);
clockMs+=1001;processTelegramAlerts();assert(dangerPhotoAttempted==persistentPhoto);
currentState=STATE_DANGER;gasPPM=884;processTelegramAlerts();assert(photos==(persistentPhoto?1:2)&&texts==3);
// A new episode with failed text must not send a photo, and must stop retrying.
currentState=STATE_SAFE;gasPPM=80;processTelegramAlerts();clockMs+=60001;processTelegramAlerts();
currentState=STATE_DANGER;gasPPM=884;textOK=false;int before=texts;
for(int i=0;i<10;i++){clockMs+=21000;processTelegramAlerts();}
assert(texts-before==3&&photos==(persistentPhoto?1:2));
std::cout<<"PASS text-first order, one photo attempt, flapping suppression, SAFE text rearm without photo unlock, bounded text retries\n";
}
'''
with tempfile.TemporaryDirectory() as tmp:
 cpp=Path(tmp)/'alerts.cpp';exe=Path(tmp)/'alerts';cpp.write_text(shim+function+main)
 subprocess.run(['g++','-std=c++17',str(cpp),'-o',str(exe)],check=True)
 subprocess.run([str(exe)],check=True)
# Ensure payload has all requested links and clock fallback without fabricated time.
body=s[s.index('String buildTelegramAlert('):a]
for required in ['SITE_MAP_URL','cameraURL()','getTimeText()','dangerEventTime','https://fadhilatulroslan.github.io/fyp/dashboard.html','digitalRead(RELAY_FAN)','digitalRead(BUZZER_PIN)']:
 assert required in body
assert 'sendTelegramLocation(' not in function
assert 'Not synchronized; device uptime' in s
# Reuse the ownership harness against this actual photo function too.
test=(repo/'tests/firmware-photo.py').read_text().replace("firmware/GLiPS/GLiPS.ino", "firmware/current-device/GLiPS.ino").replace("\\nvoid processTelegramAlert()", "\\nString buildTelegramAlert(")
exec(compile(test,'photo-harness','exec'),{'__file__':str(repo/'tests/firmware-photo.py')})
# Compile the real message builder as well as the scheduling logic.
message_shim=shim.replace('String(float,int):std::string("884.0"){}', 'String(float,int):std::string("884.0"){} bool startsWith(const char* p)const{return rfind(p,0)==0;}')
message_shim=message_shim.replace('String buildTelegramAlert(bool critical){return critical?"DANGER":"WARNING";}','')
message_shim += r'''
const String LOCATION_NAME="IKM Lumut";
const char* SITE_MAP_URL="https://maps.app.goo.gl/AqbbRXZjT2Hft84j9";
float temperature=28,humidity=65;
const int RELAY_VALVE=1,RELAY_FAN=2,BUZZER_PIN=3,HIGH=1,FAN_ON=1,BUZZER_ON=0;
int digitalRead(int pin){return pin==BUZZER_PIN?0:1;}
bool dfReady=true,voicePlaybackRequested=true;
String dashboardURL(){return "https://dashboard.example/";}
String cameraURL(){return "http://10.178.40.114:81/stream";}
'''
message_main=r'''
int main(){dangerEventTime=getTimeText();String text=buildTelegramAlert(true);
assert(text.find("IKM Lumut")!=std::string::npos);
assert(text.find("MYT (UTC+8)")!=std::string::npos);
assert(text.find("https://maps.app.goo.gl/AqbbRXZjT2Hft84j9")!=std::string::npos);
assert(text.find("http://10.178.40.114:81/stream")!=std::string::npos);
assert(text.find("Exhaust fan: ON")!=std::string::npos);
assert(text.find("Buzzer: ON")!=std::string::npos);
assert(text.find("physical operation not confirmed")!=std::string::npos);
}
'''
with tempfile.TemporaryDirectory() as tmp:
 cpp=Path(tmp)/'message.cpp';exe=Path(tmp)/'message';cpp.write_text(message_shim+body+message_main)
 subprocess.run(['g++','-std=c++17',str(cpp),'-o',str(exe)],check=True)
 subprocess.run([str(exe)],check=True)
print('PASS compiled alert includes location, MYT date/time, links and truthful output reports')
