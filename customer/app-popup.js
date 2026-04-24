// app-popup.js — Lead popup, WhatsApp ordering, share, custom cake form
// No circular imports — openModal/closeModal/showToast imported from app-ui.js only

import { openModal, closeModal, showToast } from "./app-ui.js";
import {
    submitLead,
    buildOrderUrl,
    buildCustomCakeWhatsAppUrl,
    getProductShareUrl,
    shouldShowLeadPopup,
    safeTrackInterest
} from "./app-data.js";

// ══════════════════════════════════════════
//  LEAD POPUP
// ══════════════════════════════════════════
const POPUP_DELAY_MS = 60_000; // 60 seconds
let _popupTimer  = null;
let _popupShown  = false;
let _exitBound   = false;

export function initLeadPopup() {
    // Already shown or permanently dismissed
    if (!shouldShowLeadPopup()) return;
    // Already dismissed in this session
    if (sessionStorage.getItem("v3cafe_popup_dismissed")) return;

    // Primary trigger: after 60 seconds
    _popupTimer = setTimeout(() => {
        if (!_popupShown) _showLeadPopup();
    }, POPUP_DELAY_MS);

    // Secondary trigger: exit intent (desktop — mouse leaves top of page)
    if (!_exitBound) {
        _exitBound = true;
        document.addEventListener("mouseleave", _handleExitIntent);
    }
}

function _handleExitIntent(e) {
    if (e.clientY <= 5 && !_popupShown && shouldShowLeadPopup()) {
        if (sessionStorage.getItem("v3cafe_popup_dismissed")) return;
        clearTimeout(_popupTimer);
        _showLeadPopup();
    }
}

function _showLeadPopup() {
    if (_popupShown) return;
    _popupShown = true;
    openModal("lead-popup");
}

export function cleanupPopup() {
    clearTimeout(_popupTimer);
    document.removeEventListener("mouseleave", _handleExitIntent);
    _exitBound = false;
}

// ── Lead Form ──
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

    form?.addEventListener("submit", async e => {
        e.preventDefault();

        const phone = (phoneInp?.value || "").trim();
        const name  = (nameInp?.value  || "").trim();

        const cleanPhone = phone.replace(/\D/g, "");
        if (!cleanPhone || cleanPhone.length < 7) {
            showToast("Please enter a valid phone number.", "warning");
            phoneInp?.focus();
            return;
        }

        // Loading state
        if (btnTxt)  btnTxt.classList.add("hidden");
        if (spinner) spinner.classList.remove("hidden");
        if (form)    form.style.pointerEvents = "none";

        try {
            await submitLead({
                phone:  cleanPhone,
                name,
                source: "popup",
                page:   window.location.pathname
            });
            closeModal("lead-popup");
            showToast("🎉 Thank you! You'll receive exclusive offers.", "success", 5000);
        } catch (err) {
            showToast("❌ " + (err.message || "Something went wrong. Try again."), "error");
        } finally {
            if (btnTxt)  btnTxt.classList.remove("hidden");
            if (spinner) spinner.classList.add("hidden");
            if (form)    form.style.pointerEvents = "";
        }
    });

    // Allow only digits + common phone chars
    phoneInp?.addEventListener("input", e => {
        const cleaned = e.target.value.replace(/[^\d\s\+\-\(\)]/g, "");
        if (e.target.value !== cleaned) e.target.value = cleaned;
    });
}

// ══════════════════════════════════════════
//  WHATSAPP ORDER
// ══════════════════════════════════════════
export async function handleOrder(product, qty = 1) {
    if (!product) return;

    const avail = (product.availability || "available").toLowerCase();
    if (avail === "out of stock") {
        showToast("❌ This item is currently out of stock.", "error");
        return;
    }

    try {
        const url = await buildOrderUrl(product, qty);
        _openWhatsApp(url);
        safeTrackInterest({
            type:      "order_click",
            productId: product.id || "",
            page:      window.location.pathname
        });
    } catch (err) {
        console.error("[popup] handleOrder:", err);
        showToast("Could not open WhatsApp. Please try again.", "error");
    }
}

function _openWhatsApp(url) {
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) window.location.href = url; // fallback if popup blocked
}

// ══════════════════════════════════════════
//  SHARE
// ══════════════════════════════════════════
export async function handleShare(product) {
    if (!product) return;

    const shareUrl   = getProductShareUrl(product);
    const shareTitle = `${product.title || ""} — V3 Cafe`;
    const shareText  = `Check out this from V3 Cafe: ${product.title || ""}`;

    // Web Share API (mobile browsers, modern desktop)
    if (navigator.share) {
        try {
            await navigator.share({ title: shareTitle, text: shareText, url: shareUrl });
            return;
        } catch (err) {
            // User cancelled — don't show error
            if (err.name === "AbortError") return;
        }
    }

    // Clipboard fallback
    try {
        await navigator.clipboard.writeText(shareUrl);
        showToast("🔗 Link copied to clipboard!", "success");
    } catch (_) {
        // Last resort: prompt
        window.prompt("Copy this link to share:", shareUrl);
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

    // Set minimum delivery date to today
    const dateInp = document.getElementById("cc-date");
    if (dateInp) {
        dateInp.min = new Date().toISOString().split("T")[0];
    }

    // Phone input — digits only
    const ccPhone = document.getElementById("cc-phone");
    ccPhone?.addEventListener("input", e => {
        e.target.value = e.target.value.replace(/[^\d\s\+\-\(\)]/g, "");
    });

    form?.addEventListener("submit", async e => {
        e.preventDefault();

        const name     = _getVal("cc-name");
        const phone    = _getVal("cc-phone").replace(/\D/g, "");
        const desc     = _getVal("cc-desc");
        const occasion = _getVal("cc-occasion");
        const date     = _getVal("cc-date");
        const budget   = _getVal("cc-budget");

        if (!phone || phone.length < 7) {
            showToast("Please enter a valid phone number.", "error");
            document.getElementById("cc-phone")?.focus();
            return;
        }
        if (!desc) {
            showToast("Please describe your dream cake.", "error");
            document.getElementById("cc-desc")?.focus();
            return;
        }

        if (submitBtn) {
            submitBtn.disabled  = true;
            submitBtn.innerHTML = `<span>⏳</span> Opening WhatsApp…`;
        }

        try {
            // Save lead non-blocking
            submitLead({
                phone,
                name,
                source: "custom_cake_request",
                page:   window.location.pathname
            }).catch(() => {});

            const url = await buildCustomCakeWhatsAppUrl({ name, desc, occasion, date, budget });

            closeModal("custom-modal");
            form.reset();
            // Reset min date after reset
            if (dateInp) dateInp.min = new Date().toISOString().split("T")[0];

            _openWhatsApp(url);
            showToast("📲 Opening WhatsApp with your custom cake request!", "success", 4000);

        } catch (err) {
            showToast("Error: " + (err.message || "Please try again."), "error");
        } finally {
            if (submitBtn) {
                submitBtn.disabled  = false;
                submitBtn.innerHTML = `<span>📲</span> Send Request on WhatsApp`;
            }
        }
    });
}

// ── Helper ──
function _getVal(id) {
    return (document.getElementById(id)?.value || "").trim();
}
