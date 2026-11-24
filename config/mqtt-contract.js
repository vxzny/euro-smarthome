/**
 * Kontrak Topic & Validasi Payload MQTT Smart Home
 * Digunakan bersama oleh modul MQTT dan UI Dashboard
 */

export const DEVICE_KEYS = ["jemuran", "kipas", "lampu1", "lampu2", "pintu"];

export const TOPICS = {
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
  },
  subscribeAll: [
    "smarthome/+/state",
    "smarthome/system/status",
    "smarthome/system/availability"
  ]
};

export const VALID_ACTIONS = {
  jemuran: ["OPEN", "CLOSE", "STOP"],
  kipas: ["ON", "OFF"],
  lampu1: ["ON", "OFF"],
  lampu2: ["ON", "OFF"],
  pintu: ["OPEN", "CLOSE", "LOCK", "UNLOCK"]
};

export const VALID_STATES = {
  jemuran: ["OPEN", "CLOSED", "MOVING", "UNKNOWN"],
  kipas: ["ON", "OFF", "UNKNOWN"],
  lampu1: ["ON", "OFF", "UNKNOWN"],
  lampu2: ["ON", "OFF", "UNKNOWN"],
  pintu: ["OPEN", "CLOSED", "LOCKED", "UNLOCKED", "UNKNOWN"]
};

/**
 * Menghasilkan requestId unik untuk melacak konfirmasi command -> state
 */
export function generateRequestId() {
  const rand = Math.random().toString(36).substring(2, 7);
  return `req-${Date.now()}-${rand}`;
}

/**
 * Membentuk dan memvalidasi payload JSON perintah sebelum dipublikasikan
 */
export function buildCommandPayload(device, action, source = "web") {
  if (!DEVICE_KEYS.includes(device)) {
    throw new Error(`Perangkat tidak dikenal: ${device}`);
  }
  const normalizedAction = String(action).trim().toUpperCase();
  if (!VALID_ACTIONS[device].includes(normalizedAction)) {
    throw new Error(`Aksi "${normalizedAction}" tidak valid untuk ${device}`);
  }

  return {
    device,
    action: normalizedAction,
    source,
    requestId: generateRequestId(),
    timestamp: Math.floor(Date.now() / 1000)
  };
}

/**
 * Memvalidasi payload JSON status yang diterima dari ESP32
 */
export function parseAndValidateState(rawPayload) {
  let data;
  try {
    data = typeof rawPayload === "string" ? JSON.parse(rawPayload) : rawPayload;
  } catch {
    return { valid: false, error: "Payload bukan JSON valid" };
  }

  if (!data || typeof data !== "object") {
    return { valid: false, error: "Struktur objek payload tidak valid" };
  }

  const { device, state } = data;
  if (!DEVICE_KEYS.includes(device)) {
    return { valid: false, error: `Device "${device}" tidak terdaftar` };
  }

  const normalizedState = String(state || "UNKNOWN").toUpperCase();
  if (!VALID_STATES[device].includes(normalizedState)) {
    return { valid: false, error: `State "${normalizedState}" tidak valid untuk ${device}` };
  }

  return {
    valid: true,
    data: {
      device,
      state: normalizedState,
      online: Boolean(data.online),
      source: data.source || "esp32",
      requestId: data.requestId || null,
      detail: data.detail || {},
      timestamp: Number(data.timestamp) || Math.floor(Date.now() / 1000)
    }
  };
}

export const DEFAULT_MQTT_CONFIG = {
  brokerUrl: "wss://lf0d78dd.ala.asia-southeast1.emqxsl.com:8084/mqtt",
  host: "lf0d78dd.ala.asia-southeast1.emqxsl.com",
  port: 8084,
  path: "/mqtt",
  username: "web_client",
  password: "web_client"
};
