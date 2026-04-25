// app-data.js — All Firebase / data operations for customer panel
// Uses NAMED exports from connection.js (not just the default object)

import {
    db,
    getAllProducts,
    getFeaturedProducts,
    getProductById,
    getProductBySlug,
    getProductForRoute,
    getProductsByCategory,
    searchProducts,
    addLead,
    trackPageView,
    trackInterest,
    incrementProductView,
    incrementProductClick,
    buildWhatsAppUrl,
    buildShareLink,
    buildProductDetail,
    subscribeProducts,
    subscribeLeads,
    shouldShowLeadPopup,
    markLeadPopupSeen
} from "../connection/connection.js";

// Re-export what other modules need
export {
    db,
    getAllProducts,
    getFeaturedProducts,
    getProductById,
    getProductBySlug,
    getProductForRoute,
    getProductsByCategory,
    searchProducts,
    addLead,
    trackPageView,
    trackInterest,
    incrementProductView,
    incrementProductClick,
    buildWhatsAppUrl,
    buildShareLink,
    buildProductDetail,
    subscribeProducts,
    subscribeLeads,
    shouldShowLeadPopup,
    markLeadPopupSeen
};

// ══════════════════════════════════════════
//  SHOP SETTINGS (from Firebase)
// ══════════════════════════════════════════
import { ref, get } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

let _shopSettings    = null;
let _settingsFetched = false;
let _cachedWaNumber  = ""; // sync-accessible after preload

export async function getShopSettings() {
    if (_settingsFetched) return _shopSettings || {};
    try {
        const snap = await get(ref(db, "settings/shop"));
        _shopSettings = snap.exists() ? snap.val() : {};
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
//  PRODUCTS — cached layer with TTL
// ══════════════════════════════════════════
let _allProducts    = null;
let _loadedAt       = 0;
const PRODUCT_TTL   = 60_000; // 60s

export async function fetchAllProducts(force = false) {
    const stale = !_allProducts || (Date.now() - _loadedAt) > PRODUCT_TTL;
    if (!force && !stale) return _allProducts;
    try {
        _allProducts = await getAllProducts({ force: true });
        _loadedAt    = Date.now();
        return _allProducts;
    } catch (err) {
        console.error("[data] fetchAllProducts:", err);
        return _allProducts || [];
    }
}

export async function fetchFeatured(limit = 6) {
    try {
        const all = await fetchAllProducts();
        return all.filter(p => p.featured && p.status !== "deleted").slice(0, limit);
    } catch (err) {
        console.error("[data] fetchFeatured:", err);
        return [];
    }
}

export async function fetchProductDetail(idOrSlug) {
    if (!idOrSlug) return null;
    try {
        // Try cache first
        if (_allProducts) {
            const cached = _allProducts.find(p => p.id === idOrSlug || p.slug === idOrSlug);
            if (cached) return cached;
        }
        // Fall back to Firebase
        return await getProductForRoute({ slug: idOrSlug }) ||
               await getProductForRoute({ id: idOrSlug });
    } catch (err) {
        console.error("[data] fetchProductDetail:", err);
        return null;
    }
}

export async function fetchByCategory(category) {
    if (!category || category === "all") return fetchAllProducts();
    try {
        const all = await fetchAllProducts();
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
function _composeOrderMessage(product, qty) {
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
    ];

    if (product.note)         lines.push(`📌 Note: ${product.note}`);
    if (product.whatsappText) lines.push(``, product.whatsappText);

    // Item link
    try {
        const base = window.location.href.split("#")[0].split("?")[0];
        const productLink = `${base}#product=${product.slug || product.id}`;
        lines.push(``, `item link:`, `🔗 ${productLink}`);
    } catch (_) {}

    lines.push(``, `ID: ${product.id || ""}`, `Thank you! 😊`);
    return lines.join("\n");
}

/**
 * SYNCHRONOUS — safe to call directly in a click handler.
 * Requires settings to have been preloaded (getShopSettings called at startup).
 * Returns the full wa.me URL string, or throws if number not configured.
 */
export function buildOrderUrlSync(product, qty = 1) {
    const phone = getWhatsAppNumberSync();
    if (!phone || phone.includes("X")) {
        throw new Error("WhatsApp number is not set. Please configure it in Admin → Settings.");
    }
    const text = encodeURIComponent(_composeOrderMessage(product, qty));
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
