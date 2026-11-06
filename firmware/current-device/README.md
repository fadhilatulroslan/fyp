# Current-device diagnostic update

This template is based on the user-supplied functioning sketch received on 7 November 2026 (Malaysia). It preserves its pins, real sensor mode, calibration, thresholds, valve behavior, camera and Telegram functions. It does not add the separate template's persistent valve latch or 300/250 hysteresis. Existing TLS settings and photo-buffer behavior are unchanged.

Use `../prepare-sketch.html?version=current` with the matching filled source to restore connection settings locally. No file upload is performed. Do not commit the filled output.

Changes: `hardware_outputs` JSON containing GPIO command reports (not physical feedback), safe HTTP status logging, correct anon-JWT versus publishable-key authorization, DFPlayer startup/event diagnostics, and newline-terminated `TEST_VOICE` / `STOP_VOICE` serial commands at 115200 baud. STOP_VOICE is rejected during active DANGER. Audio still uses the supplied sketch's `play(1)` track selection; this command does not prove audible playback. Initialization failure remains unavailable rather than reporting audio as playing.

After upload, check `SUPABASE payload includes hardware_outputs`, HTTP 201, and a non-null object in the latest database row. For audio, check `DFPLAYER READY` versus `DFPLAYER INIT FAILED`, then send TEST_VOICE. Verify microSD audio and first-track ordering, UART pins, common ground, stable module power and speaker wiring according to the module specification. Physical hardware and a full ESP toolchain compile were not available here.

Validation: `python3 tests/current-device-telemetry.py` compiles the real JSON and play/stop functions with host stubs. The supplied private sketch also passed the browser helper's pin/mode/calibration/library/function guards without revealing credentials.
