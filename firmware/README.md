# Send output states from the existing ESP firmware

The latest supplied firmware sets relay and buzzer outputs OFF in both modes,
but only uploads LPG, temperature,
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
reports the GPIO command, not a verified OPEN/CLOSED valve position. The latest sketch has no DFPlayer/voice implementation, so voice reports NOT
CONFIGURED. This replacement does not refer to the removed FAN_ON or dfReady.
A physical feedback sensor would be needed to prove actuator operation.

Check both firmware modes in a controlled bench test: output cards must match GPIO
commands, and disconnecting the ESP must make the cards UNKNOWN after the existing
freshness timeout. A live dashboard and working Telegram message do not establish
that a physical valve/fan is operating correctly.

Threshold mismatch remains a separate issue: the supplied ESP has 1000 ppm danger
entry / 800 ppm recovery, while the dashboard currently uses 100/300 ppm. Do not
use dashboard classification to infer actuator commands. Firmware still has demo
mode enabled and MQ_R0 unset; no real-sensor readiness is claimed here.

The latest sketch uses a separate sensor/LCD task and omits created_at from the
POST body. The replacement preserves that behavior, relying on the existing
sensor_data.created_at database default. Actuators remain disabled; changing
telemetry does not activate them. The latest sendTelegramPhoto still accesses
fb->len after returning the frame buffer, and photos and streaming share one
frame buffer. Those are separate firmware issues requiring a device-validated
camera update. No credentials from the uploaded sketches are committed.

## Complete sketch for the latest uploaded version

`GLiPS/GLiPS.ino` is the complete latest uploaded sketch with the tested telemetry
function already inserted. WIFI_SSID, WIFI_PASS, BOT_TOKEN, CHAT_ID and
SUPABASE_KEY are blank. Fill them only in your local copy; do not commit or send
that filled copy. Open it inside a folder named GLiPS in Arduino IDE, use your
existing board/library settings, compile, and upload. Apply the SQL column first.

This full sketch has not been compiled for an ESP board or flashed here. Its
actuator OFF logic and existing TLS/camera limitations are preserved, not fixed
by the telemetry integration. GPIO reports describe output commands only.
