import crypto from "crypto";
import axios from "axios";

/**
 * NexoRNG Multi-Tenant Seamless Wallet & Session Engine
 */
class SeamlessWalletService {
  constructor() {
    this.sessions = new Map();
    this.operators = new Map();
    this.transactions = [];

    // Register Default System Operator (e.g. Master Demo & Direct Testing)
    this.registerOperator({
      operatorId: "default_master",
      operatorName: "Master Platform Operator",
      apiKey: "uapi_nx_master_001",
      apiSecret: "sec_nx_master_secret",
      webhookUrl: null, // Local balance tracking if null
      status: "ACTIVE"
    });
  }

  registerOperator({ operatorId, operatorName, apiKey, apiSecret, webhookUrl, status = "ACTIVE" }) {
    const op = {
      operatorId,
      operatorName: operatorName || `Operator-${operatorId}`,
      apiKey: apiKey || `uapi_nx_${crypto.randomBytes(6).toString("hex")}`,
      apiSecret: apiSecret || `sec_nx_${crypto.randomBytes(12).toString("hex")}`,
      webhookUrl: webhookUrl || null,
      status: status || "ACTIVE",
      createdAt: new Date().toISOString()
    };
    this.operators.set(op.operatorId, op);
    return op;
  }

  createPlayerSession({
    userId,
    username,
    balance = 5000,
    currency = "INR",
    operatorId = "default_master",
    returnUrl = null,
    gameId = null
  }) {
    const token = `nx_tok_${crypto.randomBytes(16).toString("hex")}`;
    const sessionId = `sess_${crypto.randomBytes(10).toString("hex")}`;
    const playerSessionToken = `pst_${crypto.randomBytes(12).toString("hex")}`;

    const session = {
      token,
      sessionId,
      playerSessionToken,
      userId: String(userId || "demo_user"),
      username: String(username || "Player"),
      balance: Number(balance) || 0,
      currency: currency || "INR",
      operatorId,
      returnUrl,
      gameId,
      createdAt: Date.now(),
      lastActive: Date.now()
    };

    this.sessions.set(token, session);
    return session;
  }

  getSession(token) {
    if (!token) return null;
    if (token === "demo") {
      return {
        token: "demo",
        sessionId: "sess_demo",
        playerSessionToken: "pst_demo",
        userId: "demo_user",
        username: "Demo Player",
        balance: 10000.0,
        currency: "INR",
        operatorId: "default_master",
        returnUrl: null,
        isDemo: true
      };
    }
    return this.sessions.get(token) || null;
  }

  async authenticate(token) {
    const session = this.getSession(token);
    if (!session) {
      throw new Error("Invalid or expired session token");
    }

    session.lastActive = Date.now();
    return {
      status: true,
      data: {
        token: session.token,
        sessionId: session.sessionId,
        playerSessionToken: session.playerSessionToken,
        playerId: session.userId,
        userId: session.userId,
        username: session.username,
        playerUsername: session.username,
        playerName: session.username,
        name: session.username,
        balance: session.balance,
        currency: session.currency,
        returnUrl: session.returnUrl,
        nameChosen: true
      }
    };
  }

  async getBalance(token) {
    const session = this.getSession(token);
    if (!session) {
      throw new Error("Invalid session token");
    }

    return {
      status: true,
      data: {
        balance: session.balance,
        currency: session.currency
      }
    };
  }

  async processBet(token, { round, amount, slot = 0, event = "88.0034" }) {
    const session = this.getSession(token);
    if (!session) throw new Error("Invalid session token");

    const betAmount = Math.max(0, Number(amount) || 0);
    if (session.balance < betAmount) {
      throw new Error("INSUFFICIENT_BALANCE");
    }

    session.balance = Math.round((session.balance - betAmount) * 100) / 100;
    session.lastActive = Date.now();

    const tx = {
      txId: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      token,
      userId: session.userId,
      event,
      round,
      type: "BET",
      amount: betAmount,
      balanceAfter: session.balance,
      timestamp: Date.now()
    };
    this.transactions.push(tx);

    // If operator has webhook callback, dispatch debit notification
    this.dispatchWebhook(session.operatorId, "DEBIT", tx);

    return {
      status: true,
      balance: session.balance,
      currency: session.currency,
      txId: tx.txId
    };
  }

  async processCashout(token, { round, multiplier, win, slot = 0, event = "88.0034" }) {
    const session = this.getSession(token);
    if (!session) throw new Error("Invalid session token");

    const winAmount = Math.max(0, Number(win) || 0);
    session.balance = Math.round((session.balance + winAmount) * 100) / 100;
    session.lastActive = Date.now();

    const tx = {
      txId: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      token,
      userId: session.userId,
      event,
      round,
      multiplier,
      type: "WIN",
      amount: winAmount,
      balanceAfter: session.balance,
      timestamp: Date.now()
    };
    this.transactions.push(tx);

    // If operator has webhook callback, dispatch credit notification
    this.dispatchWebhook(session.operatorId, "CREDIT", tx);

    return {
      status: true,
      balance: session.balance,
      currency: session.currency,
      txId: tx.txId
    };
  }

  async dispatchWebhook(operatorId, action, payload) {
    const op = this.operators.get(operatorId);
    if (!op || !op.webhookUrl) return;

    try {
      await axios.post(op.webhookUrl, {
        action,
        operatorId,
        data: payload,
        timestamp: Date.now()
      }, {
        headers: {
          "X-API-Key": op.apiKey,
          "Content-Type": "application/json"
        },
        timeout: 2500
      });
    } catch (err) {
      console.warn(`[SeamlessWallet Webhook] Delivery failed for ${operatorId}:`, err.message);
    }
  }
}

export const seamlessWalletService = new SeamlessWalletService();
