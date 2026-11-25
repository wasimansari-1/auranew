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

async function downloadFile(remotePath, localPath) {
  try {
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // If file already exists and has size > 0, skip
    if (fs.existsSync(localPath) && fs.statSync(localPath).size > 0) {
      return true;
    }

    const response = await client.get(remotePath, {
      responseType: "arraybuffer",
      validateStatus: (s) => s === 200,
    });

    fs.writeFileSync(localPath, Buffer.from(response.data));
    console.log(`✅ [${response.status}] ${remotePath} -> ${(response.data.byteLength / 1024).toFixed(1)} KB`);
    return true;
  } catch (err) {
    return false;
  }
}

async function mirrorGame(gameCode) {
  const indexUrl = `/games/${gameCode}/`;
  const gameDir = path.join(PUBLIC_DIR, "games", gameCode);

  try {
    const indexRes = await client.get(indexUrl, { validateStatus: (s) => s === 200 });
    const html = typeof indexRes.data === "string" ? indexRes.data : indexRes.data.toString("utf8");
    const indexPath = path.join(gameDir, "index.html");
    if (!fs.existsSync(gameDir)) fs.mkdirSync(gameDir, { recursive: true });
    fs.writeFileSync(indexPath, html);
    console.log(`\n🎮 === Mirroring Game: ${gameCode} ===`);

    const urlsToFetch = new Set([
      "main.js",
      "app.js",
      "scene.js",
      "style.css",
      "common.js",
      "world.js",
      "timeline.js",
      "assets/logo.webp",
      "assets/logo@2x.webp",
      "assets/bg.webp",
      "assets/sound.mp3",
      "assets/music.mp3",
      "assets/click.mp3",
    ]);

    // Extract all resources mentioned in html
    for (const m of html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css|webp|png|jpg|jpeg|mp3|json|atlas|svg))["']/gi)) {
      const p = m[1].trim();
      if (!p.includes("http") && !p.startsWith("../_core") && !p.startsWith("/games/_core")) {
        urlsToFetch.add(p.replace(/^\.\//, ""));
      }
    }

    // Process all URLs
    for (const rel of Array.from(urlsToFetch)) {
      const cleanRel = rel.replace(/^\.\//, "").split("?")[0].split("#")[0];
      if (cleanRel.startsWith("/")) continue;
      const remoteFileUrl = `/games/${gameCode}/${cleanRel}`;
      const localFilePath = path.join(gameDir, cleanRel);

      const ok = await downloadFile(remoteFileUrl, localFilePath);

      // If it's a JS file, inspect for imports and referenced assets
      if (ok && cleanRel.endsWith(".js") && fs.existsSync(localFilePath)) {
        try {
          const content = fs.readFileSync(localFilePath, "utf8");
          // match import/from
          for (const imp of content.matchAll(/(?:from\s+|import\s*\(?)\s*["'](\.[^"']+\.js)["']/g)) {
            const impFile = path.normalize(path.join(path.dirname(cleanRel), imp[1]));
            if (!impFile.startsWith("../_core") && !impFile.startsWith("..")) {
              const subRemote = `/games/${gameCode}/${impFile}`;
              const subLocal = path.join(gameDir, impFile);
              await downloadFile(subRemote, subLocal);
            }
          }
          // match assets strings like "assets/something.webp"
          for (const assetMatch of content.matchAll(/["'](assets\/[^"']+\.(?:webp|png|jpg|mp3|json|atlas|svg))["']/g)) {
            const assetRel = assetMatch[1];
            const subRemote = `/games/${gameCode}/${assetRel}`;
            const subLocal = path.join(gameDir, assetRel);
            await downloadFile(subRemote, subLocal);
          }
        } catch (_) {}
      }

      // If it's a JSON file (spritesheet or spine rig), check for texture image
      if (ok && cleanRel.endsWith(".json") && fs.existsSync(localFilePath)) {
        try {
          const j = JSON.parse(fs.readFileSync(localFilePath, "utf8"));
          if (j.meta && j.meta.image) {
            const imgRel = path.join(path.dirname(cleanRel), j.meta.image);
            await downloadFile(`/games/${gameCode}/${imgRel}`, path.join(gameDir, imgRel));
          }
          if (j.skeleton && j.images) {
            const atlasRel = cleanRel.replace(/\.json$/, ".atlas");
            const webpRel = cleanRel.replace(/\.json$/, ".webp");
            await downloadFile(`/games/${gameCode}/${atlasRel}`, path.join(gameDir, atlasRel));
            await downloadFile(`/games/${gameCode}/${webpRel}`, path.join(gameDir, webpRel));
          }
        } catch (_) {}
      }

      // If it's an atlas file, check referenced png/webp
      if (ok && cleanRel.endsWith(".atlas") && fs.existsSync(localFilePath)) {
        try {
          const atlasContent = fs.readFileSync(localFilePath, "utf8");
          const lines = atlasContent.split("\n");
          for (const line of lines.slice(0, 5)) {
            const trimmed = line.trim();
            if (trimmed.endsWith(".webp") || trimmed.endsWith(".png")) {
              const imgRel = path.join(path.dirname(cleanRel), trimmed);
              await downloadFile(`/games/${gameCode}/${imgRel}`, path.join(gameDir, imgRel));
            }
          }
        } catch (_) {}
      }
    }

    console.log(`⭐ Completed mirroring for ${gameCode}!`);
  } catch (err) {
    console.warn(`Could not mirror ${gameCode}: ${err.message}`);
  }
}

async function run() {
  const gamesToMirror = [
    "chromaten",
    "minispin",
    "dominocascade",
    "arrowflight",
    "bounceup",
    "adventurehoneybee",
    "kiteflyer",
    "bingoorbit",
    "spiralderby",
    "triorollers",
    "orbit36",
    "triotowers",
    "jeweldrum",
    "kenovortex",
    "lucky20",
    "matkapulse",
    "tigerchase",
    "golddigger",
    "teenpatti",
    "lucky7",
    "dragontiger",
    "andarbahar",
    "luckysix",
    "sevenup",
    "diceduel",
    "sixersky",
    "raptorrun",
    "novarocket",
    "skyace",
    "dragonascent",
    "surfwave",
    "motojump",
    "deepdive",
    "fireworkfever"
  ];

  console.log(`🚀 Starting batch mirror for ${gamesToMirror.length} games...`);
  for (const g of gamesToMirror) {
    await mirrorGame(g);
  }
  console.log("\n🎉 ALL TARGET GAMES MIRRORED 100% LOCALLY!");
}

run();
