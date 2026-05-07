// admin-main.js — Main entry: router, dashboard, leads, settings, toasts, realtime

// ── Firebase imports FIRST (before any other imports) ──
import { ref, get, set } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import bakeryDB from "../connection/connection.js?v=2";
import { initLoginUI, logout, changePassword } from "./admin-auth.js?v=2";
import {
    loadProducts, renderProductsGrid, renderRecentProducts,
    openAddForm, initProductForm, initProducts, updateProductBadge,
    getLoadedProducts
} from "./admin-products.js?v=2";

const { getDashboardStats, subscribeProducts, subscribeLeads, getAllProducts, db } = bakeryDB;

// ══════════════════════════════════════════
//  APP STATE
// ══════════════════════════════════════════
let currentSection = "";
let allLeads       = [];
let leadsFilter    = "";
let _unsubProducts = null;
let _unsubLeads    = null;

// ══════════════════════════════════════════
//  TOAST SYSTEM
// ══════════════════════════════════════════
export function toast(message, type = "info", duration = 3500) {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = message; // use textContent, not innerHTML — prevents XSS

    // Max 5 toasts visible at once
    const existing = container.querySelectorAll(".toast");
    if (existing.length >= 5) existing[0].remove();

    container.appendChild(el);

    const timer = setTimeout(() => fadeOutToast(el), duration);
    el.addEventListener("click", () => { clearTimeout(timer); fadeOutToast(el); });
}

function fadeOutToast(el) {
    if (!el.parentNode) return;
    el.classList.add("removing");
    setTimeout(() => el?.remove(), 350);
}

// ══════════════════════════════════════════
//  CONFIRM MODAL
// ══════════════════════════════════════════
let _confirmCallback = null;

export function confirmModal(title, message, icon = "⚠️", onConfirm) {
    const modal = document.getElementById("confirm-modal");
    if (!modal) { onConfirm?.(); return; }

    const titleEl = document.getElementById("modal-title");
    const msgEl   = document.getElementById("modal-msg");
    const iconEl  = document.getElementById("modal-icon");

    if (titleEl) titleEl.textContent = title;
    if (msgEl)   msgEl.textContent   = message;
    if (iconEl)  iconEl.textContent  = icon;

    _confirmCallback = onConfirm;
    modal.classList.remove("hidden");
    // Focus confirm button for keyboard accessibility
    setTimeout(() => document.getElementById("modal-confirm")?.focus(), 50);
}

function closeModal() {
    document.getElementById("confirm-modal")?.classList.add("hidden");
    _confirmCallback = null;
}

function initModal() {
    document.getElementById("modal-cancel")?.addEventListener("click", closeModal);

    document.getElementById("modal-confirm")?.addEventListener("click", () => {
        const cb = _confirmCallback;
        closeModal();
        cb?.();
    });

    document.getElementById("confirm-modal")?.addEventListener("click", e => {
        if (e.target === e.currentTarget) closeModal();
    });

    // ESC key closes modal
    document.addEventListener("keydown", e => {
        if (e.key === "Escape") closeModal();
    });
}

// ══════════════════════════════════════════
//  ROUTER
// ══════════════════════════════════════════
const SECTION_TITLES = {
    "dashboard":   "Dashboard",
    "products":    "Products",
    "add-product": "Add Product",
    "leads":       "Customer Leads",
    "settings":    "Settings"
};

export function navigate(section) {
    // Allow re-navigating to add-product (for edit flows), but skip no-ops
    if (section === currentSection && section !== "add-product") return;

    const prev = currentSection;
    currentSection = section;

    // Hide all sections
    document.querySelectorAll(".sec").forEach(s => s.classList.remove("active"));
    // Clear all nav active states
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));

    // Activate target section
    const target = document.getElementById(`sec-${section}`);
    if (target) {
        target.classList.add("active");
    } else {
        console.warn(`Section not found: sec-${section}`);
        currentSection = prev; // Rollback
        return;
    }

    // Highlight matching nav item
    const navEl = document.querySelector(`.nav-item[data-sec="${section}"]`);
    if (navEl) navEl.classList.add("active");

    // Update header title
    const titleEl = document.getElementById("tb-title");
    if (titleEl) titleEl.textContent = SECTION_TITLES[section] || section;

    // Close mobile sidebar
    closeSidebar();

    // Section-specific actions
    switch (section) {
        case "dashboard":
            loadDashboard();
            break;
        case "products":
            // Use cached data if available, force only if coming from add-product
            loadProducts(prev === "add-product").then(() => renderProductsGrid());
            break;
        case "leads":
            renderLeadsTable();
            break;
        case "settings":
            loadSettings();
            break;
        case "add-product":
            // Handled externally by openAddForm / openEditForm
            break;
    }
}

// ══════════════════════════════════════════
//  SIDEBAR
// ══════════════════════════════════════════
function closeSidebar() {
    document.getElementById("sidebar")?.classList.remove("open");
    document.getElementById("sb-overlay")?.classList.remove("show");
}

function initSidebar() {
    document.getElementById("hamburger")?.addEventListener("click", () => {
        document.getElementById("sidebar")?.classList.toggle("open");
        document.getElementById("sb-overlay")?.classList.toggle("show");
    });
    document.getElementById("sb-close")?.addEventListener("click", closeSidebar);
    document.getElementById("sb-overlay")?.addEventListener("click", closeSidebar);
}

// ══════════════════════════════════════════
//  NAVIGATION BINDINGS
// ══════════════════════════════════════════
function bindNavigation() {
    // BUG FIX: Only bind once — use a single selector pass, no duplicates
    document.querySelectorAll("[data-sec]").forEach(el => {
        el.addEventListener("click", e => {
            e.preventDefault();
            const sec = el.dataset.sec;
            if (!sec) return;
            if (sec === "add-product") {
                openAddForm();
            } else {
                navigate(sec);
            }
        });
    });

    // Refresh
    document.getElementById("refresh-btn")?.addEventListener("click", async () => {
        toast("🔄 Refreshing…", "info", 1500);
        try {
            await loadProducts(true);
            await loadDashboard();
            if (currentSection === "leads") renderLeadsTable();
            toast("✅ Refreshed!", "success", 2000);
        } catch (err) {
            toast("Refresh failed: " + err.message, "error");
        }
    });

    // Logout
    document.getElementById("logout-btn")?.addEventListener("click", e => {
        e.preventDefault();
        confirmModal("Logout", "Are you sure you want to logout?", "🚪", () => {
            cleanup();
            logout();
            location.reload();
        });
    });
}

// ══════════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════════
async function loadDashboard() {
    try {
        // Load stats and products in parallel
        const [stats, products] = await Promise.all([
            getDashboardStats(),
            getAllProducts()
        ]);

        setEl("st-products",  stats.totalProducts   ?? 0);
        setEl("st-available", stats.availableProducts ?? 0);
        setEl("st-visitors",  stats.totalVisitors    ?? 0);
        setEl("st-leads",     stats.totalLeads       ?? 0);
        setEl("st-interests", stats.totalInterests   ?? 0);
        setEl("st-custom",    stats.customProducts   ?? 0);

        renderRecentProducts(products);
        renderRecentLeads();

    } catch (err) {
        toast("Dashboard error: " + err.message, "error");
    }
}

function setEl(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(val);
}

// ══════════════════════════════════════════
//  LEADS
// ══════════════════════════════════════════
function renderLeadsTable() {
    const tbody = document.getElementById("leads-tbody");
    const totEl = document.getElementById("leads-total");
    const badge = document.getElementById("nb-leads");
    if (!tbody) return;

    let list = [...allLeads];

    // BUG FIX: guard against null/undefined fields in filter
    if (leadsFilter) {
        const q = leadsFilter.toLowerCase();
        list = list.filter(l => {
            const searchable = [l.phone, l.name, l.source].map(v => String(v || "").toLowerCase()).join(" ");
            return searchable.includes(q);
        });
    }

    if (totEl) totEl.textContent = list.length;
    if (badge) badge.textContent = allLeads.length;

    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="loading-ph">
            ${leadsFilter ? "No leads match your search." : "No leads collected yet."}
        </td></tr>`;
        return;
    }

    tbody.innerHTML = list.map((l, i) => `
        <tr>
            <td>${i + 1}</td>
            <td><strong>${esc(l.phone || "—")}</strong></td>
            <td>${esc(l.name  || "—")}</td>
            <td><span class="badge-src">${esc(l.source || "popup")}</span></td>
            <td>${esc(l.page  || "—")}</td>
            <td>${l.createdAt ? formatDate(l.createdAt) : "—"}</td>
        </tr>
    `).join("");
}

function renderRecentLeads() {
    const el = document.getElementById("recent-leads");
    if (!el) return;

    const recent = allLeads.slice(0, 5);
    if (!recent.length) {
        el.innerHTML = `<div class="loading-ph">No leads yet.</div>`;
        return;
    }

    el.innerHTML = recent.map(l => `
        <div class="r-item">
            <div class="r-thumb-ph">📱</div>
            <div class="r-info">
                <div class="r-name">${esc(l.phone || "—")}</div>
                <div class="r-meta">${esc(l.source || "popup")} · ${l.createdAt ? formatDate(l.createdAt) : "—"}</div>
            </div>
        </div>
    `).join("");
}

function initLeadsSection() {
    const searchEl = document.getElementById("leads-search");
    if (searchEl) {
        let timer;
        searchEl.addEventListener("input", e => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                leadsFilter = e.target.value.trim();
                renderLeadsTable();
            }, 200);
        });
    }

    document.getElementById("export-leads-btn")?.addEventListener("click", exportLeadsCSV);
}

function exportLeadsCSV() {
    if (!allLeads.length) { toast("No leads to export.", "warning"); return; }

    const headers = ["#", "Phone", "Name", "Source", "Page", "Date"];
    const rows = allLeads.map((l, i) => [
        i + 1,
        l.phone  || "",
        l.name   || "",
        l.source || "popup",
        l.page   || "",
        l.createdAt ? formatDate(l.createdAt) : ""
    ]);

    const csvContent = [headers, ...rows]
        .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))
        .join("\n");

    try {
        const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href     = url;
        a.download = `v3cafe_leads_${new Date().toISOString().slice(0,10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast("📥 Leads exported successfully!", "success");
    } catch (err) {
        toast("Export failed: " + err.message, "error");
    }
}

// ══════════════════════════════════════════
//  SETTINGS
// ══════════════════════════════════════════
async function loadSettings() {
    try {
        const [shopSnap, tplSnap] = await Promise.all([
            get(ref(db, "settings/shop")),
            get(ref(db, "settings/templates"))
        ]);

        if (shopSnap.exists()) {
            const s = shopSnap.val();
            setVal("s-shop-name", s.shopName  || "");
            setVal("s-whatsapp",  s.whatsapp  || "");
            setVal("s-facebook",  s.facebook  || "");
            setVal("s-instagram", s.instagram || "");
            setVal("s-address",   s.address   || "");
        }
        if (tplSnap.exists()) {
            const t = tplSnap.val();
            setVal("s-wa-template", t.orderMessage      || "");
            setVal("s-wa-custom",   t.customCakeMessage || "");
        }
    } catch (err) {
        toast("Settings load error: " + err.message, "error");
    }
}

function initSettings() {
    // ── Save shop info ──
    document.getElementById("save-shop-btn")?.addEventListener("click", async () => {
        try {
            await set(ref(db, "settings/shop"), {
                shopName:  getVal("s-shop-name"),
                whatsapp:  getVal("s-whatsapp"),
                facebook:  getVal("s-facebook"),
                instagram: getVal("s-instagram"),
                address:   getVal("s-address"),
                updatedAt: Date.now()
            });
            toast("✅ Shop info saved!", "success");
        } catch (err) {
            toast("Save failed: " + err.message, "error");
        }
    });

    // ── Save WA templates ──
    document.getElementById("save-wa-btn")?.addEventListener("click", async () => {
        try {
            await set(ref(db, "settings/templates"), {
                orderMessage:      getVal("s-wa-template"),
                customCakeMessage: getVal("s-wa-custom"),
                updatedAt: Date.now()
            });
            toast("✅ Templates saved!", "success");
        } catch (err) {
            toast("Save failed: " + err.message, "error");
        }
    });

    // ── Change password ──
    document.getElementById("change-pass-btn")?.addEventListener("click", async () => {
        const btn = document.getElementById("change-pass-btn");
        if (btn) btn.disabled = true;
        try {
            await changePassword(
                getVal("s-old-pass"),
                getVal("s-new-pass"),
                getVal("s-confirm-pass")
            );
            toast("✅ Password changed!", "success");
            ["s-old-pass","s-new-pass","s-confirm-pass"].forEach(id => setVal(id, ""));
        } catch (err) {
            toast("❌ " + err.message, "error");
        } finally {
            if (btn) btn.disabled = false;
        }
    });

    // ── Clear cache ──
    document.getElementById("clear-cache-btn")?.addEventListener("click", () => {
        confirmModal("Clear Cache", "Force-refresh all product data from Firebase?", "🔄", async () => {
            await loadProducts(true);
            toast("✅ Cache cleared & refreshed!", "info");
        });
    });

    // ── Clear all leads ──
    document.getElementById("clear-leads-btn")?.addEventListener("click", () => {
        confirmModal(
            "Clear All Leads",
            "This permanently deletes ALL customer leads from Firebase. Cannot be undone!",
            "⚠️",
            async () => {
                try {
                    await set(ref(db, "leads"), null);
                    allLeads = [];
                    renderLeadsTable();
                    renderRecentLeads();
                    setEl("nb-leads", 0);
                    toast("🗑️ All leads cleared.", "info");
                } catch (err) {
                    toast("Failed: " + err.message, "error");
                }
            }
        );
    });
}

// ══════════════════════════════════════════
//  REALTIME SUBSCRIPTIONS
// ══════════════════════════════════════════
function startRealtimeSubscriptions() {
    // Products live updates
    _unsubProducts = subscribeProducts(products => {
        updateProductBadge();
        if (currentSection === "products")  renderProductsGrid();
        if (currentSection === "dashboard") renderRecentProducts(products);
    });

    // Leads live updates (limit to last 200)
    _unsubLeads = subscribeLeads(leads => {
        allLeads = leads;
        setEl("nb-leads", leads.length);
        if (currentSection === "leads")     renderLeadsTable();
        if (currentSection === "dashboard") renderRecentLeads();
    }, 200);
}

function cleanup() {
    try { if (typeof _unsubProducts === "function") _unsubProducts(); } catch (_) {}
    try { if (typeof _unsubLeads    === "function") _unsubLeads();    } catch (_) {}
    _unsubProducts = null;
    _unsubLeads    = null;
}

// ══════════════════════════════════════════
//  APP STARTUP
// ══════════════════════════════════════════
function startApp() {
    const app = document.getElementById("admin-app");
    if (!app) return;

    app.classList.remove("hidden");
    app.style.opacity    = "0";
    app.style.transition = "opacity .35s ease";
    requestAnimationFrame(() => {
        requestAnimationFrame(() => { app.style.opacity = "1"; });
    });

    // Wire product module dependencies
    initProducts(navigate, toast, confirmModal);

    // Init UI subsystems
    initModal();
    initSidebar();
    bindNavigation();
    initProductForm();
    initLeadsSection();
    initSettings();

    // Start Firebase realtime listeners
    startRealtimeSubscriptions();

    // Pre-load products
    loadProducts(true).then(ps => {
        renderRecentProducts(ps);
        updateProductBadge();
    });

    // Navigate to dashboard as default
    navigate("dashboard");

    // Handle browser back/forward (optional enhancement)
    window.addEventListener("beforeunload", cleanup);
}

// ══════════════════════════════════════════
//  BOOTSTRAP
// ══════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {
    initLoginUI(startApp);
});

// ── Utilities ──
function esc(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
function setVal(id, v) {
    const el = document.getElementById(id);
    if (el) el.value = (v === null || v === undefined) ? "" : v;
}
function getVal(id) {
    return (document.getElementById(id)?.value || "").trim();
}
function formatDate(ts) {
    try {
        return new Intl.DateTimeFormat("en-IN", {
            day:    "2-digit", month: "short", year: "numeric",
            hour:   "2-digit", minute: "2-digit", hour12: true
        }).format(new Date(Number(ts)));
    } catch {
        return String(ts);
    }
}
