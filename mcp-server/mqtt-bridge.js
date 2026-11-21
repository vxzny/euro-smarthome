/**
 * Jembatan Komunikasi MQTT TLS/WSS untuk MCP Server XiaoZhi AI
 * - Menyimpan cache status aktual seluruh perangkat dari retained messages
 * - Mengirim perintah (QoS 1) dan menunggu konfirmasi aktual dari ESP32
 */
import mqtt from "mqtt";

const VALID_DEVICES = ["jemuran", "kipas", "lampu1", "lampu2", "pintu"];

const VALID_ACTIONS = {
  jemuran: ["OPEN", "CLOSE", "STOP"],
  kipas: ["ON", "OFF"],
  lampu1: ["ON", "OFF"],
  lampu2: ["ON", "OFF"],
  pintu: ["OPEN", "CLOSE"]
};

export class SmartHomeMqttBridge {
  constructor({ brokerUrl, username, password, clientId, commandTimeoutMs = 6000 }) {
    this.brokerUrl = brokerUrl;
    this.username = username;
    this.password = password;
    this.clientId = clientId || `mcp-xiaozhi-${Math.random().toString(36).substring(2, 7)}`;
    this.commandTimeoutMs = Number(commandTimeoutMs) || 6000;

    this.client = null;
    this.brokerConnected = false;
    this.espOnline = false;
    this.telemetry = null;

    // Cache status aktual terakhir tiap perangkat
    this.deviceStates = {};
    VALID_DEVICES.forEach((dev) => {
      this.deviceStates[dev] = {
        device: dev,
        state: "UNKNOWN",
        online: false,
        detail: {},
        timestamp: null,
        lastUpdatedIso: null
      };
    });

    // Antrean promise yang menunggu balasan state dari ESP32
    this.pendingWaiters = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      console.log(`[MQTT-BRIDGE] Menghubungkan ke ${this.brokerUrl}...`);

      this.client = mqtt.connect(this.brokerUrl, {
        clientId: this.clientId,
        username: this.username,
        password: this.password,
        clean: true,
        keepalive: 30,
        reconnectPeriod: 3000,
        connectTimeout: 10000
      });

      let initialResolved = false;

      this.client.on("connect", () => {
        this.brokerConnected = true;
        console.log("[MQTT-BRIDGE] Terhubung ke MQTT Broker!");

        this.client.subscribe(
          [
            "smarthome/+/state",
            "smarthome/system/availability",
            "smarthome/system/status"
          ],
          { qos: 1 },
          (err) => {
            if (err) {
              console.error("[MQTT-BRIDGE] Gagal subscribe:", err.message);
            } else {
              console.log("[MQTT-BRIDGE] Berhasil subscribe ke state & availability.");
            }
            if (!initialResolved) {
              initialResolved = true;
              resolve();
            }
          }
        );
      });

      this.client.on("message", (topic, payloadBuffer) => {
        this.handleIncomingMessage(topic, payloadBuffer.toString("utf-8"));
      });

      this.client.on("close", () => {
        this.brokerConnected = false;
      });

      this.client.on("offline", () => {
        this.brokerConnected = false;
      });

      this.client.on("error", (err) => {
        console.error("[MQTT-BRIDGE] Error:", err.message);
        if (!initialResolved) {
          initialResolved = true;
          reject(err);
        }
      });
    });
  }

  handleIncomingMessage(topic, rawString) {
    // 1. Cek status LWT ESP32
    if (topic === "smarthome/system/availability") {
      const trimmed = rawString.trim();
      if (trimmed.startsWith("{")) {
        try {
          const parsed = JSON.parse(trimmed);
          this.espOnline =
            String(parsed.status || "").toLowerCase() === "online" || parsed.online === true;
        } catch {
          this.espOnline = false;
        }
      } else {
        this.espOnline = trimmed.toLowerCase() === "online";
      }

      VALID_DEVICES.forEach((dev) => {
        if (!this.espOnline) {
          this.deviceStates[dev].online = false;
        } else if (this.deviceStates[dev].state !== "UNKNOWN") {
          this.deviceStates[dev].online = true;
        }
      });
      console.log(`[MQTT-BRIDGE] Status ESP32 Availability: ${this.espOnline ? "ONLINE" : "OFFLINE"}`);
      return;
    }

    // 2. Cek telemetri sistem ESP32
    if (topic === "smarthome/system/status") {
      try {
        this.telemetry = JSON.parse(rawString);
      } catch {
        // Abaikan jika JSON tidak valid
      }
      return;
    }

    // 3. Cek update status aktual perangkat (smarthome/<device>/state)
    const match = topic.match(/^smarthome\/([a-z0-9]+)\/state$/);
    if (!match) return;

    const topicDevice = match[1];
    if (!VALID_DEVICES.includes(topicDevice)) return;

    let data;
    try {
      data = JSON.parse(rawString);
    } catch {
      console.warn(`[MQTT-BRIDGE] JSON tidak valid di ${topic}`);
      return;
    }

    const normalizedState = String(data.state || "UNKNOWN").toUpperCase();
    const updatedRecord = {
      device: topicDevice,
      state: normalizedState,
      online: Boolean(data.online) && this.espOnline,
      detail: data.detail || {},
      source: data.source || "esp32",
      requestId: data.requestId || null,
      timestamp: Number(data.timestamp) || Math.floor(Date.now() / 1000),
      lastUpdatedIso: new Date().toISOString()
    };

    this.deviceStates[topicDevice] = updatedRecord;
    console.log(`[MQTT-BRIDGE] State aktual ${topicDevice}: ${normalizedState}`);

    // Jika state adalah "MOVING" (jemuran sedang bergerak), tunggu state akhir (OPEN/CLOSED)
    if (normalizedState === "MOVING") return;

    // Selesaikan promise yang sedang menunggu konfirmasi perangkat ini
    const waiter = this.pendingWaiters.get(topicDevice);
    if (waiter) {
      if (!data.requestId || data.requestId === waiter.requestId) {
        clearTimeout(waiter.timer);
        this.pendingWaiters.delete(topicDevice);
        waiter.resolve(updatedRecord);
      }
    }
  }

  /**
   * Mengirim perintah kontrol ke MQTT dan menunggu konfirmasi aktual dari ESP32
   */
  async executeDeviceCommand(device, action) {
    if (!VALID_DEVICES.includes(device)) {
      throw new Error(`Perangkat "${device}" tidak dikenali.`);
    }

    const normalizedAction = String(action || "").trim().toUpperCase();
    if (!VALID_ACTIONS[device].includes(normalizedAction)) {
      throw new Error(
        `Aksi "${normalizedAction}" tidak valid untuk ${device}. Pilihan: ${VALID_ACTIONS[device].join(", ")}`
      );
    }

    if (!this.brokerConnected || !this.client) {
      throw new Error("MCP Server belum terhubung ke MQTT Broker.");
    }

    if (!this.espOnline) {
      return {
        success: false,
        reason: "ESP32_OFFLINE",
        message: `Perangkat ESP32 sedang OFFLINE sehingga perintah ${normalizedAction} untuk ${device} tidak dapat dijalankan.`,
        currentState: this.deviceStates[device]
      };
    }

    // Cegah pengiriman ganda saat perintah sebelumnya untuk perangkat sama masih berjalan
    if (this.pendingWaiters.has(device)) {
      return {
        success: false,
        reason: "DEVICE_BUSY",
        message: `Perintah sebelumnya untuk ${device} masih diproses oleh ESP32. Silakan tunggu sebentar.`,
        currentState: this.deviceStates[device]
      };
    }

    const requestId = `xz-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const topic = `smarthome/${device}/command`;
    const payload = {
      device,
      action: normalizedAction,
      source: "xiaozhi",
      requestId,
      timestamp: Math.floor(Date.now() / 1000)
    };

    const confirmationPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingWaiters.delete(device);
        reject(
          new Error(
            `Timeout (${this.commandTimeoutMs / 1000} detik): ESP32 tidak mengirim konfirmasi status untuk ${device}.`
          )
        );
      }, this.commandTimeoutMs);

      this.pendingWaiters.set(device, { requestId, resolve, reject, timer });
    });

    await new Promise((resolve, reject) => {
      this.client.publish(topic, JSON.stringify(payload), { qos: 1, retain: false }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    console.log(`[MQTT-BRIDGE] Perintah XiaoZhi dikirim ke ${topic}: ${JSON.stringify(payload)}`);

    try {
      const confirmedState = await confirmationPromise;
      return {
        success: true,
        message: `Berhasil: ${device} sekarang dalam kondisi ${confirmedState.state}.`,
        data: confirmedState
      };
    } catch (timeoutErr) {
      return {
        success: false,
        reason: "TIMEOUT",
        message: timeoutErr.message,
        lastKnownState: this.deviceStates[device]
      };
    }
  }

  getDoorStatus() {
    return {
      espOnline: this.espOnline,
      door: this.deviceStates.pintu
    };
  }

  getAllDeviceStatus() {
    const devices = VALID_DEVICES.map((k) => this.deviceStates[k]);
    const onlineCount = devices.filter((d) => d.online).length;
    return {
      brokerConnected: this.brokerConnected,
      esp32Online: this.espOnline,
      summary: {
        totalDevices: devices.length,
        onlineDevices: onlineCount,
        offlineDevices: devices.length - onlineCount
      },
      devices: this.deviceStates,
      telemetry: this.telemetry
    };
  }
}