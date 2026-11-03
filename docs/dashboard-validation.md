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
- Camera streaming still uses the ESP's private HTTP address and requires network
  reachability and browser permission. Remote streaming is deferred. An HTTPS
  dashboard may block a plain HTTP camera stream.

Historical alert events are derived from changes in sensor gas status, including
recovery to SAFE; they are not proof a Telegram message was delivered. The full
history query is capped at 10,000 sensor rows. Frontend session checks do not
replace Supabase row-level security and authorization in Edge Functions.
