/**
 * Modul Asisten Suara AI Langsung di Website (Gemini Function Calling + TTS Bahasa Indonesia)
 * Berjalan langsung di browser HP/PC tanpa membutuhkan server laptop (mcp-server)
 */
import { DEVICE_KEYS } from "../config/mqtt-contract.js";
import { DEVICE_DEFINITIONS } from "./devices.js";

// Tempel API Key dari Google AI Studio (sudah dibatasi untuk https://vxzny.github.io/*)
const GEMINI_API_KEY = "AQ.Ab8RN6KEFMgV8ou9v41O2VGMTq8rFIMCG5jB7YlfSmNOVMgSVg";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

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

    this.initSpeechRecognition();
    this.bindEvents();
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
    // Jika API Key belum diisi, langsung gunakan mode kata kunci lokal
    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes("TEMPEL_API_KEY")) {
      this.processLocalFallback(userText);
      return;
    }

    this.setResponse("AI sedang memproses perintah Anda...", false);

    const systemInstruction = `Kamu adalah asisten Smart Home cerdas bernama NEXUS AI yang terintegrasi langsung di dashboard rumah.
Jawablah pengguna dalam Bahasa Indonesia yang ramah, ringkas, dan natural (maksimal 2 kalimat agar enak didengar lewat speaker HP).
Gunakan data aktual berikut saat menjawab pertanyaan kondisi rumah:
${this.buildLiveHomeContext()}

Aturan kontrol:
- Jika pengguna meminta menyalakan/mematikan/membuka/menutup perangkat (baik perintah langsung maupun tersirat seperti "gerah" -> nyalakan kipas, "mendung/hujan" -> tutup jemuran, "gelap" -> nyalakan lampu), panggil function control_device atau control_all_devices.
- Jika ESP32 sedang OFFLINE, beritahu pengguna bahwa perangkat fisik sedang tidak terhubung ke internet.`;

    try {
      const res = await fetch(GEMINI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: "user", parts: [{ text: userText }] }],
          tools: SMART_HOME_TOOLS,
          generationConfig: { temperature: 0.3 }
        })
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

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
    } catch {
      // Fallback otomatis ke pengenalan lokal jika API AI gagal dijangkau
      this.processLocalFallback(userText);
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

  processLocalFallback(rawText) {
    const text = rawText.toLowerCase();
    const isOn = /\b(nyalakan|hidupkan|aktifkan|on)\b/.test(text);
    const isOff = /\b(matikan|nonaktifkan|off)\b/.test(text);
    const isOpen = /\b(buka|open)\b/.test(text);
    const isClose = /\b(tutup|kunci|close)\b/.test(text);

    this.activeBatch = null;

    if (/\b(lampu 1|lampu satu)\b/.test(text) && (isOn || isOff)) {
      this.onExecuteCommand?.("lampu1", isOn ? "ON" : "OFF", "hp-voice");
      return;
    }
    if (/\b(lampu 2|lampu dua)\b/.test(text) && (isOn || isOff)) {
      this.onExecuteCommand?.("lampu2", isOn ? "ON" : "OFF", "hp-voice");
      return;
    }
    if (/\bkipas\b/.test(text) && (isOn || isOff)) {
      this.onExecuteCommand?.("kipas", isOn ? "ON" : "OFF", "hp-voice");
      return;
    }
    if (/\bjemuran\b/.test(text) && (isOpen || isClose)) {
      this.onExecuteCommand?.("jemuran", isOpen ? "OPEN" : "CLOSE", "hp-voice");
      return;
    }
    if (/\bpintu\b/.test(text) && (isOpen || isClose)) {
      this.setResponse("Silakan konfirmasi akses pintu utama di layar.", true);
      this.onRequestDoorConfirm?.(isOpen ? "OPEN" : "CLOSE");
      return;
    }

    this.setResponse("Maaf, perintah tidak dikenali dan koneksi AI sedang tidak tersedia.", true);
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
