"""Host-test frame ownership in the actual Telegram photo function, without networking."""
from pathlib import Path
import subprocess,tempfile
repo=Path(__file__).resolve().parents[1]
s=(repo/'firmware/GLiPS/GLiPS.ino').read_text()
a=s.index('bool sendTelegramPhoto(');b=s.index('\n// ===',a)
fn=s[a:b]
shim=r'''
#include <string>
#include <stdint.h>
#include <iostream>
#include <cstring>
#include <cstdlib>
#include <cassert>
#include <algorithm>
using std::min;
struct String:std::string {
 using std::string::string;
 String(const std::string& v):std::string(v){}
 String(size_t v):std::string(std::to_string(v)){}
 long indexOf(const char* text) const {auto i=find(text);return i==npos?-1:static_cast<long>(i);}
};
const int WL_CONNECTED=3;
struct Wifi{int status(){return WL_CONNECTED;}}WiFi;
bool cameraReady=true,returned=false,connectOK=true;
size_t bytes=0,writeLimit=1024,returnCount=0;
const char* CHAT_ID="test-only",*BOT_TOKEN="test-only";
struct camera_fb_t{size_t len;uint8_t* buf;};
uint8_t picture[3000]={1,2,3};camera_fb_t frame{sizeof(picture),picture};
camera_fb_t* esp_camera_fb_get(){returned=false;frame={sizeof(picture),picture};return &frame;}
void esp_camera_fb_return(camera_fb_t* f){assert(!returned);returned=true;returnCount++;f->len=0;f->buf=nullptr;}
struct WiFiClientSecure {
 void setInsecure(){} void setTimeout(int){}
 bool connect(const char*,int){assert(returned);return connectOK;}
 template<class T> void print(const T&){}
 size_t write(const uint8_t*,size_t count){assert(returned);size_t n=min(count,writeLimit);bytes+=n;return n;}
 String readStringUntil(char){return "HTTP/1.1 200 OK";}
 void stop(){}
};
'''
main=r'''
int main(){
assert(sendTelegramPhoto("test"));assert(bytes==sizeof(picture));assert(returnCount==1);
connectOK=false;assert(!sendTelegramPhoto("test"));assert(returnCount==2);
connectOK=true;writeLimit=0;assert(!sendTelegramPhoto("test"));assert(returnCount==3);
std::cout<<"PASS frame returned before network I/O, exact photo byte count, failed connect and failed write; no real network or board test\n";
}
'''
with tempfile.TemporaryDirectory() as tmp:
 cpp=Path(tmp)/'photo.cpp';exe=Path(tmp)/'photo';cpp.write_text(shim+fn+main)
 subprocess.run(['g++','-std=c++17','-Wall','-Wextra',str(cpp),'-o',str(exe)],check=True)
 subprocess.run([str(exe)],check=True)
