# GLiPS full-system firmware — v4

The complete `GLiPS/GLiPS.ino` includes the supplied hardware pins, LCD,
DFPlayer, sensor routines, camera, Supabase and Telegram integrations. Credentials
are blank in the public sketch. Changes below implement the user's approved
thresholds and manual valve-reset behavior; actual hardware is not validated here.

## Gas states and outputs

- At or below 100 ppm: SAFE.
- Above 100 ppm: WARNING unless DANGER is retained.
- Enter DANGER at 300 ppm or above.
- Once in DANGER, retain it until a valid reading is at or below 250 ppm.
- Sensor errors do not count as recovery or clear the valve latch.

DANGER requests fan and buzzer ON and DFPlayer track 1. Recovery stops fan,
buzzer, and voice requests. Green LED indicates SAFE; red LED indicates WARNING,
DANGER, or invalid sensor state. Voice telemetry reports a play/stop request,
not verified audible playback.

The valve relay latches to the existing VALVE_RELAY_DANGER GPIO level after a
DANGER transition and stays there even when gas status recovers. The latch is
stored in ESP Preferences (NVS) for normal restarts. On startup the stored state
is read before enabling the valve output. Unavailable storage commands the
latched relay level and disables reset. Storage write failures are reported on
Serial Monitor; do not assume persistence succeeded if that error occurs. Erasing
NVS/flash clears saved state; this software cannot guarantee GPIO levels during
reset, startup, or loss of power. These are GPIO commands, not physical position
feedback. Relay polarity and VALVE_RELAY_TEST remain as supplied.

## Local manual reset

After inspecting the area and confirming the intended valve/relay behavior:

1. Open Serial Monitor at 115200, with Newline or Both NL & CR selected.
2. Wait for a valid SAFE reading (at or below 100 ppm), no more than 4 seconds old.
3. Enter `RESET_VALVE` and Send.
4. Verify `VALVE: manual reset accepted; normal relay command restored`.

DANGER, WARNING, invalid/stale readings, or unavailable latch storage reject the
reset. No dashboard button or recovery reading automatically releases the latch.
The dashboard displays Latched only when reported in fresh hardware_outputs;
physical valve movement is not established by that label.

## Install and verify

1. Run `supabase/hardware-telemetry.sql` if hardware_outputs does not exist.
2. Copy `GLiPS/GLiPS.ino` into an Arduino sketch folder named GLiPS. Fill only the
   five local credentials: WIFI_SSID, WIFI_PASS, BOT_TOKEN, CHAT_ID, SUPABASE_KEY.
   Never publish the filled sketch.
3. Use the board settings/libraries from the working original: ESP32-S3 core,
   DHT, LiquidCrystal_I2C, DFRobotDFPlayerMini and ESP camera support. Preferences
   is included in the ESP32 core. Compile and upload via USB.
4. Verify `GLiPS firmware: 300/250 hysteresis + manual valve reset v4` at 115200,
   a successful Supabase HTTP result, and hardware_outputs JSON in a NEW row.
5. Check SAFE/WARNING/DANGER, GPIO reports, recovery with valve still latched,
   rejection of an unsafe reset, and explicit SAFE reset. Confirm the physical
   relay/valve separately before connecting this to a real gas supply.

The complete sketch is required: the payload-only replacement depends on other
v4 helpers and is not a standalone upgrade to v3.

## Validation and limits

Host tests compile actual functions using stub peripherals; no hardware is operated:

```sh
python3 tests/firmware-outputs.py
python3 tests/firmware-telemetry.py
python3 tests/firmware-telemetry.py --complete
python3 tests/firmware-photo.py
```

Tests cover threshold boundaries/hysteresis, output commands, persistent latch,
fresh SAFE-only reset, stale/invalid/storage-failure rejection, serial parsing,
payload JSON, and early camera-frame release during Telegram photo upload.
They do not compile the complete sketch for an ESP board, prove NVS hardware
behavior, physical actuator operation, live backend delivery, or streaming stability.

DEMO_MODE remains enabled. Its simulated readings are 80/350 ppm, allowing SAFE,
DANGER and manual-reset testing; WARNING/boundary behavior is covered by host
fixtures. Real MQ-6 operation still needs MQ_R0 calibration. Demo mode runs the
actual output logic, as the original full-system sketch did. Existing setInsecure()
calls remain from the supplied network code; TLS trust is not corrected here.
Sensor/LCD updates may be delayed by blocking Internet requests. Camera streams
and Quick Tunnel reachability still require validation on the user's equipment.

## Fixed-site location in the same Telegram danger message

v4.1 adds SITE_NAME, SITE_ADDRESS, SITE_MAP_URL, SITE_LATITUDE and SITE_LONGITUDE
near the local bot settings. They are intentionally empty/NAN in the public
sketch. Configure the actual installation location locally before uploading.
No location is obtained from Wi-Fi or inferred as GPS.

- Recommended: set SITE_NAME and SITE_MAP_URL to the verified HTTPS Google Maps
  share/pin link for the installation. SITE_ADDRESS is optional readable text.
- Alternatively, supply both latitude (-90..90) and longitude (-180..180). The
  text builder creates a clickable Maps coordinate link. A provided HTTPS link
  takes precedence.
- An address alone creates a clearly labelled address-search link, not a verified
  coordinate pin. With no configured location, the message explicitly says so;
  it never sends an invented location or default 0,0 pin.

The location text is inserted in the existing DANGER text message before the
camera link, using the existing sendMessage request. It does not create a second
Telegram location-pin message or add a network request. Existing retry behavior
and hardware control are unchanged. The installation location is shared with the
configured Telegram chat whenever this danger alert succeeds; verify the pin and
recipient before use. Keep private site details out of a public filled sketch.

Run `python3 tests/firmware-location.py` for the host-level text/encoding tests.
The full board compile and actual Telegram delivery still need device validation.
The startup marker is now `v4.1 + site location` within the full build string.
