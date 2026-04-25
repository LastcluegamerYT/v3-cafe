// app-popup.js — Lead popup, WhatsApp order, share, custom cake form

import {
    submitLead,
    buildOrderUrlSync,
    buildCustomCakeWhatsAppUrl,
    getProductShareUrl,
    shouldShowLeadPopup,
    markLeadPopupSeen
} from "./app-data.js";

import { openModal, closeModal, showToast } from "./app-ui.js";

// ══════════════════════════════════════════
//  LEAD POPUP (60s trigger + exit intent)
// ══════════════════════════════════════════
const POPUP_DELAY_MS = 60_000;
let _popupTimer  = null;
let _popupShown  = false;
let _exitBound   = false;

export function initLeadPopup() {
    // Don't show if already submitted / dismissed
    if (!shouldShowLeadPopup()) return;
    // Don't show if dismissed this session
    if (sessionStorage.getItem("v3cafe_popup_dismissed")) return;

    _popupTimer = setTimeout(() => {
        if (!_popupShown) showLeadPopup();
    }, POPUP_DELAY_MS);

    // Exit intent (mouse leaves top of viewport — desktop only)
    if (!_exitBound && window.matchMedia("(pointer:fine)").matches) {
        document.addEventListener("mouseleave", _exitIntentHandler);
        _exitBound = true;
    }
}

function _exitIntentHandler(e) {
    if (e.clientY <= 5 && !_popupShown && shouldShowLeadPopup()
        && !sessionStorage.getItem("v3cafe_popup_dismissed")) {
        clearTimeout(_popupTimer);
        showLeadPopup();
    }
}

function showLeadPopup() {
    if (_popupShown) return;
    _popupShown = true;
    openModal("lead-popup");
}

export function cleanupPopup() {
    clearTimeout(_popupTimer);
    if (_exitBound) {
        document.removeEventListener("mouseleave", _exitIntentHandler);
        _exitBound = false;
    }
}

// ══════════════════════════════════════════
//  LEAD FORM
// ══════════════════════════════════════════
export function initLeadForm() {
    const form     = document.getElementById("lead-form");
    const closeBtn = document.getElementById("popup-close");
    const overlay  = document.getElementById("lead-popup");
    const phoneInp = document.getElementById("lead-phone");
    const nameInp  = document.getElementById("lead-name");
    const btnTxt   = document.getElementById("lead-btn-txt");
    const spinner  = document.getElementById("lead-spinner");

    function dismissPopup() {
        closeModal("lead-popup");
        sessionStorage.setItem("v3cafe_popup_dismissed", "1");
    }

    closeBtn?.addEventListener("click", dismissPopup);

    overlay?.addEventListener("click", e => {
        if (e.target === e.currentTarget) dismissPopup();
    });

    // ESC key closes the lead popup too
    document.addEventListener("keydown", e => {
        if (e.key === "Escape" && !overlay?.classList.contains("hidden")) {
            dismissPopup();
        }
    });

    form?.addEventListener("submit", async e => {
        e.preventDefault();

        const phone      = (phoneInp?.value || "").trim();
        const name       = (nameInp?.value  || "").trim();
        const cleanPhone = phone.replace(/\D/g, "");

        if (!cleanPhone || cleanPhone.length < 7) {
            showToast("Please enter a valid phone number.", "warning");
            phoneInp?.focus();
            return;
        }

        // Loading state
        btnTxt?.classList.add("hidden");
        spinner?.classList.remove("hidden");
        if (form) form.style.pointerEvents = "none";

        try {
            await submitLead({
                phone:  cleanPhone,
                name,
                source: "popup",
                page:   window.location.pathname
            });
            closeModal("lead-popup");
            showToast("🎉 Thank you! We'll send you exclusive offers.", "success", 4500);
        } catch (err) {
            showToast("❌ " + (err.message || "Could not save. Try again."), "error");
        } finally {
            btnTxt?.classList.remove("hidden");
            spinner?.classList.add("hidden");
            if (form) form.style.pointerEvents = "";
        }
    });
}

// ══════════════════════════════════════════
//  WHATSAPP ORDER
//
//  DEVICE BEHAVIOUR (wa.me handles automatically):
//   📱 Mobile  → Opens WhatsApp app directly
//   💻 Laptop  → Opens web.whatsapp.com in browser
//   WhatsApp NOT installed  → wa.me shows download page
//
//  POPUP-BLOCKER FIX:
//   Settings are preloaded at startup, so buildOrderUrlSync()
//   is 100% SYNCHRONOUS — no await at all — window.open()
//   is called within the user-gesture context and NEVER blocked.
// ══════════════════════════════════════════
export function handleOrder(product, qty = 1) {
    if (!product) return;

    const avail = (product.availability || "available").toLowerCase();
    if (avail === "out of stock") {
        showToast("❌ This item is out of stock.", "error");
        return;
    }

    // Build URL synchronously (settings already cached at startup)
    let url;
    try {
        url = buildOrderUrlSync(product, qty);
    } catch (err) {
        showToast(err.message || "WhatsApp not configured.", "error", 6000);
        return;
    }

    // Open WhatsApp — fully inside user-gesture context, never popup-blocked
    // • Mobile   → Opens WhatsApp app
    // • Laptop   → Opens web.whatsapp.com
    _openLink(url);
    showToast("📲 Opening WhatsApp…", "info", 2000);
}

// Robust link opener — works on all devices:
// 1. window.open (desktop Chrome + Android)
// 2. <a> click fallback (iOS Safari WebView, popup-blocked)
function _openLink(url) {
    const win = window.open(url, "_blank");
    if (!win || win.closed || typeof win.closed === "undefined") {
        _anchorOpen(url);
    }
}

// Anchor-click fallback — bypasses popup-blockers on iOS Safari
function _anchorOpen(url) {
    const a = document.createElement("a");
    a.href   = url;
    a.target = "_blank";
    a.rel    = "noopener noreferrer";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 200);
}

// ══════════════════════════════════════════
//  SHARE
// ══════════════════════════════════════════
export async function handleShare(product) {
    if (!product) return;

    const shareUrl   = getProductShareUrl(product);
    const shareTitle = `${product.title} — V3 Cafe`;
    const shareText  = `Check out this item from V3 Cafe: ${product.title}`;

    // Web Share API (mobile-native share sheet)
    if (navigator.share) {
        try {
            await navigator.share({ title: shareTitle, text: shareText, url: shareUrl });
            return;
        } catch (err) {
            if (err.name === "AbortError") return; // user cancelled — do nothing
        }
    }

    // Clipboard fallback
    try {
        await navigator.clipboard.writeText(shareUrl);
        showToast("🔗 Product link copied to clipboard!", "success");
    } catch (_) {
        // Last resort — prompt dialog
        window.prompt("Copy this product link:", shareUrl);
    }
}

// ══════════════════════════════════════════
//  CUSTOM CAKE MODAL
// ══════════════════════════════════════════
export function openCustomCakeModal() {
    openModal("custom-modal");
}

export function initCustomCakeForm() {
    const form      = document.getElementById("custom-cake-form");
    const submitBtn = document.getElementById("custom-submit-btn");

    // Set minimum date to today
    const dateInp = document.getElementById("cc-date");
    if (dateInp) {
        dateInp.min = new Date().toISOString().split("T")[0];
    }

    form?.addEventListener("submit", async e => {
        e.preventDefault();

        const name     = getVal("cc-name");
        const phone    = getVal("cc-phone").replace(/\D/g, "");
        const desc     = getVal("cc-desc");
        const occasion = getVal("cc-occasion");
        const date     = getVal("cc-date");
        const budget   = getVal("cc-budget");

        if (!phone || phone.length < 7) {
            showToast("Please enter a valid phone number.", "error");
            document.getElementById("cc-phone")?.focus();
            return;
        }
        if (!desc) {
            showToast("Please describe the cake you want.", "error");
            document.getElementById("cc-desc")?.focus();
            return;
        }

        if (submitBtn) {
            submitBtn.disabled   = true;
            submitBtn.innerHTML  = `<span>⏳</span> Opening WhatsApp…`;
        }

        try {
            // Save as lead (non-blocking, best-effort)
            submitLead({ phone, name, source: "custom_cake_request", page: window.location.pathname }).catch(() => {});

            const url = await buildCustomCakeWhatsAppUrl({ name, desc, occasion, date, budget });
            closeModal("custom-modal");
            form.reset();
            // _openLink is sync, no popup-block risk here since buildCustomCakeWhatsAppUrl
            // is fast (uses cached _cachedWaNumber), but we call _openLink after await.
            // If browser blocks it: anchorOpen fallback handles it.
            _openLink(url);
            showToast("📲 WhatsApp opened with your request!", "success", 3000);

        } catch (err) {
            showToast("Error: " + (err.message || "Please try again."), "error", 5000);
        } finally {
            if (submitBtn) {
                submitBtn.disabled  = false;
                submitBtn.innerHTML = `<span>📲</span> Send Request on WhatsApp`;
            }
        }
    });
}

// ── Tiny helper ──
function getVal(id) {
    return (document.getElementById(id)?.value || "").trim();
}
