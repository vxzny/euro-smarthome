/**
 * Entry Point Utama Aplikasi Smart Home Dashboard (Manual Web + Voice HP + XiaoZhi MCP)
 */
import { DEFAULT_MQTT_CONFIG } from "../config/mqtt-contract.js";
import { DeviceStore, DEVICE_DEFINITIONS } from "./devices.js";
import { NotificationManager } from "./notifications.js";
import { DashboardUI } from "./dashboard.js";
import { MqttService } from "./mqtt.js";
import { VoiceAssistantController } from "./voice.js";

/**
 * Mengambil konfigurasi MQTT dari localStorage jika tersedia,
 * atau otomatis memakai DEFAULT_MQTT_CONFIG dari config/mqtt-contract.js pada perangkat baru.
 */
function resolveStartupMqttConfig(currentConfig = {}) {
  if (currentConfig?.host && currentConfig?.password) {
    return currentConfig;
  }

  let parsedHost = DEFAULT_MQTT_CONFIG?.host || "";
  let parsedPort = DEFAULT_MQTT_CONFIG?.port || 8084;
  let parsedPath = DEFAULT_MQTT_CONFIG?.path || "/mqtt";

  if (DEFAULT_MQTT_CONFIG?.brokerUrl) {
    try {
      const url = new URL(DEFAULT_MQTT_CONFIG.brokerUrl);
      parsedHost = url.hostname;
      parsedPort = Number(url.port) || 8084;
      parsedPath = url.pathname || "/mqtt";
    } catch {
      // Abaikan jika format URL tidak standar
    }
  }

  return {
    ...currentConfig,
    brokerUrl: DEFAULT_MQTT_CONFIG?.brokerUrl || "",
    host: parsedHost,
    port: parsedPort,
    path: parsedPath,
    username: DEFAULT_MQTT_CONFIG?.username || currentConfig?.username || "",
    password: DEFAULT_MQTT_CONFIG?.password || currentConfig?.password || ""
  };
}

document.addEventListener("DOMContentLoaded", () => {
  const notifier = new NotificationManager();
  let voiceController = null;

  const deviceStore = new DeviceStore(
    () => {
      ui.renderDevices(deviceStore.getAll(), mqttService.connected);
    },
    (deviceKey, action, requestId, pendingSource) => {
      const devName = DEVICE_DEFINITIONS[deviceKey]?.name || deviceKey;
      notifier.updateCommandStatus(requestId, "TIMEOUT");
      notifier.showToast(
        `Timeout: ESP32 tidak merespons perintah ${action} pada ${devName}.`,
        "error"
      );
      if (pendingSource === "hp-voice") {
        voiceController?.handleCommandOutcome({
          deviceKey,
          state: null,
          success: false,
          isTimeout: true
        });
      }
    }
  );

  const mqttService = new MqttService({
    onStatusChange: (status, host) => {
      ui.updateMqttStatus(status, host);
      ui.renderDevices(deviceStore.getAll(), status === "CONNECTED");
    },
    onDeviceState: (stateData) => {
      const result = deviceStore.applyConfirmedState(stateData);
      const devName = DEVICE_DEFINITIONS[stateData.device]?.name || stateData.device;
      if (stateData.requestId) {
        notifier.updateCommandStatus(stateData.requestId, "CONFIRMED");
      }
      if (result?.wasConfirmed) {
        notifier.showToast(`${devName} berhasil diubah ke ${stateData.state}`, "success");
        if (result.pendingSource === "hp-voice" || stateData.source === "hp-voice") {
          voiceController?.handleCommandOutcome({
            deviceKey: stateData.device,
            state: stateData.state,
            success: true,
            isTimeout: false
          });
        }
      }
      notifier.addActivityLog(
        `${devName} status aktual: ${stateData.state}`,
        stateData.source || "esp32"
      );
    },
    onSystemStatus: (telemetry) => {
      ui.updateEspTelemetry(telemetry, deviceStore.espAvailable);
    },
    onAvailability: (isOnline) => {
      deviceStore.setEspAvailability(isOnline);
      ui.updateEspTelemetry(null, isOnline);
      notifier.addActivityLog(
        `Status koneksi ESP32: ${isOnline ? "ONLINE" : "OFFLINE (LWT)"}`,
        "broker"
      );
      notifier.showToast(
        isOnline ? "Perangkat ESP32 terhubung ke broker." : "Peringatan: ESP32 terputus (OFFLINE).",
        isOnline ? "success" : "warning"
      );
    },
    onError: (msg) => {
      notifier.showToast(msg, "warning");
    }
  });

  function dispatchDeviceCommand(device, action, source = "web", meta = {}) {
    if (device === "pintu" && !mqttService.verifyDoorPin(meta.enteredPin)) {
      notifier.showToast("PIN keamanan pintu salah. Perintah dibatalkan.", "error");
      if (source === "hp-voice") {
        voiceController?.setResponse("PIN keamanan pintu salah. Perintah dibatalkan.", true);
      }
      return;
    }

    if (deviceStore.isBusy(device)) {
      notifier.showToast("Tunggu proses perintah sebelumnya selesai.", "warning");
      return;
    }

    try {
      const cmd = mqttService.publishCommand(device, action, source);
      const devName = DEVICE_DEFINITIONS[device]?.name || device;
      deviceStore.markCommandPending(device, cmd.requestId, action, source);
      notifier.addCommandLog({
        requestId: cmd.requestId,
        deviceName: devName,
        action: cmd.action,
        source,
        status: "PENDING"
      });
      notifier.showToast(`Mengirim perintah ${action} ke ${devName}...`, "info");
    } catch (err) {
      notifier.showToast(err.message, "error");
      if (source === "hp-voice") {
        voiceController?.setResponse(err.message, true);
      }
    }
  }

  const ui = new DashboardUI({
    onDeviceAction: (device, action, meta = {}) => {
      dispatchDeviceCommand(device, action, "web", meta);
    },
    onSaveMqttConfig: (config) => {
      mqttService.connect(config);
    },
    onDisconnectMqtt: () => {
      mqttService.disconnect();
      notifier.showToast("Koneksi MQTT diputuskan.", "info");
    }
  });

  voiceController = new VoiceAssistantController({
    deviceStore,
    onExecuteCommand: (device, action, source) => {
      dispatchDeviceCommand(device, action, source);
    },
    onRequestDoorConfirm: (action) => {
      ui.openDoorModal(action);
    },
    onNotify: (msg, type) => {
      notifier.showToast(msg, type);
    }
  });

  // Render awal seluruh kartu perangkat
  ui.renderDevices(deviceStore.getAll(), false);

  // Event tombol header & log
  document.getElementById("btn-open-settings")?.addEventListener("click", () => {
    ui.openSettingsModal(mqttService.config);
  });
  document.getElementById("btn-clear-commands")?.addEventListener("click", () => {
    notifier.clearCommands();
  });
  document.getElementById("btn-clear-activities")?.addEventListener("click", () => {
    notifier.clearActivities();
  });

  // Otomatis sambungkan ke MQTT Broker menggunakan konfigurasi tersimpan atau default
  const startupConfig = resolveStartupMqttConfig(mqttService.config);
  if (startupConfig?.host && startupConfig?.password) {
    mqttService.config = startupConfig;
    mqttService.connect(startupConfig);
  }
});
