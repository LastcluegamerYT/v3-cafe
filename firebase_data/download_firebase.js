/**
 * ══════════════════════════════════════════════════════
 *  V3 Cafe — Firebase Data Downloader
 *  Downloads ALL data from Firebase Realtime DB
 *  + Converts base64 images → real image files
 *  + Organizes everything into firebase_data/
 * ══════════════════════════════════════════════════════
 *  Run: node download_firebase.js
 *  Node.js built-in only — no npm install needed
 * ══════════════════════════════════════════════════════
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

// ── Firebase Config ──────────────────────────────────
const DB_URL =
  "https://project-store-44fff-default-rtdb.asia-southeast1.firebasedatabase.app";

// ── Output Folders ───────────────────────────────────
const BASE_DIR = path.resolve(__dirname); // firebase_data/
const IMAGES_DIR = path.join(BASE_DIR, "images");
const RAW_DIR = path.join(BASE_DIR, "raw_json");

// ── Paths / collections to fetch ────────────────────
const COLLECTIONS = [
  "products",
  "leads",
  "analytics",
  "settings",
  "visitors",
  "productViews",
  "productClicks",
  "interestEvents",
];

// ── Helpers ──────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

function err(msg) {
  console.error(`[ERROR] ${msg}`);
}

/** Fetch JSON from Firebase REST endpoint */
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 30000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse failed for ${url}: ${e.message}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });
  });
}

/** Download a remote image URL → save as file */
function downloadImage(imageUrl, destPath) {
  return new Promise((resolve, reject) => {
    // Skip data URIs here — handled separately
    if (imageUrl.startsWith("data:")) {
      resolve(false);
      return;
    }

    const proto = imageUrl.startsWith("https") ? require("https") : require("http");
    const file = fs.createWriteStream(destPath);

    const request = proto.get(imageUrl, { timeout: 20000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        // Handle redirect
        file.close();
        fs.unlinkSync(destPath);
        downloadImage(res.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      res.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve(true);
      });
    });

    request.on("error", (e) => {
      file.close();
      try { fs.unlinkSync(destPath); } catch (_) {}
      reject(e);
    });

    request.on("timeout", () => {
      request.destroy();
      file.close();
      try { fs.unlinkSync(destPath); } catch (_) {}
      reject(new Error("Timeout"));
    });
  });
}

/**
 * Detect base64 image and return { ext, buffer } or null
 */
function parseBase64Image(value) {
  if (typeof value !== "string") return null;

  // data:image/jpeg;base64,....
  const match = value.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
  if (match) {
    const mime = match[1]; // e.g. image/webp
    const ext = mime.split("/")[1].replace("jpeg", "jpg").replace("svg+xml", "svg");
    const buffer = Buffer.from(match[2], "base64");
    return { ext, buffer, mime };
  }

  // Plain base64 (no header) — try to detect
  if (value.length > 100 && /^[A-Za-z0-9+/=]+$/.test(value.slice(0, 50))) {
    try {
      const buffer = Buffer.from(value, "base64");
      // Check magic bytes
      if (buffer[0] === 0xff && buffer[1] === 0xd8) return { ext: "jpg", buffer, mime: "image/jpeg" };
      if (buffer[0] === 0x89 && buffer[1] === 0x50) return { ext: "png", buffer, mime: "image/png" };
      if (buffer[0] === 0x47 && buffer[1] === 0x49) return { ext: "gif", buffer, mime: "image/gif" };
      if (buffer.slice(0, 4).toString() === "RIFF") return { ext: "webp", buffer, mime: "image/webp" };
    } catch (_) {}
  }

  return null;
}

/**
 * Walk a JS object, find all base64 or URL image fields,
 * extract them, save to disk, replace field value with local path.
 * Returns modified object.
 */
function processImages(obj, context, imageCounter) {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === "string") {
    // Check if it's a base64 image
    const b64 = parseBase64Image(obj);
    if (b64) {
      const count = ++imageCounter.n;
      const fname = `${context}_img_${count}.${b64.ext}`;
      const fpath = path.join(IMAGES_DIR, fname);
      fs.writeFileSync(fpath, b64.buffer);
      log(`  💾 Saved base64 image → images/${fname} (${(b64.buffer.length / 1024).toFixed(1)} KB)`);
      return `./images/${fname}`;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => processImages(item, context, imageCounter));
  }

  if (typeof obj === "object") {
    const result = {};
    for (const [key, val] of Object.entries(obj)) {
      if (key.startsWith("_")) {
        result[key] = val; // Keep original raw value without processing
      } else {
        result[key] = processImages(val, `${context}_${key}`, imageCounter);
      }
    }
    return result;
  }

  return obj;
}

/**
 * For image URL fields (not base64), download the actual file
 */
async function downloadProductImages(products) {
  const imgDir = path.join(IMAGES_DIR, "products");
  ensureDir(imgDir);

  let downloaded = 0;
  let skipped = 0;

  for (const [productId, product] of Object.entries(products || {})) {
    if (!product || typeof product !== "object") continue;

    const pDir = path.join(imgDir, productId);
    ensureDir(pDir);

    // Collect all image URLs from product
    const imageUrls = [];

    if (product.mainImage && typeof product.mainImage === "string" && !product.mainImage.startsWith("data:")) {
      imageUrls.push({ url: product.mainImage, label: "main" });
    }

    if (Array.isArray(product.images)) {
      product.images.forEach((img, i) => {
        const url = typeof img === "string" ? img : img?.url;
        if (url && typeof url === "string" && !url.startsWith("data:") && !url.startsWith("./")) {
          imageUrls.push({ url, label: `img_${i}` });
        }
      });
    }

    for (const { url, label } of imageUrls) {
      try {
        // Determine extension from URL
        const urlPath = url.split("?")[0];
        const ext = path.extname(urlPath).replace(".", "") || "jpg";
        const safeName = `${label}.${ext}`;
        const destPath = path.join(pDir, safeName);

        if (fs.existsSync(destPath)) {
          skipped++;
          continue;
        }

        await downloadImage(url, destPath);
        log(`  📥 Downloaded: products/${productId}/${safeName}`);
        downloaded++;
      } catch (e) {
        err(`  Failed to download image for ${productId}: ${e.message}`);
        skipped++;
      }
    }
  }

  log(`  ✅ Images: ${downloaded} downloaded, ${skipped} skipped/already exist`);
}

// ── Main ──────────────────────────────────────────────

async function main() {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║  V3 Cafe — Firebase Data Downloader     ║");
  console.log("╚══════════════════════════════════════════╝\n");

  ensureDir(BASE_DIR);
  ensureDir(IMAGES_DIR);
  ensureDir(RAW_DIR);

  const summary = {
    fetchedAt: new Date().toISOString(),
    collections: {},
  };

  // ── Step 1: Fetch all collections ────────────────
  log("📡 Fetching data from Firebase Realtime Database...\n");

  const allData = {};

  for (const col of COLLECTIONS) {
    try {
      log(`  Fetching: /${col} ...`);
      const url = `${DB_URL}/${col}.json`;
      const data = await fetchJSON(url);

      if (data === null) {
        log(`  ⚠️  /${col} — empty or not found`);
        summary.collections[col] = { count: 0, status: "empty" };
        allData[col] = null;
      } else {
        const count = typeof data === "object" ? Object.keys(data).length : 1;
        log(`  ✅ /${col} — ${count} record(s)`);
        summary.collections[col] = { count, status: "ok" };
        allData[col] = data;
      }

    } catch (e) {
      err(`  /${col} — ${e.message}`);
      summary.collections[col] = { count: 0, status: "error", error: e.message };
    }
  }

  // ── Step 2: Save raw JSON (original state) ───────
  log("\n💾 Saving raw JSON files...");

  for (const [col, data] of Object.entries(allData)) {
    if (data === null) continue;
    const rawPath = path.join(RAW_DIR, `${col}.json`);
    fs.writeFileSync(rawPath, JSON.stringify(data, null, 2), "utf8");
    log(`  ✅ raw_json/${col}.json`);
  }

  // Full dump
  fs.writeFileSync(
    path.join(RAW_DIR, "_ALL_DATA.json"),
    JSON.stringify(allData, null, 2),
    "utf8"
  );
  log("  ✅ raw_json/_ALL_DATA.json (full dump)");

  // ── Step 3: Process base64 images ────────────────
  // Inject original image references for products to enable smart live merging on the frontend
  if (allData.products && typeof allData.products === "object") {
    for (const [id, p] of Object.entries(allData.products)) {
      if (p && typeof p === "object") {
        p._originalMainImage = p.mainImage || "";
        p._originalImages = Array.isArray(p.images) ? JSON.parse(JSON.stringify(p.images)) : [];
      }
    }
  }

  log("\n🖼️  Processing base64 images (converting to real files)...");

  const processedData = {};
  for (const [col, data] of Object.entries(allData)) {
    if (data === null) { processedData[col] = null; continue; }
    const counter = { n: 0 };
    processedData[col] = processImages(data, col, counter);
    if (counter.n > 0) log(`  🎉 ${col}: extracted ${counter.n} base64 image(s)`);
  }

  // ── Step 4: Download product images from URLs ────
  if (allData.products) {
    log("\n📥 Downloading product images from URLs...");
    await downloadProductImages(allData.products);
  }

  // ── Step 5: Save processed JSON (base64 → paths) ─
  log("\n💾 Saving processed JSON files...");

  const processedDir = path.join(BASE_DIR, "processed_json");
  ensureDir(processedDir);

  for (const [col, data] of Object.entries(processedData)) {
    if (data === null) continue;
    const procPath = path.join(processedDir, `${col}.json`);
    fs.writeFileSync(procPath, JSON.stringify(data, null, 2), "utf8");
    log(`  ✅ processed_json/${col}.json`);
  }

  fs.writeFileSync(
    path.join(processedDir, "_ALL_DATA.json"),
    JSON.stringify(processedData, null, 2),
    "utf8"
  );
  log("  ✅ processed_json/_ALL_DATA.json (full processed dump)");

  // ── Step 6: Generate readable report ─────────────
  log("\n📊 Generating summary report...");

  summary.processedAt = new Date().toISOString();

  // Per-product image map
  if (allData.products) {
    summary.products = [];
    for (const [id, p] of Object.entries(allData.products || {})) {
      if (!p) continue;
      summary.products.push({
        id,
        title: p.title || "—",
        category: p.category || "—",
        price: p.price || 0,
        availability: p.availability || "—",
        featured: p.featured || false,
        mainImage: p.mainImage
          ? p.mainImage.startsWith("data:")
            ? "[base64 image]"
            : p.mainImage
          : "—",
        imageCount: Array.isArray(p.images) ? p.images.length : 0,
        views: p.views || 0,
        clicks: p.clicks || 0,
      });
    }
  }

  if (allData.leads) {
    summary.leadsCount = Object.keys(allData.leads).length;
    summary.leads = Object.entries(allData.leads || {}).map(([id, l]) => ({
      id,
      phone: l.phone || "—",
      name: l.name || "—",
      source: l.source || "—",
      date: l.createdAt ? new Date(l.createdAt).toLocaleString() : "—",
    }));
  }

  fs.writeFileSync(
    path.join(BASE_DIR, "summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8"
  );
  log("  ✅ summary.json");

  // ── Step 7: Human-readable text report ───────────
  const lines = [
    "══════════════════════════════════════════════════",
    "  V3 Cafe — Firebase Data Export Report",
    `  Generated: ${new Date().toLocaleString()}`,
    "══════════════════════════════════════════════════",
    "",
    "📦 COLLECTIONS",
    "──────────────────────────────────────────────────",
  ];

  for (const [col, info] of Object.entries(summary.collections)) {
    lines.push(`  ${info.status === "ok" ? "✅" : "⚠️"} /${col.padEnd(20)} ${info.count} records`);
  }

  if (summary.products?.length) {
    lines.push("");
    lines.push("🧁 PRODUCTS");
    lines.push("──────────────────────────────────────────────────");
    for (const p of summary.products) {
      lines.push(`  [${p.id}]`);
      lines.push(`    Title:        ${p.title}`);
      lines.push(`    Category:     ${p.category}`);
      lines.push(`    Price:        Rs. ${p.price}`);
      lines.push(`    Availability: ${p.availability}`);
      lines.push(`    Featured:     ${p.featured}`);
      lines.push(`    Images:       ${p.imageCount}`);
      lines.push(`    Views/Clicks: ${p.views} / ${p.clicks}`);
      lines.push("");
    }
  }

  if (summary.leads?.length) {
    lines.push("👥 LEADS");
    lines.push("──────────────────────────────────────────────────");
    for (const l of summary.leads) {
      lines.push(`  Phone: ${l.phone}  Name: ${l.name}  Source: ${l.source}  Date: ${l.date}`);
    }
  }

  lines.push("");
  lines.push("══════════════════════════════════════════════════");
  lines.push("  Files saved in: firebase_data/");
  lines.push("  raw_json/     ← Original Firebase data as JSON");
  lines.push("  processed_json/ ← Base64 replaced with file paths");
  lines.push("  images/       ← All extracted & downloaded images");
  lines.push("══════════════════════════════════════════════════");

  fs.writeFileSync(path.join(BASE_DIR, "report.txt"), lines.join("\n"), "utf8");
  log("  ✅ report.txt");

  // ── Done ──────────────────────────────────────────
  console.log("\n" + lines.join("\n"));
  console.log("\n✅ Done! All data saved to: firebase_data/\n");
}

main().catch((e) => {
  err(e.message);
  process.exit(1);
});
