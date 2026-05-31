/**
 * app-local-data.js
 * ══════════════════════════════════════════════════════════════════
 *  HYBRID DATA SYSTEM — V3 Cafe
 *
 *  HOW IT WORKS:
 *  ─────────────
 *  1. INSTANT LOAD  → Fetch /firebase_data/processed_json/products.json
 *                     (served as a static file = blazing fast, no Firebase latency)
 *                     Images are also local files in /firebase_data/images/
 *
 *  2. LIVE SYNC     → Firebase onValue subscription runs in background.
 *                     Detects any admin changes (price, name, availability,
 *                     new products, deleted products, image swaps).
 *
 *  3. SMART MERGE   → For existing products: keep local images (fast),
 *                     but apply all metadata changes from Firebase.
 *                     For NEW products: use Firebase image URLs directly.
 *                     For DELETED products: remove from UI instantly.
 *
 *  This gives you:
 *  ✅ Sub-100ms first paint (local JSON + local images)
 *  ✅ Zero stale data (Firebase keeps everything live)
 *  ✅ Works offline for existing products (service worker can cache local files)
 *  ✅ New products from admin appear automatically
 * ══════════════════════════════════════════════════════════════════
 */

// ── Path to the local static data folder (relative to customer/) ──
const LOCAL_DATA_BASE = "../firebase_data";
const LOCAL_JSON_URL  = `${LOCAL_DATA_BASE}/processed_json/products.json`;
const LOCAL_IMG_BASE  = `${LOCAL_DATA_BASE}/images`;

// ── In-memory state ──────────────────────────────────────────────
let _localProducts  = null;   // Products from local JSON (snapshot)
let _liveProducts   = null;   // Live merged products (local + Firebase)
let _localProductIds = new Set(); // IDs we have locally (for image routing)
let _changeListeners = [];    // Callbacks registered externally

// ────────────────────────────────────────────────────────────────
//  STEP 1 — Load local snapshot (instant, static file)
// ────────────────────────────────────────────────────────────────

/**
 * Fetch the static products.json from firebase_data/.
 * Returns an array of normalized product objects, images pointing to local files.
 */
export async function loadLocalProducts() {
    if (_localProducts) return _localProducts;

    try {
        const resp = await fetch(LOCAL_JSON_URL + "?v=" + _buildVersion());
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const raw = await resp.json(); // object keyed by productId

        // Convert to array + resolve relative image paths → absolute relative URLs
        const list = Object.values(raw)
            .filter(Boolean)
            .map(p => _resolveLocalImages(p));

        _localProducts = _sortProducts(list);
        _localProductIds = new Set(_localProducts.map(p => p.id));

        return _localProducts;
    } catch (e) {
        console.warn("[local-data] Could not load local JSON, will use Firebase only:", e.message);
        _localProducts = [];
        return [];
    }
}

/**
 * Fix relative image paths from the JSON file so they work from /customer/ route.
 * JSON has: "./images/products_xxx.webp"
 * We need:  "../firebase_data/images/products_xxx.webp"
 */
function _resolveLocalImages(product) {
    const fix = (url) => {
        if (!url || typeof url !== "string") return url;
        // If already absolute or Firebase URL — leave it
        if (url.startsWith("http") || url.startsWith("data:")) return url;
        // Strip leading "./" then prepend correct path
        const filename = url.replace(/^\.\/images\//, "");
        return `${LOCAL_IMG_BASE}/${filename}`;
    };

    return {
        ...product,
        mainImage: fix(product.mainImage),
        images: Array.isArray(product.images)
            ? product.images.map(img => ({
                ...img,
                url: fix(img.url)
              }))
            : [],
        // Tag that this product has local images available
        _hasLocalImages: true,
    };
}

// ────────────────────────────────────────────────────────────────
//  STEP 2 — Firebase live sync
// ────────────────────────────────────────────────────────────────

import { db } from "../connection/connection.js";
import { ref, onValue } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

let _unsubscribe = null;

/**
 * Start listening to Firebase for real-time changes.
 * When products change, merges with local data and calls all listeners.
 *
 * @param {Function} onUpdate - Called with merged products array whenever data changes
 */
export function startLiveSync(onUpdate) {
    if (typeof onUpdate === "function") {
        _changeListeners.push(onUpdate);
    }

    // Only register one Firebase listener (shared across all callers)
    if (_unsubscribe) return;

    _unsubscribe = onValue(
        ref(db, "products"),
        (snapshot) => {
            _handleFirebaseUpdate(snapshot.val());
        },
        (err) => {
            console.warn("[local-data] Firebase sync error:", err.message);
        }
    );
}

/**
 * Stop the Firebase listener (call on page unload)
 */
export function stopLiveSync() {
    if (_unsubscribe) {
        _unsubscribe();
        _unsubscribe = null;
    }
    _changeListeners = [];
}

/**
 * Core merge logic: takes raw Firebase snapshot and merges with local data.
 *
 * Rules:
 *  • Product exists locally + unchanged image → keep local image (fast), update metadata
 *  • Product exists locally + image changed in Firebase → switch to Firebase image URL
 *  • New product (not in local) → use Firebase data + URLs
 *  • Product in local but DELETED in Firebase → excluded from result
 */
function _handleFirebaseUpdate(rawFirebase) {
    if (!rawFirebase || typeof rawFirebase !== "object") {
        // Firebase returned null = no products
        _liveProducts = [];
        _notifyListeners([]);
        return;
    }

    const firebaseMap = new Map(Object.entries(rawFirebase));
    const localMap    = new Map((_localProducts || []).map(p => [p.id, p]));
    const merged      = [];

    for (const [id, fbProduct] of firebaseMap) {
        if (!fbProduct || typeof fbProduct !== "object") continue;

        const localProduct = localMap.get(id);
        const normalized   = _normalizeFirebaseProduct(fbProduct, id);

        if (localProduct) {
            // ── Existing product: merge ──────────────────────────────
            const localMainImgKey  = _extractFirebaseUrl(localProduct._originalMainImage || "");
            const firebaseMainImgKey = _extractFirebaseUrl(fbProduct.mainImage || "");

            // Check if admin changed the main image
            const mainImageChanged = localMainImgKey !== firebaseMainImgKey && !!firebaseMainImgKey;

            // Check if admin changed any gallery images
            const localImgUrls    = (localProduct._originalImages || []).map(i => _extractFirebaseUrl(i.url || i)).join(",");
            const fbImgUrls       = _getFirebaseImageUrls(fbProduct.images).join(",");
            const galleryChanged  = localImgUrls !== fbImgUrls && !!fbImgUrls;

            merged.push({
                ...normalized,
                // Keep local images unless admin changed them
                mainImage: mainImageChanged ? fbProduct.mainImage : localProduct.mainImage,
                images:    galleryChanged
                    ? normalized.images  // Use Firebase images (new ones)
                    : localProduct.images, // Keep local fast images
                _hasLocalImages: !mainImageChanged && !galleryChanged,
                _isLiveUpdate: true,
            });
        } else {
            // ── New product added by admin ───────────────────────────
            merged.push({
                ...normalized,
                _hasLocalImages: false,
                _isNewProduct: true,
            });
        }
    }

    _liveProducts = _sortProducts(merged);
    _notifyListeners(_liveProducts);
}

function _notifyListeners(products) {
    for (const fn of _changeListeners) {
        try { fn(products.slice()); } catch (e) { console.warn("[local-data] listener error:", e); }
    }
}

// ────────────────────────────────────────────────────────────────
//  STEP 3 — Accessors
// ────────────────────────────────────────────────────────────────

/** Get current merged products (call after loadLocalProducts + startLiveSync) */
export function getLiveProducts() {
    return (_liveProducts || _localProducts || []).slice();
}

/** Check if a product ID has local images */
export function hasLocalImages(productId) {
    return _localProductIds.has(productId);
}

// ────────────────────────────────────────────────────────────────
//  Internal helpers
// ────────────────────────────────────────────────────────────────

function _normalizeFirebaseProduct(p, id) {
    const images = _normalizeImages(p.images);
    const mainImage = (p.mainImage && typeof p.mainImage === "string")
        ? p.mainImage
        : (images[0]?.url || "");

    return {
        id:            id || p.id || "",
        slug:          p.slug || _slugify(p.title || id),
        title:         (p.title || "").trim(),
        description:   (p.description || "").trim(),
        category:      (p.category || "General").trim(),
        price:         Number(p.price) || 0,
        availability:  (p.availability || "available").trim(),
        status:        (p.status || "active").trim(),
        mainImage,
        images,
        tags:          Array.isArray(p.tags) ? p.tags : [],
        ingredients:   Array.isArray(p.ingredients) ? p.ingredients : [],
        note:          (p.note || "").trim(),
        whatsappText:  (p.whatsappText || "").trim(),
        featured:      Boolean(p.featured),
        orderRank:     Number(p.orderRank) || 0,
        views:         Number(p.views) || 0,
        clicks:        Number(p.clicks) || 0,
        createdAt:     Number(p.createdAt) || 0,
        updatedAt:     Number(p.updatedAt) || 0,
        meta:          (p.meta && typeof p.meta === "object") ? p.meta : {},
        // Store original Firebase URLs for change detection
        _originalMainImage: p.mainImage || "",
        _originalImages:    _normalizeImages(p.images),
    };
}

function _normalizeImages(images) {
    if (!Array.isArray(images)) return [];
    return images
        .map((img, i) => {
            if (typeof img === "string") return { url: img, alt: "", order: i };
            if (img && typeof img === "object") {
                return {
                    url:   img.url || img.src || img.image || "",
                    alt:   img.alt || img.title || "",
                    order: Number.isFinite(img.order) ? img.order : i,
                };
            }
            return null;
        })
        .filter(img => img && img.url)
        .sort((a, b) => a.order - b.order);
}

function _getFirebaseImageUrls(images) {
    if (!Array.isArray(images)) return [];
    return images.map(img => {
        const url = typeof img === "string" ? img : img?.url || "";
        return _extractFirebaseUrl(url);
    }).filter(Boolean);
}

/**
 * Extract a stable key from a Firebase Storage URL (strips auth tokens).
 * Firebase Storage URLs look like:
 * https://firebasestorage.googleapis.com/v0/b/xxx/o/path%2Ffile.jpg?alt=media&token=xxx
 * We only compare the path part (before ?).
 */
function _extractFirebaseUrl(url) {
    if (!url || typeof url !== "string") return "";
    try { return url.split("?")[0]; } catch (_) { return url; }
}

function _sortProducts(list) {
    return list.sort((a, b) => {
        if (a.featured !== b.featured) return a.featured ? -1 : 1;
        if (a.orderRank !== b.orderRank) return b.orderRank - a.orderRank;
        return b.updatedAt - a.updatedAt;
    });
}

function _slugify(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "item";
}

function _buildVersion() {
    // Use date (YYYYMMDD) so cache busts on new day but stays stable within the day
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
}
