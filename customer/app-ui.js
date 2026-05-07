// app-ui.js — All rendering: product cards, grid, modal, categories, skeleton
// No circular dependencies — toast/modal open/close are self-contained here.

import {
    fetchAllProducts,
    fetchFeatured,
    extractCategories,
    getCategoryEmoji,
    buildProductDetail,
    safeTrackProductView,
    safeTrackProductClick,
    fetchProductDetail
} from "./app-data.js?v=2";

// ── External callbacks wired from app-main (avoids circular deps) ──
let _onOrderClick = null;
let _onShareClick = null;

export function wireUICallbacks({ onOrder, onShare }) {
    _onOrderClick = onOrder;
    _onShareClick = onShare;
}

// ══════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════
let _products = [];
let _filtered = [];
let _activeCategory = "all";
let _activeAvail = "all";
let _sortOrder = "default";
let _searchTerm = "";
let _pageSize = 40;
let _page = 1;
let _currentProduct = null;
let _modalQty = 1;
let _shuffleSeed = new Map();
let _pendingRender = false;

// Load Base64 image cache
let _imageCache = {};
try { _imageCache = JSON.parse(localStorage.getItem("v3_image_cache") || "{}"); } catch(e) {}

// ══════════════════════════════════════════
//  NST PICKUP TIME HELPERS
//  Nepal Standard Time = UTC + 5h 45m
// ══════════════════════════════════════════
const NST_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;
const CAFE_OPEN_MIN = 9 * 60; // 9:00 AM
const CAFE_CLOSE_MIN = 21 * 60; // 9:00 PM
const PICKUP_BUFFER = 4 * 60;  // 4 hours prep time in minutes

function _nowInNST() {
    // Shift UTC epoch by NST offset, read as UTC fields → gives NST values
    const d = new Date(Date.now() + NST_OFFSET_MS);
    return d.getUTCHours() * 60 + d.getUTCMinutes(); // total minutes from midnight NST
}

function _fmtSlot(totalMin) {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
    const mm = m === 0 ? "00" : "30";
    return `${h12}:${mm} ${ampm}`;
}

export function populatePickupSlots(day) {
    const dayEl = document.getElementById("pickup-day");
    const timeEl = document.getElementById("pickup-time");
    const noteEl = document.getElementById("pickup-note");
    if (!timeEl) return;

    const nowMin = _nowInNST();
    const cutoff = day === "today" ? nowMin + PICKUP_BUFFER : -1;

    const slots = [];
    for (let m = CAFE_OPEN_MIN; m <= CAFE_CLOSE_MIN; m += 30) {
        if (m >= cutoff) slots.push(m);
    }

    if (!slots.length && day === "today") {
        // No more slots for today — auto-switch to tomorrow
        if (dayEl) dayEl.value = "tomorrow";
        if (noteEl) {
            noteEl.textContent = "⚠️ Cafe order time passed for today — switched to Tomorrow.";
            noteEl.className = "pickup-note warn";
        }
        populatePickupSlots("tomorrow");
        return;
    }

    timeEl.innerHTML = slots.map(m => {
        const label = _fmtSlot(m);
        return `<option value="${label}">${label}</option>`;
    }).join("");

    if (noteEl) {
        noteEl.textContent = day === "today"
            ? `🕐 Nepal Time • Slots from now +4h prep (9 AM–9 PM)`
            : "🕐 Nepal Time • All slots for tomorrow (9 AM–9 PM)";
        noteEl.className = "pickup-note";
    }
}

function _getPickupString() {
    const day = document.getElementById("pickup-day")?.value || "today";
    const time = document.getElementById("pickup-time")?.value || "";
    if (!time || time === "Loading…") return "";
    return `${day === "today" ? "Today" : "Tomorrow"} at ${time} (Nepal Time)`;
}

export function setProducts(products) {
    _products = Array.isArray(products) ? products : [];
    _filtered = [..._products];
    // Bug 6 fix: prune stale shuffle seeds for products that no longer exist
    const currentIds = new Set(_products.map(p => p.id));
    for (const key of _shuffleSeed.keys()) {
        if (!currentIds.has(key)) _shuffleSeed.delete(key);
    }
}

export function setSearchTerm(term) {
    _searchTerm = (term || "").trim();
    _page = 1;
}

// ══════════════════════════════════════════
//  TOAST (self-contained, no external dep)
// ══════════════════════════════════════════
export function showToast(message, type = "info", duration = 3000) {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = message; // textContent prevents XSS
    // Cap at 4 toasts
    while (container.children.length >= 4) container.firstChild.remove();
    container.appendChild(el);
    setTimeout(() => {
        el.classList.add("removing");
        setTimeout(() => el?.remove(), 320);
    }, duration);
}

// ══════════════════════════════════════════
//  MODAL OPEN / CLOSE (self-contained)
// ══════════════════════════════════════════
export function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove("hidden");
    document.body.style.overflow = "hidden";
}

export function closeModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add("hidden");
    const anyOpen = document.querySelector(".modal-overlay:not(.hidden), .popup-overlay:not(.hidden)");
    if (!anyOpen) {
        document.body.style.overflow = "";
        if (_pendingRender) {
            _pendingRender = false;
            applyFiltersAndRender();
            renderFeatured();
        }
    }
}

// ══════════════════════════════════════════
//  SKELETON LOADERS
// ══════════════════════════════════════════
export function showSkeletons(containerId, count = 8) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = Array.from({ length: count }, () => `
        <div class="skeleton-card">
            <div class="skeleton skel-img"></div>
            <div class="skel-body">
                <div class="skeleton skel-cat"></div>
                <div class="skeleton skel-title"></div>
                <div class="skeleton skel-title2"></div>
                <div class="skeleton skel-price"></div>
                <div class="skeleton skel-btn"></div>
            </div>
        </div>
    `).join("");
}

// ══════════════════════════════════════════
//  PRODUCT CARD BUILDER
// ══════════════════════════════════════════
function buildCardHTML(p) {
    const origPrice = Number(p.meta?.originalPrice) || 0;
    const salePrice = Number(p.price) || 0;
    const discountPct = (origPrice > 0 && origPrice > salePrice)
        ? Math.round((1 - salePrice / origPrice) * 100) : 0;

    const avail = (p.availability || "available").toLowerCase();
    const badgeClass = avail === "available" ? "badge-available"
        : avail === "custom" ? "badge-custom" : "badge-out";
    const badgeTxt = avail === "available" ? "✅ Available"
        : avail === "custom" ? "🎨 Custom" : "❌ Out of Stock";

    const isOut = avail === "out of stock";
    const safeId = esc(p.id || "");

    const imgUrl = p.mainImage || p.image;
    const finalImgSrc = _imageCache[imgUrl] || imgUrl;

    const imgHTML = finalImgSrc
        ? `<img class="card-img" src="${esc(finalImgSrc)}" alt="${esc(p.title)}" loading="lazy"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
           <div class="card-img-ph" style="display:none">🧁</div>`
        : `<div class="card-img-ph">🧁</div>`;

    const priceHTML = (origPrice > 0 && origPrice > salePrice)
        ? `<span class="card-price">Rs. ${salePrice.toLocaleString()}</span>
           <span class="card-mrp">Rs. ${origPrice.toLocaleString()}</span>
           <span class="card-off">${discountPct}% OFF</span>`
        : `<span class="card-price">Rs. ${salePrice.toLocaleString()}</span>`;

    return `
    <div class="prod-card" data-id="${safeId}" tabindex="0" role="button" aria-label="View ${esc(p.title)}">
        <div class="card-img-wrap">
            ${imgHTML}
            <span class="card-avail-badge ${badgeClass}">${badgeTxt}</span>
            ${p.featured ? `<span class="card-featured-tag">⭐ Featured</span>` : ""}
        </div>
        <div class="card-body">
            <div class="card-cat">${getCategoryEmoji(p.category)} ${esc(p.category || "Bakery")}</div>
            <div class="card-title">${esc(p.title)}</div>
            <div class="card-price-row">${priceHTML}</div>
            <div class="card-actions">
                <button class="btn-view"  data-action="view"  data-id="${safeId}">👁 Details</button>
                <button class="btn-order ${isOut ? "disabled" : ""}"
                    data-action="order" data-id="${safeId}" ${isOut ? "disabled" : ""}>
                    📲 Pre-Order
                </button>
            </div>
        </div>
    </div>`;
}

// ══════════════════════════════════════════
//  FEATURED SECTION
// ══════════════════════════════════════════
export async function renderFeatured() {
    const container = document.getElementById("featured-grid");
    const section = document.getElementById("featured");
    if (!container) return;
    // Note: app-main already called showSkeletons("featured-grid", 4) before this,
    // so we do NOT call it again here — avoids visible re-flash.
    try {
        const featured = await fetchFeatured(6);
        if (!featured.length) {
            if (section) section.style.display = "none";
            return;
        }
        container.innerHTML = featured.map(p => buildCardHTML(p)).join("");
        bindCardEvents(container);
    } catch (err) {
        if (section) section.style.display = "none";
    }
}

// ══════════════════════════════════════════
//  CATEGORY CHIPS
// ══════════════════════════════════════════
export function renderCategoryChips(products) {
    const container = document.getElementById("category-chips");
    if (!container) return;

    const categories = extractCategories(products);
    if (!categories.length) return;

    container.innerHTML =
        `<button class="cat-chip active" data-cat="all">🍽️ All</button>` +
        categories.map(cat =>
            `<button class="cat-chip" data-cat="${esc(cat)}">${getCategoryEmoji(cat)} ${esc(cat)}</button>`
        ).join("");

    container.querySelectorAll(".cat-chip").forEach(btn => {
        btn.addEventListener("click", () => {
            container.querySelectorAll(".cat-chip").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            _activeCategory = btn.dataset.cat || "all";
            _page = 1;
            applyFiltersAndRender();
        });
    });
}

// ══════════════════════════════════════════
//  AVAILABILITY FILTER
// ══════════════════════════════════════════
export function initAvailFilter() {
    document.querySelectorAll(".avail-chip").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".avail-chip").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            _activeAvail = btn.dataset.avail || "all";
            _page = 1;
            applyFiltersAndRender();
        });
    });
}

// ══════════════════════════════════════════
//  SORT
// ══════════════════════════════════════════
export function initSortSelect() {
    document.getElementById("sort-select")?.addEventListener("change", e => {
        _sortOrder = e.target.value;
        _page = 1;
        applyFiltersAndRender();
    });
}

// ══════════════════════════════════════════
//  FILTER + SORT + RENDER
// ══════════════════════════════════════════
export function applyFiltersAndRender(isBackgroundUpdate = false) {
    const anyOpen = document.querySelector(".modal-overlay:not(.hidden), .popup-overlay:not(.hidden)");
    if (isBackgroundUpdate && anyOpen) {
        _pendingRender = true;
        return;
    }

    let list = [..._products];

    if (_activeCategory !== "all") {
        list = list.filter(p => (p.category || "").toLowerCase() === _activeCategory.toLowerCase());
    }

    if (_activeAvail !== "all") {
        list = list.filter(p => (p.availability || "available").toLowerCase() === _activeAvail);
    }

    if (_searchTerm) {
        const q = _searchTerm.toLowerCase();
        list = list.filter(p =>
            [p.title, p.description, p.category, ...(p.tags || []), ...(p.ingredients || [])]
                .join(" ").toLowerCase().includes(q)
        );
    }

    switch (_sortOrder) {
        case "price-asc": list.sort((a, b) => (a.price || 0) - (b.price || 0)); break;
        case "price-desc": list.sort((a, b) => (b.price || 0) - (a.price || 0)); break;
        case "name-asc": list.sort((a, b) => (a.title || "").localeCompare(b.title || "")); break;
        case "newest": list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); break;
        default:
            if (_activeCategory === "all" && _activeAvail === "all" && !_searchTerm) {
                // Persistent shuffle so real-time updates don't cause the grid to jump around
                for (let p of list) {
                    if (!_shuffleSeed.has(p.id)) _shuffleSeed.set(p.id, Math.random());
                }

                let shuffled = [...list].sort((a, b) => _shuffleSeed.get(a.id) - _shuffleSeed.get(b.id));
                let top5 = [], seen = new Set(), rest = [];
                for (let p of shuffled) {
                    if (top5.length < 5 && !seen.has(p.price)) {
                        top5.push(p); seen.add(p.price);
                    } else {
                        rest.push(p);
                    }
                }
                while (top5.length < 5 && rest.length) top5.push(rest.shift());
                list = [...top5.sort((a, b) => _shuffleSeed.get(a.id) - _shuffleSeed.get(b.id)), ...rest];
            }
            break;
    }

    _filtered = list;
    _renderGrid();
    _updateLabel();
    _updateSearchBanner();
}

function _updateLabel() {
    const el = document.getElementById("products-count-label");
    if (!el) return;
    const n = _filtered.length;
    el.textContent = _searchTerm
        ? `${n} result${n !== 1 ? "s" : ""} for "${_searchTerm}"`
        : `${n} item${n !== 1 ? "s" : ""}`;
}

function _updateSearchBanner() {
    const banner = document.getElementById("search-banner");
    const txt = document.getElementById("search-banner-txt");
    if (!banner) return;
    if (_searchTerm) {
        if (txt) txt.textContent = `Showing results for "${_searchTerm}"`;
        banner.classList.remove("hidden");
    } else {
        banner.classList.add("hidden");
    }
}

function _renderGrid() {
    const grid = document.getElementById("products-grid");
    if (!grid) return;

    const visible = _filtered.slice(0, _page * _pageSize);

    if (!_filtered.length) {
        grid.innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon">🔍</div>
            <div class="empty-state-title">${_searchTerm ? "No results found" : "No products here yet"}</div>
            <div class="empty-state-sub">${_searchTerm ? "Try a different search term." : "Check back soon!"}</div>
        </div>`;
        document.getElementById("load-more-wrap")?.classList.add("hidden");
        return;
    }

    grid.innerHTML = visible.map(buildCardHTML).join("");
    bindCardEvents(grid);

    const lmWrap = document.getElementById("load-more-wrap");
    if (lmWrap) {
        lmWrap.classList.toggle("hidden", _filtered.length <= visible.length);
    }
}

export function loadMoreProducts() {
    _page++;
    _renderGrid();
}

// ══════════════════════════════════════════
//  CARD EVENTS
// ══════════════════════════════════════════
function bindCardEvents(container) {
    container.querySelectorAll("[data-action='view']").forEach(btn => {
        btn.addEventListener("click", e => {
            e.stopPropagation();
            openProductModal(btn.dataset.id);
        });
    });

    container.querySelectorAll("[data-action='order']").forEach(btn => {
        btn.addEventListener("click", e => {
            e.stopPropagation();
            if (btn.disabled || btn.classList.contains("disabled")) return;
            // Open modal so customer selects pickup time before ordering
            openProductModal(btn.dataset.id);
        });
    });

    container.querySelectorAll(".prod-card").forEach(card => {
        card.addEventListener("click", e => {
            if (e.target.closest("[data-action]")) return;
            openProductModal(card.dataset.id);
        });
        card.addEventListener("keydown", e => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openProductModal(card.dataset.id);
            }
        });
    });
}

// ══════════════════════════════════════════
//  PRODUCT DETAIL MODAL
// ══════════════════════════════════════════
export async function openProductModal(id) {
    if (!id) return;

    // Fast lookup in already-loaded products
    let product = _products.find(p => p.id === id || p.slug === id);

    // Firebase fallback
    if (!product) {
        try { product = await fetchProductDetail(id); } catch (_) { }
    }

    if (!product) {
        showToast("Product not found.", "error");
        return;
    }

    safeTrackProductView(product.id);

    const detail = buildProductDetail(product);
    _currentProduct = detail;
    _modalQty = 1;

    populateProductModal(detail);

    // Reset day selector and refresh slots every time modal opens
    const dayEl = document.getElementById("pickup-day");
    if (dayEl) dayEl.value = "today";
    try { populatePickupSlots("today"); } catch (_) {}

    openModal("product-modal");

    // Update URL — use replaceState so the Back button returns to the previous page
    // rather than cycling through each product the user viewed.
    const slug = product.slug || product.id;
    const newHash = `#product=${encodeURIComponent(slug)}`;
    if (window.location.hash !== newHash) {
        history.replaceState(null, "", newHash);
    }
}

function populateProductModal(p) {
    const avail = (p.availability || "available").toLowerCase();

    // Availability badge
    const ab = document.getElementById("pm-avail-badge");
    if (ab) {
        ab.textContent = avail === "available" ? "✅ Available"
            : avail === "custom" ? "🎨 Custom Order" : "❌ Out of Stock";
        ab.className = `pm-avail-badge ${avail === "available" ? "available" : avail === "custom" ? "custom" : "out"}`;
    }

    // Category badge
    const cb = document.getElementById("pm-category-badge");
    if (cb) cb.textContent = `${getCategoryEmoji(p.category)} ${p.category || "Bakery"}`;

    setText("pm-title", p.title);

    // Pricing
    const orig = Number(p.meta?.originalPrice) || 0;
    const sale = Number(p.price) || 0;
    setText("pm-price", `Rs. ${sale.toLocaleString()}`);

    const mrpEl = document.getElementById("pm-mrp");
    const offEl = document.getElementById("pm-off");
    if (orig > 0 && orig > sale) {
        const pct = Math.round((1 - sale / orig) * 100);
        if (mrpEl) { mrpEl.textContent = `Rs. ${orig.toLocaleString()}`; mrpEl.classList.remove("hidden"); }
        if (offEl) { offEl.textContent = `${pct}% OFF`; offEl.classList.remove("hidden"); }
    } else {
        mrpEl?.classList.add("hidden");
        offEl?.classList.add("hidden");
    }

    const descEl = document.getElementById("pm-desc");
    const showMoreBtn = document.getElementById("pm-show-more");
    if (descEl) {
        descEl.textContent = p.description || "A delicious bakery item, freshly made just for you.";
        descEl.classList.remove("expanded");
        if (showMoreBtn) {
            showMoreBtn.textContent = "...show more";
            showMoreBtn.style.display = "none";
            // Check after a paint if text actually overflows
            requestAnimationFrame(() => {
                if (descEl.scrollHeight > descEl.clientHeight + 2) {
                    showMoreBtn.style.display = "inline-block";
                }
            });
            showMoreBtn.onclick = () => {
                const expanded = descEl.classList.toggle("expanded");
                showMoreBtn.textContent = expanded ? "show less" : "...show more";
            };
        }
    }

    // Ingredients
    const ingWrap = document.getElementById("pm-ingredients-wrap");
    const ingEl = document.getElementById("pm-ingredients");
    if (p.ingredients?.length) {
        if (ingEl) ingEl.textContent = p.ingredients.join(", ");
        ingWrap?.classList.remove("hidden");
    } else { ingWrap?.classList.add("hidden"); }

    // Tags
    const tagsWrap = document.getElementById("pm-tags-wrap");
    const tagsEl = document.getElementById("pm-tags");
    if (p.tags?.length && tagsEl) {
        tagsEl.innerHTML = p.tags.map(t => `<span class="pm-tag">${esc(t)}</span>`).join("");
        tagsWrap?.classList.remove("hidden");
    } else { tagsWrap?.classList.add("hidden"); }

    // Note
    const noteWrap = document.getElementById("pm-note-wrap");
    const noteTxt = document.getElementById("pm-note-txt");
    if (p.note && noteTxt) {
        noteTxt.textContent = p.note;
        noteWrap?.classList.remove("hidden");
    } else { noteWrap?.classList.add("hidden"); }

    // Gallery
    renderModalGallery(p);

    // Qty
    const qtyEl = document.getElementById("qty-val");
    if (qtyEl) qtyEl.textContent = "1";
    _modalQty = 1;

    // Order button
    const orderBtn = document.getElementById("pm-order-btn");
    if (orderBtn) {
        if (avail === "out of stock") {
            orderBtn.disabled = true;
            orderBtn.innerHTML = "❌ Out of Stock";
            orderBtn.style.background = "#9ca3af";
            orderBtn.style.boxShadow = "none";
        } else {
            orderBtn.disabled = false;
            orderBtn.innerHTML = `<span>📲</span> Pre-Order via WhatsApp`;
            orderBtn.style.background = "";
            orderBtn.style.boxShadow = "";
        }
    }
}

function renderModalGallery(p) {
    const mainImg = document.getElementById("pm-main-img");
    const imgPh = document.getElementById("pm-img-placeholder");
    const thumbsEl = document.getElementById("pm-thumbnails");
    const fsBtn = document.getElementById("pm-fs-btn");

    const gallery = (p.gallery && p.gallery.length)
        ? p.gallery
        : (p.mainImage ? [{ url: p.mainImage, alt: p.title }] : []);

    if (!gallery.length) {
        if (mainImg) mainImg.style.display = "none";
        if (imgPh) imgPh.style.display = "flex";
        if (thumbsEl) thumbsEl.innerHTML = "";
        if (fsBtn) fsBtn.style.display = "none";
        return;
    }

    if (mainImg) {
        const imgUrl = gallery[0].url;
        mainImg.src = _imageCache[imgUrl] || imgUrl;
        mainImg.alt = gallery[0].alt || p.title;
        mainImg.style.display = "block";
        mainImg.style.opacity = "1";
        mainImg.onerror = () => {
            mainImg.style.display = "none";
            if (imgPh) imgPh.style.display = "flex";
        };
    }
    if (imgPh) imgPh.style.display = "none";

    // Wire fullscreen button
    if (fsBtn) {
        fsBtn.style.display = "flex";
        // Remove old handler to avoid stacking listeners
        const newFsBtn = fsBtn.cloneNode(true);
        fsBtn.parentNode.replaceChild(newFsBtn, fsBtn);
        newFsBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const activeIdx = thumbsEl
                ? [...thumbsEl.querySelectorAll(".pm-thumb")].findIndex(t => t.classList.contains("active"))
                : 0;
            openFullscreenViewer(gallery, activeIdx < 0 ? 0 : activeIdx, p.title);
        });
        // Also allow tapping the main image to go fullscreen
        if (mainImg) {
            mainImg.style.cursor = "zoom-in";
            mainImg.onclick = () => {
                const activeIdx = thumbsEl
                    ? [...thumbsEl.querySelectorAll(".pm-thumb")].findIndex(t => t.classList.contains("active"))
                    : 0;
                openFullscreenViewer(gallery, activeIdx < 0 ? 0 : activeIdx, p.title);
            };
        }
    }

    if (thumbsEl) {
        if (gallery.length > 1) {
            thumbsEl.innerHTML = gallery.map((img, i) => `
                <img class="pm-thumb ${i === 0 ? "active" : ""}"
                     src="${esc(img.url)}" alt="${esc(img.alt || p.title)}"
                     loading="lazy" data-idx="${i}"
                     onerror="this.style.display='none'" />`
            ).join("");

            thumbsEl.querySelectorAll(".pm-thumb").forEach(thumb => {
                thumb.addEventListener("click", () => {
                    if (!mainImg) return;
                    mainImg.style.opacity = "0";
                    setTimeout(() => {
                        mainImg.src = thumb.src;
                        mainImg.style.opacity = "1";
                    }, 150);
                    thumbsEl.querySelectorAll(".pm-thumb").forEach(t => t.classList.remove("active"));
                    thumb.classList.add("active");
                });
            });
        } else {
            thumbsEl.innerHTML = "";
        }
    }
}

// ══════════════════════════════════════════
//  FULLSCREEN IMAGE VIEWER
// ══════════════════════════════════════════
function openFullscreenViewer(gallery, startIdx = 0, title = "") {
    const viewer = document.getElementById("fs-viewer");
    const fsImg = document.getElementById("fs-main-img");
    const fsThumbsEl = document.getElementById("fs-thumbs");
    const fsClose = document.getElementById("fs-close");
    if (!viewer || !fsImg) return;

    let currentIdx = startIdx;

    function showImage(idx) {
        currentIdx = idx;
        const item = gallery[idx];
        fsImg.style.opacity = "0";
        setTimeout(() => {
            fsImg.src = _imageCache[item.url] || item.url;
            fsImg.alt = item.alt || title;
            fsImg.style.opacity = "1";
        }, 120);
        // Update active thumb
        if (fsThumbsEl) {
            fsThumbsEl.querySelectorAll(".fs-thumb").forEach((t, i) => {
                t.classList.toggle("active", i === idx);
            });
        }
    }

    // Build bottom thumbnail strip
    if (fsThumbsEl) {
        if (gallery.length > 1) {
            fsThumbsEl.innerHTML = gallery.map((img, i) => `
                <img class="fs-thumb ${i === startIdx ? "active" : ""}"
                     src="${esc(_imageCache[img.url] || img.url)}"
                     alt="${esc(img.alt || title)}"
                     data-idx="${i}" loading="lazy"
                     onerror="this.style.display='none'" />`
            ).join("");
            fsThumbsEl.querySelectorAll(".fs-thumb").forEach(t => {
                t.addEventListener("click", () => showImage(Number(t.dataset.idx)));
            });
        } else {
            fsThumbsEl.innerHTML = "";
        }
    }

    showImage(startIdx);
    viewer.classList.remove("hidden");
    document.body.style.overflow = "hidden";

    // AbortController cleans up ALL listeners when viewer closes (Bug 4 fix)
    const ac = new AbortController();
    const sig = { signal: ac.signal };

    // Close handlers
    function closeViewer() {
        ac.abort(); // removes all attached listeners atomically
        viewer.classList.add("hidden");
        const anyOpen = document.querySelector(".modal-overlay:not(.hidden)");
        if (!anyOpen) document.body.style.overflow = "";
    }

    // Close button
    const freshClose = document.getElementById("fs-close");
    freshClose?.addEventListener("click", closeViewer, sig);

    // Bug 10 fix: use currentTarget so backdrop tap works after thumbnail clicks
    viewer.addEventListener("click", (e) => {
        if (e.target === e.currentTarget || e.target.classList.contains("fs-content")) closeViewer();
    }, sig);

    // Keyboard: Escape closes, arrows switch image
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeViewer();
        if (e.key === "ArrowRight" && gallery.length > 1) showImage((currentIdx + 1) % gallery.length);
        if (e.key === "ArrowLeft"  && gallery.length > 1) showImage((currentIdx - 1 + gallery.length) % gallery.length);
    }, sig);

    // Touch gestures: Swipe left/right and Pinch-to-Zoom
    let _touchStartX = 0;
    let _baseDist = 0;
    let _scale = 1;

    viewer.addEventListener("touchstart", (e) => { 
        if (e.touches.length === 2) {
            _baseDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            if (fsMainImgEl) fsMainImgEl.style.transition = "none";
        } else if (e.touches.length === 1) {
            _touchStartX = e.touches[0].clientX; 
        }
    }, { passive: true, signal: ac.signal });

    viewer.addEventListener("touchmove", (e) => {
        if (e.touches.length === 2 && _baseDist > 0) {
            if (e.cancelable) e.preventDefault(); // Prevent browser zooming/scrolling
            const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            _scale = Math.max(1, Math.min(4, dist / _baseDist)); // Max 4x zoom
            if (fsMainImgEl) fsMainImgEl.style.transform = `scale(${_scale})`;
        }
    }, { passive: false, signal: ac.signal }); // MUST be passive: false to allow preventDefault()

    viewer.addEventListener("touchend", (e) => {
        if (e.touches.length < 2 && _scale > 1) {
            // Reset zoom when pinch ends
            _baseDist = 0;
            _scale = 1;
            if (fsMainImgEl) {
                fsMainImgEl.style.transition = "transform 0.25s cubic-bezier(0.25, 1, 0.5, 1)";
                fsMainImgEl.style.transform = "scale(1)";
            }
        }
        
        // Only trigger swipe if we are NOT zooming
        if (e.changedTouches.length === 1 && _scale === 1) {
            const dx = e.changedTouches[0].clientX - _touchStartX;
            if (Math.abs(dx) > 50 && gallery.length > 1) {
                showImage(dx < 0
                    ? (currentIdx + 1) % gallery.length
                    : (currentIdx - 1 + gallery.length) % gallery.length);
            }
        }
    }, { passive: true, signal: ac.signal });
}


// ══════════════════════════════════════════
//  MODAL CONTROLS — bind once from app-main
// ══════════════════════════════════════════
export function initModalControls() {
    // Product modal close
    document.getElementById("product-modal-close")?.addEventListener("click", () => {
        closeModal("product-modal");
        // Clear the hash — replaceState keeps forward/back history clean
        history.replaceState(null, "", window.location.pathname + window.location.search);
    });
    document.getElementById("product-modal")?.addEventListener("click", e => {
        if (e.target === e.currentTarget) {
            closeModal("product-modal");
            history.replaceState(null, "", window.location.pathname + window.location.search);
        }
    });

    // Custom modal close
    document.getElementById("custom-modal-close")?.addEventListener("click", () => closeModal("custom-modal"));
    document.getElementById("custom-modal")?.addEventListener("click", e => {
        if (e.target === e.currentTarget) closeModal("custom-modal");
    });

    // Qty buttons
    document.getElementById("qty-minus")?.addEventListener("click", () => {
        if (_modalQty > 1) {
            _modalQty--;
            const el = document.getElementById("qty-val");
            if (el) el.textContent = _modalQty;
        }
    });
    document.getElementById("qty-plus")?.addEventListener("click", () => {
        if (_modalQty < 99) {
            _modalQty++;
            const el = document.getElementById("qty-val");
            if (el) el.textContent = _modalQty;
        }
    });

    // Order button in modal — passes pickup time to handler
    document.getElementById("pm-order-btn")?.addEventListener("click", () => {
        if (!_currentProduct) return;
        const pickupTime = _getPickupString();
        if (!pickupTime) {
            // Shouldn't happen, but guard gracefully
            showToast("Please select a pickup time.", "warning", 3000);
            return;
        }
        safeTrackProductClick(_currentProduct.id);
        _onOrderClick?.(_currentProduct, _modalQty, pickupTime);
    });

    // Pickup day change — regenerate time slots
    document.getElementById("pickup-day")?.addEventListener("change", e => {
        populatePickupSlots(e.target.value);
    });

    // Share button
    document.getElementById("pm-share-btn")?.addEventListener("click", () => {
        if (!_currentProduct) return;
        _onShareClick?.(_currentProduct);
    });

    // Global ESC key
    document.addEventListener("keydown", e => {
        if (e.key === "Escape") {
            if (!document.getElementById("product-modal")?.classList.contains("hidden")) {
                closeModal("product-modal");
                history.replaceState(null, "", window.location.pathname + window.location.search);
            } else if (!document.getElementById("custom-modal")?.classList.contains("hidden")) {
                closeModal("custom-modal");
            }
            // lead-popup ESC is handled in app-popup.js initLeadForm()
        }
    });

    // Pre-populate slots at DOMContentLoaded (safety net for hosted/cached sites).
    // Guarantees slots are never stuck on "Loading…" even before any modal opens.
    try { populatePickupSlots("today"); } catch (_) {}
}

// ══════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════
function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text ?? "";
}

function esc(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
