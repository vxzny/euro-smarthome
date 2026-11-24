/**
 * Modul Asisten Suara AI Langsung di Website (Gemini Function Calling + TTS Bahasa Indonesia)
 * API Key disimpan aman di localStorage browser (tidak terekspos di GitHub publik)
 */
import { DEVICE_KEYS } from "../config/mqtt-contract.js";
import { DEVICE_DEFINITIONS } from "./devices.js";

const STORAGE_KEY_API = "nexus_gemini_api_key";
const GEMINI_MODEL = "gemini-2.5-flash";

const SMART_HOME_TOOLS = [
  {
    functionDeclarations: [
      {
        name: "control_device",
        description:
          "Mengontrol satu perangkat Smart Home (lampu1, lampu2, kipas, jemuran, atau pintu).",
        parameters: {
          type: "OBJECT",
          properties: {
            device: {
              type: "STRING",
              enum: ["lampu1", "lampu2", "kipas", "jemuran", "pintu"],
              description: "Nama target perangkat."
            },
            action: {
              type: "STRING",
              enum: ["ON", "OFF", "OPEN", "CLOSE", "STOP"],
              description:
                "Gunakan ON/OFF untuk lampu1, lampu2, kipas. Gunakan OPEN/CLOSE/STOP untuk jemuran. Gunakan OPEN/CLOSE untuk pintu."
            }
          },
          required: ["device", "action"]
        }
      },
      {
        name: "control_all_devices",
        description:
          "Menghidupkan/membuka atau mematikan/menutup seluruh perangkat rumah sekaligus.",
        parameters: {
          type: "OBJECT",
          properties: {
            mode: {
              type: "STRING",
              enum: ["ON", "OFF"],
              description: "ON untuk mengaktifkan semua, OFF untuk mematikan semua."
            }
          },
          required: ["mode"]
        }
      }
    ]
  }
];

export class VoiceAssistantController {
  constructor({ deviceStore, onExecuteCommand, onRequestDoorConfirm, onNotify }) {
    this.deviceStore = deviceStore;
    this.onExecuteCommand = onExecuteCommand;
    this.onRequestDoorConfirm = onRequestDoorConfirm;
    this.onNotify = onNotify;

    this.isListening = false;
    this.recognition = null;
    this.activeBatch = null;

    this.micBtn = document.getElementById("btn-voice-toggle");
    this.micBtnLabel = document.getElementById("voice-btn-label");
    this.bannerEl = document.getElementById("voice-assistant-bar");
    this.statusBadgeEl = document.getElementById("voice-status-badge");
    this.transcriptEl = document.getElementById("voice-transcript-text");
    this.responseEl = document.getElementById("voice-response-text");

    this.initApiKeyUI();
    this.initSpeechRecognition();
    this.bindEvents();
  }

  getApiKey() {
    return (localStorage.getItem(STORAGE_KEY_API) || "").trim();
  }

  initApiKeyUI() {
    if (!this.bannerEl) return;

    // Tambahkan tombol kecil "Key AI" di samping badge status
    if (this.statusBadgeEl && !document.getElementById("btn-ai-key-toggle")) {
      const keyBtn = document.createElement("button");
      keyBtn.id = "btn-ai-key-toggle";
      keyBtn.type = "button";
      keyBtn.textContent = this.getApiKey() ? "Ganti Key AI" : "Pasang Key AI";
      keyBtn.style.cssText =
        "margin-left:8px;padding:3px 10px;font-size:11px;border-radius:999px;border:1px solid #38bdf8;background:rgba(56,189,248,0.12);color:#38bdf8;cursor:pointer;";
      this.statusBadgeEl.insertAdjacentElement("afterend", keyBtn);

      keyBtn.addEventListener("click", () => this.toggleKeyBox());
    }

    // Buat kotak input API Key di dalam panel suara (disimpan lokal di browser)
    const box = document.createElement("div");
    box.id = "ai-key-setup-box";
    box.style.cssText =
      "display:none;margin:10px 0;padding:10px;border-radius:10px;background:rgba(15,23,42,0.85);border:1px solid rgba(56,189,248,0.35);gap:8px;flex-wrap:wrap;align-items:center;";

    box.innerHTML = `
      <input id="input-gemini-key" type="password" placeholder="Tempel Gemini API Key (AIzaSy...) di sini"
        style="flex:1;min-width:200px;padding:8px 10px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#f8fafc;font-size:13px;" />
      <button id="btn-save-gemini-key" type="button"
        style="padding:8px 14px;border-radius:8px;border:none;background:#0ea5e9;color:#fff;font-weight:600;font-size:13px;cursor:pointer;">
        Simpan Key
      </button>
    `;

    this.bannerEl.appendChild(box);

    if (!this.getApiKey()) {
      box.style.display = "flex";
    }

    document.getElementById("btn-save-gemini-key")?.addEventListener("click", () => {
      const inputEl = document.getElementById("input-gemini-key");
      const val = (inputEl?.value || "").trim();
      if (!val.startsWith("AIza")) {
        this.onNotify?.("Format API Key tidak valid. Pastikan diawali AIza...", "warning");
        return;
      }
      localStorage.setItem(STORAGE_KEY_API, val);
      inputEl.value = "";
      box.style.display = "none";
      const toggleBtn = document.getElementById("btn-ai-key-toggle");
      if (toggleBtn) toggleBtn.textContent = "Ganti Key AI";
      this.setResponse("API Key AI tersimpan di browser ini. Silakan tekan Suara HP dan bicara bebas.", true);
      this.onNotify?.("API Key AI berhasil disimpan!", "success");
    });
  }

  toggleKeyBox() {
    const box = document.getElementById("ai-key-setup-box");
    if (!box) return;
    box.style.display = box.style.display === "none" ? "flex" : "none";
  }

  initSpeechRecognition() {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    this.recognition = new SpeechRecognition();
    this.recognition.lang = "id-ID";
    this.recognition.interimResults = true;
    this.recognition.continuous = false;
    this.recognition.maxAlternatives = 1;

    this.recognition.onstart = () => {
      this.isListening = true;
      this.updateListeningUI(true);
      this.setBannerText("Mendengarkan perintah suara Anda...", "Silakan bicara...");
    };

    this.recognition.onresult = (event) => {
      let interim = "";
      let finalText = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += transcript;
        else interim += transcript;
      }

      if (interim && this.transcriptEl) {
        this.transcriptEl.textContent = `"${interim}..."`;
      }

      if (finalText) {
        const cleanText = finalText.trim();
        if (this.transcriptEl) this.transcriptEl.textContent = `"${cleanText}"`;
        this.handleUserSpeech(cleanText);
      }
    };

    this.recognition.onerror = (event) => {
      this.isListening = false;
      this.updateListeningUI(false);
      const msg =
        event.error === "not-allowed"
          ? "Izin mikrofon ditolak browser. Aktifkan izin mikrofon pada pengaturan situs."
          : "Suara tidak tertangkap. Tekan tombol Suara HP dan coba lagi.";
      this.setResponse(msg);
      this.onNotify?.(msg, "warning");
    };

    this.recognition.onend = () => {
      this.isListening = false;
      this.updateListeningUI(false);
    };
  }

  bindEvents() {
    this.micBtn?.addEventListener("click", () => {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      this.toggleListening();
    });

    document.querySelectorAll("[data-voice-sample]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const sample = chip.dataset.voiceSample;
        if (this.bannerEl) this.bannerEl.classList.remove("hidden");
        if (this.transcriptEl) this.transcriptEl.textContent = `"${sample}"`;
        this.handleUserSpeech(sample);
      });
    });
  }

  toggleListening() {
    if (!this.recognition) {
      this.onNotify?.("Browser tidak mendukung Web Speech API. Gunakan Chrome.", "error");
      return;
    }
    if (this.bannerEl) this.bannerEl.classList.remove("hidden");

    if (this.isListening) {
      this.recognition.stop();
    } else {
      try {
        this.recognition.start();
      } catch {
        this.recognition.stop();
      }
    }
  }

  updateListeningUI(active) {
    if (!this.micBtn || !this.micBtnLabel) return;
    if (active) {
      this.micBtn.classList.add("is-listening");
      this.micBtnLabel.textContent = "Mendengarkan...";
      if (this.statusBadgeEl) {
        this.statusBadgeEl.textContent = "MIC AKTIF";
        this.statusBadgeEl.className = "badge-pill badge-online";
      }
    } else {
      this.micBtn.classList.remove("is-listening");
      this.micBtnLabel.textContent = "Suara HP";
      if (this.statusBadgeEl) {
        this.statusBadgeEl.textContent = "AI SIAP";
        this.statusBadgeEl.className = "badge-pill";
      }
    }
  }

  setBannerText(responseText, transcriptText) {
    if (this.bannerEl) this.bannerEl.classList.remove("hidden");
    if (transcriptText && this.transcriptEl) this.transcriptEl.textContent = transcriptText;
    if (responseText && this.responseEl) this.responseEl.textContent = responseText;
  }

  setResponse(text, shouldSpeak = false) {
    if (this.responseEl) this.responseEl.textContent = text;
    if (shouldSpeak) this.speakIndonesian(text);
  }

  speakIndonesian(text) {
    if (!("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "id-ID";
      utterance.rate = 1.03;

      const voices = window.speechSynthesis.getVoices();
      const idVoice = voices.find((v) => v.lang.toLowerCase().includes("id"));
      if (idVoice) utterance.voice = idVoice;

      window.speechSynthesis.speak(utterance);
    } catch {
      // Abaikan jika browser membatasi TTS
    }
  }

  buildLiveHomeContext() {
    const espStatus = this.deviceStore.espAvailable ? "ONLINE" : "OFFLINE";
    const devicesSummary = DEVICE_KEYS.map((key) => {
      const dev = this.deviceStore.getDevice(key);
      return `- ${DEVICE_DEFINITIONS[key].name} (${key}): ${dev.state}`;
    }).join("\n");

    const tempText = document.getElementById("info-esp-temp")?.textContent || "Belum terbaca";

    return `Status ESP32: ${espStatus}
Suhu & Kelembapan DHT22: ${tempText}
Status Perangkat Saat Ini:
${devicesSummary}`;
  }

  async handleUserSpeech(userText) {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      this.processLocalFallback(
        userText,
        "API Key AI belum dipasang (klik tombol Pasang Key AI di atas)."
      );
      return;
    }

    this.setResponse("AI sedang memproses perintah Anda...", false);

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const systemInstruction = `Kamu adalah asisten Smart Home cerdas bernama NEXUS AI yang terintegrasi langsung di dashboard rumah.
Jawablah pengguna dalam Bahasa Indonesia yang ramah, ringkas, dan natural (maksimal 2 kalimat agar enak didengar lewat speaker HP).
Gunakan data aktual berikut saat menjawab pertanyaan kondisi rumah:
${this.buildLiveHomeContext()}

Aturan kontrol:
- Jika pengguna meminta menyalakan/mematikan/membuka/menutup perangkat (baik perintah langsung maupun tersirat seperti "gerah" -> nyalakan kipas, "mendung/hujan" -> tutup jemuran, "gelap" -> nyalakan lampu), panggil function control_device atau control_all_devices.
- Jika ESP32 sedang OFFLINE, beritahu pengguna bahwa perangkat fisik sedang tidak terhubung ke internet.`;

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: "user", parts: [{ text: userText }] }],
          tools: SMART_HOME_TOOLS,
          generationConfig: { temperature: 0.3 }
        })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const reason = errJson?.error?.message || `HTTP ${res.status}`;
        throw new Error(reason);
      }

      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const functionCalls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);
      const textReply = parts.find((p) => p.text)?.text?.trim();

      if (functionCalls.length > 0) {
        this.executeAiFunctionCalls(functionCalls, textReply);
      } else if (textReply) {
        this.setResponse(textReply, true);
      } else {
        this.processLocalFallback(userText);
      }
    } catch (err) {
      this.processLocalFallback(userText, `AI error: ${err.message}`);
    }
  }

  executeAiFunctionCalls(functionCalls, aiTextReply) {
    const commands = [];
    let doorAction = null;

    functionCalls.forEach((call) => {
      if (call.name === "control_all_devices") {
        const turnOn = call.args?.mode === "ON";
        commands.push(
          { device: "lampu1", action: turnOn ? "ON" : "OFF" },
          { device: "lampu2", action: turnOn ? "ON" : "OFF" },
          { device: "kipas", action: turnOn ? "ON" : "OFF" },
          { device: "jemuran", action: turnOn ? "OPEN" : "CLOSE" }
        );
        doorAction = turnOn ? "OPEN" : "CLOSE";
      } else if (call.name === "control_device") {
        const dev = call.args?.device;
        const act = call.args?.action;
        if (dev === "pintu") {
          doorAction = act === "OPEN" ? "OPEN" : "CLOSE";
        } else if (DEVICE_KEYS.includes(dev)) {
          commands.push({ device: dev, action: act });
        }
      }
    });

    if (commands.length > 0) {
      this.activeBatch = {
        expected: commands.map((c) => c.device),
        results: {},
        customIntro: aiTextReply || null,
        hasDoorPrompt: Boolean(doorAction)
      };

      this.setResponse(aiTextReply || "Mengirim perintah AI ke perangkat...", false);
      commands.forEach((cmd) => {
        this.onExecuteCommand?.(cmd.device, cmd.action, "hp-voice");
      });
    }

    if (doorAction) {
      if (commands.length === 0) {
        this.setResponse(
          aiTextReply || "Permintaan pintu siap. Silakan tekan konfirmasi pada layar.",
          true
        );
      }
      this.onRequestDoorConfirm?.(doorAction);
    }
  }

  processLocalFallback(rawText, aiErrorNote = "") {
    const text = rawText.toLowerCase();
    // Mendukung kata dasar maupun kata berimbuhan (menyalakan, mematikan, membuka, menutup)
    const isOn = /(nyalakan|hidupkan|aktifkan|\bon\b)/.test(text);
    const isOff = /(matikan|nonaktifkan|\boff\b)/.test(text);
    const isOpen = /(buka|\bopen\b)/.test(text);
    const isClose = /(tutup|kunci|\bclose\b)/.test(text);

    this.activeBatch = null;

    if (/(lampu 1|lampu satu)/.test(text) && (isOn || isOff)) {
      this.onExecuteCommand?.("lampu1", isOn ? "ON" : "OFF", "hp-voice");
      return;
    }
    if (/(lampu 2|lampu dua)/.test(text) && (isOn || isOff)) {
      this.onExecuteCommand?.("lampu2", isOn ? "ON" : "OFF", "hp-voice");
      return;
    }
    if (/kipas/.test(text) && (isOn || isOff)) {
      this.onExecuteCommand?.("kipas", isOn ? "ON" : "OFF", "hp-voice");
      return;
    }
    if (/jemuran/.test(text) && (isOpen || isClose)) {
      this.onExecuteCommand?.("jemuran", isOpen ? "OPEN" : "CLOSE", "hp-voice");
      return;
    }
    if (/pintu/.test(text) && (isOpen || isClose)) {
      this.setResponse("Silakan konfirmasi akses pintu utama di layar.", true);
      this.onRequestDoorConfirm?.(isOpen ? "OPEN" : "CLOSE");
      return;
    }

    const detail = aiErrorNote ? ` (${aiErrorNote})` : "";
    this.setResponse(`Perintah belum dipahami${detail}.`, true);
  }

  handleCommandOutcome({ deviceKey, state, success, isTimeout }) {
    if (this.activeBatch && this.activeBatch.expected.includes(deviceKey)) {
      this.activeBatch.results[deviceKey] = { success: Boolean(success) && !isTimeout, state };
      if (Object.keys(this.activeBatch.results).length >= this.activeBatch.expected.length) {
        const batch = this.activeBatch;
        this.activeBatch = null;

        const summary = batch.expected
          .map((k) => {
            const name = DEVICE_DEFINITIONS[k]?.name || k;
            const r = batch.results[k];
            return r.success ? `${name} ${r.state}` : `${name} gagal`;
          })
          .join(", ");

        const doorNote = batch.hasDoorPrompt ? " Silakan konfirmasi pintu di layar." : "";
        this.setResponse(`Selesai: ${summary}.${doorNote}`, true);
      }
      return;
    }

    const devName = DEVICE_DEFINITIONS[deviceKey]?.name || deviceKey;
    if (isTimeout) {
      this.setResponse(`Gagal: ESP32 tidak merespons perintah untuk ${devName}.`, true);
    } else if (success) {
      this.setResponse(`${devName} berhasil diubah menjadi ${state}.`, true);
    }
  }
}
