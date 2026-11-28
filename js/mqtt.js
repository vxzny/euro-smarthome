/**
 * Modul Layanan MQTT over WebSocket Secure (WSS) untuk Frontend Dashboard
 * Menggunakan MQTT.js (window.mqtt) dengan QoS 1, Retained State, & Auto-Reconnect
 */
import { TOPICS, buildCommandPayload, parseAndValidateState } from "../config/mqtt-contract.js";

const STORAGE_KEY = "nexus_smarthome_wss_config_v1";

export class MqttService {
  constructor({ onStatusChange, onDeviceState, onSystemStatus, onAvailability, onError }) {
    this.callbacks = {
      onStatusChange,
      onDeviceState,
      onSystemStatus,
      onAvailability,
      onError
    };
    this.client = null;
    this.connected = false;
    this.manualDisconnect = false;
    this.config = this.loadConfig();
  }

  publishTts(text) {
    if (!this.client || !this.connected || !text) return;
    const cleanText = String(text).trim().slice(0, 180);
    if (!cleanText) return;

    this.client.publish(
      "smarthome/system/tts",
      JSON.stringify({ text: cleanText }),
      { qos: 1, retain: false }
    );
  }

  loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  saveConfig(config) {
    this.config = config;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }

  verifyDoorPin(enteredPin) {
    if (!this.config?.doorPin) return true;
    return String(enteredPin) === String(this.config.doorPin);
  }

  connect(config = this.config) {
    if (!config || !config.host || !config.password) {
      this.callbacks.onStatusChange?.("DISCONNECTED", "Belum dikonfigurasi");
      return false;
    }

    if (typeof window.mqtt === "undefined") {
      this.callbacks.onError?.(
        "Library MQTT.js gagal dimuat dari CDN. Periksa koneksi internet Anda lalu muat ulang halaman."
      );
      this.callbacks.onStatusChange?.("DISCONNECTED", config.host);
      return false;
    }

    if (this.client) {
      try {
        this.client.end(true);
      } catch {
        // Abaikan error saat menutup klien lama
      }
      this.client = null;
    }

    this.saveConfig(config);
    this.manualDisconnect = false;
    this.callbacks.onStatusChange?.("CONNECTING", config.host);

    const cleanHost = config.host.replace(/^wss?:\/\//i, "").trim();
    const port = Number(config.port) || 8084;
    const rawPath = (config.path || "/mqtt").trim();
    const normalizedPath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
    const brokerUrl = `wss://${cleanHost}:${port}${normalizedPath}`;

    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const clientId = config.clientId || `web-dashboard-${randomSuffix}`;

    const options = {
      clientId,
      username: config.username || "web_dashboard",
      password: config.password,
      protocolVersion: 4,
      clean: true,
      keepalive: 30,
      reconnectPeriod: 3000,
      connectTimeout: 10000,
      resubscribe: true
    };

    try {
      this.client = window.mqtt.connect(brokerUrl, options);
      this.registerClientEvents(cleanHost);
      return true;
    } catch (err) {
      this.connected = false;
      this.callbacks.onStatusChange?.("DISCONNECTED", cleanHost);
      this.callbacks.onError?.(`Gagal menginisialisasi koneksi WSS: ${err.message}`);
      return false;
    }
  }

  registerClientEvents(brokerHost) {
    if (!this.client) return;

    this.client.on("connect", () => {
      this.connected = true;
      this.callbacks.onStatusChange?.("CONNECTED", brokerHost);

      this.client.subscribe(TOPICS.subscribeAll, { qos: 1 }, (err, granted) => {
        if (err) {
          this.callbacks.onError?.(`Gagal subscribe topic: ${err.message}`);
          return;
        }
        const deniedTopics = (granted || []).filter((g) => g.qos === 128);
        if (deniedTopics.length > 0) {
          const names = deniedTopics.map((d) => d.topic).join(", ");
          this.callbacks.onError?.(`Akses Subscribe ditolak ACL EMQX pada topic: ${names}`);
        }
      });
    });

    this.client.on("reconnect", () => {
      if (this.manualDisconnect) return;
      this.connected = false;
      this.callbacks.onStatusChange?.("CONNECTING", brokerHost);
    });

    this.client.on("close", () => {
      this.connected = false;
      if (this.manualDisconnect) {
        this.callbacks.onStatusChange?.("DISCONNECTED", brokerHost);
      }
    });

    this.client.on("offline", () => {
      this.connected = false;
      this.callbacks.onStatusChange?.("DISCONNECTED", brokerHost);
    });

    this.client.on("error", (err) => {
      const msg = err?.message || String(err);

      if (/not authorized|bad user name or password|identifier rejected/i.test(msg)) {
        this.manualDisconnect = true;
        this.connected = false;
        this.client?.end(true);
        this.callbacks.onStatusChange?.("DISCONNECTED", brokerHost);
        this.callbacks.onError?.(
          "Autentikasi MQTT ditolak broker. Periksa Username, Password, atau ACL di EMQX Cloud."
        );
        return;
      }

      this.callbacks.onError?.(`Gangguan koneksi MQTT WSS: ${msg}`);
    });

    this.client.on("message", (topic, payloadBuffer) => {
      const rawString = payloadBuffer.toString("utf-8");
      this.handleIncomingMessage(topic, rawString);
    });
  }

  disconnect() {
    this.manualDisconnect = true;
    if (this.client) {
      try {
        this.client.end(true);
      } catch {
        // Abaikan error saat memutus koneksi
      }
      this.client = null;
    }
    this.connected = false;
    this.callbacks.onStatusChange?.("DISCONNECTED", this.config?.host || "");
  }

  publishCommand(device, action, source = "web", extraPayload = {}) {
    if (!this.connected || !this.client) {
      throw new Error("MQTT Broker belum terhubung. Klik tombol 'Broker WSS' untuk menghubungkan.");
    }

    const payloadObj = buildCommandPayload(device, action, source, extraPayload);
    const topic = TOPICS.devices[device].command;

    this.client.publish(
      topic,
      JSON.stringify(payloadObj),
      { qos: 1, retain: false },
      (err) => {
        if (err) {
          this.callbacks.onError?.(`Gagal mengirim perintah ke ${topic}: ${err.message}`);
        }
      }
    );

    return payloadObj;
  }

  handleIncomingMessage(topic, rawString) {
    if (topic === TOPICS.system.availability) {
      const trimmed = rawString.trim();
      let isOnline = false;

      if (trimmed.startsWith("{")) {
        try {
          const parsed = JSON.parse(trimmed);
          isOnline = String(parsed.status || "").toLowerCase() === "online" || parsed.online === true;
        } catch {
          isOnline = false;
        }
      } else {
        isOnline = trimmed.toLowerCase() === "online";
      }

      this.callbacks.onAvailability?.(isOnline);
      return;
    }

    if (topic === TOPICS.system.status) {
      try {
        const telemetry = JSON.parse(rawString);
        this.callbacks.onSystemStatus?.(telemetry);
      } catch {
        this.callbacks.onError?.("Format JSON telemetri system tidak valid.");
      }
      return;
    }

    const parsed = parseAndValidateState(rawString);
    if (parsed.valid) {
      this.callbacks.onDeviceState?.(parsed.data);
    } else {
      console.warn(`[MQTT] Pesan diabaikan pada ${topic}: ${parsed.error}`);
    }
  }
}
