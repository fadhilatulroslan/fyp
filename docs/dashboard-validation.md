# Dashboard validation

Run `node tests/dashboard-smoke.cjs` from the repository root with Python 3,
Playwright, and Chromium installed. Set `CHROMIUM_PATH` if Chromium is elsewhere.
Playwright can be installed outside the checkout, for example:

```sh
npm install --prefix /tmp/glips-test-tools playwright
NODE_PATH=/tmp/glips-test-tools/node_modules node tests/dashboard-smoke.cjs
```

The suite starts its own local server on port 8765, opens the actual pages in
Chromium, and stops its server/browser when finished. It downloads the application's
CDN libraries with normal TLS verification. It intercepts the Supabase and camera
requests and injects test-only authentication responses; it does not sign into a
real account, send a Telegram message, or operate hardware.

Checks cover live/stale/missing/invalid data, safe/warning/danger/recovery, database
outage/recovery, graph periods and empty states, device status, live history,
Malaysia time/month filtering, Excel download, print invocation, AI response/error
and escaped content, manual Telegram configuration and duplicate-send prevention,
camera start/stop/error/timeout, sound toggle, modal close, mobile overflow,
login success/failure, remembered username, logout, and navigation without a session.

The user believes automatic Telegram alerts are sent by the ESP firmware. That
firmware is not in this repository, so delivery is displayed as unverified; it
is independent of the dashboard's optional Send Manual Alert button.

## Verify with real devices before the demo

- Sign in using an existing authorized account and verify logout and sign-in again.
- Confirm fresh ESP readings appear, then disconnect the ESP. After the configured
  20-second freshness window the graph must clear, hardware states become unknown,
  and the database can still show Connected. Reconnect and verify recovery.
- Use a controlled sensor test to confirm actual warning/danger thresholds,
  physical valve/fan/buzzer feedback, database records, and Telegram delivery.
  Frontend simulations do not establish physical safety or hardware operation.
- Confirm the existing `glips-ai` Edge Function works with a real authenticated
  session. Backend code is not included in this repository.
- Manual Telegram sending needs the actual deployed Edge Function URL in
  `CONFIG.telegramAlertEndpoint`, currently unset. The Supabase project URL alone
  does not identify that function. Do not put a Telegram bot token in frontend code.
- Camera streaming uses the HTTPS Cloudflare Quick Tunnel in
  `CONFIG.cameraStreamUrl`, with public access approved by the user. Keep
  cloudflared running on the Windows laptop, with the laptop awake and connected
  to the ESP network. Quick Tunnel hostnames can change after restarting the
  tunnel; update the configured URL when they do. Close other direct camera
  stream tabs before testing the dashboard.

Historical alert events are derived from changes in sensor gas status, including
recovery to SAFE; they are not proof a Telegram message was delivered. The full
history query is capped at 10,000 sensor rows. Frontend session checks do not
replace Supabase row-level security and authorization in Edge Functions.

## Findings from the supplied ESP firmware

Telegram text and photos are sent directly by `processTelegramAlert()` through
`sendTelegramText()` and `sendTelegramPhoto()`. The optional dashboard manual-alert
endpoint is independent. The supplied firmware is not committed because it contains
credentials.

The firmware currently enables DEMO_MODE, alternating 120/1500 ppm every 15 seconds.
The original supplied thresholds were 1000/800 ppm. Current v4 follows the
user-approved 300 ppm danger trigger, 250 ppm clear threshold and 100 ppm SAFE
limit. The dashboard honors reported DANGER only within that hysteresis band.
MQ_R0 is NAN, so real MQ-6 measurements cannot work until calibrated. Invalid
measurements are currently uploaded as zero with SENSOR ERROR; the frontend now
honors this status, excludes the reading from the graph/history, and shows unknown
instead of SAFE. The upload does not include hardware feedback fields, so the
frontend cannot verify valve/fan/LED/buzzer states. Firmware still captures Telegram
photos even though dashboard capture controls were removed. The original photo-buffer access after esp_camera_fb_return() has been corrected
in the current full-system integration. Existing setInsecure() calls and physical
device validation remain unresolved.

## Compact English status layout

Safety Response has three cards: Gas Valve, Exhaust Fan, and Alarm. Expand Alarm
to see Buzzer, Red LED, and Green LED reports. Voice Alert is removed. A compact
strip below the main readings contains ESP32, Database, and Last reading; the
separate Wi-Fi, DHT22, and unverified Telegram cards are removed. Telegram send
results still appear as toasts; message delivery is not inferred.

Missing output fields show Not reported. Stale readings, sensor errors, and database
outages show distinct unknown reasons. The Alarm summary distinguishes Active,
Inactive, and partial reports; green LED alone does not mean the alarm is active.
This layout does not populate missing hardware_outputs or activate physical
outputs. Apply the telemetry SQL and upload the matching firmware separately.

## Changing a Quick Tunnel address

The camera's Connection settings panel accepts an HTTPS tunnel base URL (adds
/stream) or complete stream URL. Save camera URL stores it only in that browser
and stops the current stream. Invalid protocols and embedded credentials are
rejected. Reopen Start Live Monitoring after saving. A saved value takes precedence
over CONFIG.cameraStreamUrl on subsequent visits; update the field whenever
cloudflared creates a new hostname. This setting does not fix ESP/network outages.

## Full-system integration

The latest full-system sketch supplied by the user restores original fan, buzzer,
valve relay-test, LEDs, LCD and DFPlayer control. That source is the base of the
current complete sketch, with its output functions preserved. See firmware/README.md
for the current build, host checks, and remaining physical/board validation limits.

## v4 hysteresis and manually reset valve

Current firmware retains DANGER after 300 ppm until at or below 250 ppm. The
valve relay latch is independent of gas-state recovery and is stored in ESP
Preferences for normal restarts. A fresh SAFE reading at or below 100 ppm and
local RESET_VALVE serial command are required to release it. The dashboard reads
hardware_outputs.valve_latched and can show SAFE gas alongside a Latched valve.
No physical valve position is inferred. See firmware/README.md for test limits,
storage handling, upload steps, and manual reset instructions.
