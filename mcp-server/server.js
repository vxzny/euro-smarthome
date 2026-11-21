/**
 * MCP Server untuk XiaoZhi AI Voice Assistant
 * - Mendaftarkan 7 Tools resmi sesuai spesifikasi Smart Home
 * - Terhubung ke XiaoZhi MCP Endpoint (WSS) dengan auto-reconnect
 * - Menyediakan HTTP endpoint cadangan (/health dan /mcp) untuk hosting cloud
 */
import http from "node:http";
import WebSocket from "ws";
import dotenv from "dotenv";
import { SmartHomeMqttBridge } from "./mqtt-bridge.js";

dotenv.config();

const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL;
const MQTT_USERNAME = process.env.MQTT_USERNAME || "mcp_assistant";
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const MQTT_CLIENT_ID = process.env.MQTT_CLIENT_ID || "mcp-xiaozhi-01";
const XIAOZHI_MCP_ENDPOINT = process.env.XIAOZHI_MCP_ENDPOINT || "";
const COMMAND_TIMEOUT_MS = Number(process.env.COMMAND_TIMEOUT_MS) || 6000;
const HTTP_PORT = Number(process.env.PORT) || 3000;

if (!MQTT_BROKER_URL || !MQTT_PASSWORD) {
  console.error("ERROR FATAL: MQTT_BROKER_URL dan MQTT_PASSWORD wajib diisi pada file .env");
  process.exit(1);
}

// 1. Inisialisasi Jembatan MQTT
const mqttBridge = new SmartHomeMqttBridge({
  brokerUrl: MQTT_BROKER_URL,
  username: MQTT_USERNAME,
  password: MQTT_PASSWORD,
  clientId: MQTT_CLIENT_ID,
  commandTimeoutMs: COMMAND_TIMEOUT_MS
});

// 2. Definisi 7 MCP Tools Wajib untuk XiaoZhi AI
const MCP_TOOLS = [
  {
    name: "control_clothesline",
    description:
      "Mengontrol jemuran otomatis pintar (motor servo). Gunakan action 'OPEN' untuk membuka/mengeluarkan jemuran, 'CLOSE' untuk menutup/memasukkan jemuran, atau 'STOP' untuk menghentikan gerakan.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["OPEN", "CLOSE", "STOP"],
          description: "Perintah jemuran: OPEN (buka), CLOSE (tutup), atau STOP (berhenti)."
        }
      },
      required: ["action"]
    }
  },
  {
    name: "control_fan",
    description:
      "Menyalakan atau mematikan kipas angin 12V di rumah pintar. Gunakan 'ON' untuk menghidupkan dan 'OFF' untuk mematikan.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["ON", "OFF"],
          description: "Perintah kipas angin: ON atau OFF."
        }
      },
      required: ["action"]
    }
  },
  {
    name: "control_light_1",
    description:
      "Menyalakan atau mematikan Lampu 1 (lampu utama 220V). Gunakan 'ON' untuk menyalakan dan 'OFF' untuk mematikan.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["ON", "OFF"],
          description: "Perintah Lampu 1: ON atau OFF."
        }
      },
      required: ["action"]
    }
  },
  {
    name: "control_light_2",
    description:
      "Menyalakan atau mematikan Lampu 2. Gunakan 'ON' untuk menyalakan dan 'OFF' untuk mematikan.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["ON", "OFF"],
          description: "Perintah Lampu 2: ON atau OFF."
        }
      },
      required: ["action"]
    }
  },
  {
    name: "get_door_status",
    description:
      "Mengecek status aktual Pintu Utama (apakah sedang OPEN/terbuka atau CLOSED/tertutup, sudut servo, dan status koneksi ESP32).",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "control_door",
    description:
      "Mengontrol Pintu Utama yang digerakkan motor servo ('OPEN' untuk membuka pintu, 'CLOSE' untuk menutup pintu). Demi keamanan, hanya jalankan jika pengguna secara eksplisit meminta membuka atau menutup pintu.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["OPEN", "CLOSE"],
          description: "Perintah pintu: OPEN (buka pintu) atau CLOSE (tutup pintu)."
        }
      },
      required: ["action"]
    }
  },
  {
    name: "get_all_device_status",
    description:
      "Mengecek status seluruh perangkat Smart Home (jemuran, kipas, lampu 1, lampu 2, pintu) sekaligus memeriksa apakah ESP32 sedang online atau offline.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  }
];

// 3. Eksekutor Tool MCP -> MQTT Broker -> Konfirmasi ESP32
async function executeMcpTool(toolName, args = {}) {
  switch (toolName) {
    case "control_clothesline":
      return await mqttBridge.executeDeviceCommand("jemuran", args.action);

    case "control_fan":
      return await mqttBridge.executeDeviceCommand("kipas", args.action);

    case "control_light_1":
      return await mqttBridge.executeDeviceCommand("lampu1", args.action);

    case "control_light_2":
      return await mqttBridge.executeDeviceCommand("lampu2", args.action);

    case "get_door_status":
      return {
        success: true,
        ...mqttBridge.getDoorStatus()
      };

    case "control_door":
      return await mqttBridge.executeDeviceCommand("pintu", args.action);

    case "get_all_device_status":
      return {
        success: true,
        ...mqttBridge.getAllDeviceStatus()
      };

    default:
      throw new Error(`Tool MCP tidak dikenal: ${toolName}`);
  }
}

// 4. Handler Protokol JSON-RPC 2.0 MCP
async function handleJsonRpcMessage(rawMessage) {
  let msg;
  try {
    msg = typeof rawMessage === "string" ? JSON.parse(rawMessage) : rawMessage;
  } catch {
    return JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error: JSON tidak valid" }
    });
  }

  // Abaikan notifikasi satu arah tanpa id (seperti notifications/initialized)
  if (msg.id === undefined || msg.id === null) {
    if (msg.method === "notifications/initialized") {
      console.log("[MCP] Sesi XiaoZhi MCP siap digunakan.");
    }
    return null;
  }

  const { id, method, params } = msg;

  try {
    if (method === "initialize") {
      return JSON.stringify({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: { listChanged: false }
          },
          serverInfo: {
            name: "nexus-smarthome-mcp",
            version: "1.0.0"
          }
        }
      });
    }

    if (method === "ping") {
      return JSON.stringify({ jsonrpc: "2.0", id, result: {} });
    }

    if (method === "tools/list") {
      console.log("[MCP] XiaoZhi meminta daftar 7 tools Smart Home.");
      return JSON.stringify({
        jsonrpc: "2.0",
        id,
        result: { tools: MCP_TOOLS }
      });
    }

    if (method === "tools/call") {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      console.log(`[MCP TOOL CALL] ${toolName}(${JSON.stringify(toolArgs)})`);

      const toolResult = await executeMcpTool(toolName, toolArgs);
      return JSON.stringify({
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(toolResult)
            }
          ],
          isError: toolResult.success === false
        }
      });
    }

    return JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method tidak didukung: ${method}` }
    });
  } catch (err) {
    console.error(`[MCP ERROR] ${method}:`, err.message);
    return JSON.stringify({
      jsonrpc: "2.0",
      id,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: false, error: err.message })
          }
        ],
        isError: true
      }
    });
  }
}

// 5. Koneksi Outbound WebSocket ke XiaoZhi MCP Endpoint (dengan Auto-Reconnect)
function connectToXiaoZhiEndpoint() {
  if (!XIAOZHI_MCP_ENDPOINT || XIAOZHI_MCP_ENDPOINT.includes("YOUR_XIAOZHI")) {
    console.warn(
      "[MCP] XIAOZHI_MCP_ENDPOINT belum diisi di .env. Server berjalan dalam mode HTTP lokal (/mcp)."
    );
    return;
  }

  console.log("[MCP] Menghubungkan ke XiaoZhi MCP Endpoint...");
  const ws = new WebSocket(XIAOZHI_MCP_ENDPOINT);

  ws.on("open", () => {
    console.log("[MCP] Terhubung penuh ke XiaoZhi AI Voice Assistant!");
  });

  ws.on("message", async (data) => {
    const responseStr = await handleJsonRpcMessage(data.toString("utf-8"));
    if (responseStr && ws.readyState === WebSocket.OPEN) {
      ws.send(responseStr);
    }
  });

  ws.on("close", (code) => {
    console.warn(`[MCP] Koneksi XiaoZhi terputus (code=${code}). Reconnect dalam 5 detik...`);
    setTimeout(connectToXiaoZhiEndpoint, 5000);
  });

  ws.on("error", (err) => {
    console.error("[MCP] WebSocket Error:", err.message);
  });
}

// 6. Server HTTP Cadangan (/health & /mcp untuk deployment cloud / self-hosted XiaoZhi)
function startHttpServer() {
  const server = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");

    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200);
      res.end(
        JSON.stringify({
          status: "ok",
          mqttConnected: mqttBridge.brokerConnected,
          esp32Online: mqttBridge.espOnline,
          registeredTools: MCP_TOOLS.map((t) => t.name)
        })
      );
      return;
    }

    if (req.method === "POST" && req.url === "/mcp") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        const responseStr = await handleJsonRpcMessage(body);
        res.writeHead(200);
        res.end(responseStr || JSON.stringify({ jsonrpc: "2.0", result: "accepted" }));
      });
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: "Endpoint tidak ditemukan" }));
  });

  server.listen(HTTP_PORT, () => {
    console.log(`[HTTP] Health & MCP fallback aktif di port ${HTTP_PORT} (/health, /mcp)`);
  });
}

// 7. Booting Utama
async function bootstrap() {
  try {
    await mqttBridge.connect();
    startHttpServer();
    connectToXiaoZhiEndpoint();
  } catch (err) {
    console.error("[FATAL] Gagal menjalankan MCP Server:", err.message);
    process.exit(1);
  }
}

bootstrap();