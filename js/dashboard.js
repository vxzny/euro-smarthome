/**
 * Pengendali Tampilan UI Dashboard, Chart.js Telemetri, dan Modal Interaktif
 */
export class DashboardUI {
  constructor({ onDeviceAction, onSaveMqttConfig, onDisconnectMqtt }) {
    this.onDeviceAction = onDeviceAction;
    this.onSaveMqttConfig = onSaveMqttConfig;
    this.onDisconnectMqtt = onDisconnectMqtt;
    this.pendingDoorCommand = null;
    this.chart = null;

    this.devicesGrid = document.getElementById("devices-grid");
    this.initClock();
    this.initChart();
    this.bindModals();
  }

  initClock() {
    const timeEl = document.getElementById("header-time");
    const dateEl = document.getElementById("header-date");

    const tick = () => {
      const now = new Date();
      if (timeEl) {
        timeEl.textContent = now.toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        });
      }
      if (dateEl) {
        dateEl.textContent = now.toLocaleDateString("id-ID", {
          weekday: "long",
          day: "numeric",
          month: "short",
          year: "numeric"
        });
      }
    };
    tick();
    setInterval(tick, 1000);
  }

  initChart() {
    const canvas = document.getElementById("telemetry-chart");
    if (!canvas || typeof window.Chart === "undefined") return;

    this.chart = new window.Chart(canvas, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "Sinyal Wi-Fi ESP32 (dBm)",
            data: [],
            borderColor: "#38bdf8",
            backgroundColor: "rgba(56, 189, 248, 0.14)",
            borderWidth: 2,
            tension: 0.35,
            fill: true,
            pointRadius: 3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: "#94a3b8", font: { size: 12 } }
          }
        },
        scales: {
          x: {
            ticks: { color: "#64748b", maxTicksLimit: 8 },
            grid: { color: "rgba(148, 163, 184, 0.08)" }
          },
          y: {
            suggestedMin: -90,
            suggestedMax: -30,
            ticks: { color: "#64748b" },
            grid: { color: "rgba(148, 163, 184, 0.08)" }
          }
        }
      }
    });
  }

  pushTelemetryPoint(rssi) {
    if (!this.chart || typeof rssi !== "number") return;
    const label = new Date().toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    this.chart.data.labels.push(label);
    this.chart.data.datasets[0].data.push(rssi);

    if (this.chart.data.labels.length > 15) {
      this.chart.data.labels.shift();
      this.chart.data.datasets[0].data.shift();
    }
    this.chart.update("none");
  }

  updateMqttStatus(status, brokerHost = "") {
    const pill = document.getElementById("mqtt-status-pill");
    const text = document.getElementById("mqtt-status-text");
    const hostEl = document.getElementById("info-broker-host");

    if (hostEl && brokerHost) hostEl.textContent = brokerHost;
    if (!pill || !text) return;

    pill.classList.remove("status-online", "status-connecting", "status-offline");
    if (status === "CONNECTED") {
      pill.classList.add("status-online");
      text.textContent = "MQTT WSS CONNECTED";
    } else if (status === "CONNECTING") {
      pill.classList.add("status-connecting");
      text.textContent = "CONNECTING WSS...";
    } else {
      pill.classList.add("status-offline");
      text.textContent = "MQTT DISCONNECTED";
    }
  }

  updateEspTelemetry(data, isOnline) {
    const badge = document.getElementById("esp32-lwt-badge");
    if (badge) {
      badge.className = `badge-pill ${isOnline ? "badge-online" : "badge-offline"}`;
      badge.textContent = isOnline ? "ESP32 ONLINE" : "ESP32 OFFLINE";
    }
    if (!data) return;

    if (data.device) document.getElementById("info-esp-id").textContent = data.device;
    if (data.ip) document.getElementById("info-esp-ip").textContent = data.ip;
    if (typeof data.rssi === "number") {
      document.getElementById("info-esp-rssi").textContent = `${data.rssi} dBm`;
      this.pushTelemetryPoint(data.rssi);
    }
    if (typeof data.uptimeSec === "number") {
      const mins = Math.floor(data.uptimeSec / 60);
      const heapKb = data.freeHeap ? `${Math.round(data.freeHeap / 1024)} KB` : "-";
      document.getElementById("info-esp-uptime").textContent = `${mins} mnt • Heap ${heapKb}`;
    }
  }

  renderDevices(devices, mqttConnected) {
    if (!this.devicesGrid) return;

    const onlineCount = devices.filter((d) => d.online).length;
    const offlineCount = devices.length - onlineCount;

    document.getElementById("kpi-total").textContent = String(devices.length);
    document.getElementById("kpi-online").textContent = String(onlineCount);
    document.getElementById("kpi-offline").textContent = String(offlineCount);

    const sysStatusEl = document.getElementById("kpi-system-status");
    if (sysStatusEl) {
      sysStatusEl.textContent = !mqttConnected
        ? "DISCONNECTED"
        : onlineCount > 0
        ? "OPERASIONAL"
        : "ESP32 OFFLINE";
    }

    this.devicesGrid.innerHTML = devices
      .map((dev) => {
        const isActiveState = ["ON", "OPEN", "UNLOCKED"].includes(dev.state);
        const stateClass =
          dev.state === "UNKNOWN"
            ? "state-unknown"
            : dev.state === "MOVING"
            ? "state-moving"
            : isActiveState
            ? "state-on"
            : "state-off";

        const isBusy = Boolean(dev.pendingRequestId);
        const lastTime = dev.lastUpdated
          ? dev.lastUpdated.toLocaleTimeString("id-ID")
          : "Belum ada data";

        const subdetail = this.formatDeviceSubdetail(dev);
        const controlsClass =
          dev.controls.length === 3 ? "device-controls three-cols" : "device-controls";

        const buttonsHtml = dev.controls
          .map((ctrl) => {
            const isThisPending = isBusy && dev.pendingAction === ctrl.action;
            const disabledAttr = !mqttConnected || isBusy ? "disabled" : "";
            return `
              <button
                type="button"
                class="btn ${ctrl.style}"
                data-device="${dev.key}"
                data-action="${ctrl.action}"
                ${disabledAttr}
              >
                ${isThisPending ? `<span class="spinner"></span>` : ""}
                <span>${isThisPending ? "Proses..." : ctrl.label}</span>
              </button>
            `;
          })
          .join("");

        return `
          <article class="device-card ${isActiveState && dev.online ? "is-active" : ""}">
            <div class="device-card-top">
              <div class="device-identity">
                <div class="device-icon">${dev.iconSvg}</div>
                <div>
                  <h3 class="device-name">${dev.name}</h3>
                  <span class="device-topic">${dev.topicState}</span>
                </div>
              </div>
              <span class="conn-badge ${dev.online ? "conn-online" : "conn-offline"}">
                ${dev.online ? "ONLINE" : "OFFLINE"}
              </span>
            </div>

            <div class="device-state-box">
              <div class="state-main-row">
                <span class="state-label">Status Aktual</span>
                <span class="state-value ${stateClass}">${dev.state}</span>
              </div>
              <span class="device-subdetail">${subdetail}</span>
            </div>

            <div class="${controlsClass}">
              ${buttonsHtml}
            </div>

            <div class="device-footer">
              <span>${isBusy ? "Menunggu konfirmasi ESP32..." : "Siap"}</span>
              <span>Update: ${lastTime}</span>
            </div>
          </article>
        `;
      })
      .join("");

    this.devicesGrid.querySelectorAll("button[data-device]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const device = btn.dataset.device;
        const action = btn.dataset.action;
        if (device === "pintu") {
          this.openDoorModal(action);
        } else {
          this.onDeviceAction?.(device, action);
        }
      });
    });
  }

  formatDeviceSubdetail(dev) {
    const d = dev.detail || {};
    if (dev.key === "jemuran") {
      const motor = d.motor || (dev.state === "MOVING" ? "BERGERAK" : "STANDBY");
      const sensor = d.rain ? `Hujan: ${d.rain}` : "Aktuator Siap";
      return `Motor: ${motor} • ${sensor}`;
    }
    if (dev.key === "pintu") {
      const angleInfo = typeof d.angle === "number" ? ` (${d.angle}°)` : "";
      const posisi =
        dev.state === "OPEN"
          ? `Terbuka${angleInfo}`
          : dev.state === "CLOSED"
          ? `Tertutup${angleInfo}`
          : dev.state;
      return `Aktuator: Motor Servo • Posisi: ${posisi}`;
    }
    return `Koneksi Node: ${dev.online ? "Terhubung (QoS 1)" : "Menunggu ESP32"}`;
  }

  openDoorModal(action) {
    this.pendingDoorCommand = { device: "pintu", action };
    const desc = document.getElementById("door-modal-desc");
    const pinInput = document.getElementById("door-pin-input");
    if (desc) {
      desc.textContent = `Konfirmasi pengiriman perintah "${action}" ke Servo Pintu Utama? Tindakan ini akan dicatat di log keamanan.`;
    }
    if (pinInput) pinInput.value = "";
    document.getElementById("door-confirm-modal")?.classList.remove("hidden");
  }

  openSettingsModal(savedConfig) {
    if (savedConfig) {
      document.getElementById("cfg-host").value = savedConfig.host || "";
      document.getElementById("cfg-port").value = savedConfig.port || 8084;
      document.getElementById("cfg-path").value = savedConfig.path || "/mqtt";
      document.getElementById("cfg-username").value = savedConfig.username || "web_dashboard";
      document.getElementById("cfg-password").value = savedConfig.password || "";
      document.getElementById("cfg-door-pin").value = savedConfig.doorPin || "";
    }
    document.getElementById("mqtt-settings-modal")?.classList.remove("hidden");
  }

  closeModal(modalId) {
    document.getElementById(modalId)?.classList.add("hidden");
  }

  bindModals() {
    document.querySelectorAll("[data-close-modal]").forEach((el) => {
      el.addEventListener("click", () => this.closeModal(el.dataset.closeModal));
    });

    document.getElementById("btn-confirm-door")?.addEventListener("click", () => {
      if (!this.pendingDoorCommand) return;
      const enteredPin = document.getElementById("door-pin-input")?.value.trim() || "";
      const { device, action } = this.pendingDoorCommand;
      this.pendingDoorCommand = null;
      this.closeModal("door-confirm-modal");
      this.onDeviceAction?.(device, action, { enteredPin });
    });

    document.getElementById("mqtt-settings-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const config = {
        host: document.getElementById("cfg-host").value.trim(),
        port: Number(document.getElementById("cfg-port").value) || 8084,
        path: document.getElementById("cfg-path").value.trim() || "/mqtt",
        username: document.getElementById("cfg-username").value.trim(),
        password: document.getElementById("cfg-password").value,
        doorPin: document.getElementById("cfg-door-pin").value.trim()
      };
      this.closeModal("mqtt-settings-modal");
      this.onSaveMqttConfig?.(config);
    });

    document.getElementById("btn-disconnect-mqtt")?.addEventListener("click", () => {
      this.closeModal("mqtt-settings-modal");
      this.onDisconnectMqtt?.();
    });
  }
}