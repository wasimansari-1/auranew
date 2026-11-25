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
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept: "*/*",
  },
});

async function download(remotePath, localPath, forceOverwrite = false) {
  try {
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (!forceOverwrite && fs.existsSync(localPath) && fs.statSync(localPath).size > 0) {
      return true;
    }

    const res = await client.get(remotePath, {
      responseType: "arraybuffer",
      validateStatus: (s) => s === 200,
    });

    fs.writeFileSync(localPath, Buffer.from(res.data));
    console.log(`✅ [${res.status}] ${remotePath} -> ${(res.data.byteLength / 1024).toFixed(1)} KB`);
    return true;
  } catch (err) {
    return false;
  }
}

async function mirrorAllCards() {
  console.log("\n🎨 === 1. Mirroring Real Unique Card Artworks for All Games ===");
  const cardsDir = path.join(PUBLIC_DIR, "cards");
  const games = fs.readdirSync(cardsDir);

  for (const g of games) {
    const gDir = path.join(cardsDir, g);
    if (!fs.statSync(gDir).isDirectory()) continue;

    for (const img of ["card.webp", "poster.webp", "hero.webp", "logo.webp"]) {
      const remote = `/cards/${g}/${img}`;
      const local = path.join(gDir, img);
      // Force overwrite to replace any dummy vimaan plane copies with real game artworks!
      await download(remote, local, true);
    }
  }
}

async function deepMirrorGame(gameCode) {
  console.log(`\n🎮 === Deep Scanning & Mirroring Game Assets: ${gameCode} ===`);
  const gameDir = path.join(PUBLIC_DIR, "games", gameCode);
  if (!fs.existsSync(gameDir)) fs.mkdirSync(gameDir, { recursive: true });

  const queue = new Set();

  // Scan all existing files in gameDir to find un-downloaded dependencies
  function scanDir(dir) {
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) {
        scanDir(full);
      } else if (f.endsWith(".js") || f.endsWith(".html") || f.endsWith(".css")) {
        const text = fs.readFileSync(full, "utf8");
        // match imports: import ... from './something.js'
        for (const m of text.matchAll(/(?:from\s+|import\s*\(?)\s*["'](\.[^"']+\.js)["']/g)) {
          const rel = path.normalize(path.join(path.relative(gameDir, dir), m[1]));
          if (!rel.startsWith("..")) queue.add(rel);
        }
        // match asset strings: "assets/something.webp", "something.js", "something.bin", "something.glb"
        for (const m of text.matchAll(/["']([^"'\s]+\.(?:webp|png|jpg|jpeg|mp3|json|atlas|bin|glb|gltf|svg|js))["']/g)) {
          const p = m[1];
          if (!p.startsWith("http") && !p.startsWith("/") && !p.startsWith("../_core") && !p.startsWith("data:")) {
            const rel = path.normalize(path.join(path.relative(gameDir, dir), p));
            if (!rel.startsWith("..")) queue.add(rel);
          }
        }
      }
    }
  }

  scanDir(gameDir);

  // Common modules/assets in 3D crash games
  const commonGuesses = [
    "falcon.js",
    "falconer.js",
    "models.js",
    "world.js",
    "timeline.js",
    "scene.js",
    "app.js",
    "main.js",
    "common.js",
    "audio.js",
    "rules.js",
    "style.css",
    "assets/sand-col.webp",
    "assets/sand-nor.webp",
    "assets/rock-col.webp",
    "assets/rock-nor.webp",
    "assets/clouds.webp",
    "assets/feather.webp",
    "assets/nexorng.webp",
    "assets/nx.webp",
    "assets/brand-nx.webp",
    "assets/logo.webp",
    "assets/logo@2x.webp",
    "assets/bg.webp",
    "assets/sound.mp3",
    "assets/music.mp3",
    "wheel.json"
  ];
  for (const guess of commonGuesses) queue.add(guess);

  const downloaded = new Set();
  while (queue.size > 0) {
    const item = Array.from(queue)[0];
    queue.delete(item);
    if (downloaded.has(item)) continue;
    downloaded.add(item);

    const remote = `/games/${gameCode}/${item}`;
    const local = path.join(gameDir, item);

    const ok = await download(remote, local, false);
    if (ok && item.endsWith(".js") && fs.existsSync(local)) {
      try {
        const text = fs.readFileSync(local, "utf8");
        for (const m of text.matchAll(/(?:from\s+|import\s*\(?)\s*["'](\.[^"']+\.js)["']/g)) {
          const rel = path.normalize(path.join(path.dirname(item), m[1]));
          if (!rel.startsWith("..") && !downloaded.has(rel)) queue.add(rel);
        }
        for (const m of text.matchAll(/["'](assets\/[^"'\s]+\.(?:webp|png|jpg|jpeg|mp3|json|atlas|bin|glb|gltf|svg))["']/g)) {
          const p = m[1];
          if (!downloaded.has(p)) queue.add(p);
        }
      } catch (_) {}
    }
  }
}

async function main() {
  await mirrorAllCards();

  const gamesDir = path.join(PUBLIC_DIR, "games");
  const games = fs.readdirSync(gamesDir).filter((g) => g !== "_core" && fs.statSync(path.join(gamesDir, g)).isDirectory());

  for (const g of games) {
    await deepMirrorGame(g);
  }

  console.log("\n🎉 === ALL REAL GAME ARTWORKS, CHARACTERS & 3D ASSETS MIRRORED LOCALLY! ===");
}

main();

