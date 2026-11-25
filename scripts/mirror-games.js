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

    const response = await client.get(remotePath, {
      responseType: "arraybuffer",
    });

    fs.writeFileSync(localPath, Buffer.from(response.data));
    console.log(
      `✅ [${response.status}] ${remotePath} -> ${(
        response.data.byteLength / 1024
      ).toFixed(1)} KB`
    );
    return true;
  } catch (err) {
    console.warn(`⚠️ [Skip] ${remotePath}: ${err.message}`);
    return false;
  }
}

async function mirrorCore() {
  console.log("\n📦 --- 1. Mirroring NexoRNG Core Engine Files ---");
  const coreFiles = [
    "/nexorng-config.js",
    "/favicon.ico",
    "/logo2.webp",
    "/games/_core/sound-unlock.js",
    "/games/_core/socket-auth.js",
    "/games/_core/secure-socket.js",
    "/games/_core/phrases.js",
    "/games/_core/crash-client.js",
    "/games/_core/players.js",
    "/games/_core/fit-screen.js",
    "/games/_core/fair.js",
    "/games/_core/maintenance.js",
    "/games/_core/vendor/three-0.170.0/three.module.min.js",
  ];

  for (const rel of coreFiles) {
    const dest = path.join(
      PUBLIC_DIR,
      rel.startsWith("/") ? rel.slice(1) : rel
    );
    await downloadFile(rel, dest);
  }
}

async function mirrorLobby() {
  console.log("\n🏛️ --- 2. Mirroring NexoRNG Lobby App & Assets ---");
  try {
    const res = await client.get("/lobby");
    fs.writeFileSync(path.join(PUBLIC_DIR, "lobby.html"), res.data);
    fs.writeFileSync(path.join(PUBLIC_DIR, "index.html"), res.data);

    // Find all JS/CSS in lobby HTML
    for (const m of res.data.matchAll(
      /(?:src|href)=["'](\/assets\/[^"']+)["']/g
    )) {
      const assetUrl = m[1];
      const localDest = path.join(PUBLIC_DIR, assetUrl.slice(1));
      await downloadFile(assetUrl, localDest);
    }
  } catch (err) {
    console.warn("Lobby mirror error:", err.message);
  }
}

async function mirrorGame(gameCode, gameUrl) {
  console.log(`\n🎮 --- 3. Mirroring Game: ${gameCode} (${gameUrl}) ---`);
  const indexUrl = `${gameUrl.replace(/\/+$/, "")}/`;
  const gameDir = path.join(PUBLIC_DIR, gameUrl.replace(/^\/+/, ""));

  try {
    const indexRes = await client.get(indexUrl);
    const html = indexRes.data;
    const indexPath = path.join(gameDir, "index.html");
    if (!fs.existsSync(gameDir)) fs.mkdirSync(gameDir, { recursive: true });
    fs.writeFileSync(indexPath, html);
    console.log(`✅ Saved ${gameCode} index.html`);

    const urlsToFetch = new Set([
      "main.js",
      "app.js",
      "scene.js",
      "style.css",
      "common.js",
      "world.js",
      "timeline.js",
      "jet.js",
      "assets/logo.webp",
      "assets/logo@2x.webp",
      "assets/city.webp",
      "assets/bg.webp",
      "assets/carpet.webp",
      "assets/sprite.webp",
      "assets/sheet.json",
      "assets/sound.mp3",
    ]);

    for (const m of html.matchAll(
      /(?:src|href)=["']([^"']+\.(?:js|css|webp|png|jpg|mp3|json|svg))["']/gi
    )) {
      if (!m[1].includes("http") && !m[1].startsWith("../_core")) {
        urlsToFetch.add(m[1].replace(/^\.\//, ""));
      }
    }

    for (const rel of urlsToFetch) {
      const cleanRel = rel.replace(/^\.\//, "").split("?")[0];
      const remoteFileUrl = `${indexUrl}${cleanRel}`;
      const localFilePath = path.join(gameDir, cleanRel);
      await downloadFile(remoteFileUrl, localFilePath);

      // Check for ES module imports in JS files
      if (cleanRel.endsWith(".js") && fs.existsSync(localFilePath)) {
        try {
          const content = fs.readFileSync(localFilePath, "utf8");
          for (const imp of content.matchAll(
            /from\s+["'](\.[^"']+\.js)["']/g
          )) {
            const impFile = path.normalize(
              path.join(path.dirname(cleanRel), imp[1])
            );
            if (!impFile.startsWith("../_core")) {
              const subRemote = `${indexUrl}${impFile}`;
              const subLocal = path.join(gameDir, impFile);
              await downloadFile(subRemote, subLocal);
            }
          }
        } catch (_) {}
      }
    }
  } catch (err) {
    console.warn(`Failed to mirror ${gameCode}:`, err.message);
  }
}

async function run() {
  await mirrorCore();
  await mirrorLobby();

  // Flagship games
  const targetGames = [
    { code: "vimaanlive", url: "/games/vimaan/" },
    { code: "aladdin", url: "/games/aladdin/" },
    { code: "shaktimaan", url: "/games/shaktimaan/" },
    { code: "sindbad", url: "/games/sindbad/" },
    { code: "alibaba", url: "/games/alibaba/" },
    { code: "sledrush", url: "/games/sledrush/" },
    { code: "balloon", url: "/games/balloon/" },
    { code: "jhandimunda", url: "/games/jhandimunda/" },
  ];

  for (const g of targetGames) {
    await mirrorGame(g.code, g.url);
  }

  console.log("\n🎉 --- All Core Engine & Target Games Mirrored Successfully! ---");
}

run();
