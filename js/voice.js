/**
 * Modul Kontrol Suara & Umpan Balik Suara (TTS) Bahasa Indonesia untuk Browser HP
 * Menggunakan Web Speech API (SpeechRecognition & SpeechSynthesis) di atas HTTPS
 */
import { DEVICE_KEYS } from "../config/mqtt-contract.js";
import { DEVICE_DEFINITIONS } from "./devices.js";

export class VoiceAssistantController {
  constructor({ deviceStore, onExecuteCommand, onRequestDoorConfirm, onNotify }) {
    this.deviceStore = deviceStore;
    this.onExecuteCommand = onExecuteCommand;
    this.onRequestDoorConfirm = onRequestDoorConfirm;
    this.onNotify = onNotify;

    this.isListening = false;
    this.recognition = null;

    // Elemen UI Panel Suara
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

    if (!SpeechRecognition) {
      if (this.micBtn) {
        this.micBtn.title = "Browser ini tidak mendukung pengenalan suara langsung";
      }
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.lang = "id-ID";
    this.recognition.interimResults = true;
    this.recognition.continuous = false;
    this.recognition.maxAlternatives = 1;

    this.recognition.onstart = () => {
      this.isListening = true;
      this.updateListeningUI(true);
      this.setBannerText("Mendengarkan perintah suara Anda...", "Silakan ucapkan perintah...");
    };

    this.recognition.onresult = (event) => {
      let interimTranscript = "";
      let finalTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += text;
        } else {
          interimTranscript += text;
        }
      }

      if (interimTranscript && this.transcriptEl) {
        this.transcriptEl.textContent = `"${interimTranscript}..."`;
      }

      if (finalTranscript) {
        const cleanText = finalTranscript.trim();
        if (this.transcriptEl) {
          this.transcriptEl.textContent = `"${cleanText}"`;
        }
        this.processVoiceCommand(cleanText);
      }
    };

    this.recognition.onerror = (event) => {
      this.isListening = false;
      this.updateListeningUI(false);

      let errorMsg = "Gagal menangkap suara.";
      if (event.error === "not-allowed") {
        errorMsg = "Izin mikrofon HP ditolak. Aktifkan izin mikrofon di pengaturan browser.";
      } else if (event.error === "no-speech") {
        errorMsg = "Suara tidak terdengar. Tekan tombol Mic dan coba bicara lagi.";
      } else if (event.error === "network") {
        errorMsg = "Gangguan jaringan saat memproses suara.";
      }

      this.setResponse(errorMsg);
      this.onNotify?.(errorMsg, "warning");
    };

    this.recognition.onend = () => {
      this.isListening = false;
      this.updateListeningUI(false);
    };
  }

  bindEvents() {
    this.micBtn?.addEventListener("click", () => {
      // Membuka kunci audio TTS browser HP melalui interaksi tap pengguna
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      this.toggleListening();
    });

    // Tombol cepat contoh perintah suara di HP
    document.querySelectorAll("[data-voice-sample]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const sample = chip.dataset.voiceSample;
        if (this.bannerEl) this.bannerEl.classList.remove("hidden");
        if (this.transcriptEl) this.transcriptEl.textContent = `"${sample}"`;
        this.processVoiceCommand(sample);
      });
    });
  }

  toggleListening() {
    if (!this.recognition) {
      const msg =
        "Browser HP ini tidak mendukung Web Speech API. Gunakan Google Chrome atau Edge versi terbaru.";
      this.onNotify?.(msg, "error");
      return;
    }

    if (this.bannerEl) {
      this.bannerEl.classList.remove("hidden");
    }

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
        this.statusBadgeEl.textContent = "SIAP";
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
    if (shouldSpeak) {
      this.speakIndonesian(text);
    }
  }

  /**
   * Membacakan balasan aktual menggunakan suara Bahasa Indonesia di HP
   */
  speakIndonesian(text) {
    if (!("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "id-ID";
      utterance.rate = 1.02;
      utterance.pitch = 1.0;

      const voices = window.speechSynthesis.getVoices();
      const idVoice = voices.find((v) => v.lang.toLowerCase().includes("id"));
      if (idVoice) utterance.voice = idVoice;

      window.speechSynthesis.speak(utterance);
    } catch {
      // Abaikan jika browser membatasi TTS
    }
  }

  /**
   * Menerjemahkan kalimat Bahasa Indonesia menjadi aksi kontrol / pertanyaan status
   */
  processVoiceCommand(rawText) {
    const text = rawText
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const isTurnOn = /\b(nyalakan|hidupkan|aktifkan|on)\b/.test(text);
    const isTurnOff = /\b(matikan|nonaktifkan|padamkan|off)\b/.test(text);
    const isOpen = /\b(buka|keluarkan|open)\b/.test(text);
    const isClose = /\b(tutup|masukkan|kunci|close|lock)\b/.test(text);
    const isStop = /\b(stop|hentikan|berhenti)\b/.test(text);
    const isQuery = /\b(status|kondisi|cek|apakah|bagaimana|gimana|berapa)\b/.test(text);

    // 1. Pertanyaan: Cek semua perangkat / apakah semua perangkat online
    if (isQuery && /\b(semua|seluruh|perangkat|online|sistem)\b/.test(text)) {
      this.answerAllDevicesStatus();
      return;
    }

    // 2. Pertanyaan: Kondisi Pintu
    if (isQuery && /\bpintu\b/.test(text)) {
      this.answerDoorStatus();
      return;
    }

    // 3. Perintah Grup: Semua Lampu
    if (/\b(semua lampu|seluruh lampu|lampu semua)\b/.test(text)) {
      if (isTurnOn || isOpen) {
        this.setResponse("Mengirim perintah menyalakan Lampu 1 dan Lampu 2...", true);
        this.onExecuteCommand?.("lampu1", "ON", "hp-voice");
        this.onExecuteCommand?.("lampu2", "ON", "hp-voice");
        return;
      }
      if (isTurnOff || isClose) {
        this.setResponse("Mengirim perintah mematikan Lampu 1 dan Lampu 2...", true);
        this.onExecuteCommand?.("lampu1", "OFF", "hp-voice");
        this.onExecuteCommand?.("lampu2", "OFF", "hp-voice");
        return;
      }
    }

    // 4. Kontrol Lampu 1
    if (/\b(lampu 1|lampu satu|lampu utama)\b/.test(text)) {
      if (isTurnOn || isOpen) {
        this.setResponse("Memproses perintah menyalakan Lampu 1...", false);
        this.onExecuteCommand?.("lampu1", "ON", "hp-voice");
        return;
      }
      if (isTurnOff || isClose) {
        this.setResponse("Memproses perintah mematikan Lampu 1...", false);
        this.onExecuteCommand?.("lampu1", "OFF", "hp-voice");
        return;
      }
    }

    // 5. Kontrol Lampu 2
    if (/\b(lampu 2|lampu dua|lampu kedua)\b/.test(text)) {
      if (isTurnOn || isOpen) {
        this.setResponse("Memproses perintah menyalakan Lampu 2...", false);
        this.onExecuteCommand?.("lampu2", "ON", "hp-voice");
        return;
      }
      if (isTurnOff || isClose) {
        this.setResponse("Memproses perintah mematikan Lampu 2...", false);
        this.onExecuteCommand?.("lampu2", "OFF", "hp-voice");
        return;
      }
    }

    // 6. Kontrol Kipas Angin
    if (/\bkipas\b/.test(text)) {
      if (isTurnOn || isOpen) {
        this.setResponse("Memproses perintah menghidupkan Kipas Angin...", false);
        this.onExecuteCommand?.("kipas", "ON", "hp-voice");
        return;
      }
      if (isTurnOff || isClose) {
        this.setResponse("Memproses perintah mematikan Kipas Angin...", false);
        this.onExecuteCommand?.("kipas", "OFF", "hp-voice");
        return;
      }
    }

    // 7. Kontrol Jemuran Otomatis
    if (/\bjemuran\b/.test(text)) {
      if (isStop) {
        this.setResponse("Mengirim perintah menghentikan jemuran...", false);
        this.onExecuteCommand?.("jemuran", "STOP", "hp-voice");
        return;
      }
      if (isOpen || isTurnOn) {
        this.setResponse("Memproses perintah membuka jemuran...", false);
        this.onExecuteCommand?.("jemuran", "OPEN", "hp-voice");
        return;
      }
      if (isClose || isTurnOff) {
        this.setResponse("Memproses perintah menutup jemuran...", false);
        this.onExecuteCommand?.("jemuran", "CLOSE", "hp-voice");
        return;
      }
    }

    // 8. Kontrol Pintu Utama (Wajib melewati konfirmasi keamanan!)
    if (/\bpintu\b/.test(text)) {
      if (isOpen || isTurnOn) {
        const msg = "Perintah buka pintu terdeteksi. Silakan tekan konfirmasi pada layar HP Anda.";
        this.setResponse(msg, true);
        this.onRequestDoorConfirm?.("OPEN");
        return;
      }
      if (isClose || isTurnOff) {
        const msg = "Perintah tutup pintu terdeteksi. Silakan tekan konfirmasi pada layar HP Anda.";
        this.setResponse(msg, true);
        this.onRequestDoorConfirm?.("CLOSE");
        return;
      }
    }

    const unknownReply = `Perintah "${rawText}" belum dikenali. Coba ucapkan: nyalakan lampu satu, hidupkan kipas, buka jemuran, atau cek status perangkat.`;
    this.setResponse(unknownReply, true);
  }

  answerDoorStatus() {
    const door = this.deviceStore.getDevice("pintu");
    if (!this.deviceStore.espAvailable) {
      this.setResponse("Perangkat ESP32 sedang offline, status pintu terakhir adalah " + door.state + ".", true);
      return;
    }
    const statusText =
      door.state === "OPEN" ? "terbuka" : door.state === "CLOSED" ? "tertutup" : "belum diketahui";
    const angleText =
      typeof door.detail?.angle === "number" ? ` dengan posisi servo ${door.detail.angle} derajat` : "";
    this.setResponse(`Kondisi pintu utama saat ini ${statusText}${angleText}.`, true);
  }

  answerAllDevicesStatus() {
    const all = this.deviceStore.getAll();
    const onlineCount = all.filter((d) => d.online).length;

    if (!this.deviceStore.espAvailable) {
      this.setResponse("Perangkat ESP32 saat ini sedang offline. Semua 5 perangkat tidak terhubung.", true);
      return;
    }

    const summaryList = DEVICE_KEYS.map((k) => {
      const dev = this.deviceStore.getDevice(k);
      return `${DEVICE_DEFINITIONS[k].name} ${dev.state}`;
    }).join(", ");

    this.setResponse(
      `Terdapat ${onlineCount} dari ${all.length} perangkat online. Rincian: ${summaryList}.`,
      true
    );
  }

  /**
   * Dipanggil oleh app.js saat ESP32 membalas /state atau terjadi timeout
   */
  handleCommandOutcome({ deviceKey, state, success, isTimeout }) {
    const devName = DEVICE_DEFINITIONS[deviceKey]?.name || deviceKey;
    if (isTimeout) {
      const msg = `Gagal: ESP32 tidak merespons perintah untuk ${devName}.`;
      this.setResponse(msg, true);
      return;
    }
    if (success) {
      const msg = `${devName} berhasil diubah ke kondisi ${state}.`;
      this.setResponse(msg, true);
    }
  }
}