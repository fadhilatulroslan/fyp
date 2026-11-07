"""Regress reviewed changeStatus firmware via existing actual-function host harnesses."""
from pathlib import Path
import sys
repo=Path(__file__).resolve().parents[1]
for name in ['firmware-outputs.py','firmware-telemetry.py']:
 code=(repo/'tests'/name).read_text().replace('firmware/GLiPS/GLiPS.ino','firmware/reviewed-legacy/GLiPS.ino')
 sys.argv=[name,'--complete']
 exec(compile(code,name,'exec'),{'__file__':str(repo/'tests'/name)})
code=(repo/'tests/current-device-telegram.py').read_text().replace('firmware/current-device/GLiPS.ino','firmware/reviewed-legacy/GLiPS.ino')
code=code.replace("function=s[a:b]", "function=s[a:b].replace('  const AlertState currentState = danger ? STATE_DANGER : gasPPM > GAS_SAFE_PPM ? STATE_WARNING : STATE_SAFE;\\n', '')")
code=code.replace("b=s.index('\\nvoid updateSystemState()',a)","b=s.index('\\nvoid processTelegramAlert()',a)")
exec(compile(code,'legacy-telegram','exec'),{'__file__':str(repo/'tests/current-device-telegram.py')})
