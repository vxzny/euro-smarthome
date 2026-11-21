/**
 * Manajemen Notifikasi Toast, Riwayat Perintah, dan Riwayat Aktivitas
 */
export class NotificationManager {
  constructor() {
    this.toastContainer = document.getElementById("toast-container");
    this.commandListEl = document.getElementById("command-log-list");
    this.activityListEl = document.getElementById("activity-log-list");
    this.commands = [];
    this.activities = [];
  }

  showToast(message, type = "info") {
    if (!this.toastContainer) return;
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    this.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(16px)";
      setTimeout(() => toast.remove(), 250);
    }, 4200);
  }

  addCommandLog({ requestId, deviceName, action, source = "web", status = "PENDING" }) {
    this.commands.unshift({
      requestId,
      deviceName,
      action,
      source,
      status,
      time: new Date().toLocaleTimeString("id-ID")
    });
    if (this.commands.length > 25) this.commands.pop();
    this.renderCommands();
  }

  updateCommandStatus(requestId, status) {
    const item = this.commands.find((c) => c.requestId === requestId);
    if (item) {
      item.status = status;
      this.renderCommands();
    }
  }

  addActivityLog(text, source = "esp32") {
    this.activities.unshift({
      text,
      source,
      time: new Date().toLocaleTimeString("id-ID")
    });
    if (this.activities.length > 30) this.activities.pop();
    this.renderActivities();
  }

  clearCommands() {
    this.commands = [];
    this.renderCommands();
  }

  clearActivities() {
    this.activities = [];
    this.renderActivities();
  }

  renderCommands() {
    if (!this.commandListEl) return;
    if (this.commands.length === 0) {
      this.commandListEl.innerHTML = `<div class="log-empty">Belum ada perintah yang dikirim.</div>`;
      return;
    }

    this.commandListEl.innerHTML = this.commands
      .map((cmd) => {
        const badgeColor =
          cmd.status === "CONFIRMED"
            ? "conn-online"
            : cmd.status === "TIMEOUT"
            ? "conn-offline"
            : "badge-pill";
        return `
          <div class="log-item">
            <div class="log-item-main">
              <strong>${cmd.deviceName} &rarr; ${cmd.action}</strong>
              <span class="log-item-meta">${cmd.time} • Sumber: ${cmd.source.toUpperCase()} • ${cmd.requestId}</span>
            </div>
            <span class="conn-badge ${badgeColor}">${cmd.status}</span>
          </div>
        `;
      })
      .join("");
  }

  renderActivities() {
    if (!this.activityListEl) return;
    if (this.activities.length === 0) {
      this.activityListEl.innerHTML = `<div class="log-empty">Menunggu data status dari ESP32...</div>`;
      return;
    }

    this.activityListEl.innerHTML = this.activities
      .map(
        (act) => `
        <div class="log-item">
          <div class="log-item-main">
            <span>${act.text}</span>
            <span class="log-item-meta">${act.time} • Sumber: ${act.source.toUpperCase()}</span>
          </div>
        </div>
      `
      )
      .join("");
  }
}