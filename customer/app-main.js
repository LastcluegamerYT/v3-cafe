// app-main.js — Entry point: init, router, search, analytics, settings

import {
    fetchAllProducts,
    getShopSettings,
    getWhatsAppNumberSync,
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
    wireUICallbacks
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
    // 1. Track page view (fire-and-forget)
    safeTrackPageView(window.location.pathname);

    // 2. Wire UI callbacks (must happen before any card renders)
    wireUICallbacks({ onOrder: handleOrder, onShare: handleShare });

    // 3. Init all UI interactions first (instant, no network)
    initHeaderSearch();
    initNavLinks();
    initModalControls();
    initSortSelect();
    initAvailFilter();
    initLeadForm();
    initCustomCakeForm();
    initCustomCakeButtons();
    initBackToTop();
    initLoadMore();
    initScrollAnimations();

    // 4. Load data (network — show skeletons while waiting)
    showSkeletons("products-grid", 8);
    showSkeletons("featured-grid", 4);

    const [settings, products] = await Promise.all([
        getShopSettings(),
        fetchAllProducts()
    ]);

    // 5. Apply shop settings to DOM
    // getWhatsAppNumberSync() is safe here — getShopSettings() just ran above and cached it
    applyShopSettings(settings, getWhatsAppNumberSync());

    // 6. Populate product UI
    setProducts(products);
    renderCategoryChips(products);
    applyFiltersAndRender();
    renderFeatured();

    // 7. Handle deep link AFTER products are loaded
    handleHashNavigation();

    // 8. Start lead popup timer last (after page is ready)
    initLeadPopup();

    // Cleanup on unload
    window.addEventListener("beforeunload", cleanupPopup);

    // Debounced hashchange so rapid back/forward presses don’t stack modal opens
    let _hashTimer;
    window.addEventListener("hashchange", () => {
        clearTimeout(_hashTimer);
        _hashTimer = setTimeout(handleHashNavigation, 80);
    });
});

// ══════════════════════════════════════════
//  SHOP SETTINGS → DOM
// ══════════════════════════════════════════
function applyShopSettings(settings, waNumber) {
    const shopName = (settings && settings.shopName) ? settings.shopName : "V3 Cafe";
    const address  = (settings && settings.address)  ? settings.address  : "";

    setText("hero-shop-name",   shopName);
    setText("footer-shop-name", shopName);
    setText("footer-address",   address);
    document.title = `${shopName} — Fresh Baked with Love`;

    // Auto-update copyright year
    const yearEl = document.getElementById("footer-year");
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    // Update OG title dynamically (useful for SPAs with JS-driven meta)
    document.querySelector("meta[property='og:title']")?.setAttribute("content", `${shopName} — Fresh Baked with Love`);

    const waHref = waNumber ? `https://wa.me/${waNumber}` : "#";

    const waHeaderBtn = document.getElementById("wa-header-btn");
    if (waHeaderBtn) waHeaderBtn.href = waHref;

    const waFooterBtn = document.getElementById("footer-wa");
    if (waFooterBtn) waFooterBtn.href = waHref;

    // Social links (only show if set)
    if (settings && settings.facebook) {
        const fbEl = document.getElementById("footer-fb");
        if (fbEl) { fbEl.href = settings.facebook; fbEl.style.display = ""; }
    }
    if (settings && settings.instagram) {
        const igEl = document.getElementById("footer-ig");
        if (igEl) { igEl.href = settings.instagram; igEl.style.display = ""; }
    }
}

// ══════════════════════════════════════════
//  SEARCH
// ══════════════════════════════════════════
function initHeaderSearch() {
    const toggleBtn   = document.getElementById("search-toggle");
    const searchBar   = document.getElementById("header-search-bar");
    const searchInput = document.getElementById("main-search");
    const clearBtn    = document.getElementById("search-clear");
    const clearBanner = document.getElementById("clear-search-banner");

    if (clearBtn) clearBtn.style.display = "none";

    let searchTimer;

    toggleBtn?.addEventListener("click", () => {
        const isOpen = searchBar?.classList.toggle("open");
        if (isOpen) {
            setTimeout(() => searchInput?.focus(), 80);
        } else {
            _clearSearch(searchInput, clearBtn);
        }
    });

    searchInput?.addEventListener("input", e => {
        clearTimeout(searchTimer);
        const term = e.target.value.trim();
        if (clearBtn) clearBtn.style.display = term ? "" : "none";
        searchTimer = setTimeout(() => {
            setSearchTerm(term);
            applyFiltersAndRender();
        }, 250);
    });

    clearBtn?.addEventListener("click", () => _clearSearch(searchInput, clearBtn));
    clearBanner?.addEventListener("click", () => {
        _clearSearch(searchInput, clearBtn);
        searchBar?.classList.remove("open");
    });

    searchInput?.addEventListener("keydown", e => {
        if (e.key === "Escape") {
            _clearSearch(searchInput, clearBtn);
            searchBar?.classList.remove("open");
            toggleBtn?.focus();
        }
    });
}

function _clearSearch(input, clearBtn) {
    if (input) input.value = "";
    if (clearBtn) clearBtn.style.display = "none";
    setSearchTerm("");
    applyFiltersAndRender();
}

// ══════════════════════════════════════════
//  NAV LINKS + HAMBURGER
// ══════════════════════════════════════════
function initNavLinks() {
    const hamburger  = document.getElementById("hamburger");
    const mobileMenu = document.getElementById("mobile-menu");

    hamburger?.addEventListener("click", () => {
        hamburger.classList.toggle("open");
        mobileMenu?.classList.toggle("open");
    });

    // Close mobile menu when a link is tapped
    mobileMenu?.addEventListener("click", () => {
        hamburger?.classList.remove("open");
        mobileMenu.classList.remove("open");
    });

    // Smooth scroll for all data-scroll links
    document.querySelectorAll("[data-scroll]").forEach(el => {
        el.addEventListener("click", e => {
            e.preventDefault();
            const targetId = el.dataset.scroll;
            const target   = document.getElementById(targetId);
            if (!target) return;
            hamburger?.classList.remove("open");
            mobileMenu?.classList.remove("open");
            const headerH = document.getElementById("site-header")?.offsetHeight || 68;
            const top = target.getBoundingClientRect().top + window.scrollY - headerH - 12;
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
    const y = window.scrollY + headerH + 60;
    let activeId = "";

    ["categories", "products"].forEach(id => {
        const el = document.getElementById(id);
        if (el && y >= el.offsetTop) activeId = id;
    });

    document.querySelectorAll(".nav-link[data-scroll]").forEach(link => {
        link.classList.toggle("active", link.dataset.scroll === activeId);
    });
}

// ══════════════════════════════════════════
//  CUSTOM CAKE — multiple trigger buttons
// ══════════════════════════════════════════
function initCustomCakeButtons() {
    ["custom-cake-nav-btn", "custom-cake-mob-btn", "hero-custom-btn", "cta-custom-btn"]
        .forEach(id => {
            document.getElementById(id)?.addEventListener("click", e => {
                e.preventDefault();
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
        btn.classList.toggle("visible", window.scrollY > 400);
    }, { passive: true });
    btn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
}

// ══════════════════════════════════════════
//  LOAD MORE
// ══════════════════════════════════════════
function initLoadMore() {
    document.getElementById("load-more-btn")?.addEventListener("click", () => {
        loadMoreProducts();
        // Scroll slightly so new cards are visible
        setTimeout(() => {
            const grid = document.getElementById("products-grid");
            const last = grid?.lastElementChild;
            last?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 80);
    });
}

// ══════════════════════════════════════════
//  SCROLL ANIMATIONS (IntersectionObserver)
// ══════════════════════════════════════════
function initScrollAnimations() {
    if (!("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(entries => {
        entries.forEach(e => {
            if (e.isIntersecting) {
                e.target.classList.add("in-view");
                observer.unobserve(e.target); // fire once
            }
        });
    }, { threshold: 0.06, rootMargin: "0px 0px -40px 0px" });

    document.querySelectorAll(".section-wrap, .cta-section, .hero-section").forEach(el => {
        observer.observe(el);
    });
}

// ══════════════════════════════════════════
//  DEEP LINK ROUTER
//
//  Supported share URL formats (all open the product modal):
//   • ?product=slug          ← from buildShareLink() / web share
//   • ?productId=id         ← fallback from buildShareLink()
//   • #product=slug         ← from order links + in-page nav
//
//  Called AFTER products are loaded, so modal opens instantly.
// ══════════════════════════════════════════
function handleHashNavigation() {
    // ── 1. Check query parameters (?product=slug or ?productId=id) ──
    const params = new URLSearchParams(window.location.search);
    const qSlug  = params.get("product");
    const qId    = params.get("productId");

    if (qSlug || qId) {
        const identifier = decodeURIComponent(qSlug || qId);
        // Open immediately — products already loaded at this point
        openProductModal(identifier);
        // Clean the query param from the URL bar (keep it tidy)
        const cleanUrl = window.location.pathname + window.location.hash;
        history.replaceState(null, "", cleanUrl);
        return;
    }

    // ── 2. Check hash (#product=slug) ──
    const hash = window.location.hash;
    if (!hash) return;

    const productMatch = hash.match(/^#product=(.+)$/);
    if (productMatch) {
        const slug = decodeURIComponent(productMatch[1]);
        openProductModal(slug); // products already loaded — no delay needed
        return;
    }

    // ── 3. Scroll to section (#section=id) ──
    const sectionMatch = hash.match(/^#section=(.+)$/);
    if (sectionMatch) {
        const el = document.getElementById(sectionMatch[1]);
        if (el) el.scrollIntoView({ behavior: "smooth" });
    }
}

// ══════════════════════════════════════════
//  UTILITY
// ══════════════════════════════════════════
function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text ?? "";
}
