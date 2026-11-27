/**
 * VoiceAssistantController - Asisten Suara Cerdas Ala Siri (Gemini 2.5 Flash)
 * Mendukung percakapan bebas multi-turn, tanya jawab umum, dan kontrol Smart Home real-time.
 */
import { DEVICE_DEFINITIONS } from "./devices.js";

const GEMINI_WORKER_URL = "https://euro-smarthome.vinscodex05.workers.dev";
const MAX_HISTORY_TURNS = 8; // Menyimpan 4 pasang tanya-jawab terakhir

export class VoiceAssistantController {
  constructor({ deviceStore, onExecuteCommand, onRequestDoorConfirm, onNotify, onSpeakText }) {
    this.deviceStore = deviceStore;
    this.onExecuteCommand = onExecuteCommand;
    this.onRequestDoorConfirm = onRequestDoorConfirm;
    this.onNotify = onNotify;
    this.onSpeakText = onSpeakText;

    this.isListening = false;
    this.isProcessing = false;
    this.recognition = null;
    this.chatHistory = [];
    this.latestTelemetry = null;

    this.cacheDomElements();
    this.initSpeechRecognition();
    this.bindEvents();
  }

  cacheDomElements() {
    this.btnVoice =
      document.getElementById("btn-voice-hp") ||
      document.getElementById("btn-hp-voice") ||
      document.getElementById("btn-voice") ||
      Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent.toLowerCase().includes("suara hp")
      );

    this.statusBadge =
      document.getElementById("voice-status-badge") ||
      document.getElementById("voice-status");

    this.transcriptEl =
      document.getElementById("voice-transcript") ||
      document.getElementById("detected-command");

    this.responseEl =
      document.getElementById("voice-response") ||
      document.getElementById("system-response");
  }

  bindEvents() {
    this.btnVoice?.addEventListener("click", () => {
      if (this.isListening) {
        this.stopListening();
      } else {
        this.startListening();
      }
    });

    // Mendukung klik tombol chip contoh perintah di dashboard
    document.querySelectorAll("[data-voice-command], .voice-chip, .quick-voice-btn").forEach((chip) => {
      chip.addEventListener("click", () => {
        const cmdText =
          chip.getAttribute("data-voice-command") ||
          chip.textContent.replace(/^["']|["']$/g, "").trim();
        if (cmdText) {
          this.processUserSpeech(cmdText);
        }
      });
    });
  }

  initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      this.setStatus("TIDAK DIDUKUNG");
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.lang = "id-ID";
    this.recognition.interimResults = false;
    this.recognition.maxAlternatives = 1;
    this.recognition.continuous = false;

    this.recognition.onstart = () => {
      this.isListening = true;
      this.setStatus("MENDENGARKAN...");
      if (this.btnVoice) this.btnVoice.classList.add("is-listening");
      this.setTranscript("Silakan bicara sekarang...");
    };

    this.recognition.onresult = (event) => {
      const spokenText = event.results?.[0]?.[0]?.transcript?.trim() || "";
      if (spokenText) {
        this.processUserSpeech(spokenText);
      }
    };

    this.recognition.onerror = (event) => {
      this.isListening = false;
      if (this.btnVoice) this.btnVoice.classList.remove("is-listening");
      if (event.error === "no-speech") {
        this.setStatus("SIAP");
        this.setTranscript("Tidak ada suara terdeteksi. Tekan tombol untuk mencoba lagi.");
      } else {
        this.setStatus("ERROR MIKROFON");
        this.onNotify?.(`Gagal mengakses mikrofon: ${event.error}`, "warning");
      }
    };

    this.recognition.onend = () => {
      this.isListening = false;
      if (this.btnVoice) this.btnVoice.classList.remove("is-listening");
      if (!this.isProcessing) {
        this.setStatus("SIAP");
      }
    };
  }

  startListening() {
    if (!this.recognition) {
      this.onNotify?.("Browser ini tidak mendukung pengenalan suara.", "error");
      return;
    }
    if (this.isProcessing) return;

    // Hentikan suara TTS yang sedang berbicara agar tidak masuk ke mikrofon
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    try {
      this.recognition.start();
    } catch {
      // Abaikan jika recognition sudah berjalan
    }
  }

  stopListening() {
    try {
      this.recognition?.stop();
    } catch {
      // Abaikan
    }
  }

  setStatus(text) {
    if (this.statusBadge) this.statusBadge.textContent = text;
  }

  setTranscript(text) {
    if (this.transcriptEl) this.transcriptEl.textContent = text;
  }

  setResponse(text, isError = false) {
    if (this.responseEl) {
      this.responseEl.textContent = text;
      this.responseEl.style.color = isError ? "#f87171" : "";
    }
  }

  /**
   * Mengumpulkan kondisi terkini rumah (status 5 perangkat + telemetri sensor)
   * agar Gemini bisa menjawab pertanyaan status seperti Siri.
   */
  buildHouseContext() {
    const rawDevices = this.deviceStore?.getAll?.() || {};
    const list = Array.isArray(rawDevices) ? rawDevices : Object.values(rawDevices);

    const statusLines = list.map((d) => {
      const key = d.key || d.id || d.device;
      const name = DEVICE_DEFINITIONS[key]?.name || d.name || key;
      return `- ${name} (${key}): ${d.state || "UNKNOWN"}`;
    });

    const espOnline = this.deviceStore?.espAvailable ? "ONLINE" : "OFFLINE";
    const tempText = document.getElementById("telemetry-temp")?.textContent?.trim() || "tidak terbaca";
    const humText = document.getElementById("telemetry-hum")?.textContent?.trim() || "tidak terbaca";
    const rainText = document.getElementById("telemetry-rain")?.textContent?.trim() || "kering/tidak terbaca";

    return [
      `Status Koneksi ESP32: ${espOnline}`,
      `Sensor Lingkungan: Suhu ${tempText}, Kelembapan ${humText}, Cuaca/Hujan: ${rainText}`,
      `Status Perangkat Rumah Saat Ini:`,
      ...statusLines
    ].join("\n");
  }

  buildSystemPrompt() {
    const nowStr = new Date().toLocaleString("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });

    return `Kamu adalah asisten suara pribadi yang cerdas, ramah, hangat, dan sigap seperti Apple Siri, terintegrasi dengan sistem rumah pintar (Smart Home).
Waktu saat ini: ${nowStr}.

${this.buildHouseContext()}

ATURAN PERILAKU & RESPON:
1. Kamu BISA diajak mengobrol apa saja di luar topik Smart Home: menyapa balik (misal "Hai juga! Ada yang bisa saya bantu?"), bercanda ringan, menjawab pengetahuan umum, berhitung, memberi saran, atau menanyakan kabar.
2. Jika pengguna meminta mengontrol perangkat rumah, sertakan daftar aksinya di dalam array "commands". Pemetaan device & action yang valid HANYA:
   - "lampu1" (Lampu 1 / Lampu Utama): "ON" atau "OFF"
   - "lampu2" (Lampu 2 / Lampu LED): "ON" atau "OFF"
   - "kipas" (Kipas Angin): "ON" atau "OFF"
   - "jemuran" (Jemuran Otomatis): "OPEN", "CLOSE", atau "STOP"
   - "pintu" (Pintu Utama): "OPEN" atau "CLOSE"
3. Jika pengguna hanya mengobrol biasa atau sekadar bertanya status (tanpa menyuruh mengubah perangkat), isi "commands" dengan array kosong [].
4. GAYA BICARA WAJIB (PENTING UNTUK TEXT-TO-SPEECH):
   - Gunakan Bahasa Indonesia lisan yang natural, sopan, akrab, dan tidak kaku seperti robot.
   - Jawaban "reply" WAJIB singkat dan padat (maksimal 2 kalimat pendek, di bawah 170 karakter jika memungkinkan) karena akan langsung dibacakan oleh speaker.
   - DILARANG keras memakai tanda bintang (*), pagar (#), bullet point, atau emoji di dalam teks "reply".

FORMAT OUTPUT WAJIB JSON MURNI:
{
  "reply": "Kalimat jawaban lisan kamu di sini",
  "commands": [
    { "device": "nama_device", "action": "AKSI" }
  ]
}`;
  }

  async processUserSpeech(userText) {
    this.isProcessing = true;
    this.setStatus("BERPIKIR...");
    this.setTranscript(`"${userText}"`);
    this.setResponse("Sedang memproses...");

    // Tambahkan ucapan pengguna ke riwayat percakapan
    this.chatHistory.push({
      role: "user",
      parts: [{ text: userText }]
    });
    if (this.chatHistory.length > MAX_HISTORY_TURNS) {
      this.chatHistory = this.chatHistory.slice(-MAX_HISTORY_TURNS);
    }

    try {
      const response = await fetch(GEMINI_WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: this.buildSystemPrompt() }]
          },
          contents: this.chatHistory,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 350,
            responseMimeType: "application/json",
            thinkingConfig: { thinkingBudget: 0 }
          }
        })
      });

      if (!response.ok) {
        const errDetail = await response.text();
        throw new Error(`HTTP ${response.status}: ${errDetail.slice(0, 120)}`);
      }

      const data = await response.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const parsed = this.parseGeminiJson(rawText);

      // Simpan jawaban AI ke riwayat agar percakapan berikutnya tetap nyambung
      this.chatHistory.push({
        role: "model",
        parts: [{ text: JSON.stringify(parsed) }]
      });

      this.setResponse(parsed.reply, false);
      this.speakIndonesian(parsed.reply);

      // Jalankan perintah perangkat jika ada
      if (Array.isArray(parsed.commands) && parsed.commands.length > 0) {
        this.executeParsedCommands(parsed.commands);
      }
    } catch (err) {
      const fallbackMsg = "Maaf, koneksi ke asisten suara sedang terganggu. Coba ulangi sebentar lagi ya.";
      this.setResponse(fallbackMsg, true);
      this.speakIndonesian(fallbackMsg);
      this.onNotify?.(`Error Gemini AI: ${err.message}`, "error");
    } finally {
      this.isProcessing = false;
      this.setStatus("SIAP");
    }
  }

  parseGeminiJson(rawText) {
    const cleaned = rawText.replace(/```json|```/gi, "").trim();
    try {
      const obj = JSON.parse(cleaned);
      return {
        reply: String(obj.reply || "Siap, ada lagi yang bisa dibantu?").replace(/[*#_`]/g, ""),
        commands: Array.isArray(obj.commands) ? obj.commands : []
      };
    } catch {
      // Jika AI membalas teks biasa non-JSON, tetap ucapkan dengan alami
      const plainReply = cleaned.replace(/[*#_`{}"]/g, "").trim() || "Halo, ada yang bisa saya bantu?";
      return { reply: plainReply, commands: [] };
    }
  }

  executeParsedCommands(commands) {
    const validMap = {
      lampu1: ["ON", "OFF"],
      lampu2: ["ON", "OFF"],
      kipas: ["ON", "OFF"],
      jemuran: ["OPEN", "CLOSE", "STOP"],
      pintu: ["OPEN", "CLOSE"]
    };

    commands.forEach((cmd, idx) => {
      const device = String(cmd?.device || "").toLowerCase().trim();
      const action = String(cmd?.action || "").toUpperCase().trim();

      if (!validMap[device] || !validMap[device].includes(action)) return;

      setTimeout(() => {
        if (device === "pintu") {
          // Tetap melewati modal verifikasi PIN keamanan pintu
          this.onRequestDoorConfirm?.(action);
        } else {
          this.onExecuteCommand?.(device, action, "hp-voice");
        }
      }, idx * 250);
    });
  }

  handleCommandOutcome({ deviceKey, state, success, isTimeout }) {
    if (isTimeout || !success) {
      const devName = DEVICE_DEFINITIONS[deviceKey]?.name || deviceKey;
      const errMsg = `Maaf, ${devName} belum merespons perintah.`;
      this.setResponse(errMsg, true);
      this.speakIndonesian(errMsg);
    }
  }

  speakIndonesian(text) {
    const cleanSpeech = String(text || "")
      .replace(/[*#_~`]/g, "")
      .trim();
    if (!cleanSpeech) return;

    // 1. Kirim ke speaker fisik ESP32 MAX98357A via MQTT
    this.onSpeakText?.(cleanSpeech);

    // 2. Bacakan juga melalui speaker browser HP/laptop
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanSpeech);
    utterance.lang = "id-ID";
    utterance.rate = 1.02;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  }
}
