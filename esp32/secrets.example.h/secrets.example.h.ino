#ifndef SECRETS_H
#define SECRETS_H

// ==========================================
// 1. KONFIGURASI WI-FI (2.4 GHz)
// ==========================================
const char* WIFI_SSID     = "NAMA_WIFI_ANDA";
const char* WIFI_PASSWORD = "PASSWORD_WIFI_ANDA";

// ==========================================
// 2. KONFIGURASI EMQX CLOUD (MQTT OVER TLS)
// ==========================================
// Masukkan Broker Address saja tanpa "mqtts://" atau port
const char* MQTT_BROKER   = "xxxxxxxx.ala.asia-southeast1.emqxsl.com";
const int   MQTT_PORT     = 8883;

// Kredensial khusus ESP32 dari menu Authentication EMQX Cloud
const char* MQTT_USER     = "esp32_controller";
const char* MQTT_PASS     = "PASSWORD_ESP32_CONTROLLER_ANDA";

// Client ID harus unik (dan sama dengan ACL jika ACL memakai Client ID)
const char* MQTT_CLIENT_ID = "esp32-smarthome-01";

// ==========================================
// 3. SERTIFIKAT ROOT CA EMQX CLOUD (emqxsl-ca.crt)
// ==========================================
// Tempel isi lengkap file emqxsl-ca.crt di antara tanda kutip R"EOF( ... )EOF"
const char* EMQX_ROOT_CA = R"EOF(
-----BEGIN CERTIFICATE-----
TEMPEL_ISI_SERTIFIKAT_EMQXSL_CA_CRT_ANDA_DI_SINI
-----END CERTIFICATE-----
)EOF";

#endif