/**
 * Skrip Pengujian Komunikasi MQTT, Retained Message, dan Topic ACL
 * Jalankan setelah menginstal paket mqtt: npm install mqtt dotenv
 */
import mqtt from "mqtt";
import dotenv from "dotenv";

dotenv.config();

const BROKER_HOST = process.env.MQTT_HOST; // contoh: xxxxxxxx.ala.asia-southeast1.emqxsl.com
const WEB_USER = process.env.WEB_USER || "web_dashboard";
const WEB_PASS = process.env.WEB_PASS;
const ESP_USER = process.env.ESP_USER || "esp32_controller";
const ESP_PASS = process.env.ESP_PASS;

if (!BROKER_HOST || !WEB_PASS || !ESP_PASS) {
  console.error("ERROR: Pastikan MQTT_HOST, WEB_PASS, dan ESP_PASS terisi di file .env");
  process.exit(1);
}

console.log("=== MEMULAI PENGUJIAN KOMUNIKASI MQTT & ACL ===");

// 1. Koneksi Simulasi Website via WSS (Port 8084)
const webClient = mqtt.connect(`wss://${BROKER_HOST}:8084/mqtt`, {
  clientId: `test-web-${Date.now()}`,
  username: WEB_USER,
  password: WEB_PASS,
  clean: true,
  connectTimeout: 10000
});

// 2. Koneksi Simulasi ESP32 via TLS (Port 8883) dengan LWT
const espClient = mqtt.connect(`mqtts://${BROKER_HOST}:8883`, {
  clientId: `test-esp32-${Date.now()}`,
  username: ESP_USER,
  password: ESP_PASS,
  clean: true,
  connectTimeout: 10000,
  will: {
    topic: "smarthome/system/availability",
    payload: "offline",
    qos: 1,
    retain: true
  }
});

let webReady = false;
let espReady = false;

function runTests() {
  if (!webReady || !espReady) return;
  console.log("\n[1] Kedua klien berhasil terhubung (Web via WSS 8084, ESP32 via TLS 8883).");

  // Subscribe topic masing-masing
  webClient.subscribe(["smarthome/+/state", "smarthome/system/availability"], { qos: 1 });
  espClient.subscribe("smarthome/+/command", { qos: 1 }, (err) => {
    if (err) {
      console.error("[GAGAL] ESP32 gagal subscribe command:", err.message);
      return;
    }

    // Publish status online awal dari ESP32 (Retained)
    espClient.publish("smarthome/system/availability", "online", { qos: 1, retain: true });

    // Uji 1: Website mengirim perintah sah ke lampu1
    const cmdPayload = JSON.stringify({
      device: "lampu1",
      action: "ON",
      source: "web",
      requestId: "req-test-001",
      timestamp: Math.floor(Date.now() / 1000)
    });

    console.log("[2] Website mengirim perintah ON ke smarthome/lampu1/command...");
    webClient.publish("smarthome/lampu1/command", cmdPayload, { qos: 1, retain: false });

    // Uji 2: Menguji ACL - Website mencoba memalsukan status (HARUS DITOLAK BROKER)
    setTimeout(() => {
      console.log("[3] Menguji keamanan ACL (Website mencoba publish ke /state)...");
      webClient.publish(
        "smarthome/lampu1/state",
        JSON.stringify({ device: "lampu1", state: "FAKE", online: true }),
        { qos: 1 },
        (pubErr) => {
          if (pubErr) {
            console.log("[SUKSES ACL] Broker menolak publish ilegal dari website:", pubErr.message);
          } else {
            console.log("[INFO] Cek apakah pesan /state palsu masuk ke subscriber di bawah...");
          }
        }
      );
    }, 1500);
  });
}

webClient.on("connect", () => {
  webReady = true;
  runTests();
});

espClient.on("connect", () => {
  espReady = true;
  runTests();
});

// ESP32 menerima perintah dan membalas status aktual (Retained)
espClient.on("message", (topic, message) => {
  console.log(`[ESP32 TERIMA] Topic: ${topic} | Payload: ${message.toString()}`);
  const cmd = JSON.parse(message.toString());

  if (topic === "smarthome/lampu1/command") {
    const statePayload = JSON.stringify({
      device: "lampu1",
      state: cmd.action,
      online: true,
      source: "esp32",
      requestId: cmd.requestId,
      timestamp: Math.floor(Date.now() / 1000)
    });
    espClient.publish("smarthome/lampu1/state", statePayload, { qos: 1, retain: true });
  }
});

// Website menerima status aktual
webClient.on("message", (topic, message, packet) => {
  console.log(
    `[WEB TERIMA] Topic: ${topic} | Retain: ${packet.retain} | Payload: ${message.toString()}`
  );
  if (topic === "smarthome/lampu1/state") {
    const parsed = JSON.parse(message.toString());
    if (parsed.state === "FAKE") {
      console.error("[PERINGATAN ACL] Website berhasil memalsukan /state! Periksa urutan aturan ACL.");
    } else {
      console.log("[SUKSES END-TO-END] Siklus Command -> Eksekusi -> State Aktual berhasil!");
    }
    setTimeout(() => {
      webClient.end();
      espClient.end();
      process.exit(0);
    }, 1000);
  }
});

webClient.on("error", (err) => console.error("[WEB ERROR]", err.message));
espClient.on("error", (err) => console.error("[ESP32 ERROR]", err.message));