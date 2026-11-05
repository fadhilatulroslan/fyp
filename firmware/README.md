# GLiPS full-system firmware

The current `GLiPS/GLiPS.ino` uses the user's supplied full-system sketch as its
base. GPIO pin assignments, relay polarity macros, output-control functions,
LCD logic, DFPlayer play/stop behavior, camera configuration, and operating mode
are preserved from that source. It does not use the earlier actuator-disabled
sketch as its base.

## Included integrations

- `buildSupabaseJson()` uploads `hardware_outputs` with GPIO command states,
  Wi-Fi connectivity, and DFPlayer play/stop requests or UNAVAILABLE.
- Publishable Supabase keys go in `apikey`; Bearer Authorization is added only
  for legacy JWT-style keys. Key validity and insert permissions need a live test.
- Telegram photo sending copies the frame and returns the camera driver's buffer
  before network I/O, without reading that buffer again after release.
- Serial Monitor identifies `GLiPS firmware: full-system + output-telemetry v3`
  and prints `SUPABASE payload includes hardware_outputs` before uploading.
- Dashboard gas thresholds match 1000 ppm danger entry and 800 ppm recovery.
  An explicit valid ESP status takes precedence in the hysteresis band.

## Installation

1. Run `supabase/hardware-telemetry.sql` in Supabase SQL Editor if the column is
   not already present. Existing rows remain NULL; inspect newly inserted rows.
2. Copy the complete sketch from `GLiPS/GLiPS.ino` into an Arduino sketch folder
   named GLiPS. Fill WIFI_SSID, WIFI_PASS, BOT_TOKEN, CHAT_ID and SUPABASE_KEY only
   in the local copy. Do not publish the filled copy.
3. Use the ESP32-S3 board settings and installed libraries from the working
   original sketch, including DHT, LiquidCrystal_I2C, DFRobotDFPlayerMini, and the
   ESP32 camera support. Compile and upload via USB.
4. Open Serial Monitor at 115200 and verify the v3 build marker, successful
   Supabase HTTP response, and non-NULL hardware_outputs on a NEW database row.
5. Refresh the dashboard. Reported fan/buzzer/LED states should match the uploaded
   commands. Valve RELAY HIGH/LOW is a GPIO level, not a verified physical position.

`buildSupabaseJson-replacement.txt` targets this full-system DFPlayer version only;
using the complete sketch avoids mixing functions from incompatible versions.

## Validation and remaining limits

Host checks (no hardware or network operation):

```sh
python3 tests/firmware-outputs.py
python3 tests/firmware-telemetry.py
python3 tests/firmware-telemetry.py --complete
python3 tests/firmware-photo.py
```

These compile the actual GPIO/DFPlayer, payload, and photo-buffer functions with
host stubs. Safe/danger/recovery/invalid commands, valid JSON, and early frame
release are checked. They do not compile the whole sketch for an ESP board or
prove physical actuator operation, camera stability, or delivery to Supabase and
Telegram. Full-board compilation and testing remain required.

DEMO_MODE remains true, exactly as in the supplied source. In that mode gas,
temperature, and humidity are simulated; the supplied actuator logic still runs.
MQ_R0 remains NAN, so real MQ-6 operation requires calibration. VALVE_RELAY_TEST
remains enabled, and relay polarity is preserved, not independently verified.
Physical feedback would be required to establish valve/fan operation. Existing
setInsecure() calls remain in the user-supplied network code; TLS certificate
verification is not addressed by this integration.

Sensor/LCD updates remain in the original main loop and can be delayed by
blocking Internet requests. The camera buffer correction reduces one source of
contention but does not establish that Wi-Fi, power, the tunnel, or the full
firmware is stable. Keep other stream viewers closed while testing.
