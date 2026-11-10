"""Host-test actual reset cause descriptions; not a hardware restart test."""
from pathlib import Path
import subprocess,tempfile
repo=Path(__file__).resolve().parents[1];s=(repo/'firmware/mq5/GLiPS.ino').read_text()
a=s.index('const char* resetReasonText(');b=s.index('\nvoid startupStep(',a)
code='''#include <cassert>\n#include <cstring>\nenum esp_reset_reason_t{ESP_RST_UNKNOWN,ESP_RST_POWERON,ESP_RST_EXT,ESP_RST_SW,ESP_RST_PANIC,ESP_RST_INT_WDT,ESP_RST_TASK_WDT,ESP_RST_WDT,ESP_RST_DEEPSLEEP,ESP_RST_BROWNOUT,ESP_RST_SDIO};\n'''+s[a:b]+'''\nint main(){assert(strstr(resetReasonText(ESP_RST_BROWNOUT),"voltage"));assert(strstr(resetReasonText(ESP_RST_PANIC),"crash"));assert(strstr(resetReasonText(ESP_RST_TASK_WDT),"watchdog"));assert(strstr(resetReasonText(ESP_RST_POWERON),"Power on"));}'''
with tempfile.TemporaryDirectory() as tmp:
 cpp=Path(tmp)/'reset.cpp';exe=Path(tmp)/'reset';cpp.write_text(code);subprocess.run(['g++','-std=c++17',str(cpp),'-o',str(exe)],check=True);subprocess.run([str(exe)],check=True)
for n in range(1,8):assert f'{n}/7 -' in s
assert 'STARTUP COMPLETE' in s and 'printSystemSummary();' in s
assert 'WRITE_PERI_REG' not in s and 'disableCore0WDT' not in s and 'disableCore1WDT' not in s
print('PASS reset causes distinguish brownout/panic/watchdog; startup stages and STATUS report present; protections not disabled')
