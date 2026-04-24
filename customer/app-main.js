// app-main.js — Entry point: bootstraps all modules cleanly

import {
    fetchAllProducts,
    getShopSettings,
    getWhatsAppNumber,
    safeTrackPageView
} from "./app-data.js";

import {
    showSkeletons,
    renderFeatured,
    renderCategoryChips,
    initAvailFilter,
    initSortSelect,
    setProducts,
    applyFiltersAndRender,
    openProductModal,
    initModalControls,
    loadMoreProducts,
    setSearchTerm,
    wireUICallbacks,
    showToast
} from "./app-ui.js";

import {
    initLeadPopup,
    initLeadForm,
    cleanupPopup,
    handleOrder,
    handleShare,
    initCustomCakeForm,
    openCustomCakeModal
} from "./app-popup.js";

// ══════════════════════════════════════════
//  BOOTSTRAP
// ══════════════════════════════════════════
document.addEventListener("DOMContentLoaded", async () => {
    // ── Wire callbacks between modules BEFORE rendering ──
    wireUICallbacks({ onOrder: handleOrder, onShare: handleShare });

    // ── 1. Show skeletons instantly ──
    showSkeletons("products-grid", 8);
    showSkeletons("featured-grid", 4);

    // ── 2. Init all UI controls (doesn't need data) ──
    initModalControls();
    initAvailFilter();
    initSortSelect();
    initHeaderSearch();
    initNavLinks();
    initCustomCakeButtons();
    initLoadMore();
    initBackToTop();
    initScrollAnimations();
    initLeadForm();
    initCustomCakeForm();

    // ── 3. Track page view (fire-and-forget) ──
    safeTrackPageView(window.location.pathname);

    // ── 4. Load settings + products in parallel ──
    try {
        const [products] = await Promise.all([
            fetchAllProducts(),
            applyShopSettings(),
            renderFeatured()            // runs its own fetch internally
        ]);

        setProducts(products);
        renderCategoryChips(products);
        applyFiltersAndRender();

    } catch (err) {
        console.error("[main] init error:", err);
        showToast("Failed to load menu. Please refresh the page.", "error", 6000);
        _showLoadError("products-grid");
    }

    // ── 5. Handle deep-link hash AFTER products are ready ──
    handleHashNavigation();

    // ── 6. Start lead popup timer (after everything is rendered) ──
    initLeadPopup();

    // ── 7. Cleanup on page unload ──
    window.addEventListener("beforeunload", cleanupPopup);
    window.addEventListener("hashchange", handleHashNavigation);
});

// ══════════════════════════════════════════
//  SHOP SETTINGS → APPLY TO UI
// ══════════════════════════════════════════
async function applyShopSettings() {
    try {
        const [settings, waNumber] = await Promise.all([
            getShopSettings(),
            getWhatsAppNumber()
        ]);

        const shopName = (settings && settings.shopName) ? settings.shopName : "V3 Cafe";
        const address  = (settings && settings.address)  ? settings.address  : "";

        _setText("hero-shop-name",   shopName);
        _setText("footer-shop-name", shopName);
        _setText("footer-address",   address);

        // Update page <title>
        document.title = `${shopName} — Fresh Baked with Love`;

        // WhatsApp CTA link
        const waUrl = `https://wa.me/${waNumber}`;
        const waBtn = document.getElementById("wa-header-btn");
        if (waBtn) waBtn.href = waUrl;

        const waFooter = document.getElementById("footer-wa");
        if (waFooter) waFooter.href = waUrl;

        // Social links
        const fb = settings && settings.facebook;
        const ig = settings && settings.instagram;
        if (fb) {
            const fbEl = document.getElementById("footer-fb");
            if (fbEl) { fbEl.href = fb; fbEl.style.display = ""; }
        }
        if (ig) {
            const igEl = document.getElementById("footer-ig");
            if (igEl) { igEl.href = ig; igEl.style.display = ""; }
        }

    } catch (err) {
        console.warn("[main] applyShopSettings:", err.message);
    }
}

// ══════════════════════════════════════════
//  HEADER SEARCH
// ══════════════════════════════════════════
function initHeaderSearch() {
    const toggleBtn  = document.getElementById("search-toggle");
    const searchBar  = document.getElementById("header-search-bar");
    const searchInp  = document.getElementById("main-search");
    const clearBtn   = document.getElementById("search-clear");
    const clearBanner= document.getElementById("clear-search-banner");

    let debounceTimer;

    // Toggle search bar
    toggleBtn?.addEventListener("click", () => {
        const isOpen = searchBar?.classList.toggle("open");
        if (isOpen) {
            setTimeout(() => searchInp?.focus(), 80);
        } else {
            _clearSearch(searchInp, clearBtn);
        }
    });

    // Live search — 250ms debounce
    searchInp?.addEventListener("input", e => {
        clearTimeout(debounceTimer);
        const term = e.target.value;
        if (clearBtn) clearBtn.style.display = term.trim() ? "" : "none";
        debounceTimer = setTimeout(() => {
            setSearchTerm(term.trim());
            applyFiltersAndRender();
        }, 250);
    });

    clearBtn?.addEventListener("click", () => {
        _clearSearch(searchInp, clearBtn);
    });

    clearBanner?.addEventListener("click", () => {
        _clearSearch(searchInp, clearBtn);
        searchBar?.classList.remove("open");
    });

    // ESC to close search
    searchInp?.addEventListener("keydown", e => {
        if (e.key === "Escape") {
            _clearSearch(searchInp, clearBtn);
            searchBar?.classList.remove("open");
            toggleBtn?.focus();
        }
    });

    // Initially hide clear button
    if (clearBtn) clearBtn.style.display = "none";
}

function _clearSearch(inp, clearBtn) {
    if (inp) inp.value = "";
    if (clearBtn) clearBtn.style.display = "none";
    setSearchTerm("");
    applyFiltersAndRender();
}

// ══════════════════════════════════════════
//  NAV + HAMBURGER
// ══════════════════════════════════════════
function initNavLinks() {
    const hamburger  = document.getElementById("hamburger");
    const mobileMenu = document.getElementById("mobile-menu");

    hamburger?.addEventListener("click", () => {
        hamburger.classList.toggle("open");
        mobileMenu?.classList.toggle("open");
    });

    // Close mobile menu when any mob-link or nav-link is clicked
    document.querySelectorAll("[data-scroll]").forEach(el => {
        el.addEventListener("click", e => {
            e.preventDefault();
            const targetId = el.dataset.scroll;
            const target   = document.getElementById(targetId);
            if (!target) return;

            // Close mobile menu
            hamburger?.classList.remove("open");
            mobileMenu?.classList.remove("open");

            // Offset scroll by header height
            const headerH = document.getElementById("site-header")?.offsetHeight || 68;
            const top = target.getBoundingClientRect().top + window.scrollY - headerH - 8;
            window.scrollTo({ top, behavior: "smooth" });
        });
    });

    // Logo → scroll to top
    document.getElementById("logo-home")?.addEventListener("click", e => {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: "smooth" });
    });

    // Highlight active nav on scroll
    window.addEventListener("scroll", _updateNavActive, { passive: true });
}

function _updateNavActive() {
    const headerH = document.getElementById("site-header")?.offsetHeight || 68;
    const scrollY = window.scrollY + headerH + 80;
    let activeId  = "";

    ["featured", "categories", "products"].forEach(id => {
        const el = document.getElementById(id);
        if (el && scrollY >= el.offsetTop) activeId = id;
    });

    document.querySelectorAll(".nav-link[data-scroll]").forEach(link => {
        link.classList.toggle("active", link.dataset.scroll === activeId);
    });
}

// ══════════════════════════════════════════
//  CUSTOM CAKE BUTTONS
// ══════════════════════════════════════════
function initCustomCakeButtons() {
    const ids = [
        "custom-cake-nav-btn",
        "custom-cake-mob-btn",
        "hero-custom-btn",
        "cta-custom-btn"
    ];
    ids.forEach(id => {
        document.getElementById(id)?.addEventListener("click", e => {
            e.preventDefault();
            // Close mobile menu if open
            document.getElementById("hamburger")?.classList.remove("open");
            document.getElementById("mobile-menu")?.classList.remove("open");
            openCustomCakeModal();
        });
    });
}

// ══════════════════════════════════════════
//  BACK TO TOP
// ══════════════════════════════════════════
function initBackToTop() {
    const btn = document.getElementById("back-to-top");
    if (!btn) return;

    window.addEventListener("scroll", () => {
        btn.classList.toggle("visible", window.scrollY > 500);
    }, { passive: true });

    btn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
}

// ══════════════════════════════════════════
//  LOAD MORE
// ══════════════════════════════════════════
function initLoadMore() {
    document.getElementById("load-more-btn")?.addEventListener("click", () => {
        loadMoreProducts();
    });
}

// ══════════════════════════════════════════
//  SCROLL ANIMATIONS (IntersectionObserver)
// ══════════════════════════════════════════
function initScrollAnimations() {
    if (!("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add("in-view");
                observer.unobserve(entry.target); // once is enough
            }
        });
    }, { threshold: 0.08 });

    document.querySelectorAll(".section-wrap, .cta-section, .hero-section").forEach(el => {
        observer.observe(el);
    });
}

// ══════════════════════════════════════════
//  DEEP LINK / HASH NAVIGATION
// ══════════════════════════════════════════
function handleHashNavigation() {
    const hash = window.location.hash;
    if (!hash) return;

    // #product=slug  → open product modal
    const m = hash.match(/^#product=(.+)$/);
    if (m) {
        const slug = decodeURIComponent(m[1]);
        // Small delay ensures products are rendered before trying to open modal
        setTimeout(() => openProductModal(slug), 600);
        return;
    }

    // #section=id  → smooth scroll
    const sm = hash.match(/^#section=(.+)$/);
    if (sm) {
        const el = document.getElementById(sm[1]);
        if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
    }
}

// ══════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════
function _setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text ?? "";
}

function _showLoadError(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
            <div class="empty-state-icon">⚠️</div>
            <div class="empty-state-title">Could not load the menu</div>
            <div class="empty-state-sub">Please check your internet connection and <a href="" onclick="location.reload()" style="color:var(--amber)">refresh the page</a>.</div>
        </div>`;
}
