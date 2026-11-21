/**
 * Template Konfigurasi MQTT Broker (WSS) untuk Frontend Website
 * Salin file ini menjadi "config/mqtt.local.js" untuk pengujian lokal,
 * atau isi melalui form pengaturan aman di UI saat dibuka di GitHub Pages.
 */
export const MQTT_CONFIG_TEMPLATE = {
  // Ganti dengan Broker Address dari EMQX Cloud Overview
  host: "YOUR_BROKER_ADDRESS.ala.asia-southeast1.emqxsl.com",
  port: 8084,
  path: "/mqtt",
  protocol: "wss",

  // Gunakan akun khusus frontend (bukan akun admin/ESP32)
  username: "web_dashboard",
  password: "YOUR_WEB_DASHBOARD_PASSWORD",

  // Pengaturan koneksi & keamanan
  keepalive: 30,
  reconnectPeriod: 3000,
  connectTimeout: 10000,
  clean: true,

  // Prefix topic konsisten sesuai kontrak sistem
  topics: {
    base: "smarthome",
    devices: {
      jemuran: {
        command: "smarthome/jemuran/command",
        state: "smarthome/jemuran/state"
      },
      kipas: {
        command: "smarthome/kipas/command",
        state: "smarthome/kipas/state"
      },
      lampu1: {
        command: "smarthome/lampu1/command",
        state: "smarthome/lampu1/state"
      },
      lampu2: {
        command: "smarthome/lampu2/command",
        state: "smarthome/lampu2/state"
      },
      pintu: {
        command: "smarthome/pintu/command",
        state: "smarthome/pintu/state"
      }
    },
    system: {
      status: "smarthome/system/status",
      availability: "smarthome/system/availability"
    }
  }
};