# NexoRNG 3D WebGL Crash & Table Multi-Tenant Game Engine

Autonomous, unblockable, self-hosted reverse-engineered game engine for **NexoRNG 3D WebGL games** (Vimaan Live, Aladdin, Shaktimaan, Sindbad, Ali Baba, Sled Rush, Balloon, Jhandi Munda, Lucky 0-9, etc.).

---

## 🚀 Key Features

1. **Zero Upstream Dependency (100% Unblockable):**
   - All static 3D WebGL assets, Three.js models, textures, audio, and UI files are hosted locally on your own server.
   - Upstream NexoRNG has **zero control** over your domain and cannot block your players.

2. **Dual-Mode WebSocket Engine (`/socket/ws`):**
   - **Mode A (Live Relay):** Background connects to upstream live multiplier feed to stream identical rounds in real time across all betting platforms.
   - **Mode B (Provably Fair Autonomous Fallback):** If upstream ever disconnects or goes down, the built-in SHA-256 HMAC RNG engine automatically kicks in so rounds never stop.

3. **Multi-Operator Seamless Wallet API:**
   - Sell API access to multiple betting platforms / clients (Aura, Exchange444, Rolexwin, Punt666, etc.).
   - Issue operator API keys and launch URLs with custom user IDs, balances, and return URLs.
   - Automatic debit/credit webhooks for seamless wallet balance synchronization.

---

## 📦 Project Architecture

```
nexorng-engine/
├── backend/
│   ├── config/
│   │   └── gamesCatalog.js          # Metadata for all 21 games (RTP, min/max bet, slug)
│   ├── routes/
│   │   ├── oghRoutes.js             # NexoRNG core endpoints (/ogh/games, /ogh/playerAuth, etc.)
│   │   └── partnerRoutes.js         # Operator B2B API (/api/partner/game/launch, stats)
│   ├── services/
│   │   ├── seamlessWalletService.js # Player sessions, balance management, webhook dispatcher
│   │   └── websocketRelayService.js # High-performance WebSocket server & live multiplier relay
│   └── server.js                    # Express + WebSocket HTTP server (Default Port: 6001)
├── public/
│   ├── lobby/                       # Mirrored NexoRNG Lobby App
│   ├── games/
│   │   ├── _core/                   # Shared client engine (crash-client, socket-auth, 3D libs)
│   │   ├── vimaan/                  # 3D Vimaan Jet Crash Game
│   │   ├── aladdin/                 # Aladdin Flying Carpet 3D Game
│   │   ├── shaktimaan/              # Shaktimaan Superhero 3D Game
│   │   ├── sindbad/                 # Sindbad Pirate Ship 3D Game
│   │   ├── alibaba/                 # Ali Baba Desert 3D Game
│   │   ├── sledrush/                # Space Penguin Crash Game
│   │   ├── balloon/                 # Multiplier Balloon Arcade Game
│   │   ├── jhandi munda/            # Traditional Dice Game
│   │   ├── lucky09/                 # Digital Roulette Wheel
│   │   └── baaz/                    # Falcon Crash Game
│   └── nexorng-config.js            # Auto-resolving client WebSocket/API config
├── package.json
└── test-suite.js                    # Automated verification suite
```

---

## 🎮 How to Run

```bash
# 1. Install dependencies
npm install

# 2. Run verification test suite
node test-suite.js

# 3. Start engine in production
npm start
```

---

## 🔌 Partner Integration Guide (How to Sell to Clients)

### 1. Launch Game for User
**Endpoint:** `POST /api/partner/game/launch`  
**Payload:**
```json
{
  "userId": "client_user_1029",
  "username": "Rohit_VIP",
  "balance": 5000,
  "currency": "INR",
  "gameId": "88.0034",
  "returnUrl": "https://client-casino.com/home"
}
```

**Response:**
```json
{
  "success": true,
  "token": "nx_tok_79e6d410...",
  "launchUrl": "http://your-server:6001/games/vimaan/?token=nx_tok_79e6d410...&gameId=88.0034"
}
```

Client simply opens `launchUrl` inside an `<iframe>` or mobile webview.

---

### 2. Available Game IDs

- `88.0034` — **Vimaan** (Crash)
- `88.0003` — **Aladdin** (Crash)
- `88.0006` — **Shaktimaan** (Crash)
- `88.0007` — **Sindbad** (Crash)
- `88.0032` — **Ali Baba** (Crash)
- `88.0014` — **Sled Rush** (Crash)
- `88.0019` — **Balloon** (Arcade)
- `88.0103` — **Jhandi Munda** (Dice)
- `88.0102` — **Lucky 0-9** (Roulette)
- `88.0097` — **Baaz** (Crash)
