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

## Supabase API key header correction

The complete GLiPS.ino now sends a publishable key only in the `apikey` header.
It adds `Authorization: Bearer ...` only for legacy JWT-style keys beginning with
`eyJ`. Copy the public sketch using GitHub Raw, then restore the five blank
configuration values only in Arduino IDE. Verify SUPABASE_URL and SUPABASE_KEY
come from the same project and use a publishable key or legacy anon key, never
a service-role or secret key in firmware intended for distribution.

This corrects the request headers; it does not prove that the chosen key is valid
or that table insert permissions are configured. If the response remains
"Invalid API key", copy a current key from that project's API settings. A later
RLS/permission error is a separate issue and does not mean the API key is invalid.
Do not disable RLS to resolve an unexplained error. Full-device compilation and
live Supabase insertion still need verification on the user's laptop/ESP.

## Firmware build v2: camera buffer ownership and upload evidence

The complete sketch prints `GLiPS firmware: output-telemetry + camera-buffer-fix v2`
on startup and `SUPABASE payload includes hardware_outputs` before each upload.
Use these messages and the HTTP result to verify that the new sketch, rather than
an older flashed version, is running. Success still requires non-NULL JSON in a
new database row; creating the column does not backfill old rows.

Telegram photo upload now copies the JPEG into a temporary buffer and returns the
camera driver's frame before opening the TLS connection. It frees the copy after
sending and never reads a returned frame. Allocation failure skips that photo
attempt. This reduces contention with the one-buffer stream; it does not prove
that the user's Wi-Fi, tunnel, camera power or full ESP firmware is stable.
Host checks: `python3 tests/firmware-photo.py` and
`python3 tests/firmware-telemetry.py`. Full-board compile/upload remains unverified.
