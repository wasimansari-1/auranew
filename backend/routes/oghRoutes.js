import express from "express";
import { GAMES_CATALOG } from "../config/gamesCatalog.js";
import { seamlessWalletService } from "../services/seamlessWalletService.js";

const router = express.Router();

function extractToken(req) {
  const authHeader = req.headers["authorization"] || "";
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  return req.headers["x-player-token"] || req.query?.token || req.body?.token || null;
}

// 1. Status Check: GET /ogh/status and GET /status
router.get("/status", (req, res) => {
  return res.json({ status: true, ok: true, active: true, uptime: process.uptime() });
});

// 2. Games Catalog: GET /ogh/games
router.get("/games", (req, res) => {
  return res.json({
    status: true,
    data: {
      items: GAMES_CATALOG
    }
  });
});

// 2. Player Auth: POST /ogh/playerAuth
router.post("/playerAuth", async (req, res) => {
  const token = extractToken(req) || "demo";

  try {
    const authData = await seamlessWalletService.authenticate(token);
    return res.json(authData);
  } catch (err) {
    return res.status(401).json({ status: false, message: err.message || "Invalid or expired token" });
  }
});

// 3. Player Balance: POST /ogh/playerBalance
router.post("/playerBalance", async (req, res) => {
  const token = extractToken(req) || "demo";

  try {
    const balanceData = await seamlessWalletService.getBalance(token);
    return res.json(balanceData);
  } catch (err) {
    return res.status(401).json({ status: false, message: err.message });
  }
});

// 4. Bet Limits: POST/GET /ogh/betLimit
router.all("/betLimit", (req, res) => {
  const gameId = req.query.game || req.body?.game || "88.0039";
  const game = GAMES_CATALOG.find(g => g.id === gameId || g.code === gameId);
  const min = game?.minBet ? Number(game.minBet) : 10;
  const max = game?.maxBet ? Number(game.maxBet) : 25000;
  return res.json({
    status: true,
    data: {
      limit: { min, max }
    }
  });
});

// 4. Player Transactions: POST /ogh/playerTransactions
router.post("/playerTransactions", async (req, res) => {
  const token = extractToken(req);
  const session = seamlessWalletService.getSession(token);

  const view = req.body?.view || "rounds";
  return res.json({
    status: true,
    data: {
      view,
      items: seamlessWalletService.transactions
        .filter((t) => !token || t.token === token)
        .slice(-20)
    }
  });
});

// 5. Player Name Update: POST /ogh/playerName
router.post("/playerName", (req, res) => {
  const token = extractToken(req);
  const { name } = req.body;
  const session = seamlessWalletService.getSession(token);
  if (session && name) {
    session.username = String(name).slice(0, 24);
  }
  return res.json({
    status: true,
    data: {
      username: session ? session.username : name
    }
  });
});

export default router;
