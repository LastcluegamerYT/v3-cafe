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

export async function getShopSettings() {
    if (_settingsFetched) return _shopSettings || {};
    try {
        const snap = await get(ref(db, "settings/shop"));
        _shopSettings = snap.exists() ? snap.val() : {};
    } catch (_) {
        _shopSettings = {};
    }
    _settingsFetched = true;
    return _shopSettings;
}

export function clearSettingsCache() {
    _shopSettings    = null;
    _settingsFetched = false;
}

export async function getWhatsAppNumber() {
    const s = await getShopSettings();
    const raw = (s && s.whatsapp) ? String(s.whatsapp) : "";
    const clean = raw.replace(/\D/g, "");
    return clean || "977XXXXXXXXXX";
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
export async function buildOrderUrl(product, qty = 1) {
    const phone = await getWhatsAppNumber();
    const waText = product.whatsappText || "";
    return buildWhatsAppUrl({ phoneNumber: phone, product, qty, customText: waText });
}

export async function buildCustomCakeWhatsAppUrl({ name, desc, occasion, date, budget }) {
    const waNumber = await getWhatsAppNumber();
    const parts = [
        "Hello! I want to request a *Custom Cake* 🎂",
        name     ? `👤 Name: ${name}`              : null,
        desc     ? `📝 Description: ${desc}`       : null,
        occasion ? `🎉 Occasion: ${occasion}`      : null,
        date     ? `📅 Delivery Date: ${date}`     : null,
        budget   ? `💰 Budget: Rs. ${budget}`      : null,
        "\nPlease let me know the details. Thank you!"
    ].filter(Boolean);
    const text = encodeURIComponent(parts.join("\n"));
    return `https://wa.me/${waNumber}?text=${text}`;
}

export function getProductShareUrl(product) {
    try {
        const base = window.location.href.split("#")[0].split("?")[0];
        return buildShareLink({ baseUrl: base, product });
    } catch (_) {
        return typeof window !== "undefined" ? window.location.href : "";
    }
}
