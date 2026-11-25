import express from "express";
import { seamlessWalletService } from "../services/seamlessWalletService.js";
import { GAMES_CATALOG } from "../config/gamesCatalog.js";

const router = express.Router();

/**
 * 1. Register Client Platform Operator
 * POST /api/partner/register
 */
router.post("/register", (req, res) => {
  const { operatorName, webhookUrl } = req.body;
  const operatorId = `op_${Date.now()}`;
  const op = seamlessWalletService.registerOperator({
    operatorId,
    operatorName,
    webhookUrl,
  });

  return res.json({
    success: true,
    message: "Partner Operator registered successfully",
    operator: op,
  });
});

/**
 * 2. Generate Game Launch URL
 * POST /api/partner/game/launch
 * Payload: { userId, username, balance, currency, gameId, returnUrl }
 */
router.post("/game/launch", (req, res) => {
  const { userId, username, balance, currency, gameId, returnUrl, operatorId = "default_master" } = req.body;

  if (!userId) {
    return res.status(400).json({ success: false, error: "userId is required" });
  }

  const session = seamlessWalletService.createPlayerSession({
    userId,
    username: username || `Player_${userId}`,
    balance: balance !== undefined ? Number(balance) : 1000,
    currency: currency || "INR",
    operatorId,
    returnUrl,
    gameId,
  });

  const protocol = req.protocol;
  const host = req.get("host");
  const baseUrl = `${protocol}://${host}`;

  let targetPath = "/lobby";
  if (gameId) {
    const game = GAMES_CATALOG.find((g) => g.id === String(gameId) || g.code === String(gameId));
    if (game) {
      targetPath = game.url;
    }
  }

  const launchUrl = `${baseUrl}${targetPath}?token=${session.token}&gameId=${gameId || ""}&returnUrl=${encodeURIComponent(returnUrl || "")}`;

  return res.json({
    success: true,
    token: session.token,
    launchUrl,
    session: {
      userId: session.userId,
      username: session.username,
      balance: session.balance,
      currency: session.currency,
    },
  });
});

/**
 * 3. List All Available Games for Integration
 * GET /api/partner/games
 */
router.get("/games", (req, res) => {
  return res.json({
    success: true,
    total: GAMES_CATALOG.length,
    games: GAMES_CATALOG,
  });
});

/**
 * 4. Partner Dashboard Stats & Reporting
 * GET /api/partner/stats
 */
router.get("/stats", (req, res) => {
  const txs = seamlessWalletService.transactions;
  const totalBets = txs.filter((t) => t.type === "BET").reduce((sum, t) => sum + t.amount, 0);
  const totalWins = txs.filter((t) => t.type === "WIN").reduce((sum, t) => sum + t.amount, 0);
  const ggrProfit = Math.round((totalBets - totalWins) * 100) / 100;

  return res.json({
    success: true,
    activeSessions: seamlessWalletService.sessions.size,
    totalTransactions: txs.length,
    totalBetsVolume: totalBets,
    totalPayouts: totalWins,
    operatorProfitGGR: ggrProfit,
  });
});

export default router;
