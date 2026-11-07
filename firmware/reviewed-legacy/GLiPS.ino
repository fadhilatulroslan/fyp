// Public full-system sketch: fill the five blank credential fields locally.
#include <Arduino.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>
#include <DFRobotDFPlayerMini.h>
#include "esp_camera.h"
#include "esp_http_server.h"
#include <math.h>
#include <time.h>

// ==========================================
// GLiPS ESP32-S3 - FULL SYSTEM + SUPABASE
// ==========================================

// ===== WIFI & TELEGRAM =====
// Isi semula credentials asal sebelum upload
const char* WIFI_SSID = "";
const char* WIFI_PASS = "";

const char* BOT_TOKEN = "";
const char* CHAT_ID = "";

// Fixed installation location supplied by the user; not a live GPS position.
const char* SITE_NAME = "IKM Lumut";
const char* SITE_ADDRESS = "";
const char* SITE_MAP_URL = "https://maps.app.goo.gl/AqbbRXZjT2Hft84j9";  // User-supplied pin/share link.
const double SITE_LATITUDE = NAN;
const double SITE_LONGITUDE = NAN;


// ===== SUPABASE =====
const char* SUPABASE_URL =
  "https://fkfgimyelgvlsbtxhvih.supabase.co";
const char* SUPABASE_KEY =
  "";
const char* SUPABASE_TABLE = "sensor_data";

// ===== TEST MODE =====
#define DEMO_MODE true

const unsigned long SENSOR_INTERVAL = 2000;
const unsigned long DEMO_INTERVAL = 15000;
const unsigned long ALERT_RETRY = 15000;
const unsigned long DB_INTERVAL = 5000;

const float GAS_DANGER_PPM = 300.0;
const float GAS_DANGER_CLEAR_PPM = 250.0;
const float GAS_SAFE_PPM = 100.0;

// MQ6 calibration (not yet available)
const float MQ_R0 = NAN;
const float MQ_VCC = 5.0;
const float MQ_RL = 10.0;
const float DIVIDER_GAIN = 2.0;
const float LPG_M = -0.47;
const float LPG_B = 1.31;

// ===== ESP32-S3 PINS =====
#define MQ6_PIN 1
#define DHT_PIN 2
#define DHT_TYPE DHT22

#define LED_GREEN 38
#define LED_RED 39

#define RELAY_FAN 40
#define RELAY_VALVE 41

#define BUZZER_PIN 42

#define LCD_SDA 47
#define LCD_SCL 48

#define DF_RX 14
#define DF_TX 21

// ===== BUZZER =====
#define BUZZER_ON LOW
#define BUZZER_OFF HIGH

// ===== FAN RELAY =====
#define FAN_ON HIGH
#define FAN_OFF LOW

// ===== VALVE RELAY TEST =====
#define VALVE_RELAY_TEST 1
#define VALVE_RELAY_DANGER HIGH
#define VALVE_RELAY_SAFE LOW

// ===== CAMERA OV3660 =====
#define CAM_PWDN -1
#define CAM_RESET -1
#define CAM_XCLK 15
#define CAM_SIOD 4
#define CAM_SIOC 5

#define CAM_D0 11
#define CAM_D1 9
#define CAM_D2 8
#define CAM_D3 10
#define CAM_D4 12
#define CAM_D5 18
#define CAM_D6 17
#define CAM_D7 16

#define CAM_VSYNC 6
#define CAM_HREF 7
#define CAM_PCLK 13

// ===== OBJECTS =====
DHT dht(DHT_PIN, DHT_TYPE);
LiquidCrystal_I2C lcd(0x27, 16, 2);

HardwareSerial dfSerial(1);
DFRobotDFPlayerMini dfPlayer;

WebServer server(80);
httpd_handle_t streamServer = NULL;

// ===== VARIABLES =====
Preferences safetyPreferences;
bool valveLatched = false;
bool valveStorageReady = false;

bool danger = false;
bool sensorValid = false;
bool demoDanger = false;

bool cameraReady = false;
bool dfReady = false;
bool voicePlaybackRequested = false;
enum AlertState { STATE_SAFE, STATE_WARNING, STATE_DANGER };
bool warningSent = false;
bool dangerTextSent = false;
bool dangerPhotoSent = false;
bool dangerPhotoAttempted = false;
unsigned int warningTextAttempts = 0;
unsigned int dangerTextAttempts = 0;
bool alertSafeTiming = false;
unsigned long alertSafeSince = 0;
String dangerEventTime = "";
const unsigned long ALERT_REARM_SAFE_MS = 60000;
const unsigned int ALERT_MAX_TEXT_ATTEMPTS = 3;
const String LOCATION_NAME = "IKM Lumut";


bool alertSent = false;
bool photoSent = false;

float gasPPM = NAN;
float temperature = NAN;
float humidity = NAN;

unsigned long lastSensor = 0;
unsigned long lastDemo = 0;
unsigned long lastAlert = 0;
unsigned long lastWiFiRetry = 0;
unsigned long lastDbPush = 0;

// ==========================================
// BUZZER & RELAY
// ==========================================
bool nextDangerState(bool previous, bool valid, float ppm) {
  if (!valid || !isfinite(ppm) || ppm < 0) return previous;
  return previous ? ppm > GAS_DANGER_CLEAR_PPM : ppm >= GAS_DANGER_PPM;
}

const char* currentGasStatus() {
  if (!sensorValid || !isfinite(gasPPM) || gasPPM < 0) return "SENSOR ERROR";
  if (danger) return "DANGER";
  return gasPPM > GAS_SAFE_PPM ? "WARNING" : "SAFE";
}

void restoreValveLatch() {
  valveStorageReady = safetyPreferences.begin("glips-safety", false);
  // If stored state cannot be read, keep the configured shut-off relay command.
  valveLatched = !valveStorageReady || safetyPreferences.getBool("valve-latched", false);
  if (!valveStorageReady) Serial.println("VALVE: latch storage unavailable; reset disabled");
}

void latchValve() {
  if (valveLatched) return;
  valveLatched = true;
  if (!valveStorageReady || safetyPreferences.putBool("valve-latched", true) != 1) {
    valveStorageReady = false;
    Serial.println("VALVE: latch persistence failed; relay stays latched, reset disabled");
  }
}

void buzzerONFunction() {
  digitalWrite(BUZZER_PIN, BUZZER_ON);
}

void buzzerOFFFunction() {
  digitalWrite(BUZZER_PIN, BUZZER_OFF);
}

void updateValveRelay() {
#if VALVE_RELAY_TEST
  if (valveLatched)
    digitalWrite(RELAY_VALVE, VALVE_RELAY_DANGER);
  else
    digitalWrite(RELAY_VALVE, VALVE_RELAY_SAFE);
#else
  digitalWrite(RELAY_VALVE, VALVE_RELAY_SAFE);
#endif
}

void updateOutputs() {
  bool alarm = sensorValid && danger;

  if (alarm) {
    digitalWrite(LED_GREEN, LOW);
    digitalWrite(LED_RED, HIGH);
    buzzerONFunction();
    digitalWrite(RELAY_FAN, FAN_ON);
  } else {
    digitalWrite(LED_GREEN, sensorValid && gasPPM <= GAS_SAFE_PPM ? HIGH : LOW);
    digitalWrite(LED_RED, !sensorValid || gasPPM > GAS_SAFE_PPM ? HIGH : LOW);
    buzzerOFFFunction();
    digitalWrite(RELAY_FAN, FAN_OFF);
  }

  updateValveRelay();
}

// ==========================================
// LCD DISPLAY - NO SCROLLING
// ==========================================
void updateLCD() {
  static String lastLine1 = "";
  static String lastLine2 = "";

  String statusText = currentGasStatus();

  String line1 = "";
  int start = (16 - statusText.length()) / 2;
  if (start < 0) start = 0;

  for (int i = 0; i < start; i++) {
    line1 += " ";
  }
  line1 += statusText;

  String gasText =
    (sensorValid && isfinite(gasPPM))
    ? String(gasPPM, 0) : "--";

  String tempText =
    isfinite(temperature)
    ? String(temperature, 1) : "--";

  String line2 =
    "G:" + gasText + "ppm T:" + tempText + "C";

  // Pastikan muat dalam LCD 16 karakter
  if (line2.length() > 16) {
    tempText = isfinite(temperature)
      ? String(temperature, 0) : "--";

    line2 =
      "G:" + gasText + "ppm T:" + tempText + "C";
  }

  if (line2.length() > 16) {
    line2 =
      "G:" + gasText + " T:" + tempText + "C";
  }

  // Fallback jika bacaan terlalu panjang
  if (line2.length() > 16) {
    line2 = line2.substring(0, 16);
  }

  while (line1.length() < 16) line1 += " ";
  while (line2.length() < 16) line2 += " ";

  if (line1 != lastLine1) {
    lcd.setCursor(0, 0);
    lcd.print(line1.substring(0, 16));
    lastLine1 = line1;
  }

  if (line2 != lastLine2) {
    lcd.setCursor(0, 1);
    lcd.print(line2.substring(0, 16));
    lastLine2 = line2;
  }
}

// ==========================================
// MQ6 SENSOR
// ==========================================
float readLPGppm() {
  if (!isfinite(MQ_R0) || MQ_R0 <= 0)
    return NAN;

  float adcVoltage =
    analogReadMilliVolts(MQ6_PIN) / 1000.0;

  float sensorVoltage = adcVoltage * DIVIDER_GAIN;

  if (sensorVoltage <= 0.01 ||
      sensorVoltage >= MQ_VCC)
    return NAN;

  float rs =
    ((MQ_VCC - sensorVoltage) / sensorVoltage) * MQ_RL;

  float ratio = rs / MQ_R0;

  if (!isfinite(ratio) || ratio <= 0)
    return NAN;

  float ppm =
    powf(10.0, (log10f(ratio) - LPG_B) / LPG_M);

  return isfinite(ppm) && ppm > 0 ? ppm : NAN;
}

// ==========================================
// DFPLAYER - ORIGINAL
// ==========================================
void playAlarm() {
  if (!dfReady) return;
  dfPlayer.volume(30);
  delay(200);
  dfPlayer.play(1);
  voicePlaybackRequested = true;
}

void stopAlarm() {
  voicePlaybackRequested = false;
  if (!dfReady) return;
  dfPlayer.stop();
}

void changeStatus(bool newDanger) {
  if (danger == newDanger) {
    if (danger && sensorValid && !voicePlaybackRequested) playAlarm();
    return;
  }

  danger = newDanger;
  if (danger) lastAlert = 0;
  if (danger) latchValve();
  alertSent = false;
  photoSent = false;
  lastAlert = 0;

  updateOutputs();
  updateLCD();

  if (danger) playAlarm();
  else stopAlarm();
}

bool resetValveLatch() {
  if (!sensorValid || !isfinite(gasPPM) || gasPPM < 0 || gasPPM > GAS_SAFE_PPM || danger || millis() - lastSensor > SENSOR_INTERVAL * 2) {
    Serial.println("VALVE RESET REJECTED: fresh valid SAFE reading at or below 100 ppm required");
    return false;
  }
  if (!valveStorageReady || safetyPreferences.putBool("valve-latched", false) != 1) {
    valveStorageReady = false;
    Serial.println("VALVE RESET REJECTED: latch storage unavailable");
    return false;
  }
  valveLatched = false;
  updateValveRelay();
  Serial.println("VALVE: manual reset accepted; normal relay command restored");
  return true;
}

void processSerialCommands() {
  static char command[32];
  static size_t length = 0;
  static bool overflow = false;
  while (Serial.available() > 0) {
    const char c = static_cast<char>(Serial.read());
    if (c == '\r' || c == '\n') {
      if (!overflow && length > 0) {
        command[length] = '\0';
        if (strcmp(command, "RESET_VALVE") == 0) resetValveLatch();
        else Serial.println("Unknown command. Use RESET_VALVE only after checking the area.");
      }
      length = 0;
      overflow = false;
    } else if (!overflow) {
      if (length + 1 < sizeof(command)) command[length++] = c;
      else overflow = true;
    }
  }
}

// ==========================================
// NETWORK & TIME HELPERS
// ==========================================
String dashboardURL() {
  return "http://" + WiFi.localIP().toString();
}

String cameraURL() {
  return dashboardURL() + ":81/stream";
}

// Set only after configuring authenticated HTTPS proxy
const char* PUBLIC_STREAM_URL = "https://main-dried-tennessee-hometown.trycloudflare.com/stream";

String shareableCameraURL() {
  return strlen(PUBLIC_STREAM_URL)
    ? String(PUBLIC_STREAM_URL) : cameraURL();
}

String urlEncode(const String& input) {
  String result = "";
  const char* hex = "0123456789ABCDEF";

  for (size_t i = 0; i < input.length(); i++) {
    uint8_t c = (uint8_t)input[i];

    if (isalnum(c) || c == '-' || c == '_' ||
        c == '.' || c == '~') {
      result += (char)c;
    } else {
      result += '%';
      result += hex[c >> 4];
      result += hex[c & 15];
    }
  }

  return result;
}

String getTimeText() {
  time_t now = time(nullptr);
  if (now < 1704067200) return "Not synchronized; device uptime " + String(millis() / 1000) + " s";
  struct tm timeinfo;
  localtime_r(&now, &timeinfo);
  char buffer[48];
  strftime(buffer, sizeof(buffer), "%d/%m/%Y %H:%M:%S MYT (UTC+8)", &timeinfo);
  return String(buffer);
}

// ==========================================
// SUPABASE CONNECTION
// ==========================================
String buildSupabaseJson() {
  String statusText = currentGasStatus();

  String json = "{";

  json += "\"status\":\"" + statusText + "\",";
  json += "\"gas_ppm\":" +
    String(sensorValid && isfinite(gasPPM)
      ? (int)gasPPM : 0) + ",";

  json += "\"temperature\":" +
    String(isfinite(temperature) ? temperature : 0, 1)
    + ",";

  json += "\"humidity\":" +
    String(isfinite(humidity) ? humidity : 0, 1)
    + ",";

  // GPIO commands reported by this firmware; not physical feedback.
  json += "\"hardware_outputs\":{";
  json += "\"kind\":\"output_commands\",";
  json += "\"valve_latched\":" + String(valveLatched ? "true" : "false") + ",";
  json += "\"gas_valve\":\"" + String(digitalRead(RELAY_VALVE) == HIGH ? "RELAY HIGH" : "RELAY LOW") + "\",";
  json += "\"exhaust_fan\":\"" + String(digitalRead(RELAY_FAN) == FAN_ON ? "ON" : "OFF") + "\",";
  json += "\"buzzer\":\"" + String(digitalRead(BUZZER_PIN) == BUZZER_ON ? "ON" : "OFF") + "\",";
  json += "\"red_led\":\"" + String(digitalRead(LED_RED) == HIGH ? "ON" : "OFF") + "\",";
  json += "\"green_led\":\"" + String(digitalRead(LED_GREEN) == HIGH ? "ON" : "OFF") + "\",";
  json += "\"voice_alert\":\"" + String(!dfReady ? "UNAVAILABLE" : voicePlaybackRequested ? "PLAY REQUESTED" : "STOP REQUESTED") + "\",";
  json += "\"wifi_connected\":" + String(WiFi.status() == WL_CONNECTED ? "true" : "false");
  json += "},";

  // Malaysia timezone UTC+8
  time_t now = time(nullptr);
  struct tm timeinfo;
  localtime_r(&now, &timeinfo);

  char timeBuf[30];

  strftime(timeBuf, sizeof(timeBuf),
           "%Y-%m-%dT%H:%M:%S+08:00", &timeinfo);

  json += "\"created_at\":\"" +
    String(timeBuf) + "\"";

  json += "}";
  return json;
}

bool sendToSupabase() {
  if (WiFi.status() != WL_CONNECTED)
    return false;

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(10000);

  HTTPClient http;

  String url =
    String(SUPABASE_URL) + "/rest/v1/" +
    String(SUPABASE_TABLE);

  if (!http.begin(client, url)) {
    Serial.println("SUPABASE: BEGIN FAILED");
    return false;
  }

  http.setTimeout(10000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  if (String(SUPABASE_KEY).startsWith("eyJ")) {
    http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  }
  http.addHeader("Prefer", "return=minimal");

  String body = buildSupabaseJson();
  Serial.println("SUPABASE payload includes hardware_outputs");
  int code = http.POST(body);

  Serial.print("SUPABASE HTTP: ");
  Serial.println(code);

  if (code < 200 || code >= 300) {
    Serial.print("SUPABASE ERROR DETAIL: ");
    Serial.println(http.getString());
  } else {
    Serial.println("SUPABASE: DATA MASUK!");
  }

  http.end();
  return code >= 200 && code < 300;
}

// ==========================================
// TELEGRAM
// ==========================================
bool sendTelegramText(const String& message) {
  if (WiFi.status() != WL_CONNECTED)
    return false;

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;

  String url =
    "https://api.telegram.org/bot" +
    String(BOT_TOKEN) + "/sendMessage";

  if (!http.begin(client, url))
    return false;

  http.setTimeout(15000);
  http.addHeader(
    "Content-Type",
    "application/x-www-form-urlencoded"
  );

  String body =
    "chat_id=" + urlEncode(String(CHAT_ID)) +
    "&text=" + urlEncode(message);

  int code = http.POST(body);
  http.end();

  return code == 200;
}

String telegramLocationText() {
  String name = String(SITE_NAME); name.trim();
  String address = String(SITE_ADDRESS); address.trim();
  String map = String(SITE_MAP_URL); map.trim();
  const bool coordinatesValid = isfinite(SITE_LATITUDE) && isfinite(SITE_LONGITUDE)
    && SITE_LATITUDE >= -90 && SITE_LATITUDE <= 90
    && SITE_LONGITUDE >= -180 && SITE_LONGITUDE <= 180;
  if (!map.startsWith("https://")) map = "";
  if (map.length() == 0 && coordinatesValid) {
    map = "https://www.google.com/maps?q=" + String(SITE_LATITUDE, 6) + "," + String(SITE_LONGITUDE, 6);
  }
  String text;
  if (name.length()) text += "Location: " + name + "\n";
  if (address.length()) text += "Address: " + address + "\n";
  if (map.length()) text += "Map: " + map;
  else if (address.length()) text += "Find address: https://www.google.com/maps/search/?api=1&query=" + urlEncode(address);
  else if (name.length()) text += "Map pin: not configured";
  else text = "Location: not configured on this device.";
  return text;
}

bool sendTelegramPhoto(const String& caption) {
  if (!cameraReady ||
      WiFi.status() != WL_CONNECTED)
    return false;

  camera_fb_t* fb = esp_camera_fb_get();

  if (!fb)
    return false;

  // Release the driver's frame before network I/O so live streaming can continue.
  const size_t frameLength = fb->len;
  uint8_t* photoData = static_cast<uint8_t*>(malloc(frameLength));
  if (!photoData) {
    esp_camera_fb_return(fb);
    return false;
  }
  memcpy(photoData, fb->buf, frameLength);
  esp_camera_fb_return(fb);
  fb = nullptr;

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(15000);

  if (!client.connect("api.telegram.org", 443)) {
    free(photoData);
    return false;
  }

  String boundary = "GLiPSBoundary";

  String head =
      "--" + boundary +
      "\r\nContent-Disposition: form-data; name=\"chat_id\"\r\n\r\n" +
      String(CHAT_ID) + "\r\n";

  head +=
      "--" + boundary +
      "\r\nContent-Disposition: form-data; name=\"caption\"\r\n\r\n" +
      caption + "\r\n";

  head +=
      "--" + boundary +
      "\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"glips.jpg\"\r\n"
      "Content-Type: image/jpeg\r\n\r\n";

  String tail = "\r\n--" + boundary + "--\r\n";

  size_t totalLength =
      head.length() + frameLength + tail.length();

  client.print(
      "POST /bot" + String(BOT_TOKEN) +
      "/sendPhoto HTTP/1.1\r\n"
  );

  client.print("Host: api.telegram.org\r\n");
  client.print(
      "Content-Type: multipart/form-data; boundary=" +
      boundary + "\r\n"
  );

  client.print(
      "Content-Length: " +
      String(totalLength) +
      "\r\nConnection: close\r\n\r\n"
  );

  client.print(head);

  size_t sent = 0;

  while (sent < frameLength) {
    size_t chunk =
        min((size_t)1024, frameLength - sent);

    size_t written =
        client.write(photoData + sent, chunk);

    if (written == 0)
      break;

    sent += written;
  }

  if (sent == frameLength)
    client.print(tail);

  free(photoData);

  String response = client.readStringUntil('\n');
  client.stop();

  return sent == frameLength &&
         response.indexOf(" 200 ") >= 0;
}


String buildTelegramAlert(bool critical) {
  String message = critical ? "GLiPS | DANGER - GAS LEAK WARNING\n" : "GLiPS | WARNING - ELEVATED GAS LEVEL\n";
  message += "Location: " + LOCATION_NAME + "\n";
  message += "Map: " + String(SITE_MAP_URL) + "\n";
  if (critical) message += "Event time: " + dangerEventTime + "\n";
  message += "Time sent: " + getTimeText() + "\n";
  message += "Latest gas reading: " + String(gasPPM, 1) + " ppm\n";
  message += "Temperature: " + String(temperature, 1) + " C\n";
  message += "Humidity: " + String(humidity, 1) + " %\n\n";
  message += "Reported output commands (physical operation not confirmed):\n";
  message += "Valve relay: " + String(digitalRead(RELAY_VALVE) == HIGH ? "HIGH" : "LOW") + "\n";
  message += "Exhaust fan: " + String(digitalRead(RELAY_FAN) == FAN_ON ? "ON" : "OFF") + "\n";
  message += "Buzzer: " + String(digitalRead(BUZZER_PIN) == BUZZER_ON ? "ON" : "OFF") + "\n";
  message += "Voice: " + String(!dfReady ? "Module unavailable" : voicePlaybackRequested ? "Play requested" : "Stop requested") + "\n\n";
  message += "Dashboard: https://fadhilatulroslan.github.io/fyp/dashboard.html\n";
  String stream = shareableCameraURL();
  message += stream.startsWith("https://") ? "Live camera (while tunnel is active): " : "Live camera (same Wi-Fi only): ";
  message += stream + "\n\n";
  message += critical
    ? "Leave the affected area. Avoid flames and electrical switches. Follow site emergency procedures. Do not assume the gas supply is isolated."
    : "Check the area using site safety procedures. If gas is smelled or conditions worsen, leave the area and seek assistance.";
  return message;
}

void processTelegramAlerts() {
  const AlertState currentState = danger ? STATE_DANGER : gasPPM > GAS_SAFE_PPM ? STATE_WARNING : STATE_SAFE;
  unsigned long now = millis();
  // Rearm only after one continuous minute of valid SAFE readings.
  // Brief WARNING/DANGER transitions must not start a fresh photo cycle.
  if (sensorValid && currentState == STATE_SAFE && gasPPM <= GAS_SAFE_PPM) {
    if (!alertSafeTiming) { alertSafeTiming = true; alertSafeSince = now; }
    if (now - alertSafeSince >= ALERT_REARM_SAFE_MS) {
      warningSent = false; dangerTextSent = false;
      dangerPhotoSent = false; dangerPhotoAttempted = false;
      warningTextAttempts = 0; dangerTextAttempts = 0;
      dangerEventTime = ""; lastAlert = 0;
    }
    return;
  }
  alertSafeTiming = false;
  if (!sensorValid) return;
  if (currentState == STATE_DANGER && dangerEventTime.length() == 0)
    dangerEventTime = getTimeText();
  if (WiFi.status() != WL_CONNECTED) return;
  if (lastAlert != 0 && now - lastAlert < ALERT_RETRY) return;

  if (currentState == STATE_WARNING && !warningSent && warningTextAttempts < ALERT_MAX_TEXT_ATTEMPTS) {
    lastAlert = now; warningTextAttempts++;
    warningSent = sendTelegramText(buildTelegramAlert(false));
    return;
  }
  if (currentState != STATE_DANGER) return;
  if (!dangerTextSent && dangerTextAttempts < ALERT_MAX_TEXT_ATTEMPTS) {
    lastAlert = now; dangerTextAttempts++;
    dangerTextSent = sendTelegramText(buildTelegramAlert(true));
  }
  // Text must be acknowledged before the single optional photo attempt.
  // Do not retry an ambiguous photo response: Telegram may already have accepted it.
  if (dangerTextSent && cameraReady && !dangerPhotoAttempted) {
    dangerPhotoAttempted = true;
    String caption = "GLiPS | IKM Lumut - incident snapshot\nEvent time: " + dangerEventTime;
    caption += "\nGas reading at capture: " + String(gasPPM, 1) + " ppm";
    dangerPhotoSent = sendTelegramPhoto(caption);
    Serial.println(dangerPhotoSent ? "TELEGRAM PHOTO: acknowledged" : "TELEGRAM PHOTO: not confirmed; automatic retry disabled");
  }
}

void processTelegramAlert() { processTelegramAlerts(); }


// ==========================================
// CAMERA
// ==========================================
bool initCamera() {
  camera_config_t config = {};

  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;

  config.pin_d0 = CAM_D0;
  config.pin_d1 = CAM_D1;
  config.pin_d2 = CAM_D2;
  config.pin_d3 = CAM_D3;
  config.pin_d4 = CAM_D4;
  config.pin_d5 = CAM_D5;
  config.pin_d6 = CAM_D6;
  config.pin_d7 = CAM_D7;

  config.pin_xclk = CAM_XCLK;
  config.pin_pclk = CAM_PCLK;
  config.pin_vsync = CAM_VSYNC;
  config.pin_href = CAM_HREF;

  config.pin_sccb_sda = CAM_SIOD;
  config.pin_sccb_scl = CAM_SIOC;

  config.pin_pwdn = CAM_PWDN;
  config.pin_reset = CAM_RESET;

  config.xclk_freq_hz = 10000000;
  config.pixel_format = PIXFORMAT_JPEG;

  config.frame_size =
    psramFound() ? FRAMESIZE_VGA : FRAMESIZE_QVGA;

  config.jpeg_quality = 12;
  config.fb_count = psramFound() ? 2 : 1;

  config.fb_location =
    psramFound()
    ? CAMERA_FB_IN_PSRAM
    : CAMERA_FB_IN_DRAM;

  config.grab_mode =
    psramFound()
    ? CAMERA_GRAB_LATEST
    : CAMERA_GRAB_WHEN_EMPTY;

  return esp_camera_init(&config) == ESP_OK;
}

static esp_err_t streamHandler(httpd_req_t* req) {
  esp_err_t res = httpd_resp_set_type(
    req,
    "multipart/x-mixed-replace;boundary=frame"
  );

  if (res != ESP_OK)
    return res;

  while (true) {
    camera_fb_t* fb = esp_camera_fb_get();

    if (!fb)
      return ESP_FAIL;

    char header[100];

    int len = snprintf(
      header, sizeof(header),
      "\r\n--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n",
      (unsigned int)fb->len
    );

    res = httpd_resp_send_chunk(req, header, len);

    if (res == ESP_OK)
      res = httpd_resp_send_chunk(
        req, (const char*)fb->buf, fb->len
      );

    esp_camera_fb_return(fb);

    if (res != ESP_OK)
      break;

    vTaskDelay(pdMS_TO_TICKS(50));
  }

  return res;
}

void startStreamServer() {
  if (!cameraReady) return;

  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 81;
  config.ctrl_port = 32769;
  config.stack_size = 8192;

  httpd_uri_t streamUri = {};
  streamUri.uri = "/stream";
  streamUri.method = HTTP_GET;
  streamUri.handler = streamHandler;

  if (httpd_start(&streamServer, &config) == ESP_OK)
    httpd_register_uri_handler(streamServer, &streamUri);
}

void handleCapture() {
  if (!cameraReady) {
    server.send(503, "text/plain", "Camera unavailable");
    return;
  }

  camera_fb_t* fb = esp_camera_fb_get();

  if (!fb) {
    server.send(500, "text/plain", "Capture failed");
    return;
  }

  server.sendHeader("Cache-Control", "no-store");
  server.setContentLength(fb->len);
  server.send(200, "image/jpeg", "");

  WiFiClient client = server.client();
  size_t sent = 0;

  while (sent < fb->len) {
    size_t written =
      client.write(fb->buf + sent, fb->len - sent);

    if (written == 0) break;
    sent += written;
  }

  esp_camera_fb_return(fb);
}

// ==========================================
// SETUP
// ==========================================
void handleVoiceDiagnostics() {
  static char command[24];
  static size_t used = 0;
  static bool overflow = false;
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\r' || c == '\n') {
      command[used] = '\0';
      if (!overflow && String(command) == "TEST_VOICE") playAlarm();
      if (!overflow && String(command) == "STOP_VOICE") {
        if (sensorValid && danger)
          Serial.println("VOICE: stop rejected while DANGER is active");
        else stopAlarm();
      }
      used = 0;
      overflow = false;
    } else if (used < sizeof(command) - 1) command[used++] = c;
    else overflow = true;
  }
  if (dfReady && dfPlayer.available()) {
    uint8_t type = dfPlayer.readType();
    int value = dfPlayer.read();
    Serial.printf("DFPLAYER event type=%u value=%d\n", (unsigned)type, value);
    if (type == DFPlayerError)
      Serial.println("VOICE: DFPlayer error; check track, SD card and wiring");
  }
}

void setup() {

  // FIX: BUZZER OFF BEFORE WELCOME
  digitalWrite(BUZZER_PIN, BUZZER_OFF);
  pinMode(BUZZER_PIN, OUTPUT);
  buzzerOFFFunction();

  Serial.begin(115200);
  Serial.println("GLiPS firmware: 300/250 hysteresis + manual valve reset v4.1 + site location");
  delay(500);
  Serial.println("WELCOME GLiPS - SUPABASE VERSION");

  digitalWrite(RELAY_FAN, FAN_OFF);
  pinMode(RELAY_FAN, OUTPUT);

  restoreValveLatch();
  digitalWrite(RELAY_VALVE, valveLatched ? VALVE_RELAY_DANGER : VALVE_RELAY_SAFE);
  pinMode(RELAY_VALVE, OUTPUT);

  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_RED, OUTPUT);

  digitalWrite(LED_GREEN, LOW);
  digitalWrite(LED_RED, LOW);

  pinMode(MQ6_PIN, INPUT);
  analogReadResolution(12);
  dht.begin();

  Wire.begin(LCD_SDA, LCD_SCL);
  lcd.init();
  lcd.backlight();
  lcd.clear();

  // WELCOME GLiPS - BUZZER OFF
  buzzerOFFFunction();

  lcd.setCursor(2, 0);
  lcd.print("WELCOME GLiPS");

  lcd.setCursor(2, 1);
  lcd.print("PLEASE WAIT...");

  delay(5000);

  buzzerOFFFunction();
  lcd.clear();

  danger = false;

  if (DEMO_MODE) {
    sensorValid = true;
    gasPPM = 80.0;
    temperature = 28.5;
    humidity = 65.0;
  } else {
    sensorValid = false;
    gasPPM = NAN;
    temperature = NAN;
    humidity = NAN;
  }

  updateOutputs();
  updateLCD();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  Serial.print("Connecting WiFi");
  unsigned long start = millis();

  while (WiFi.status() != WL_CONNECTED &&
         millis() - start < 20000) {
    Serial.print(".");
    delay(500);
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WIFI CONNECTED");

    configTime(
      8 * 3600, 0,
      "pool.ntp.org", "time.google.com"
    );

    time_t now = time(nullptr);
    int retry = 0;

    while (now < 1000000000 && retry < 20) {
      delay(500);
      Serial.print(".");
      now = time(nullptr);
      retry++;
    }

    Serial.println();
    Serial.print("TIME NOW: ");
    Serial.println(getTimeText());

    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
  }

  cameraReady = initCamera();
  server.on("/capture", handleCapture);
  server.begin();
  startStreamServer();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("GLiPS LIVE CAMERA (LOCAL): ");
    Serial.println(cameraURL());

    Serial.print("GLiPS DASHBOARD CAMERA URL: ");
    Serial.println(shareableCameraURL());
  }

  // DFPLAYER - ORIGINAL CODE
  dfSerial.begin(9600, SERIAL_8N1, DF_RX, DF_TX);
  delay(2000);
  dfReady = dfPlayer.begin(dfSerial, true, true);

  if (dfReady) {
    dfPlayer.volume(30);
    Serial.println("DFPLAYER READY");
  } else Serial.println("DFPLAYER INIT FAILED: check power, UART, SD card and common GND");

  lastSensor = millis();
  lastDemo = millis();
  lastDbPush = millis();
}

// ==========================================
// MAIN LOOP
// ==========================================
void loop() {
  handleVoiceDiagnostics();
  static bool clockConfigured = false;
  if (!clockConfigured && WiFi.status() == WL_CONNECTED) {
    configTime(8 * 3600, 0, "pool.ntp.org", "time.google.com");
    clockConfigured = true;
  }
  processSerialCommands();
  server.handleClient();

  unsigned long now = millis();

  if (WiFi.status() != WL_CONNECTED &&
      now - lastWiFiRetry >= 10000) {
    lastWiFiRetry = now;
    WiFi.reconnect();
  }

  if (DEMO_MODE && now - lastDemo >= DEMO_INTERVAL) {
    lastDemo = now;
    demoDanger = !demoDanger;
  }

  if (now - lastSensor >= SENSOR_INTERVAL) {
    lastSensor = now;

    if (DEMO_MODE) {
      gasPPM = demoDanger ? 350.0 : 80.0;
      temperature = 28.5;
      humidity = 65.0;
      sensorValid = true;
    } else {
      gasPPM = readLPGppm();
      sensorValid = isfinite(gasPPM);

      float t = dht.readTemperature();
      float h = dht.readHumidity();

      if (isfinite(t))
        temperature = t;

      if (isfinite(h))
        humidity = h;
    }

    if (sensorValid) {
      changeStatus(nextDangerState(danger, sensorValid, gasPPM));
    } else {
      if (danger) stopAlarm();
      alertSent = false;
      photoSent = false;
    }

    updateOutputs();
    updateLCD();
  }

  // SUPABASE EVERY 5 SECONDS
  if (now - lastDbPush >= DB_INTERVAL) {
    lastDbPush = now;

    if (sendToSupabase()) {
      Serial.println("SUPABASE: DATA MASUK!");
    } else {
      Serial.println("SUPABASE: GAGAL!");
    }
  }

  updateLCD();
  processTelegramAlert();
  delay(10);
}