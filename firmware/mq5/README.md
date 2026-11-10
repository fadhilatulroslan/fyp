# Full MQ5 integration v10

Merged from the user's supplied full firmware and the supplied MQ5 test. All private Wi-Fi, Telegram and Supabase settings are blank in this public source; the private complete copy retains the user's settings outside Git.

## Input and experimental scale

MQ5 AO enters GPIO1 through a 10k/10k divider (gain2). VCC5V, RL10kOhm must match the actual module. The code averages32 ADC/voltage samples with5ms spacing, rejects ADC<=10 or>=4000 and AO outside0..5V, and estimates Rs. The supplied A1000, B-2 and clean-air ratio6.5 are illustrative, not validated MQ5 LPG calibration. This code does not establish safety-rated ppm or leak thresholds. Heater warm-up/burn-in must follow the actual sensor datasheet; the baseline routine is not a substitute.

## Initial baseline

After warm-up in known clean air, open Serial Monitor115200 with Newline and send CALIBRATE_MQ5. This explicitly confirms the clean-air assumption; it is not run automatically at boot.60 samples are collected at least1s apart, without a long blocking calibration loop; network operations can lengthen the total time. At least50 valid samples are required. R0=mean(Rs)/6.5 is stored in Preferences namespace glips-mq5 and restored on restart. Failure preserves an older baseline. Re-baselining an already configured device requires a fresh SAFE reading, and an elevated reading aborts it. No baseline means concentration unavailable, not a forced SAFE reading. The user must not baseline in gas-contaminated air.

## Retained functions

DHT22 physical measurements and null failure values, LED timer, existing audio/buzzer/fan/valve commands and pins, camera capture/stream, Telegram text/native fixed-site pin/per-incident photo, and database error diagnostics/hardware_outputs remain from the supplied sketch. No physical verification or full ESP board compile was possible here. Blocking network operations inherited from the source still affect sampling latency.

Experimental triggers: WARNING>=80, DANGER>=100, SAFE<80. These are the user's experimental test values, not validated gas safety limits. hardware_outputs includes sensor_model MQ5, measurement_basis experimental_estimate, gas_warning_ppm, gas_danger_ppm and precise gas_estimate_ppm. The integer gas_ppm column stays integer-compatible. The updated dashboard uses this explicit profile and unrounded value for status, meter/graph thresholds and labels; legacy records retain their existing100/300 semantics. The estimate qualifier is visible beside the meter and in Telegram.

## Validation

python3 tests/mq5-firmware.py compiles the actual sample/baseline/JSON functions with fake ADC, storage and Arduino interfaces. node tests/mq5-profile.cjs checks80/100 boundaries, precision, invalid profiles/faults and legacy behavior. The dashboard smoke suite passes with mocked external services. None of these checks establish real gas accuracy, audible sound, valve movement, network delivery or board compatibility.

## v11 startup diagnostics and readable Serial output

The user reports a restart loop before monitoring starts, without a reset log. No root cause is established. The sketch now reports esp_reset_reason() and seven startup steps with free memory before photo storage, outputs/timer, sensor storage, LCD, Wi-Fi, camera and DFPlayer. LCD I2C timeout is bounded at100ms. This is a diagnostic improvement, not proof that the reboot cause is fixed. Brownout/watchdog protections remain enabled; a supply problem cannot be repaired by logging or threshold changes.

STATUS (115200/Newline) prints readable SAFE/WARNING/DANGER/BASELINE REQUIRED or SENSOR ERROR, estimated gas, real temperature/humidity, Wi-Fi, the last database reply and its age, camera/DF initialization, output commands, uptime and free memory. Regular summary output is limited to about once every5s; verbose raw values are gated by GLIPS_DEBUG. Network calls inherited from the original source can delay reports/sampling. Commands, calibration, thresholds, actuators and notification flow remain unchanged. Hardware initialization is not proof of physical operation.

Validation: tests/mq5-diagnostics.py compiles actual reset reason descriptions with host enum stubs. Sampling/baseline/JSON regression still passes. No full ESP toolchain compile, boot reproduction or power/PSRAM validation was available. After uploading, collect the first boot header, last STARTUP stage and any ROM/Guru Meditation output.
