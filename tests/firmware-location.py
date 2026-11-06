"""Host-test the actual fixed-site Telegram text builder; no messages are sent."""
from pathlib import Path
import subprocess,tempfile
repo=Path(__file__).resolve().parents[1]
s=(repo/'firmware/GLiPS/GLiPS.ino').read_text()
a=s.index('String telegramLocationText()');b=s.index('\nbool sendTelegramPhoto(',a)
location=s[a:b]
a=s.index('String urlEncode(');b=s.index('String getTimeText()',a)
encoding=s[a:b]
source=r'''
#include <string>
#include <cstring>
#include <cmath>
#include <cctype>
#include <stdint.h>
#include <sstream>
#include <iomanip>
#include <cassert>
#include <iostream>
using std::isfinite;
struct String:std::string {
 using std::string::string;
 String(const std::string& value):std::string(value){}
 String(double value,int digits):std::string(format(value,digits)){}
 static std::string format(double value,int digits){std::ostringstream s;s<<std::fixed<<std::setprecision(digits)<<value;return s.str();}
 void trim(){auto start=find_first_not_of(" \t\r\n");if(start==npos){clear();return;}auto end=find_last_not_of(" \t\r\n");*this=substr(start,end-start+1);}
 bool startsWith(const char* prefix) const{return compare(0,strlen(prefix),prefix)==0;}
};
const char* SITE_NAME="";const char* SITE_ADDRESS="";const char* SITE_MAP_URL="";
double SITE_LATITUDE=NAN,SITE_LONGITUDE=NAN;
'''+encoding+location+r'''
int main(){
assert(telegramLocationText()=="Location: not configured on this device.");
SITE_NAME="  Test site  ";SITE_ADDRESS="Test road & unit 2";SITE_MAP_URL="https://maps.example.invalid/pin";
auto t=telegramLocationText();assert(t.find("Location: Test site\n")!=std::string::npos);assert(t.find("Address: Test road & unit 2\n")!=std::string::npos);assert(t.find("Map: https://maps.example.invalid/pin")!=std::string::npos);
SITE_MAP_URL="";t=telegramLocationText();assert(t.find("query=Test%20road%20%26%20unit%202")!=std::string::npos);
SITE_ADDRESS="";SITE_LATITUDE=12.345678;SITE_LONGITUDE=-45.987654;t=telegramLocationText();assert(t.find("https://www.google.com/maps?q=12.345678,-45.987654")!=std::string::npos);
SITE_MAP_URL="https://maps.example.invalid/verified";assert(telegramLocationText().find("maps.example.invalid/verified")!=std::string::npos);
SITE_MAP_URL="javascript:invalid";SITE_LATITUDE=91;assert(telegramLocationText().find("Map pin: not configured")!=std::string::npos);
SITE_NAME="";SITE_LATITUDE=NAN;SITE_LONGITUDE=NAN;assert(telegramLocationText()=="Location: not configured on this device.");
SITE_LATITUDE=0;SITE_LONGITUDE=0;assert(telegramLocationText().find("q=0.000000,0.000000")!=std::string::npos);
std::cout<<"PASS no fabricated default location, site name/address, HTTPS map link, encoded address search, valid coordinate pin and invalid coordinate rejection; no live Telegram delivery test\n";
}
'''
with tempfile.TemporaryDirectory() as tmp:
 cpp=Path(tmp)/'location.cpp';exe=Path(tmp)/'location';cpp.write_text(source)
 subprocess.run(['g++','-std=c++17','-Wall','-Wextra',str(cpp),'-o',str(exe)],check=True)
 subprocess.run([str(exe)],check=True)
# Verify the actual danger message includes location before the camera link.
a=s.index('void processTelegramAlert()');b=s.index('\n// ===',a)
alert=s[a:b]
assert 'telegramLocationText()' in alert
assert alert.index('telegramLocationText()') < alert.index('shareableCameraURL()')
assert 'if (!alertSent)' in alert
