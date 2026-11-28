/**
 * State Store & Manajemen Perangkat Smart Home
 * Menjamin status hanya berubah berdasarkan konfirmasi aktual ESP32
 */
import { DEVICE_KEYS, TOPICS } from "../config/mqtt-contract.js";

const COMMAND_TIMEOUT_MS = 7000;

export const DEVICE_DEFINITIONS = {
  jemuran: {
    key: "jemuran",
    name: "Jemuran Otomatis",
    topicCommand: TOPICS.devices.jemuran.command,
    topicState: TOPICS.devices.jemuran.state,
    controls: [
      { action: "OPEN", label: "Buka", style: "btn-success" },
      { action: "CLOSE", label: "Tutup", style: "btn-outline" },
      { action: "STOP", label: "Stop", style: "btn-warning" }
    ],
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7h18M6 7v11M18 7v11M8 11h8M9 15h6"/></svg>`
  },
  kipas: {
    key: "kipas",
    name: "Kipas Angin",
    topicCommand: TOPICS.devices.kipas.command,
    topicState: TOPICS.devices.kipas.state,
    controls: [
      { action: "ON", label: "Hidupkan", style: "btn-success" },
      { action: "OFF", label: "Matikan", style: "btn-outline" }
    ],
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="2.5"/><path d="M12 9.5C12 6 15 4 17 6s0 5.5-3.5 6M14.5 12c3.5 0 5.5 3 3.5 5s-5.5 0-6-3.5M12 14.5c0 3.5-3 5.5-5 3.5s0-5.5 3.5-6M9.5 12C6 12 4 9 6 7s5.5 0 6 3.5"/></svg>`
  },
  lampu1: {
    key: "lampu1",
    name: "Lampu 1 (Lampu Pijar)",
    hasDimmer: true,
    topicCommand: TOPICS.devices.lampu1.command,
    topicState: TOPICS.devices.lampu1.state,
    controls: [
      { action: "ON", label: "Hidupkan", style: "btn-success" },
      { action: "OFF", label: "Matikan", style: "btn-outline" }
    ],
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.85c.5.42.85 1.03.95 1.65h5.1c.1-.62.45-1.23.95-1.65A6 6 0 0 0 12 3z"/></svg>`
  },
  lampu2: {
    key: "lampu2",
    name: "Lampu 2 (4 LED)",
    topicCommand: TOPICS.devices.lampu2.command,
    topicState: TOPICS.devices.lampu2.state,
    controls: [
      { action: "ON", label: "Hidupkan", style: "btn-success" },
      { action: "OFF", label: "Matikan", style: "btn-outline" }
    ],
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.85c.5.42.85 1.03.95 1.65h5.1c.1-.62.45-1.23.95-1.65A6 6 0 0 0 12 3z"/></svg>`
  },
  pintu: {
    key: "pintu",
    name: "Pintu Utama",
    topicCommand: TOPICS.devices.pintu.command,
    topicState: TOPICS.devices.pintu.state,
    requiresConfirmation: true,
    controls: [
      { action: "OPEN", label: "Buka Pintu", style: "btn-warning" },
      { action: "CLOSE", label: "Tutup Pintu", style: "btn-outline" }
    ],
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M3 21h18"/><circle cx="15" cy="12" r="1" fill="currentColor"/></svg>`
  }
};

export class DeviceStore {
  constructor(onChange, onTimeout) {
    this.onChange = onChange;
    this.onTimeout = onTimeout;
    this.espAvailable = false;
    this.states = {};
    this.timers = {};

    DEVICE_KEYS.forEach((key) => {
      this.states[key] = {
        state: "UNKNOWN",
        brightness: key === "lampu1" ? 0 : null,
        online: false,
        detail: {},
        lastUpdated: null,
        pendingRequestId: null,
        pendingAction: null,
        pendingSource: null
      };
    });
  }

  getAll() {
    return DEVICE_KEYS.map((key) => ({
      ...DEVICE_DEFINITIONS[key],
      ...this.states[key]
    }));
  }

  getDevice(key) {
    return {
      ...DEVICE_DEFINITIONS[key],
      ...this.states[key]
    };
  }

  isBusy(key) {
    return Boolean(this.states[key]?.pendingRequestId);
  }

  markCommandPending(key, requestId, action, source = "web") {
    if (!this.states[key]) return;
    this.clearTimer(key);

    this.states[key].pendingRequestId = requestId;
    this.states[key].pendingAction = action;
    this.states[key].pendingSource = source;

    this.timers[key] = setTimeout(() => {
      if (this.states[key].pendingRequestId === requestId) {
        const prevSource = this.states[key].pendingSource;
        this.states[key].pendingRequestId = null;
        this.states[key].pendingAction = null;
        this.states[key].pendingSource = null;
        this.onTimeout?.(key, action, requestId, prevSource);
        this.onChange?.();
      }
    }, COMMAND_TIMEOUT_MS);

    this.onChange?.();
  }

  applyConfirmedState(validatedData) {
    const { device, state, brightness, online, detail, timestamp, requestId } = validatedData;
    if (!this.states[device]) return null;

    const prevState = this.states[device].state;
    const pendingSource = this.states[device].pendingSource;
    const wasConfirmed =
      this.states[device].pendingRequestId &&
      (!requestId || this.states[device].pendingRequestId === requestId);

    this.clearTimer(device);
    this.states[device].state = state;
    this.states[device].online = Boolean(online) && this.espAvailable;
    this.states[device].detail = detail || {};
    this.states[device].lastUpdated = timestamp ? new Date(timestamp * 1000) : new Date();
    this.states[device].pendingRequestId = null;
    this.states[device].pendingAction = null;
    this.states[device].pendingSource = null;

    if (device === "lampu1") {
      if (typeof brightness === "number") {
        this.states[device].brightness = Math.max(0, Math.min(100, Math.round(brightness)));
      } else if (state === "OFF") {
        this.states[device].brightness = 0;
      } else if (state === "ON" && this.states[device].brightness === 0) {
        this.states[device].brightness = 100;
      }
    }

    this.onChange?.();
    return {
      prevState,
      newState: state,
      brightness: this.states[device].brightness,
      wasConfirmed,
      pendingSource
    };
  }

  setEspAvailability(isOnline) {
    this.espAvailable = Boolean(isOnline);
    DEVICE_KEYS.forEach((key) => {
      if (!this.espAvailable) {
        this.states[key].online = false;
      } else if (this.states[key].state !== "UNKNOWN") {
        this.states[key].online = true;
      }
    });
    this.onChange?.();
  }

  clearTimer(key) {
    if (this.timers[key]) {
      clearTimeout(this.timers[key]);
      delete this.timers[key];
    }
  }
}
