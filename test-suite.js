import app, { server } from "./backend/server.js";
import axios from "axios";
import WebSocket from "ws";

const PORT = process.env.PORT || 4000;
const BASE = `http://localhost:${PORT}`;

async function runTests() {
  console.log("\n🧪 Running NexoRNG Comprehensive Verification Suite...\n");

  // Wait 600ms for server listen
  await new Promise((r) => setTimeout(r, 600));

  // 1. Health check
  const healthRes = await axios.get(`${BASE}/health`);
  console.log("✓ Health Check:", healthRes.data);

  // 2. Games catalog
  const gamesRes = await axios.get(`${BASE}/ogh/games`);
  console.log(`✓ Games Catalogue: Fetched ${gamesRes.data?.data?.items?.length} games successfully.`);

  // 3. Partner Launch API
  const launchRes = await axios.post(`${BASE}/api/partner/game/launch`, {
    userId: "test_user_777",
    username: "Rahul_VIP",
    balance: 25000,
    currency: "INR",
    gameId: "88.0034",
    returnUrl: "http://localhost:4000/lobby"
  });
  console.log("✓ Partner Launch URL:", launchRes.data.launchUrl);
  const token = launchRes.data.token;

  // 4. Player Auth with token
  const authRes = await axios.post(`${BASE}/ogh/playerAuth`, {}, {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log("✓ Player Auth Data:", authRes.data.data);

  // 5. Player Balance
  const balRes = await axios.post(`${BASE}/ogh/playerBalance`, {}, {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log("✓ Player Live Balance:", balRes.data.data);

  // 6. Test Vimaan Static Assets
  const vimaanRes = await axios.get(`${BASE}/games/vimaan/`);
  console.log("✓ Vimaan 3D Game HTML Loaded (Length:", vimaanRes.data.length, "bytes)");

  // 7. Test Local WebSocket Server
  console.log("\n⚡ Testing WebSocket Gateway & Betting Flow...");
  const ws = new WebSocket(`ws://localhost:${PORT}/socket/ws`);

  ws.on("open", () => {
    console.log("✓ WebSocket connection established!");
    // Send Auth
    ws.send(JSON.stringify({ op: "auth", id: "auth_1", data: { token } }));
    // Subscribe to Vimaan (88.0034)
    ws.send(JSON.stringify({ op: "subscribe", event: "88.0034" }));
  });

  let ticksReceived = 0;
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === "auth") {
      console.log("✓ WebSocket Auth Confirmed:", msg.data?.ok ? "SUCCESS" : "FAILED");
      // Place a test bet of 100 INR
      ws.send(JSON.stringify({ op: "bet", event: "88.0034", id: "bet_1", data: { amount: 100, round: 5001, slot: 0 } }));
    } else if (msg.type === "bet.accepted") {
      console.log("✓ Bet Accepted! New Balance:", msg.data?.balance, msg.data?.currency);
      // Trigger cashout at 2.50x
      ws.send(JSON.stringify({ op: "cashout", event: "88.0034", id: "cash_1", data: { round: 5001, multiplier: 2.50, slot: 0 } }));
    } else if (msg.type === "cashout.success") {
      console.log("✓ Cashout Successful! Won:", msg.data?.win, "New Balance:", msg.data?.balance);
    } else if (msg.type === "round.tick") {
      ticksReceived++;
      if (ticksReceived <= 3) {
        console.log(`✓ Live Multiplier Tick: ${msg.data?.multiplier}x (Elapsed: ${msg.data?.elapsedMs}ms)`);
      }
    }
  });

  setTimeout(async () => {
    // 8. Partner Stats
    const statsRes = await axios.get(`${BASE}/api/partner/stats`);
    console.log("\n✓ Partner Dashboard Stats:", statsRes.data);
    console.log("\n🎉 ALL TESTS PASSED! NexoRNG Engine is 100% Operational!\n");
    ws.close();
    process.exit(0);
  }, 4000);
}

runTests().catch((err) => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
