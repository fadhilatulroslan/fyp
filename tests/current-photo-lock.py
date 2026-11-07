"""Verify the actual persisted single-photo reservation and startup test stages."""
from pathlib import Path
import subprocess,tempfile
repo=Path(__file__).resolve().parents[1]
s=(repo/'firmware/current-device/GLiPS.ino').read_text()
a=s.index('void restorePhotoLock()');b=s.index('unsigned int warningTextAttempts',a)
fn=s[a:b]
a=s.index('float testSequenceReading(');b=s.index('\nfloat readLPGppm()',a)
fn+=s[a:b]
shim=r'''
#include <cassert>
#include <iostream>
bool dangerPhotoAttempted=false,photoStoreReady=false;
const unsigned long TEST_STAGE_MS=20000;
struct Store {bool saved=false,openOK=true,writeOK=true;bool begin(const char*,bool){return openOK;}bool getBool(const char*,bool){return saved;}int putBool(const char*,bool value){if(!writeOK)return 0;saved=value;return 1;}}photoStore;
struct Log {void println(const char*){}}Serial;
'''
main=r'''
int main(){
restorePhotoLock();assert(!dangerPhotoAttempted);assert(reservePhotoAttempt());assert(photoStore.saved);
assert(!reservePhotoAttempt());dangerPhotoAttempted=false;restorePhotoLock();assert(dangerPhotoAttempted);assert(!reservePhotoAttempt());
photoStore.saved=false;restorePhotoLock();photoStore.writeOK=false;assert(!reservePhotoAttempt());assert(dangerPhotoAttempted);
photoStore.openOK=false;restorePhotoLock();assert(!reservePhotoAttempt());
assert(testSequenceReading(0)==80);assert(testSequenceReading(19999)==80);
assert(testSequenceReading(20000)==200);assert(testSequenceReading(39999)==200);
assert(testSequenceReading(40000)==350);assert(testSequenceReading(900000)==350);
std::cout<<"PASS persistent photo lock across reboots, failure suppression and one-pass SAFE/WARNING/DANGER sequence\n";
}
'''
with tempfile.TemporaryDirectory() as tmp:
 cpp=Path(tmp)/'lock.cpp';exe=Path(tmp)/'lock';cpp.write_text(shim+fn+main)
 subprocess.run(['g++','-std=c++17',str(cpp),'-o',str(exe)],check=True)
 subprocess.run([str(exe)],check=True)
