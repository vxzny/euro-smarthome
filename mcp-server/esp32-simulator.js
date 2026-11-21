/**
 * Simulator ESP32 Otomatis (Pengganti Sementara Sebelum Hardware ESP32 Fisik Tersedia)
 * Terhubung langsung ke EMQX Cloud sebagai esp32-smarthome-01
 */
import mqtt from "mqtt";

const BROKER_WSS_URL = "wss://lf0d78dd.ala.asia-southeast1.emqxsl.com:8084/mqtt";
const ESP32_USER     = "esp32";
const ESP32_PASS     = "esp32";

console.log(`[ESP32-SIM] Menghubungkan ke ${BROKER_WSS_URL}...`);

const client = mqtt.connect(BROKER_WSS_URL, {
  clientId: "esp32-smarthome-01",
  username: ESP32_USER,
  password: ESP32_PASS,
  clean: true,
  keepalive: 30,
  reconnectPeriod: 3000,
  will: {
    topic: "smarthome/system/availability",
    payload: "offline",
    qos: 1,
    retain: true
  }
});

const currentStates = {
  jemuran: { state: "CLOSED", detail: { angle: 0, motor: "STANDBY" } },
  kipas:   { state: "OFF",    detail: {} },
  lampu1:  { state: "OFF",    detail: {} },
  lampu2:  { state: "OFF",    detail: {} },
  pintu:   { state: "CLOSED", detail: { angle: 0 } }
};

function publishState(device, state, source = "esp32", requestId = null, detail = {}) {
  const payload = {
    device,
    state,
    online: true,
    source,
    requestId,
    detail,
    timestamp: Math.floor(Date.now() / 1000)
  };

  client.publish(`smarthome/${device}/state`, JSON.stringify(payload), {
    qos: 1,
    retain: true
  });
  console.log(`[ESP32-SIM] State aktual terkirim -> ${device}: ${state}`);
}

function publishTelemetry() {
  if (!client.connected) return;
  const rssiSimulated = -52 - Math.floor(Math.random() * 8);
  const telemetry = {
    device: "esp32-smarthome-01",
    online: true,
    ip: "192.168.1.105",
    rssi: rssiSimulated,
    uptimeSec: Math.floor(process.uptime()),
    freeHeap: 215040,
    timestamp: Math.floor(Date.now() / 1000)
  };
  client.publish("smarthome/system/status", JSON.stringify(telemetry), {
    qos: 1,
    retain: true
  });
}

client.on("connect", () => {
  console.log("[ESP32-SIM] Terhubung penuh ke EMQX Cloud sebagai esp32-smarthome-01!");
  client.publish("smarthome/system/availability", "online", { qos: 1, retain: true });
  client.subscribe("smarthome/+/command", { qos: 1 });

  Object.entries(currentStates).forEach(([device, info]) => {
    publishState(device, info.state, "esp32", null, info.detail);
  });
  publishTelemetry();
});

client.on("message", (topic, buffer) => {
  try {
    const cmd = JSON.parse(buffer.toString("utf-8"));
    const { device, action, source, requestId } = cmd;

    if (!currentStates[device]) return;
    console.log(`[ESP32-SIM] Terima perintah -> ${device}: ${action} (source: ${source})`);

    let nextState = action;
    let nextDetail = {};

    if (device === "jemuran") {
      if (action === "OPEN") {
        nextState = "OPEN";
        nextDetail = { angle: 120, motor: "STANDBY" };
      } else if (action === "CLOSE") {
        nextState = "CLOSED";
        nextDetail = { angle: 0, motor: "STANDBY" };
      } else if (action === "STOP") {
        nextState = currentStates.jemuran.state;
        nextDetail = { ...currentStates.jemuran.detail, motor: "STANDBY" };
      }
    } else if (device === "pintu") {
      if (action === "OPEN" || action === "UNLOCK") {
        nextState = "OPEN";
        nextDetail = { angle: 90 };
      } else if (action === "CLOSE" || action === "LOCK") {
        nextState = "CLOSED";
        nextDetail = { angle: 0 };
      }
    }

    currentStates[device] = { state: nextState, detail: nextDetail };

    setTimeout(() => {
      publishState(device, nextState, source || "esp32", requestId || null, nextDetail);
    }, 500);
  } catch (err) {
    console.error("[ESP32-SIM] Gagal memproses pesan masuk:", err.message);
  }
});

client.on("error", (err) => {
  console.error("[ESP32-SIM] Error koneksi MQTT:", err.message);
});

setInterval(publishTelemetry, 10000);