# Send output states from the existing ESP firmware

The supplied firmware controls GPIO outputs but only uploads LPG, temperature,
humidity, status, and timestamp. The dashboard cannot reconstruct the output
states from that data, so UNKNOWN is expected.

1. In the project's Supabase SQL Editor, run
   [`hardware-telemetry.sql`](../supabase/hardware-telemetry.sql). It adds one
   nullable JSONB column; old rows remain unknown. Do this before flashing.
2. In your existing Arduino sketch, replace the entire `buildSupabaseJson()`
   function with [`buildSupabaseJson-replacement.txt`](buildSupabaseJson-replacement.txt).
   Keep the rest of the sketch and your local credentials unchanged.
3. Compile using your existing ESP32-S3 board settings and libraries, then upload
   over USB. This repository does not have a board/toolchain pin, so a full sketch
   compilation and device upload cannot be verified in the cloud.
4. In Serial Monitor (115200), verify the Supabase POST succeeds. In Supabase,
   verify NEW sensor_data rows contain hardware_outputs. Restart/refresh the
   dashboard; output cards should update on the next fresh reading, normally
   within the 10-second polling interval. Old database rows are not backfilled.

The patch reads GPIO output levels; it does not change output control, pins,
thresholds, calibration, credentials, or operating mode. Valve RELAY HIGH/LOW
reports the GPIO command, not a verified OPEN/CLOSED valve position. Voice
PLAY REQUESTED/STOP REQUESTED reports the firmware request, not audio feedback.
A physical feedback sensor would be needed to prove actuator operation.

Check both firmware modes in a controlled bench test: output cards must match GPIO
commands, and disconnecting the ESP must make the cards UNKNOWN after the existing
freshness timeout. A live dashboard and working Telegram message do not establish
that a physical valve/fan is operating correctly.

Threshold mismatch remains a separate issue: the supplied ESP has 1000 ppm danger
entry / 800 ppm recovery, while the dashboard currently uses 100/300 ppm. Do not
use dashboard classification to infer actuator commands. Firmware still has demo
mode enabled and MQ_R0 unset; no real-sensor readiness is claimed here.
