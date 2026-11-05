// Credentials intentionally blank: restore only in your local Arduino sketch.
// Only Supabase output telemetry was integrated; actuator control remains unchanged.
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>
#include "esp_camera.h"
#include "esp_http_server.h"
#include <math.h>
#include <time.h>

// ======================================
// GLiPS ESP32-S3
// LCD NO SCROLL + DEMO GAS + REAL DHT22
// ======================================

// WIFI
const char* WIFI_SSID = ""; // Fill locally; never post credentials publicly.
const char* WIFI_PASS = ""; // Fill locally; never post credentials publicly.

// TELEGRAM
const char* BOT_TOKEN = ""; // Fill locally; never post credentials publicly.
const char* CHAT_ID = ""; // Fill locally; never post credentials publicly.

// SUPABASE
const char* SUPABASE_URL = "https://fkfgimyelgvlsbtxhvih.supabase.co";
const char* SUPABASE_KEY = ""; // Fill locally; never post credentials publicly.
const char* SUPABASE_TABLE = "sensor_data";

// TEST MODE
#define DEMO_MODE true

const unsigned long SENSOR_INTERVAL = 2000;
const unsigned long DEMO_INTERVAL = 15000;
const unsigned long DB_INTERVAL = 5000;
const unsigned long ALERT_RETRY = 15000;

const float GAS_DANGER_PPM = 1000.0;
const float GAS_SAFE_PPM = 800.0;

// MQ6 CALIBRATION (FOR FUTURE REAL MODE)
const float MQ_R0 = NAN;
const float MQ_VCC = 5.0;
const float MQ_RL = 10.0;
const float DIVIDER_GAIN = 2.0;
const float LPG_M = -0.47;
const float LPG_B = 1.31;

// PINS
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

#define BUZZER_ON LOW
#define BUZZER_OFF HIGH
#define FAN_OFF LOW
#define VALVE_SAFE LOW

// OV3660 CAMERA
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

DHT dht(DHT_PIN, DHT_TYPE);
LiquidCrystal_I2C lcd(0x27, 16, 2);
WebServer server(80);

httpd_handle_t streamServer = NULL;

bool danger = false;
bool demoDanger = false;
bool sensorValid = false;
bool cameraReady = false;
bool alertSent = false;
bool photoSent = false;

float gasPPM = NAN;
float temperature = NAN;
float humidity = NAN;

unsigned long lastSensor = 0;
unsigned long lastDemo = 0;
unsigned long lastDB = 0;
unsigned long lastAlert = 0;
unsigned long lastWiFiRetry = 0;

// ======================================
// LCD DISPLAY - NO SCROLL
// ======================================

void updateLCD() {
  static char previousTop[17] = "";
  static char previousBottom[17] = "";

  char top[17];
  char bottom[17];

  memset(top, ' ', 16);
  memset(bottom, ' ', 16);
  top[16] = '\0';
  bottom[16] = '\0';

  const char* status =
      !sensorValid ? "SENSOR ERROR" :
      danger ? "DANGER" : "SAFE";

  int start = (16 - strlen(status)) / 2;
  if (start < 0) start = 0;

  memcpy(top + start, status,
         min((size_t)(16 - start), strlen(status)));

  char reading[32];

  if (sensorValid && isfinite(gasPPM) &&
      isfinite(temperature)) {
    snprintf(reading, sizeof(reading),
             "G:%.0f T:%.1f%cC",
             gasPPM, temperature, (char)223);
  } else if (sensorValid && isfinite(gasPPM)) {
    snprintf(reading, sizeof(reading),
             "G:%.0f T:--", gasPPM);
  } else {
    snprintf(reading, sizeof(reading),
             "G:---- T:--");
  }

  memcpy(bottom, reading,
         min((size_t)16, strlen(reading)));

  // Only rewrite LCD when content changes.
  if (strcmp(top, previousTop) != 0) {
    lcd.setCursor(0, 0);
    lcd.print(top);
    strcpy(previousTop, top);
  }

  if (strcmp(bottom, previousBottom) != 0) {
    lcd.setCursor(0, 1);
    lcd.print(bottom);
    strcpy(previousBottom, bottom);
  }
}

// ======================================
// SENSOR
// ======================================

float readLPGppm() {
  if (!isfinite(MQ_R0) || MQ_R0 <= 0)
    return NAN;

  float voltage =
      analogReadMilliVolts(MQ6_PIN) / 1000.0;

  float sensorVoltage = voltage * DIVIDER_GAIN;

  if (sensorVoltage <= 0.01 ||
      sensorVoltage >= MQ_VCC)
    return NAN;

  float rs =
      ((MQ_VCC - sensorVoltage) /
       sensorVoltage) * MQ_RL;

  float ratio = rs / MQ_R0;

  if (!isfinite(ratio) || ratio <= 0)
    return NAN;

  float ppm = powf(
      10.0,
      (log10f(ratio) - LPG_B) / LPG_M
  );

  return isfinite(ppm) && ppm > 0 ? ppm : NAN;
}

// ======================================
// OUTPUTS
// DUMMY NEVER OPERATES GAS HARDWARE
// ======================================

void updateOutputs() {
  if (DEMO_MODE) {
    digitalWrite(LED_GREEN, danger ? LOW : HIGH);
    digitalWrite(LED_RED, danger ? HIGH : LOW);

    digitalWrite(BUZZER_PIN, BUZZER_OFF);
    digitalWrite(RELAY_FAN, FAN_OFF);
    digitalWrite(RELAY_VALVE, VALVE_SAFE);
    return;
  }

  // Real-mode actuator control intentionally
  // disabled until relay polarity, calibration
  // and safety interlocks are verified.
  digitalWrite(LED_GREEN, sensorValid && !danger);
  digitalWrite(LED_RED, !sensorValid || danger);

  digitalWrite(BUZZER_PIN, BUZZER_OFF);
  digitalWrite(RELAY_FAN, FAN_OFF);
  digitalWrite(RELAY_VALVE, VALVE_SAFE);
}

void changeStatus(bool newDanger) {
  if (danger == newDanger) return;

  danger = newDanger;
  alertSent = false;
  photoSent = false;
  lastAlert = 0;

  updateOutputs();
  updateLCD();

  Serial.println(danger ?
      "GLiPS TEST DANGER" :
      "GLiPS TEST SAFE");
}

// ======================================
// SENSOR + LCD TASK
// SEPARATE FROM INTERNET REQUESTS
// ======================================

void sensorLCDTask(void* parameter) {
  lastSensor = millis();
  lastDemo = millis();

  for (;;) {
    unsigned long now = millis();

    if (DEMO_MODE &&
        now - lastDemo >= DEMO_INTERVAL) {
      lastDemo = now;
      demoDanger = !demoDanger;
    }

    if (now - lastSensor >= SENSOR_INTERVAL) {
      lastSensor = now;

      if (DEMO_MODE) {
        gasPPM = demoDanger ? 1500.0 : 120.0;
        sensorValid = true;
      } else {
        gasPPM = readLPGppm();
        sensorValid = isfinite(gasPPM);
      }

      // REAL DHT22 READINGS
      float t = dht.readTemperature();
      float h = dht.readHumidity();

      temperature = isfinite(t) ? t : NAN;
      humidity = isfinite(h) ? h : NAN;

      if (sensorValid) {
        if (!danger &&
            gasPPM >= GAS_DANGER_PPM)
          changeStatus(true);

        else if (danger &&
                 gasPPM <= GAS_SAFE_PPM)
          changeStatus(false);
      }

      updateOutputs();
      updateLCD();

      Serial.printf(
        "GAS: %.1f ppm | TEMP: %.1f C | HUM: %.1f %%\n",
        gasPPM, temperature, humidity
      );
    }

    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

// ======================================
// URL ENCODING
// ======================================

String urlEncode(const String& input) {
  String result;
  const char* hex = "0123456789ABCDEF";

  for (size_t i = 0; i < input.length(); i++) {
    uint8_t c = (uint8_t)input[i];

    if (isalnum(c) || c == '-' ||
        c == '_' || c == '.' || c == '~') {
      result += (char)c;
    } else {
      result += '%';
      result += hex[c >> 4];
      result += hex[c & 15];
    }
  }

  return result;
}

// ======================================
// TIME
// ======================================

String getTimeText() {
  struct tm info;

  if (!getLocalTime(&info, 100))
    return "Time unavailable";

  char buffer[32];

  strftime(buffer, sizeof(buffer),
           "%d/%m/%Y %H:%M:%S", &info);

  return String(buffer);
}

// ======================================
// SUPABASE
// ======================================

String buildSupabaseJson() {
  String statusText =
      !sensorValid ? "SENSOR ERROR" :
      danger ? "DANGER" : "SAFE";

  String json = "{";

  json += "\"status\":\"" + statusText + "\",";
  json += "\"gas_ppm\":" +
          String(isfinite(gasPPM) ? gasPPM : 0, 1) + ",";

  json += "\"temperature\":" +
          String(isfinite(temperature) ? temperature : 0, 1) + ",";

  json += "\"humidity\":" +
          String(isfinite(humidity) ? humidity : 0, 1);


  // Report GPIO commands only, never inferred physical actuator positions.
  json += ",\"hardware_outputs\":{";
  json += "\"kind\":\"output_commands\",";
  json += "\"gas_valve\":\"" + String(digitalRead(RELAY_VALVE) == HIGH ? "RELAY HIGH" : "RELAY LOW") + "\",";
  json += "\"exhaust_fan\":\"" + String(digitalRead(RELAY_FAN) == FAN_OFF ? "OFF" : "ON") + "\",";
  json += "\"buzzer\":\"" + String(digitalRead(BUZZER_PIN) == BUZZER_ON ? "ON" : "OFF") + "\",";
  json += "\"red_led\":\"" + String(digitalRead(LED_RED) == HIGH ? "ON" : "OFF") + "\",";
  json += "\"green_led\":\"" + String(digitalRead(LED_GREEN) == HIGH ? "ON" : "OFF") + "\",";
  // This latest sketch has no DFPlayer or voice output implementation.
  json += "\"voice_alert\":\"NOT CONFIGURED\",";
  json += "\"wifi_connected\":" + String(WiFi.status() == WL_CONNECTED ? "true" : "false");
  json += "}";

  json += "}";

  return json;
}


bool sendToSupabase() {
  if (WiFi.status() != WL_CONNECTED)
    return false;

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;

  String url = String(SUPABASE_URL) +
               "/rest/v1/" +
               String(SUPABASE_TABLE);

  if (!http.begin(client, url))
    return false;

  http.setTimeout(10000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader(
      "Authorization",
      String("Bearer ") + SUPABASE_KEY
  );
  http.addHeader("Prefer", "return=minimal");

  String body = buildSupabaseJson();

  int code = http.POST(body);

  Serial.printf("SUPABASE HTTP: %d\n", code);

  if (code < 200 || code >= 300)
    Serial.println(http.getString());
  else
    Serial.println("SUPABASE: DATA MASUK!");

  http.end();

  return code >= 200 && code < 300;
}

// ======================================
// TELEGRAM TEXT
// ======================================

bool sendTelegramText(const String& message) {
  if (WiFi.status() != WL_CONNECTED)
    return false;

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;

  String url =
      "https://api.telegram.org/bot" +
      String(BOT_TOKEN) +
      "/sendMessage";

  if (!http.begin(client, url))
    return false;

  http.setTimeout(15000);

  http.addHeader(
      "Content-Type",
      "application/x-www-form-urlencoded"
  );

  String body =
      "chat_id=" + urlEncode(CHAT_ID) +
      "&text=" + urlEncode(message);

  int code = http.POST(body);
  http.end();

  return code == 200;
}

// ======================================
// CAMERA
// ======================================

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
  config.frame_size = FRAMESIZE_QVGA;
  config.jpeg_quality = 15;
  config.fb_count = 1;

  config.fb_location =
      psramFound() ?
      CAMERA_FB_IN_PSRAM :
      CAMERA_FB_IN_DRAM;

  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;

  return esp_camera_init(&config) == ESP_OK;
}

// ======================================
// LIVE STREAM
// ======================================

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
        "\r\n--frame\r\n"
        "Content-Type: image/jpeg\r\n"
        "Content-Length: %u\r\n\r\n",
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

    vTaskDelay(pdMS_TO_TICKS(80));
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

// ======================================
// CAMERA PHOTO TO TELEGRAM
// ======================================

bool sendTelegramPhoto(const String& caption) {
  if (!cameraReady ||
      WiFi.status() != WL_CONNECTED)
    return false;

  camera_fb_t* fb = esp_camera_fb_get();

  if (!fb)
    return false;

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(15000);

  if (!client.connect("api.telegram.org", 443)) {
    esp_camera_fb_return(fb);
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
      head.length() + fb->len + tail.length();

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

  while (sent < fb->len) {
    size_t chunk =
        min((size_t)1024, fb->len - sent);

    size_t written =
        client.write(fb->buf + sent, chunk);

    if (written == 0)
      break;

    sent += written;
  }

  if (sent == fb->len)
    client.print(tail);

  esp_camera_fb_return(fb);

  String response = client.readStringUntil('\n');
  client.stop();

  return sent == fb->len &&
         response.indexOf(" 200 ") >= 0;
}

// ======================================
// TELEGRAM DANGER ALERT
// ======================================

void processTelegramAlert() {
  if (!sensorValid || !danger ||
      WiFi.status() != WL_CONNECTED)
    return;

  if (alertSent && (photoSent || !cameraReady))
    return;

  unsigned long now = millis();

  if (lastAlert != 0 &&
      now - lastAlert < ALERT_RETRY)
    return;

  lastAlert = now;

  String message = "GLiPS TEST GAS ALERT!\n\n";
  message += "Status: DANGER (SIMULATION)\n";
  message += "LPG: " + String(gasPPM, 0) + " ppm (DUMMY)\n";
  message += "Temperature: " +
             String(temperature, 1) + " C\n";
  message += "Time: " + getTimeText() + "\n";
  message += "Hardware actuators: DISABLED\n\n";
  message += "LIVE CAMERA (LOCAL WIFI):\n";
  message += "http://" +
             WiFi.localIP().toString() +
             ":81/stream";

  if (!alertSent) {
    sendTelegramText("🔥");
    alertSent = sendTelegramText(message);
  }

  if (cameraReady && !photoSent) {
    photoSent = sendTelegramPhoto(
        "GLiPS TEST DANGER - " +
        String(gasPPM, 0) + " ppm (SIMULATED)"
    );
  }
}

// ======================================
// SETUP
// ======================================

void setup() {
  Serial.begin(115200);
  delay(500);

  // Initialize safe outputs first
  digitalWrite(BUZZER_PIN, BUZZER_OFF);
  pinMode(BUZZER_PIN, OUTPUT);

  digitalWrite(RELAY_FAN, FAN_OFF);
  pinMode(RELAY_FAN, OUTPUT);

  digitalWrite(RELAY_VALVE, VALVE_SAFE);
  pinMode(RELAY_VALVE, OUTPUT);

  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_RED, OUTPUT);

  pinMode(MQ6_PIN, INPUT);
  analogReadResolution(12);

  dht.begin();

  Wire.begin(LCD_SDA, LCD_SCL);
  lcd.init();
  lcd.backlight();
  lcd.clear();

  lcd.setCursor(2, 0);
  lcd.print("WELCOME GLiPS");

  lcd.setCursor(2, 1);
  lcd.print("PLEASE WAIT...");

  delay(1500);
  lcd.clear();

  gasPPM = DEMO_MODE ? 120.0 : NAN;
  sensorValid = DEMO_MODE;
  temperature = NAN;
  humidity = NAN;

  updateOutputs();
  updateLCD();

  // Start LCD/sensor task before WiFi
  xTaskCreatePinnedToCore(
      sensorLCDTask,
      "GLiPS_LCD",
      8192,
      nullptr,
      2,
      nullptr,
      0
  );

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  Serial.println("Connecting WiFi...");

  unsigned long start = millis();

  while (WiFi.status() != WL_CONNECTED &&
         millis() - start < 20000) {
    delay(200);
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WIFI CONNECTED");
    Serial.println(WiFi.localIP());

    configTime(
        8 * 3600, 0,
        "pool.ntp.org",
        "time.google.com"
    );
  }

  cameraReady = initCamera();

  server.begin();
  startStreamServer();

  if (cameraReady) {
    Serial.println(
        "LIVE CAMERA: http://" +
        WiFi.localIP().toString() +
        ":81/stream"
    );
  } else {
    Serial.println("CAMERA INIT FAILED");
  }

  lastDB = millis();
}

// ======================================
// MAIN LOOP
// ======================================

void loop() {
  server.handleClient();

  unsigned long now = millis();

  if (WiFi.status() != WL_CONNECTED &&
      now - lastWiFiRetry >= 10000) {
    lastWiFiRetry = now;
    WiFi.reconnect();
  }

  if (now - lastDB >= DB_INTERVAL) {
    lastDB = now;
    sendToSupabase();
  }

  processTelegramAlert();

  delay(10);
}