import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GAMES_CATALOG } from "../backend/config/gamesCatalog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const GAMES_DIR = path.join(PUBLIC_DIR, "games");

const BASE_URL = "https://launch.nexorng.com";
const client = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept: "*/*",
  },
});

async function download(remotePath, localPath) {
  try {
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (fs.existsSync(localPath) && fs.statSync(localPath).size > 0) {
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

// Global sounds directory for fallback
const GLOBAL_SOUNDS_DIR = path.join(PUBLIC_DIR, "sounds");

function findSoundFallback(filename) {
  // Check public/sounds
  const inPublicSounds = path.join(GLOBAL_SOUNDS_DIR, filename);
  if (fs.existsSync(inPublicSounds)) return inPublicSounds;

  // Search in all other games
  const allGames = fs.readdirSync(GAMES_DIR);
  for (const g of allGames) {
    const gSounds = path.join(GAMES_DIR, g, "sounds", filename);
    if (fs.existsSync(gSounds)) return gSounds;
    const gAssetsSounds = path.join(GAMES_DIR, g, "assets", "sounds", filename);
    if (fs.existsSync(gAssetsSounds)) return gAssetsSounds;
  }
  return null;
}

async function scanAndMirrorAllGames() {
  console.log("🚀 Starting deep asset mirror for all 45 games...");

  for (const game of GAMES_CATALOG) {
    const code = game.code;
    const gameDir = path.join(GAMES_DIR, code);
    if (!fs.existsSync(gameDir)) {
      console.log(`⚠️ Game directory ${code} missing, attempting to fetch index.html`);
      fs.mkdirSync(gameDir, { recursive: true });
      await download(`/games/${code}/index.html`, path.join(gameDir, "index.html"));
    }

    if (!fs.existsSync(path.join(gameDir, "index.html"))) continue;

    // Collect all candidate assets referenced in this game
    const candidateAssets = new Set();

    function scan(dir) {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        const full = path.join(dir, entry);
        if (fs.statSync(full).isDirectory()) {
          scan(full);
        } else if (entry.endsWith(".html") || entry.endsWith(".js") || entry.endsWith(".css")) {
          const content = fs.readFileSync(full, "utf-8");
          // Match paths ending in webp, png, mp3, glb, json, atlas, bin, wasm, svg
          const matches = content.matchAll(/["']([^"'\s`<>:]+\.(?:webp|png|jpg|jpeg|mp3|glb|gltf|json|atlas|bin|wasm|svg))["']/g);
          for (const m of matches) {
            let ref = m[1].split("?")[0].split("#")[0];
            if (ref.startsWith("/") || ref.startsWith("http") || ref.startsWith("data:")) continue;
            candidateAssets.add(ref);
          }
        }
      }
    }

    scan(gameDir);

    // Try to resolve each candidate
    for (const asset of candidateAssets) {
      // Possible local locations
      const directLocal = path.join(gameDir, asset);
      const inAssets = path.join(gameDir, "assets", asset);
      const inSounds = path.join(gameDir, "sounds", asset);

      if (fs.existsSync(directLocal) || fs.existsSync(inAssets) || fs.existsSync(inSounds)) {
        continue; // Already exists
      }

      // Try downloading from upstream
      const remoteCandidates = [
        `/games/${code}/${asset}`,
        `/games/${code}/assets/${asset}`,
        `/games/${code}/sounds/${asset}`,
      ];

      let downloaded = false;
      for (const rPath of remoteCandidates) {
        let dest = directLocal;
        if (rPath.includes("/assets/")) dest = inAssets;
        else if (rPath.includes("/sounds/")) dest = inSounds;

        const ok = await download(rPath, dest);
        if (ok) {
          downloaded = true;
          break;
        }
      }

      // If it is an mp3 sound and failed to download from upstream, find local fallback
      if (!downloaded && asset.endsWith(".mp3")) {
        const baseName = path.basename(asset);
        const fallback = findSoundFallback(baseName);
        if (fallback) {
          const dest = path.join(gameDir, "sounds", baseName);
          const destDir = path.dirname(dest);
          if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
          fs.copyFileSync(fallback, dest);
          console.log(`🎵 [Fallback Sound] ${baseName} -> ${code}/sounds/`);
        }
      }
    }
  }

  console.log("\n✅ Deep asset scan and mirror complete!");
}

scanAndMirrorAllGames();
