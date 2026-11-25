import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");

const BASE_URL = "https://launch.nexorng.com";
const client = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept: "*/*",
  },
});

async function download(remotePath, localPath) {
  try {
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const res = await client.get(remotePath, { responseType: "arraybuffer", validateStatus: s => s === 200 });
    fs.writeFileSync(localPath, Buffer.from(res.data));
    console.log(`✅ [${res.status}] ${remotePath} -> ${(res.data.byteLength / 1024).toFixed(1)} KB`);
    return true;
  } catch (err) {
    console.warn(`❌ Failed ${remotePath}: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log("\n📦 --- 1. Downloading Missing Core Engine Scripts ---");
  const coreFiles = [
    "/games/_core/instant-client.js",
    "/games/_core/wheel-client.js",
    "/games/_core/spin-focus.js",
    "/games/_core/table-client.js",
    "/games/_core/solo-client.js",
    "/games/_core/crash-client.js",
    "/games/_core/fair.js",
    "/games/_core/fit-screen.js",
    "/games/_core/maintenance.js",
    "/games/_core/phrases.js",
    "/games/_core/players.js",
    "/games/_core/secure-socket.js",
    "/games/_core/socket-auth.js",
    "/games/_core/sound-unlock.js",
  ];

  for (const rel of coreFiles) {
    const local = path.join(PUBLIC_DIR, rel.slice(1));
    await download(rel, local);
  }

  console.log("\n🎵 --- 2. Downloading All Common Game Audio Files ---");
  const soundNames = [
    "tick1", "tick2", "tick3",
    "chiplay1", "chiplay2",
    "land", "win", "bigwin",
    "sparkle1", "sparkle2",
    "lose", "error", "open", "closed",
    "click", "bell1", "bell2", "bell3",
    "glass1", "glass2", "wood1", "wood2",
    "lock1", "lock2", "lock3",
    "soft", "roll", "whoosh"
  ];

  const commonSoundsDir = path.join(PUBLIC_DIR, "sounds");
  if (!fs.existsSync(commonSoundsDir)) fs.mkdirSync(commonSoundsDir, { recursive: true });

  for (const s of soundNames) {
    const remote = `/games/lucky09/sounds/${s}.mp3`;
    const local = path.join(commonSoundsDir, `${s}.mp3`);
    await download(remote, local);
  }

  // Also check if any other game has unique sounds
  const gamesWithSounds = ["chromaten", "bingoorbit", "spiralderby", "jeweldrum", "triorollers", "orbit36", "minispin"];
  for (const g of gamesWithSounds) {
    for (const s of soundNames) {
      const remote = `/games/${g}/sounds/${s}.mp3`;
      const local = path.join(PUBLIC_DIR, "games", g, "sounds", `${s}.mp3`);
      if (!fs.existsSync(local)) {
        const ok = await download(remote, local);
        if (!ok && fs.existsSync(path.join(commonSoundsDir, `${s}.mp3`))) {
          // Fallback to common sound
          fs.mkdirSync(path.dirname(local), { recursive: true });
          fs.copyFileSync(path.join(commonSoundsDir, `${s}.mp3`), local);
        }
      }
    }
  }

  console.log("\n🔄 --- 3. Distributing Sounds to All Games Needing Audio ---");
  const gamesDir = path.join(PUBLIC_DIR, "games");
  for (const game of fs.readdirSync(gamesDir)) {
    const gPath = path.join(gamesDir, game);
    if (!fs.statSync(gPath).isDirectory() || game === "_core") continue;

    // Check if game scripts reference 'sounds/'
    let needsSounds = false;
    for (const f of fs.readdirSync(gPath)) {
      if (f.endsWith(".js") || f.endsWith(".html")) {
        const content = fs.readFileSync(path.join(gPath, f), "utf8");
        if (content.includes("sounds/") || content.includes(".mp3")) {
          needsSounds = true;
          break;
        }
      }
    }

    if (needsSounds) {
      const gSoundDir = path.join(gPath, "sounds");
      if (!fs.existsSync(gSoundDir)) fs.mkdirSync(gSoundDir, { recursive: true });
      for (const s of fs.readdirSync(commonSoundsDir)) {
        const dest = path.join(gSoundDir, s);
        if (!fs.existsSync(dest)) {
          fs.copyFileSync(path.join(commonSoundsDir, s), dest);
        }
      }
      console.log(`✅ Distributed sounds to game: ${game}`);
    }
  }

  console.log("\n🎉 --- All Missing Core Files & Sound Assets Mirrored & Distributed! ---");
}

main();
