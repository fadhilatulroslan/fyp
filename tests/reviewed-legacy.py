"""Run current full firmware regressions on the reviewed changeStatus variant."""
from pathlib import Path
repo=Path(__file__).resolve().parents[1]
for name in ['current-startup.py','current-device-telemetry.py','current-device-telegram.py','current-photo-lock.py']:
 code=(repo/'tests'/name).read_text().replace('firmware/current-device/GLiPS.ino','firmware/reviewed-legacy/GLiPS.ino')
 exec(compile(code,name,'exec'),{'__file__':str(repo/'tests'/name)})
