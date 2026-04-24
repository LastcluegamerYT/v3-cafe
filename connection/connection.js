// connection.js
// Smart Bakery Web Platform
// Firebase Realtime Database data layer (fast, structured, reusable, browser-safe)

import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
    getDatabase,
    ref,
    get,
    set,
    update,
    remove,
    push,
    child,
    onValue,
    runTransaction,
    query,
    orderByChild,
    limitToLast,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// -----------------------------
// Firebase config
// -----------------------------
const firebaseConfig = {
    apiKey: "AIzaSyDmyFzYe9lYRgIAtsU0f2AZWLTztNPTPjE",
    authDomain: "project-store-44fff.firebaseapp.com",
    databaseURL: "https://project-store-44fff-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "project-store-44fff",
    storageBucket: "project-store-44fff.firebasestorage.app",
    messagingSenderId: "711461666990",
    appId: "1:711461666990:web:951ba33b6e61ed77736d3f"
};

// -----------------------------
// App bootstrap (safe for repeated imports)
// -----------------------------
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getDatabase(app);

// -----------------------------
// Paths / schema
// -----------------------------
export const DB_PATHS = Object.freeze({
    products: "products",
    leads: "leads",
    analytics: "analytics",
    settings: "settings",
    visitors: "visitors",
    productViews: "productViews",
    productClicks: "productClicks",
    interestEvents: "interestEvents",
});

// -----------------------------
// Fast helpers
// -----------------------------
const hasCrypto = typeof crypto !== "undefined";
const hasLocalStorage = typeof window !== "undefined" && !!window.localStorage;

function now() {
    return Date.now();
}

function isStr(v) {
    return typeof v === "string" && v.trim().length > 0;
}

function cleanText(v) {
    return isStr(v) ? v.trim() : "";
}

function safeNumber(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

export function slugify(text) {
    return cleanText(text)
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "item";
}

function randSegment(len = 8) {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let out = "";

    if (hasCrypto && crypto.getRandomValues) {
        const arr = crypto.getRandomValues(new Uint32Array(len));
        for (let i = 0; i < len; i++) out += chars[arr[i] % chars.length];
        return out;
    }

    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}

export function createId(prefix = "prod") {
    if (hasCrypto && typeof crypto.randomUUID === "function") {
        return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
    }
    return `${prefix}_${Date.now().toString(36)}_${randSegment(10)}`;
}

function toArrayImages(images) {
    if (!Array.isArray(images)) return [];

    return images
        .map((img, index) => {
            if (typeof img === "string") {
                const url = cleanText(img);
                return url ? { url, alt: "", order: index } : null;
            }

            if (img && typeof img === "object") {
                const url = cleanText(img.url || img.src || img.image || img.i);
                if (!url) return null;

                return {
                    url,
                    alt: cleanText(img.alt || img.title || img.name),
                    order: Number.isFinite(img.order) ? Number(img.order) : index,
                };
            }

            return null;
        })
        .filter(Boolean)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function pickMainImage(images, fallback = "") {
    const list = toArrayImages(images);
    if (list.length) return list[0].url;
    return cleanText(fallback);
}

function normalizeProduct(product = {}, id = "") {
    const images = toArrayImages(product.images);
    const mainImage = cleanText(product.mainImage) || pickMainImage(images, product.image || product.coverImage || "");

    return {
        id: cleanText(product.id || id),
        slug: cleanText(product.slug) || slugify(product.title || id),
        title: cleanText(product.title),
        description: cleanText(product.description),
        category: cleanText(product.category) || "General",
        price: safeNumber(product.price, 0),
        availability: cleanText(product.availability) || "available",
        status: cleanText(product.status) || "active",
        mainImage,
        images,
        tags: Array.isArray(product.tags) ? product.tags.map(cleanText).filter(Boolean) : [],
        ingredients: Array.isArray(product.ingredients) ? product.ingredients.map(cleanText).filter(Boolean) : [],
        note: cleanText(product.note),
        whatsappText: cleanText(product.whatsappText),
        featured: Boolean(product.featured),
        orderRank: safeNumber(product.orderRank, 0),
        views: safeNumber(product.views, 0),
        clicks: safeNumber(product.clicks, 0),
        createdAt: safeNumber(product.createdAt, now()),
        updatedAt: safeNumber(product.updatedAt, now()),
        meta: product.meta && typeof product.meta === "object" ? product.meta : {},
    };
}

function normalizeLead(lead = {}, id = "") {
    return {
        id: cleanText(lead.id || id),
        phone: cleanText(lead.phone).replace(/\D/g, ""),
        name: cleanText(lead.name),
        source: cleanText(lead.source) || "popup",
        page: cleanText(lead.page),
        productId: cleanText(lead.productId),
        createdAt: safeNumber(lead.createdAt, now()),
        meta: lead.meta && typeof lead.meta === "object" ? lead.meta : {},
    };
}

function mapProducts(snapshotVal) {
    const raw = snapshotVal || {};
    const out = [];
    for (const [id, value] of Object.entries(raw)) {
        if (!value || typeof value !== "object") continue;
        out.push(normalizeProduct(value, id));
    }
    return out;
}

function sortProducts(list) {
    return list.sort((a, b) => {
        if (a.featured !== b.featured) return a.featured ? -1 : 1;
        if ((a.orderRank || 0) !== (b.orderRank || 0)) return (b.orderRank || 0) - (a.orderRank || 0);
        return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
}

// -----------------------------
// Cache layer for speed
// -----------------------------
const memoryCache = {
    products: null,
    productsAt: 0,
    productById: new Map(),
    productBySlug: new Map(),
};

const CACHE_TTL = 10_000; // small TTL to keep UI snappy without stale data

function cacheProducts(list) {
    const snapshot = list.slice();
    memoryCache.products = snapshot;
    memoryCache.productsAt = now();
    memoryCache.productById.clear();
    memoryCache.productBySlug.clear();

    for (const item of snapshot) {
        if (item.id) memoryCache.productById.set(item.id, item);
        if (item.slug) memoryCache.productBySlug.set(item.slug, item);
    }
}

function cacheFresh() {
    return Array.isArray(memoryCache.products) && (now() - memoryCache.productsAt) < CACHE_TTL;
}

function invalidateCache() {
    memoryCache.products = null;
    memoryCache.productsAt = 0;
}

async function getOnce(path) {
    const snap = await get(ref(db, path));
    return snap.exists() ? snap.val() : null;
}

// -----------------------------
// Public data builders
// -----------------------------
export function buildWhatsAppUrl({ phoneNumber, product, qty = 1, customText = "" }) {
    const phone = cleanText(phoneNumber).replace(/\D/g, "");
    if (!phone) throw new Error("Valid phoneNumber is required.");

    const title = cleanText(product?.title || "product");
    const price = product?.price != null ? `Rs. ${product.price}` : "";
    const parts = [
        `Hello, I want to order ${title}`,
        price ? `Price: ${price}` : "",
        qty ? `Qty: ${qty}` : "",
        cleanText(customText),
        `Product ID: ${product?.id || ""}`,
    ].filter(Boolean);

    return `https://wa.me/${phone}?text=${encodeURIComponent(parts.join("\n"))}`;
}

export function buildShareLink({ baseUrl, product }) {
    const href = cleanText(baseUrl) || (typeof window !== "undefined" ? window.location.href : "");
    const url = new URL(href || "https://example.com/");

    if (product?.slug) url.searchParams.set("product", product.slug);
    else if (product?.id) url.searchParams.set("productId", product.id);

    return url.toString();
}

export function buildProductPreview(product) {
    const p = normalizeProduct(product);
    return {
        id: p.id,
        slug: p.slug,
        title: p.title,
        category: p.category,
        price: p.price,
        availability: p.availability,
        mainImage: p.mainImage,
        featured: p.featured,
        updatedAt: p.updatedAt,
    };
}

export function buildProductDetail(product) {
    const p = normalizeProduct(product);
    const images = p.images.length ? p.images.slice() : [];

    const main = p.mainImage
        ? [{ url: p.mainImage, alt: p.title || "main image", order: -1 }, ...images.filter((img) => img.url !== p.mainImage)]
        : images;

    return {
        ...p,
        gallery: main,
        hasMultipleImages: main.length > 1,
    };
}

// -----------------------------
// Read APIs
// -----------------------------
export async function getAllProducts({ force = false } = {}) {
    if (!force && cacheFresh()) return memoryCache.products.slice();

    const data = await getOnce(DB_PATHS.products);
    const list = sortProducts(mapProducts(data));
    cacheProducts(list);
    return list.slice();
}

export async function getFeaturedProducts(limit = 6) {
    const all = await getAllProducts();
    return all.filter((p) => p.featured && p.status !== "deleted").slice(0, limit);
}

export async function getProductsByCategory(category) {
    const cat = cleanText(category).toLowerCase();
    const all = await getAllProducts();
    return all.filter((p) => p.category.toLowerCase() === cat);
}

export async function searchProducts(term = "") {
    const q = cleanText(term).toLowerCase();
    const all = await getAllProducts();
    if (!q) return all;

    return all.filter((p) => {
        const haystack = [p.title, p.description, p.category, ...(p.tags || []), ...(p.ingredients || [])]
            .join(" ")
            .toLowerCase();
        return haystack.includes(q);
    });
}

export async function getProductById(id) {
    const key = cleanText(id);
    if (!key) return null;

    if (memoryCache.productById.has(key)) return memoryCache.productById.get(key);

    const data = await getOnce(`${DB_PATHS.products}/${key}`);
    if (!data) return null;

    const item = normalizeProduct(data, key);
    memoryCache.productById.set(key, item);
    if (item.slug) memoryCache.productBySlug.set(item.slug, item);
    return item;
}

export async function getProductBySlug(slug) {
    const key = cleanText(slug);
    if (!key) return null;

    if (memoryCache.productBySlug.has(key)) return memoryCache.productBySlug.get(key);

    const all = await getAllProducts();
    return all.find((p) => p.slug === key) || null;
}

export async function getProductForRoute({ id, slug } = {}) {
    if (isStr(id)) return getProductById(id);
    if (isStr(slug)) return getProductBySlug(slug);
    return null;
}

// -----------------------------
// Write APIs
// -----------------------------
export async function createProduct(data = {}) {
    const title = cleanText(data.title);
    if (!title) throw new Error("Product title is required.");

    const id = cleanText(data.id) || createId("prod");
    const images = toArrayImages(data.images || []);
    const mainImage = cleanText(data.mainImage) || pickMainImage(images, data.image || data.coverImage || "");
    const slug = cleanText(data.slug) || `${slugify(title)}-${id.slice(-6)}`;

    const product = normalizeProduct(
        {
            ...data,
            id,
            title,
            slug,
            mainImage,
            images,
            createdAt: data.createdAt || now(),
            updatedAt: now(),
        },
        id
    );

    await set(ref(db, `${DB_PATHS.products}/${id}`), product);
    memoryCache.productById.set(id, product);
    memoryCache.productBySlug.set(product.slug, product);
    invalidateCache();
    return product;
}

export async function updateProduct(id, patch = {}) {
    const key = cleanText(id);
    if (!key) throw new Error("Product id is required.");

    const current = (await getProductById(key)) || { id: key };
    const next = normalizeProduct(
        {
            ...current,
            ...patch,
            id: key,
            images: patch.images != null ? toArrayImages(patch.images) : current.images,
            mainImage: patch.mainImage || current.mainImage,
            updatedAt: now(),
        },
        key
    );

    await update(ref(db, `${DB_PATHS.products}/${key}`), next);
    memoryCache.productById.set(key, next);
    if (next.slug) memoryCache.productBySlug.set(next.slug, next);
    invalidateCache();
    return next;
}

export async function deleteProduct(id) {
    const key = cleanText(id);
    if (!key) throw new Error("Product id is required.");

    await remove(ref(db, `${DB_PATHS.products}/${key}`));
    memoryCache.productById.delete(key);
    invalidateCache();
    return true;
}

export async function incrementProductView(id) {
    const key = cleanText(id);
    if (!key) return;
    const viewRef = ref(db, `${DB_PATHS.products}/${key}/views`);
    await runTransaction(viewRef, (v) => safeNumber(v, 0) + 1);
}

export async function incrementProductClick(id) {
    const key = cleanText(id);
    if (!key) return;
    const clickRef = ref(db, `${DB_PATHS.products}/${key}/clicks`);
    await runTransaction(clickRef, (v) => safeNumber(v, 0) + 1);
}

export async function addLead(lead = {}) {
    const phone = cleanText(lead.phone).replace(/\D/g, "");
    if (!phone) throw new Error("Phone number is required.");

    const key = cleanText(lead.id) || createId("lead");
    const payload = normalizeLead({ ...lead, id: key, phone, createdAt: now() }, key);

    await set(ref(db, `${DB_PATHS.leads}/${key}`), payload);
    return payload;
}

export async function trackPageView({ path = "/", userAgent = "" } = {}) {
    const key = createId("visit");
    await set(ref(db, `${DB_PATHS.visitors}/${key}`), {
        id: key,
        path: cleanText(path) || "/",
        userAgent: cleanText(userAgent),
        createdAt: now(),
    });
    return key;
}

export async function trackInterest({ type = "popup", phone = "", productId = "", page = "", meta = {} } = {}) {
    const key = createId("interest");
    await set(ref(db, `${DB_PATHS.interestEvents}/${key}`), {
        id: key,
        type: cleanText(type) || "popup",
        phone: cleanText(phone).replace(/\D/g, ""),
        productId: cleanText(productId),
        page: cleanText(page),
        meta: meta && typeof meta === "object" ? meta : {},
        createdAt: now(),
    });
    return key;
}

// -----------------------------
// Analytics helpers
// -----------------------------
export async function incrementGlobalCounter(name, amount = 1) {
    const key = cleanText(name);
    if (!key) throw new Error("Counter name is required.");
    const counterRef = ref(db, `${DB_PATHS.analytics}/${key}`);
    await runTransaction(counterRef, (v) => safeNumber(v, 0) + safeNumber(amount, 1));
}

export async function getDashboardStats() {
    const [productsSnap, leadsSnap, visitorsSnap, interestSnap] = await Promise.all([
        get(ref(db, DB_PATHS.products)),
        get(ref(db, DB_PATHS.leads)),
        get(ref(db, DB_PATHS.visitors)),
        get(ref(db, DB_PATHS.interestEvents)),
    ]);

    const products = productsSnap.exists() ? Object.values(productsSnap.val()) : [];
    const leads = leadsSnap.exists() ? Object.values(leadsSnap.val()) : [];
    const visitors = visitorsSnap.exists() ? Object.values(visitorsSnap.val()) : [];
    const interests = interestSnap.exists() ? Object.values(interestSnap.val()) : [];

    return {
        totalProducts: products.length,
        totalLeads: leads.length,
        totalVisitors: visitors.length,
        totalInterests: interests.length,
        availableProducts: products.filter((p) => cleanText(p?.availability).toLowerCase() === "available").length,
        customProducts: products.filter((p) => cleanText(p?.availability).toLowerCase() === "custom").length,
        outOfStockProducts: products.filter((p) => cleanText(p?.availability).toLowerCase() === "out of stock").length,
    };
}

// -----------------------------
// Realtime subscriptions
// -----------------------------
export function subscribeProducts(callback) {
    if (typeof callback !== "function") throw new Error("callback function is required.");
    return onValue(ref(db, DB_PATHS.products), (snap) => {
        const list = sortProducts(mapProducts(snap.val()));
        cacheProducts(list);
        callback(list);
    });
}

export function subscribeProduct(idOrSlug, callback) {
    if (typeof callback !== "function") throw new Error("callback function is required.");
    const key = cleanText(idOrSlug);
    if (!key) throw new Error("idOrSlug is required.");

    return onValue(ref(db, `${DB_PATHS.products}/${key}`), (snap) => {
        if (!snap.exists()) {
            callback(null);
            return;
        }
        callback(normalizeProduct(snap.val(), key));
    });
}

export function subscribeLeads(callback, limit = 50) {
    if (typeof callback !== "function") throw new Error("callback function is required.");
    const q = query(ref(db, DB_PATHS.leads), orderByChild("createdAt"), limitToLast(limit));

    return onValue(q, (snap) => {
        const list = snap.exists()
            ? Object.entries(snap.val())
                .map(([id, v]) => normalizeLead(v, id))
                .sort((a, b) => b.createdAt - a.createdAt)
            : [];
        callback(list);
    });
}

// -----------------------------
// Popup helper for frontend
// -----------------------------
export function shouldShowLeadPopup(storageKey = "bakery_phone_popup_seen") {
    try {
        return !hasLocalStorage || !localStorage.getItem(storageKey);
    } catch {
        return true;
    }
}

export function markLeadPopupSeen(storageKey = "bakery_phone_popup_seen") {
    try {
        if (hasLocalStorage) localStorage.setItem(storageKey, "1");
    } catch { }
}

// -----------------------------
// Image helpers (for future upload flows)
// These are for browser-side encode/decode when you need to store image data URLs.
// Realtime DB is fine for URLs and small thumbnails; for larger files, storage is still better.
// -----------------------------
export function dataURLToBlob(dataURL) {
    const [meta, base64] = String(dataURL).split(",");
    const match = meta.match(/data:(.*?);base64/);
    const mime = match ? match[1] : "application/octet-stream";
    const binary = atob(base64 || "");
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

export function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        if (!blob) {
            reject(new Error("Blob is required."));
            return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("Failed to encode blob."));
        reader.readAsDataURL(blob);
    });
}

export async function compressImageFile(file, { maxWidth = 900, quality = 0.78, mimeType = "image/webp" } = {}) {
    if (!(file instanceof Blob)) throw new Error("A file/blob is required.");

    const bitmap = typeof createImageBitmap === "function" ? await createImageBitmap(file) : null;

    const source = bitmap || await new Promise((resolve, reject) => {
        const reader = new FileReader();
        const img = new Image();
        reader.onload = (e) => { img.src = e.target.result; };
        reader.onerror = () => reject(reader.error || new Error("FileReader failed."));
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Image decode failed."));
        reader.readAsDataURL(file);
    });

    try {
        const srcW = source.width || source.naturalWidth || 1;
        const srcH = source.height || source.naturalHeight || 1;
        const scale = Math.min(1, maxWidth / srcW);
        const w = Math.max(1, Math.round(srcW * scale));
        const h = Math.max(1, Math.round(srcH * scale));

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
        ctx.drawImage(source, 0, 0, w, h);

        const blob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
        if (!blob) throw new Error("Image compression failed.");

        return {
            blob,
            dataURL: await blobToDataURL(blob),
            width: w,
            height: h,
            mimeType,
            size: blob.size,
        };
    } finally {
        if (bitmap && typeof bitmap.close === "function") bitmap.close();
    }
}

// -----------------------------
// Convenience wrapper object
// -----------------------------
export const bakeryDB = {
    app,
    db,
    DB_PATHS,
    createId,
    slugify,
    normalizeProduct,
    normalizeLead,
    buildWhatsAppUrl,
    buildShareLink,
    buildProductPreview,
    buildProductDetail,
    getAllProducts,
    getFeaturedProducts,
    getProductsByCategory,
    searchProducts,
    getProductById,
    getProductBySlug,
    getProductForRoute,
    createProduct,
    updateProduct,
    deleteProduct,
    incrementProductView,
    incrementProductClick,
    addLead,
    trackPageView,
    trackInterest,
    incrementGlobalCounter,
    getDashboardStats,
    subscribeProducts,
    subscribeProduct,
    subscribeLeads,
    shouldShowLeadPopup,
    markLeadPopupSeen,
    dataURLToBlob,
    blobToDataURL,
    compressImageFile,
};

export default bakeryDB;
