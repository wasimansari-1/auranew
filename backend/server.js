import express from "express";
import http from "http";
import path from "path";
import cors from "cors";
import axios from "axios";
import { fileURLToPath } from "url";
import fs from "fs";

import oghRoutes from "./routes/oghRoutes.js";
import partnerRoutes from "./routes/partnerRoutes.js";
import { websocketRelayService } from "./services/websocketRelayService.js";
import { seamlessWalletService } from "./services/seamlessWalletService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");

const PORT = process.env.PORT || 4000;

const app = express();
const server = http.createServer(app);

// 1. Global Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2. Health & Status
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "NexoRNG Engine",
    activeSessions: seamlessWalletService.sessions.size,
    upstreamConnected: websocketRelayService.upstreamConnected,
    timestamp: new Date().toISOString()
  });
});

// 3. API Routes
app.use("/ogh", oghRoutes);
app.use("/api/partner", partnerRoutes);

// Compatibility alias for /api/partner/launch -> /api/partner/game/launch
app.post("/api/partner/launch", (req, res, next) => {
  req.url = "/game/launch";
  partnerRoutes(req, res, next);
});

// 4. Favicon Handling
app.get(["/favicon.ico", "*/favicon.ico"], (req, res) => {
  const fav = path.join(PUBLIC_DIR, "favicon.ico");
  if (fs.existsSync(fav)) return res.sendFile(fav);
  res.status(204).end();
});

// 5. Static Assets from public directory
app.use(express.static(PUBLIC_DIR));

// 6. Dynamic Upstream Asset Mirror Proxy
// If any static asset (.js, .css, .webp, .png, .json, .atlas, etc.) is missing locally,
// fetch it on the fly from launch.nexorng.com, save to disk, and serve with exact headers.
app.use(async (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  const ext = path.extname(req.path);
  if (!ext || req.path.startsWith("/ogh") || req.path.startsWith("/api")) return next();

  const localFile = path.join(PUBLIC_DIR, req.path);
  if (fs.existsSync(localFile)) {
    return res.sendFile(localFile);
  }

  try {
    const upstreamUrl = `https://launch.nexorng.com${req.path}`;
    const response = await axios({
      method: req.method,
      url: upstreamUrl,
      responseType: "arraybuffer",
      timeout: 8000,
      validateStatus: () => true,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://launch.nexorng.com/"
      }
    });

    if (response.status === 200) {
      fs.mkdirSync(path.dirname(localFile), { recursive: true });
      fs.writeFileSync(localFile, response.data);
      const ct = response.headers["content-type"];
      if (ct) res.setHeader("Content-Type", ct);
      return res.status(200).send(response.data);
    }
  } catch (_) {}

  // Crucial: NEVER serve HTML for asset requests to prevent MIME type errors
  return res.status(404).type("text/plain").send("Asset not found");
});

// Helper for SPA with token
function handleSpaRoute(req, res, routePath) {
  const query = { ...req.query };
  if (!query.token) {
    query.token = "demo";
    const qs = new URLSearchParams(query).toString();
    return res.redirect(`${routePath}?${qs}`);
  }
  const lobbyFile = path.join(PUBLIC_DIR, "lobby.html");
  if (fs.existsSync(lobbyFile)) return res.sendFile(lobbyFile);
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
}

// 7. Frontend SPA & Lobby Routing
app.get("/", (req, res) => {
  const query = { ...req.query };
  if (!query.token) query.token = "demo";
  const qs = new URLSearchParams(query).toString();
  res.redirect(`/lobby?${qs}`);
});

app.get("/lobby", (req, res) => handleSpaRoute(req, res, "/lobby"));
app.get("/auth", (req, res) => handleSpaRoute(req, res, "/auth"));

app.get(["/launchGame*", "/history*", "/load*"], (req, res) => {
  const lobbyFile = path.join(PUBLIC_DIR, "lobby.html");
  if (fs.existsSync(lobbyFile)) return res.sendFile(lobbyFile);
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// 8. Initialize WebSocket Relay Engine
websocketRelayService.init(server);

// 9. Start Listening
if (process.env.NODE_ENV !== "test" || !process.env.TEST_NO_LISTEN) {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`\n======================================================`);
    console.log(`🚀 NexoRNG Engine running on http://localhost:${PORT}`);
    console.log(`🎮 Lobby: http://localhost:${PORT}/lobby?token=demo`);
    console.log(`✈️  Vimaan: http://localhost:${PORT}/games/vimaan/?token=demo`);
    console.log(`🧞 Aladdin: http://localhost:${PORT}/games/aladdin/?token=demo`);
    console.log(`🦸 Shaktimaan: http://localhost:${PORT}/games/shaktimaan/?token=demo`);
    console.log(`======================================================\n`);
  });
}

export { server, app };
export default app;
