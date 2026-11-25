import express from "express";
import http from "http";
import path from "path";
import cors from "cors";
import { fileURLToPath } from "url";
import fs from "fs";

import oghRoutes from "./routes/oghRoutes.js";
import partnerRoutes from "./routes/partnerRoutes.js";
import { websocketRelayService } from "./services/websocketRelayService.js";
import { seamlessWalletService } from "./services/seamlessWalletService.js";
import { GAMES_CATALOG } from "./config/gamesCatalog.js";

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
app.get(["/health", "/status"], (req, res) => {
  res.json({
    status: "ok",
    ok: true,
    active: true,
    service: "NexoRNG Engine",
    activeSessions: seamlessWalletService.sessions.size,
    timestamp: new Date().toISOString()
  });
});

// Direct compatibility alias for /games -> /ogh/games
app.get("/games", (req, res) => {
  res.json({
    status: true,
    data: {
      items: GAMES_CATALOG,
      count: GAMES_CATALOG.length
    }
  });
});

app.all(["/betLimit", "/ogh/betLimit"], (req, res) => {
  const gameId = req.query.game || req.body?.game || "88.0039";
  const game = GAMES_CATALOG.find(g => g.id === gameId || g.code === gameId);
  const min = game?.minBet ? Number(game.minBet) : 10;
  const max = game?.maxBet ? Number(game.maxBet) : 25000;
  res.json({
    status: true,
    data: {
      limit: { min, max }
    }
  });
});

app.all(["/playerBalance", "/ogh/playerBalance"], async (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace(/^Bearer\s+/i, "") || "demo";
  try {
    const balanceData = await seamlessWalletService.getBalance(token);
    res.json(balanceData);
  } catch (err) {
    res.status(200).json({ status: true, data: { balance: 2500, currency: "EUR" } });
  }
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
app.use("/games/vimaanlive", express.static(path.join(PUBLIC_DIR, "games/vimaan")));
app.use("/lobby/assets", express.static(path.join(PUBLIC_DIR, "assets")));
app.use("/launchGame/assets", express.static(path.join(PUBLIC_DIR, "assets")));
app.use(express.static(PUBLIC_DIR));

// 6. Static Asset Handler
// All game assets (.js, .css, .webp, .png, .json, .atlas, .mp3, etc.) are served 100% locally from public/
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  const ext = path.extname(req.path);
  if (!ext || req.path.startsWith("/ogh") || req.path.startsWith("/api")) return next();

  const localFile = path.join(PUBLIC_DIR, req.path);
  if (fs.existsSync(localFile)) {
    return res.sendFile(localFile);
  }

  // Never serve HTML for missing static assets to prevent MIME type errors
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
