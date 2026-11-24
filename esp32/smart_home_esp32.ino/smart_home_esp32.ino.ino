/**
- FIRMWARE SMART HOME ESP32-WROOM-32E (MQTT OVER TLS + XIAOZHI MCP READY)
- Mendukung:
- - 2x Servo (Pintu Utama & Jemuran Otomatis)
- - Relay Active-HIGH (Kipas 12V) + Otomatisasi Suhu DHT22
- - Otomatisasi Jemuran Tertutup Saat Hujan (Sensor Hujan)
- - AC TRIAC/Switch ON-OFF (Lampu 1) & LED/Relay (Lampu 2)
- - Tombol Fisik dengan Debounce & Sinkronisasi State Real-Time
- - Sensor DHT22 & Telemetri Wi-Fi RSSI
- - Last Will & Testament (LWT) + Auto-Reconnect Non-Blocking
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include <DHT.h>
#include <time.h>
#include "secrets.h.ino"

// =========================================================================
// 1. PEMETAAN PIN GPIO (SESUAI WIRING & TEMPLATE TIM WIRING)
// =========================================================================
// --- Pin Sesuai Diagram Wiring ---
#define PIN_SERVO_PINTU     18  // Micro Servo SG90 untuk Pintu Utama
#define PIN_RELAY_KIPAS     27  // Relay Fan 12V (Logika Active-HIGH)
#define PIN_LAMPU_2         32  // Lampu 2 / LED Indikator (Logika Active-HIGH)
#define PIN_DHT22           4   // Sensor Suhu & Kelembaban DHT22

// --- [TEMPLATE PIN] Ganti angka GPIO di bawah sesuai arahan tim wiring ---
#define PIN_SERVO_JEMURAN   13  // [TEMPLATE] Pin sinyal Servo ke-2 untuk Jemuran
#define PIN_LAMPU_1_GATE    21  // [TEMPLATE] Pin Gate/PWM Modul AC Lampu 1 (ON/OFF)
#define PIN_LAMPU_1_ZC      19  // [TEMPLATE] Pin Zero-Cross Modul AC (cadangan input)
#define PIN_TOMBOL_FISIK    33  // [TEMPLATE] Pin Tombol Fisik (kiri atas rangkaian)
#define PIN_SENSOR_HUJAN    34  // [TEMPLATE] Pin DO Modul Sensor Hujan (Input-Only, Active-LOW)

// =========================================================================
// 2. KONFIGURASI KALIBRASI SERVO, RELAY, & SENSOR
// =========================================================================
// Sudut Servo Pintu (sesuaikan dengan mekanisme engsel/kunci pintu Anda)
const int PINTU_SUDUT_TUTUP   = 0;
const int PINTU_SUDUT_BUKA    = 90;

// Sudut Servo Jemuran (sesuaikan dengan mekanisme tarikan jemuran Anda)
const int JEMURAN_SUDUT_TUTUP = 0;
const int JEMURAN_SUDUT_BUKA  = 120;

// Logika Relay & Output (Sesuai konfirmasi: HIGH = Menyala, LOW = Mati)
const uint8_t RELAY_ON_LEVEL  = HIGH;
const uint8_t RELAY_OFF_LEVEL = LOW;

// Aktifkan pembacaan sensor (ubah ke false jika sensor belum dipasang saat tes)
#define ENABLE_DHT22        true
#define ENABLE_RAIN_SENSOR  true
#define DHT_TYPE            DHT22

// Batas Otomatisasi Suhu Kipas (dengan Histeresis 2°C agar relay tidak cetak-cetek)
const float SUHU_KIPAS_NYALA = 30.0; // Kipas otomatis ON jika suhu >= 30.0 °C
const float SUHU_KIPAS_MATI  = 28.0; // Kipas otomatis OFF jika suhu <= 28.0 °C

// =========================================================================
// 3. DAFTAR TOPIC MQTT (KONTRAK SISTEM)
// =========================================================================
const char* TOPIC_SUB_COMMAND       = "smarthome/+/command";

const char* TOPIC_JEMURAN_STATE     = "smarthome/jemuran/state";
const char* TOPIC_KIPAS_STATE       = "smarthome/kipas/state";
const char* TOPIC_LAMPU1_STATE      = "smarthome/lampu1/state";
const char* TOPIC_LAMPU2_STATE      = "smarthome/lampu2/state";
const char* TOPIC_PINTU_STATE       = "smarthome/pintu/state";

const char* TOPIC_SYS_AVAILABILITY  = "smarthome/system/availability";
const char* TOPIC_SYS_STATUS        = "smarthome/system/status";

// =========================================================================
// 4. OBJEK GLOBAL & VARIABEL STATUS AKTUAL
// =========================================================================
WiFiClientSecure secureClient;
PubSubClient mqttClient(secureClient);
Servo servoPintu;
Servo servoJemuran;
DHT dht(PIN_DHT22, DHT_TYPE);

// Status aktual perangkat di memori ESP32
String stateJemuran = "CLOSED";
int    angleJemuran = JEMURAN_SUDUT_TUTUP;

String stateKipas   = "OFF";
String stateLampu1  = "OFF";
String stateLampu2  = "OFF";

String statePintu   = "CLOSED";
int    anglePintu   = PINTU_SUDUT_TUTUP;

// Timer non-blocking
unsigned long lastReconnectAttempt = 0;
unsigned long lastTelemetryPublish = 0;
const unsigned long TELEMETRY_INTERVAL_MS = 10000; // Kirim telemetri tiap 10 detik

// Variabel Debounce Tombol Fisik
int lastButtonReading = HIGH;
int stableButtonState = HIGH;
unsigned long lastDebounceTime = 0;
const unsigned long DEBOUNCE_DELAY_MS = 50;

// Variabel Otomatisasi Sensor Hujan & Suhu DHT22
bool isRainingConfirmed = false;
bool rawRainReading     = false;
unsigned long lastRainDebounceTime = 0;
const unsigned long RAIN_DEBOUNCE_MS = 2000; // Tahan 2 detik agar tidak salah picu percikan air

unsigned long lastDhtCheckTime = 0;
const unsigned long DHT_CHECK_INTERVAL_MS = 2500; // Cek suhu tiap 2,5 detik
bool manualFanOnLock  = false; // Mengunci perintah manual ON dari Web/XiaoZhi
bool manualFanOffLock = false; // Mengunci perintah manual OFF dari Web/XiaoZhi

// =========================================================================
// 5. FUNGSI UTILITAS WAKTU & PUBLISH STATUS AKTUAL
// =========================================================================
unsigned long getUnixTimestamp() {
  time_t now;
  time(&now);
  return (now > 1700000000) ? (unsigned long)now : (millis() / 1000);
}

void publishDeviceState(const char* topic, const char* device, const String& state,
                        const char* source, const String& requestId,
                        int servoAngle = -1, const char* motorStatus = nullptr) {
  if (!mqttClient.connected()) return;

  JsonDocument doc;
  doc["device"]    = device;
  doc["state"]     = state;
  doc["online"]    = true;
  doc["source"]    = source;
  doc["timestamp"] = getUnixTimestamp();

  if (requestId.length() > 0) {
    doc["requestId"] = requestId;
  } else {
    doc["requestId"] = nullptr;
  }

  JsonObject detail = doc["detail"].to<JsonObject>();
  if (servoAngle >= 0) {
    detail["angle"] = servoAngle;
  }
  if (motorStatus != nullptr) {
    detail["motor"] = motorStatus;
  }
  if (strcmp(device, "jemuran") == 0 && ENABLE_RAIN_SENSOR) {
    detail["raining"] = isRainingConfirmed;
  }

  char buffer[384];
  size_t len = serializeJson(doc, buffer, sizeof(buffer));

  // Publish dengan retained = true agar dashboard selalu mendapat status terakhir
  bool ok = mqttClient.publish(topic, (const uint8_t*)buffer, len, true);
  Serial.printf("[MQTT PUB] %s -> %s (%s)\n", topic, buffer, ok ? "OK" : "GAGAL");
}

void publishAllInitialStates() {
  publishDeviceState(TOPIC_JEMURAN_STATE, "jemuran", stateJemuran, "esp32", "", angleJemuran, "STANDBY");
  publishDeviceState(TOPIC_KIPAS_STATE,   "kipas",   stateKipas,   "esp32", "");
  publishDeviceState(TOPIC_LAMPU1_STATE,  "lampu1",  stateLampu1,  "esp32", "");
  publishDeviceState(TOPIC_LAMPU2_STATE,  "lampu2",  stateLampu2,  "esp32", "");
  publishDeviceState(TOPIC_PINTU_STATE,   "pintu",   statePintu,   "esp32", "", anglePintu, nullptr);
}

void publishSystemTelemetry() {
  if (!mqttClient.connected()) return;

  JsonDocument doc;
  doc["device"]    = MQTT_CLIENT_ID;
  doc["online"]    = true;
  doc["ip"]        = WiFi.localIP().toString();
  doc["rssi"]      = WiFi.RSSI();
  doc["uptimeSec"] = millis() / 1000;
  doc["freeHeap"]  = ESP.getFreeHeap();
  doc["timestamp"] = getUnixTimestamp();

  if (ENABLE_RAIN_SENSOR) {
    doc["raining"] = isRainingConfirmed;
  }

  if (ENABLE_DHT22) {
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    if (!isnan(t) && !isnan(h)) {
      doc["temperature"] = round(t * 10.0) / 10.0;
      doc["humidity"]    = round(h * 10.0) / 10.0;
    }
  }

  char buffer[384];
  size_t len = serializeJson(doc, buffer, sizeof(buffer));
  mqttClient.publish(TOPIC_SYS_STATUS, (const uint8_t*)buffer, len, true);
}

// =========================================================================
// 6. EKSEKUSI AKTUATOR FISIK (DENGAN VALIDASI & KONFIRMASI AKTUAL)
// =========================================================================
void executeJemuran(const String& action, const String& source, const String& reqId) {
  if (action == "OPEN") {
    // Proteksi hujan: jika sedang hujan, tahan posisi tertutup & tetap balas reqId agar Web/XiaoZhi tidak timeout
    if (ENABLE_RAIN_SENSOR && isRainingConfirmed) {
      Serial.println("[RAIN GUARD] Perintah OPEN ditahan karena terdeteksi HUJAN.");
      servoJemuran.write(JEMURAN_SUDUT_TUTUP);
      angleJemuran = JEMURAN_SUDUT_TUTUP;
      stateJemuran = "CLOSED";
      publishDeviceState(TOPIC_JEMURAN_STATE, "jemuran", stateJemuran, "sensor-hujan", reqId, angleJemuran, "STANDBY");
      return;
    }

    publishDeviceState(TOPIC_JEMURAN_STATE, "jemuran", "MOVING", source.c_str(), reqId, angleJemuran, "BERGERAK");
    servoJemuran.write(JEMURAN_SUDUT_BUKA);
    delay(350); // Waktu singkat mekanik servo mencapai sudut target
    angleJemuran = JEMURAN_SUDUT_BUKA;
    stateJemuran = "OPEN";
    publishDeviceState(TOPIC_JEMURAN_STATE, "jemuran", stateJemuran, source.c_str(), reqId, angleJemuran, "STANDBY");
  } else if (action == "CLOSE") {
    publishDeviceState(TOPIC_JEMURAN_STATE, "jemuran", "MOVING", source.c_str(), reqId, angleJemuran, "BERGERAK");
    servoJemuran.write(JEMURAN_SUDUT_TUTUP);
    delay(350);
    angleJemuran = JEMURAN_SUDUT_TUTUP;
    stateJemuran = "CLOSED";
    publishDeviceState(TOPIC_JEMURAN_STATE, "jemuran", stateJemuran, source.c_str(), reqId, angleJemuran, "STANDBY");
  } else if (action == "STOP") {
    // Pertahankan posisi servo saat ini dan laporkan status aktual
    publishDeviceState(TOPIC_JEMURAN_STATE, "jemuran", stateJemuran, source.c_str(), reqId, angleJemuran, "STANDBY");
  }
}

void executeKipas(const String& action, const String& source, const String& reqId, bool isManual = false) {
  if (action == "ON") {
    digitalWrite(PIN_RELAY_KIPAS, RELAY_ON_LEVEL);
    stateKipas = "ON";
    if (isManual) {
      manualFanOnLock  = true;
      manualFanOffLock = false;
    }
    publishDeviceState(TOPIC_KIPAS_STATE, "kipas", stateKipas, source.c_str(), reqId);
  } else if (action == "OFF") {
    digitalWrite(PIN_RELAY_KIPAS, RELAY_OFF_LEVEL);
    stateKipas = "OFF";
    if (isManual) {
      manualFanOffLock = true;
      manualFanOnLock  = false;
    }
    publishDeviceState(TOPIC_KIPAS_STATE, "kipas", stateKipas, source.c_str(), reqId);
  }
}

void executeLampu1(const String& action, const String& source, const String& reqId) {
  if (action == "ON") {
    digitalWrite(PIN_LAMPU_1_GATE, RELAY_ON_LEVEL);
    stateLampu1 = "ON";
    publishDeviceState(TOPIC_LAMPU1_STATE, "lampu1", stateLampu1, source.c_str(), reqId);
  } else if (action == "OFF") {
    digitalWrite(PIN_LAMPU_1_GATE, RELAY_OFF_LEVEL);
    stateLampu1 = "OFF";
    publishDeviceState(TOPIC_LAMPU1_STATE, "lampu1", stateLampu1, source.c_str(), reqId);
  }
}

void executeLampu2(const String& action, const String& source, const String& reqId) {
  if (action == "ON") {
    digitalWrite(PIN_LAMPU_2, RELAY_ON_LEVEL);
    stateLampu2 = "ON";
    publishDeviceState(TOPIC_LAMPU2_STATE, "lampu2", stateLampu2, source.c_str(), reqId);
  } else if (action == "OFF") {
    digitalWrite(PIN_LAMPU_2, RELAY_OFF_LEVEL);
    stateLampu2 = "OFF";
    publishDeviceState(TOPIC_LAMPU2_STATE, "lampu2", stateLampu2, source.c_str(), reqId);
  }
}

void executePintu(const String& action, const String& source, const String& reqId) {
  if (action == "OPEN" || action == "UNLOCK") {
    servoPintu.write(PINTU_SUDUT_BUKA);
    delay(350);
    anglePintu = PINTU_SUDUT_BUKA;
    statePintu = "OPEN";
    publishDeviceState(TOPIC_PINTU_STATE, "pintu", statePintu, source.c_str(), reqId, anglePintu, nullptr);
  } else if (action == "CLOSE" || action == "LOCK") {
    servoPintu.write(PINTU_SUDUT_TUTUP);
    delay(350);
    anglePintu = PINTU_SUDUT_TUTUP;
    statePintu = "CLOSED";
    publishDeviceState(TOPIC_PINTU_STATE, "pintu", statePintu, source.c_str(), reqId, anglePintu, nullptr);
  }
}

// =========================================================================
// 7. CALLBACK PENERIMA PESAN MQTT & VALIDASI PAYLOAD JSON
// =========================================================================
void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  String topicStr = String(topic);
  String message;
  message.reserve(length + 1);
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }

  Serial.printf("[MQTT RX] %s -> %s\n", topic, message.c_str());

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, message);
  if (err) {
    Serial.printf("[ERROR] JSON tidak valid: %s\n", err.c_str());
    return;
  }

  String device = doc["device"] | "";
  String action = doc["action"] | "";
  String source = doc["source"] | "unknown";
  String reqId  = doc["requestId"] | "";

  action.toUpperCase();
  device.toLowerCase();

  // Validasi kesesuaian nama device dengan topic command
  if (topicStr == "smarthome/jemuran/command" && device == "jemuran") {
    executeJemuran(action, source, reqId);
  } else if (topicStr == "smarthome/kipas/command" && device == "kipas") {
    executeKipas(action, source, reqId, true);
  } else if (topicStr == "smarthome/lampu1/command" && device == "lampu1") {
    executeLampu1(action, source, reqId);
  } else if (topicStr == "smarthome/lampu2/command" && device == "lampu2") {
    executeLampu2(action, source, reqId);
  } else if (topicStr == "smarthome/pintu/command" && device == "pintu") {
    executePintu(action, source, reqId);
  } else {
    Serial.println("[WARN] Perintah ditolak: topic dan field 'device' tidak cocok.");
  }
}

// =========================================================================
// 8. PENANGANAN TOMBOL FISIK & OTOMATISASI SENSOR LOKAL
// =========================================================================
void handlePhysicalButton() {
  int reading = digitalRead(PIN_TOMBOL_FISIK);

  if (reading != lastButtonReading) {
    lastDebounceTime = millis();
  }

  if ((millis() - lastDebounceTime) > DEBOUNCE_DELAY_MS) {
    if (reading != stableButtonState) {
      stableButtonState = reading;

      // Deteksi penekanan tombol (Active-LOW dengan INPUT_PULLUP)
      if (stableButtonState == LOW) {
        String nextAction = (stateLampu1 == "OFF") ? "ON" : "OFF";
        Serial.printf("[BUTTON] Tombol fisik ditekan -> Lampu 1 %s\n", nextAction.c_str());
        executeLampu1(nextAction, "physical-button", "");
      }
    }
  }
  lastButtonReading = reading;
}

void handleRainSensorAutomation() {
  if (!ENABLE_RAIN_SENSOR) return;

  // Modul sensor hujan umumnya Active-LOW (LOW = terdeteksi air hujan, HIGH = kering)
  bool currentWet = (digitalRead(PIN_SENSOR_HUJAN) == LOW);

  if (currentWet != rawRainReading) {
    rawRainReading = currentWet;
    lastRainDebounceTime = millis();
  }

  if ((millis() - lastRainDebounceTime) >= RAIN_DEBOUNCE_MS) {
    if (isRainingConfirmed != rawRainReading) {
      isRainingConfirmed = rawRainReading;
      Serial.printf("[RAIN SENSOR] Kondisi berubah -> %s\n", isRainingConfirmed ? "HUJAN" : "KERING");

      if (isRainingConfirmed && stateJemuran != "CLOSED") {
        Serial.println("[AUTO JEMURAN] Hujan terdeteksi! Menutup jemuran otomatis...");
        executeJemuran("CLOSE", "sensor-hujan", "");
      }
      publishSystemTelemetry();
    }
  }
}

void handleDht22FanAutomation() {
  if (!ENABLE_DHT22) return;
  if (millis() - lastDhtCheckTime < DHT_CHECK_INTERVAL_MS) return;
  lastDhtCheckTime = millis();

  float t = dht.readTemperature();
  if (isnan(t)) return;

  // Buka kembali kunci override manual saat suhu kembali bergerak melewati titik tengah
  if (t < (SUHU_KIPAS_NYALA - 0.5)) {
    manualFanOffLock = false;
  }
  if (t > (SUHU_KIPAS_MATI + 0.5)) {
    manualFanOnLock = false;
  }

  // Otomatisasi Kipas Berdasarkan Batas Suhu
  if (t >= SUHU_KIPAS_NYALA && stateKipas != "ON" && !manualFanOffLock) {
    Serial.printf("[AUTO KIPAS] Suhu %.1f°C >= %.1f°C -> Kipas ON otomatis\n", t, SUHU_KIPAS_NYALA);
    executeKipas("ON", "sensor-dht22", "", false);
  } else if (t <= SUHU_KIPAS_MATI && stateKipas != "OFF" && !manualFanOnLock) {
    Serial.printf("[AUTO KIPAS] Suhu %.1f°C <= %.1f°C -> Kipas OFF otomatis\n", t, SUHU_KIPAS_MATI);
    executeKipas("OFF", "sensor-dht22", "", false);
  }
}

// =========================================================================
// 9. KONEKSI WI-FI, SINKRONISASI WAKTU NTP, & RECONNECT MQTT TLS
// =========================================================================
void setupWiFiAndTime() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WIFI] Menghubungkan ke ");
  Serial.println(WIFI_SSID);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.printf("\n[WIFI] Terhubung! IP: %s | RSSI: %d dBm\n",
                WiFi.localIP().toString().c_str(), WiFi.RSSI());

  // Wajib sinkronisasi NTP agar verifikasi sertifikat TLS & timestamp valid
  configTime(8 * 3600, 0, "pool.ntp.org", "time.nist.gov");
  Serial.print("[NTP] Sinkronisasi waktu");
  time_t now = time(nullptr);
  int retry = 0;
  while (now < 1700000000 && retry < 20) {
    delay(500);
    Serial.print(".");
    now = time(nullptr);
    retry++;
  }
  Serial.println(" Selesai.");
}

bool reconnectMqtt() {
  Serial.printf("[MQTT] Menghubungkan ke %s:%d...\n", MQTT_BROKER, MQTT_PORT);

  // Koneksi dengan Last Will & Testament (LWT) untuk deteksi otomatis jika ESP32 putus
  bool connected = mqttClient.connect(
    MQTT_CLIENT_ID,
    MQTT_USER,
    MQTT_PASS,
    TOPIC_SYS_AVAILABILITY, // Will Topic
    1,                      // Will QoS 1
    true,                   // Will Retain = true
    "offline"               // Will Payload otomatis saat terputus mendadak
  );

  if (connected) {
    Serial.println("[MQTT] Berhasil terhubung via TLS!");

    // 1. Umumkan status online (Retained)
    mqttClient.publish(TOPIC_SYS_AVAILABILITY, "online", true);

    // 2. Subscribe semua topic command dengan QoS 1
    mqttClient.subscribe(TOPIC_SUB_COMMAND, 1);

    // 3. Laporkan status aktual seluruh perangkat & telemetri awal
    publishAllInitialStates();
    publishSystemTelemetry();
  } else {
    Serial.printf("[MQTT] Gagal terhubung, kode error rc=%d\n", mqttClient.state());
  }
  return connected;
}

// =========================================================================
// 10. SETUP & LOOP UTAMA
// =========================================================================
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n=== BOOTING SMART HOME ESP32 SYSTEM ===");

  // Inisialisasi pin output & pastikan semua beban dalam kondisi aman (OFF) saat boot
  pinMode(PIN_RELAY_KIPAS, OUTPUT);
  digitalWrite(PIN_RELAY_KIPAS, RELAY_OFF_LEVEL);

  pinMode(PIN_LAMPU_1_GATE, OUTPUT);
  digitalWrite(PIN_LAMPU_1_GATE, RELAY_OFF_LEVEL);

  pinMode(PIN_LAMPU_1_ZC, INPUT);

  pinMode(PIN_LAMPU_2, OUTPUT);
  digitalWrite(PIN_LAMPU_2, RELAY_OFF_LEVEL);

  // Tombol fisik menggunakan internal pull-up (sambungkan tombol ke GPIO & GND)
  pinMode(PIN_TOMBOL_FISIK, INPUT_PULLUP);

  // Sensor hujan pin DO (GPIO 34 adalah pin input-only tanpa internal pull-up)
  pinMode(PIN_SENSOR_HUJAN, INPUT);

  // Inisialisasi 2 Servo pada posisi awal tertutup
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  servoPintu.setPeriodHertz(50);
  servoPintu.attach(PIN_SERVO_PINTU, 500, 2400);
  servoPintu.write(PINTU_SUDUT_TUTUP);

  servoJemuran.setPeriodHertz(50);
  servoJemuran.attach(PIN_SERVO_JEMURAN, 500, 2400);
  servoJemuran.write(JEMURAN_SUDUT_TUTUP);

  if (ENABLE_DHT22) {
    dht.begin();
  }

  setupWiFiAndTime();

  // Konfigurasi sertifikat TLS & ukuran buffer PubSubClient (wajib > 256 byte untuk JSON)
  secureClient.setCACert(EMQX_ROOT_CA);
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(onMqttMessage);
  mqttClient.setBufferSize(1024);
  mqttClient.setKeepAlive(30);

  reconnectMqtt();
}

void loop() {
  // Pastikan Wi-Fi tetap terhubung
  if (WiFi.status() != WL_CONNECTED) {
    setupWiFiAndTime();
  }

  // Reconnect MQTT non-blocking setiap 5 detik jika terputus
  if (!mqttClient.connected()) {
    unsigned long now = millis();
    if (now - lastReconnectAttempt > 5000) {
      lastReconnectAttempt = now;
      if (reconnectMqtt()) {
        lastReconnectAttempt = 0;
      }
    }
  } else {
    mqttClient.loop();
  }

  // Pantau tombol fisik & otomatisasi sensor lokal setiap siklus loop
  handlePhysicalButton();
  handleRainSensorAutomation();
  handleDht22FanAutomation();

  // Kirim telemetri sistem berkala setiap 10 detik
  if (mqttClient.connected() && (millis() - lastTelemetryPublish > TELEMETRY_INTERVAL_MS)) {
    lastTelemetryPublish = millis();
    publishSystemTelemetry();
  }
}
