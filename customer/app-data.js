// app-data.js — All Firebase / data operations for customer panel
// Uses NAMED exports from connection.js (not just the default object)
// ── HYBRID MODE: local firebase_data/ snapshot + Firebase live sync ──

import {
    db,
    addLead,
    trackPageView,
    trackInterest,
    incrementProductView,
    incrementProductClick,
    buildWhatsAppUrl,
    buildShareLink,
    buildProductDetail,
    subscribeLeads,
    shouldShowLeadPopup,
    markLeadPopupSeen
} from "../connection/connection.js?v=2";

// ── Local-first data system ──────────────────────────────────────
import {
    loadLocalProducts,
    startNewProductSync,
    startLiveSync,
    stopLiveSync,
    getLiveProducts,
} from "./app-local-data.js";

// Re-export what other modules need
export {
    db,
    addLead,
    trackPageView,
    trackInterest,
    incrementProductView,
    incrementProductClick,
    buildWhatsAppUrl,
    buildShareLink,
    buildProductDetail,
    subscribeLeads,
    shouldShowLeadPopup,
    markLeadPopupSeen,
    // Local-data system
    startNewProductSync,
    startLiveSync,
    stopLiveSync,
    getLiveProducts,
};

// ══════════════════════════════════════════
//  SHOP SETTINGS (from Firebase)
// ══════════════════════════════════════════
import { ref, get } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

let _shopSettings    = null;
let _settingsFetched = false;
let _cachedWaNumber  = ""; // sync-ccessible after preloaad

export async function getShopSettings() {
    if (_settingsFetched) return _shopSettings || {};
    
    // 1. Try to load from localStorage first (Instant Load)
    let cachedStr = null;
    try { cachedStr = localStorage.getItem("v3_shopSettings"); } catch(e) {}
    
    if (cachedStr) {
        try {
            _shopSettings = JSON.parse(cachedStr);
            _cachedWaNumber = ((_shopSettings && _shopSettings.whatsapp)
                ? String(_shopSettings.whatsapp) : "").replace(/\D/g, "");
            _settingsFetched = true;
            
            // 2. Silently fetch from Firebase in background to keep cache fresh for next visit
            get(ref(db, "settings/shop")).then(snap => {
                if (snap.exists()) {
                    try { localStorage.setItem("v3_shopSettings", JSON.stringify(snap.val())); } catch(e) {}
                }
            }).catch(() => {});
            
            return _shopSettings;
        } catch(e) {}
    }

    // 3. Fallback: Fetch directly if no cache exists
    try {
        const snap = await get(ref(db, "settings/shop"));
        _shopSettings = snap.exists() ? snap.val() : {};
        try { localStorage.setItem("v3_shopSettings", JSON.stringify(_shopSettings)); } catch(e) {}
    } catch (_) {
        _shopSettings = {};
    }
    
    // Cache WA number for sync access
    _cachedWaNumber = ((_shopSettings && _shopSettings.whatsapp)
        ? String(_shopSettings.whatsapp) : "").replace(/\D/g, "");
    _settingsFetched = true;
    return _shopSettings;
}

export function clearSettingsCache() {
    _shopSettings    = null;
    _settingsFetched = false;
    _cachedWaNumber  = "";
}

// Async version (for settings UI / initial load)
export async function getWhatsAppNumber() {
    await getShopSettings(); // ensures cache is populated
    return _cachedWaNumber || "";
}

// Synchronous version — safe to call from a click handler with NO await
// Returns "" if settings not loaded yet (preloadSettings() must have run first)
export function getWhatsAppNumberSync() {
    return _cachedWaNumber || "";
}

// ══════════════════════════════════════════
//  PRODUCTS — hybrid local-first layer
// ══════════════════════════════════════════
let _allProducts = null; // in-memory cache

/**
 * Load products with INSTANT local-first strategy:
 *  1. Load from /firebase_data/processed_json/products.json (static file, fast)
 *  2. If local fails, fallback to Firebase
 *
 * After this call, startLiveSync() (called in app-main.js) keeps data updated.
 */
export async function fetchAllProducts(force = false) {
    if (_allProducts && !force) return _allProducts;

    // ── Priority 1: Local static JSON (instant — no Firebase latency) ──
    try {
        const localProducts = await loadLocalProducts();
        if (localProducts && localProducts.length > 0) {
            _allProducts = localProducts;
            console.log(`[data] ✅ Loaded ${localProducts.length} products from local cache (fast)`); 
            return _allProducts.slice();
        }
    } catch (e) {
        console.warn("[data] Local load failed, falling back to Firebase:", e.message);
    }

    // ── Priority 2: Firebase direct fetch (fallback when local not available) ──
    try {
        const { getAllProducts } = await import("../connection/connection.js");
        _allProducts = await getAllProducts({ force: true });
        console.log(`[data] 🔥 Loaded ${_allProducts.length} products from Firebase (fallback)`);
        return _allProducts.slice();
    } catch (err) {
        console.error("[data] fetchAllProducts Firebase fallback failed:", err);
        return _allProducts || [];
    }
}

/**
 * Called by the live sync when Firebase sends updated data.
 * Updates in-memory cache and re-renders the UI.
 */
export function updateLocalProductsCache(freshProducts) {
    _allProducts = freshProducts;
    // Note: we do NOT write to localStorage anymore since local static files
    // are the source of truth for images. Firebase handles live metadata.
}

export async function fetchFeatured(limit = 6) {
    try {
        // Use getLiveProducts() for the most current merged data (local + Firebase)
        const all = getLiveProducts().length > 0 ? getLiveProducts() : await fetchAllProducts();
        return all.filter(p => p.featured && p.status !== "deleted").slice(0, limit);
    } catch (err) {
        console.error("[data] fetchFeatured:", err);
        return [];
    }
}

export async function fetchProductDetail(idOrSlug) {
    if (!idOrSlug) return null;
    try {
        // 1. Check live products first (most up-to-date)
        const live = getLiveProducts();
        if (live.length > 0) {
            const found = live.find(p => p.id === idOrSlug || p.slug === idOrSlug);
            if (found) return found;
        }
        // 2. Check local cache
        if (_allProducts) {
            const cached = _allProducts.find(p => p.id === idOrSlug || p.slug === idOrSlug);
            if (cached) return cached;
        }
        // 3. Fallback: dynamic import from Firebase
        try {
            const { getProductForRoute } = await import("../connection/connection.js");
            return await getProductForRoute({ slug: idOrSlug }) ||
                   await getProductForRoute({ id: idOrSlug });
        } catch (_) { return null; }
    } catch (err) {
        console.error("[data] fetchProductDetail:", err);
        return null;
    }
}

export async function fetchByCategory(category) {
    if (!category || category === "all") return fetchAllProducts();
    try {
        const all = getLiveProducts().length > 0 ? getLiveProducts() : await fetchAllProducts();
        return all.filter(p => (p.category || "").toLowerCase() === category.toLowerCase());
    } catch (err) {
        console.error("[data] fetchByCategory:", err);
        return [];
    }
}

// ── Utilities ──
export function extractCategories(products) {
    const seen = new Set();
    const cats = [];
    for (const p of (products || [])) {
        const c = p.category;
        if (c && !seen.has(c)) { seen.add(c); cats.push(c); }
    }
    return cats;
}

export function getCategoryEmoji(cat) {
    const map = {
        "Cake": "🎂", "Pastry": "🥐", "Cupcake": "🧁",
        "Cookie": "🍪", "Bread": "🍞", "Drink": "🥤",
        "Dessert": "🍮", "Custom": "🎨", "General": "🍽️", "Other": "📦"
    };
    return map[cat] || "🍽️";
}

// ══════════════════════════════════════════
//  ANALYTICS — fire-and-forget wrappers
// ══════════════════════════════════════════
export function safeTrackPageView(path) {
    try {
        trackPageView({ path, userAgent: navigator.userAgent || "" }).catch(() => {});
    } catch (_) {}
}

export function safeTrackProductView(id) {
    if (!id) return;
    try { incrementProductView(id).catch(() => {}); } catch (_) {}
}

export function safeTrackProductClick(id) {
    if (!id) return;
    try { incrementProductClick(id).catch(() => {}); } catch (_) {}
}

export function safeTrackInterest(opts = {}) {
    try { trackInterest(opts).catch(() => {}); } catch (_) {}
}

// ══════════════════════════════════════════
//  LEADS
// ══════════════════════════════════════════
export async function submitLead({ phone, name = "", source = "popup", page = "", productId = "" }) {
    const cleanPhone = String(phone || "").replace(/\D/g, "");
    if (!cleanPhone || cleanPhone.length < 7) {
        throw new Error("Please enter a valid phone number (at least 7 digits).");
    }
    const payload = {
        phone:     cleanPhone,
        name:      String(name  || "").trim(),
        source,
        page:      page || (typeof window !== "undefined" ? window.location.pathname : "/"),
        productId: productId || ""
    };
    await addLead(payload);
    safeTrackInterest({ type: source, phone: cleanPhone, page: payload.page });
    markLeadPopupSeen();
    return payload;
}

// ══════════════════════════════════════════
//  WHATSAPP URL BUILDERS
// ══════════════════════════════════════════

// ── Shared message composer (pure sync, no network) ──
function _composeOrderMessage(product, qty, pickupTime = "") {
    const salePrice = Number(product.price) || 0;
    const origPrice = Number(product.meta?.originalPrice) || 0;

    const discountLine = (origPrice > 0 && origPrice > salePrice)
        ? `Orig: Rs.${origPrice.toLocaleString()} → Sale: Rs.${salePrice.toLocaleString()} (${Math.round((1 - salePrice / origPrice) * 100)}% OFF)`
        : `Rs.${salePrice.toLocaleString()}`;

    const lines = [
        `Hello! 🙏 I'd like to *pre-order* from *V3 Cafe*`,
        ``,
        `🧁 *${product.title || "Item"}*`,
        `📂 Category: ${product.category || "Bakery"}`,
        `💰 Price: ${discountLine}`,
        `🔢 Qty: ${qty}`,
        `💵 Total: Rs.${(salePrice * qty).toLocaleString()}`,
        `🏪 Pickup: From store (I'll come to collect)`,
        pickupTime ? `📅 Pickup Time: ${pickupTime}` : null,
    ].filter(Boolean);

    if (product.note)         lines.push(`📌 Note: ${product.note}`);
    if (product.whatsappText) lines.push(``, product.whatsappText);

    // Item link
    try {
        const base = window.location.href.split("#")[0].split("?")[0];
        const productLink = `${base}#product=${product.slug || product.id}`;
        lines.push(``, `item link:`, `🔗 ${productLink}`);
    } catch (_) {}

    // 4-digit random order ref — customer shows this at pickup for verification
    const orderRef = String(Math.floor(1000 + Math.random() * 9000));
    lines.push(``, `📋 Order Ref: *#${orderRef}*`, `(Please show this number when picking up)`, `Thank you! 😊`);
    return lines.join("\n");
}

/**
 * SYNCHRONOUS — safe to call directly in a click handler.
 * Requires settings to have been preloaded (getShopSettings called at startup).
 * Returns the full wa.me URL string, or throws if number not configured.
 */
export function buildOrderUrlSync(product, qty = 1, pickupTime = "") {
    const phone = getWhatsAppNumberSync();
    if (!phone || phone.includes("X")) {
        throw new Error("WhatsApp number is not set. Please configure it in Admin → Settings.");
    }
    const text = encodeURIComponent(_composeOrderMessage(product, qty, pickupTime));
    return `https://wa.me/${phone}?text=${text}`;
}

/**
 * ASYNC fallback — use only when sync version isn't viable.
 * Forces a settings fetch if not yet loaded.
 */
export async function buildOrderUrl(product, qty = 1) {
    await getShopSettings(); // ensures _cachedWaNumber is populated
    return buildOrderUrlSync(product, qty);
}

export async function buildCustomCakeWhatsAppUrl({ name, desc, occasion, date, budget }) {
    const waNumber = await getWhatsAppNumber();
    if (!waNumber || waNumber.includes("X")) {
        throw new Error("WhatsApp number not configured. Please update Settings in the Admin Panel.");
    }
    const parts = [
        "Hello! I want to request a *Custom Cake* 🎂",
        name     ? `👤 Name: ${name}`         : null,
        desc     ? `📝 Cake Details: ${desc}` : null,
        occasion ? `🎉 Occasion: ${occasion}` : null,
        date     ? `📅 Needed By: ${date}`    : null,
        budget   ? `💰 Budget: Rs.${budget}`  : null,
        `\nPlease let me know availability and pricing. Thank you! 🙏`
    ].filter(Boolean);
    return `https://wa.me/${waNumber}?text=${encodeURIComponent(parts.join("\n"))}`;
}

export function getProductShareUrl(product) {
    // Uses #product=slug so the deep-link router can open the modal
    // Works with: handleHashNavigation() + hashchange listener in app-main.js
    try {
        const base = window.location.href.split("#")[0].split("?")[0];
        const slug = product.slug || product.id || "";
        if (!slug) return base;
        return `${base}#product=${encodeURIComponent(slug)}`;
    } catch (_) {
        return typeof window !== "undefined" ? window.location.href : "";
    }
}
