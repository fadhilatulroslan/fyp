# Current-device diagnostic update

This template is based on the user-supplied functioning sketch received on 7 November 2026 (Malaysia). It preserves its pins, real sensor mode, calibration, thresholds, valve behavior, camera and Telegram functions. It does not add the separate template's persistent valve latch or 300/250 hysteresis. Existing TLS settings and photo-buffer behavior are unchanged.

Use `../prepare-sketch.html?version=current` with the matching filled source to restore connection settings locally. No file upload is performed. Do not commit the filled output.

Changes: `hardware_outputs` JSON containing GPIO command reports (not physical feedback), safe HTTP status logging, correct anon-JWT versus publishable-key authorization, DFPlayer startup/event diagnostics, and newline-terminated `TEST_VOICE` / `STOP_VOICE` serial commands at 115200 baud. STOP_VOICE is rejected during active DANGER. Audio still uses the supplied sketch's `play(1)` track selection; this command does not prove audible playback. Initialization failure remains unavailable rather than reporting audio as playing.

After upload, check `SUPABASE payload includes hardware_outputs`, HTTP 201, and a non-null object in the latest database row. For audio, check `DFPLAYER READY` versus `DFPLAYER INIT FAILED`, then send TEST_VOICE. Verify microSD audio and first-track ordering, UART pins, common ground, stable module power and speaker wiring according to the module specification. Physical hardware and a full ESP toolchain compile were not available here.

Validation: `python3 tests/current-device-telemetry.py` compiles the real JSON and play/stop functions with host stubs. The supplied private sketch also passed the browser helper's pin/mode/calibration/library/function guards without revealing credentials.

## Telegram v2

The current-device template sends one plain-text alert containing IKM Lumut, the supplied Google Maps link, Malaysia date/time, current readings, actual GPIO output commands, dashboard and camera links. No separate native location message is sent; the older unverified coordinate constants are not used in the alert flow. Time synchronization is requested when Wi-Fi becomes available; if NTP has not synchronized, the message explicitly says so and reports uptime rather than inventing a date.

DANGER text must return HTTP 200 before one optional photo attempt. Photos are not retried when acknowledgment is missing, since an ambiguous response may already have delivered the photo. Text requests have at most three attempts, spaced by the retry interval; missing acknowledgments can still cause duplicate text. Delivery deduplication is in RAM and resets on reboot. Rearming requires 60 continuous seconds of valid SAFE readings; threshold flapping and sensor errors do not rearm. This only changes notification scheduling, not output thresholds or valve behavior.

The snapshot buffer is copied and the camera driver's frame returned before network upload; no frame metadata is read after return. Live stream concurrency and real Telegram delivery still require device testing. All existing `setInsecure()` behavior remains inherited from the working sketch.

The helper has an optional current HTTPS camera URL field. Dashboard URL settings do not automatically update ESP firmware. Restarting a quick tunnel requires updating the camera URL in the dashboard and the generated/uploaded sketch. Set the current working URL before preparing the code.

Validation: `python3 tests/current-device-telegram.py` compiles the real scheduler, message builder and photo function with fake network/Arduino interfaces. It checks ordering, repeated DANGER, state flapping, invalid readings, SAFE rearm, bounded failures, content and frame ownership. This is not a full ESP32 compile or a real notification test.

## Full firmware v3 (supersedes photo rearming above)

The latest update is based on the identical newly supplied original sketch. LCD startup now reads WELCOME GLiPS / Starting system, without TVETMARA LUMUT. Existing pins, real-mode sensor conversion and output behavior remain in place. The optional preparation-page test checkbox sets DEMO_MODE=true and runs a single 80ppm SAFE stage for 20s, 200ppm WARNING for 20s, then holds 350ppm DANGER; it does not loop. With the box unchecked, the source's sensor mode is preserved and an initially high reading goes straight to DANGER. The original analog-to-ppm conversion is only an estimate and has not been calibrated here.

A photo upload attempt is now persisted BEFORE network transmission using Preferences namespace glips-photo. SAFE transitions and reboots do not clear it. Failed storage initialization/write disables automatic photos. This favors no repeated photos over guaranteed delivery. To permit one new attempt, send REARM_PHOTO on Serial Monitor 115200 with Newline, only while the sensor has a fresh valid SAFE reading; storage must be available. Text alerts still rearm after sustained SAFE. Erasing NVS removes the saved photo lock.

The database JSON always includes hardware_outputs; no fallback removes it. Check startup marker GLiPS full firmware v3, SUPABASE payload includes hardware_outputs and HTTP201, then check the newest row. Previous rows remain NULL unless deliberately edited; uploading the new firmware does not backfill old telemetry. GPIO command reports are not physical feedback. Full ESP compile and hardware tests remain required.

Additional regression: python3 tests/current-photo-lock.py compiles the actual persisted reservation and test-stage functions with host stubs, including reboot/write-failure/open-failure cases. Browser tests cover full-code generation in both architectures and the explicit test checkbox.
