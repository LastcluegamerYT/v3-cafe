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
let _pageSize = 12;
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
const PICKUP_BUFFER = 45;      // min lead time in minutes

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
    for (let m = CAFE_OPEN_MIN; m < CAFE_CLOSE_MIN; m += 30) {
        if (m > cutoff) slots.push(m);
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
            ? `🕐 Nepal Time • Slots from now +${PICKUP_BUFFER}min (9 AM–9 PM)`
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
//  PRODUCT DETAIL MODAL / SPA PAGE
// ══════════════════════════════════════════

let _ppQty = 1;
let _ppGalleryIndex = 0;

function _ppEsc(s) { const d = document.createElement('div'); d.textContent = String(s || ''); return d.innerHTML; }

export function closeMobilePage() {
    const page = document.getElementById('product-page');
    if (!page) return;
    page.style.display = 'none';
    document.body.style.overflow = '';
}

export function openMobilePage(product, allProducts, waNumber) {
    const page = document.getElementById('product-page');
    if (!page) return;

    // Reset scroll of the product page itself
    page.scrollTo(0, 0);
    _ppQty = 1;
    _ppGalleryIndex = 0;

    const avail = (product.availability || 'available').toLowerCase();
    const price = Number(product.price) || 0;
    const origPrice = Number(product.meta?.originalPrice) || 0;
    const imageCache = (() => { try { return JSON.parse(localStorage.getItem('v3_image_cache') || '{}'); } catch (_) { return {}; } })();
    const detail = buildProductDetail(product);
    const gallery = detail.gallery?.length ? detail.gallery : (product.mainImage ? [{ url: product.mainImage, alt: product.title }] : []);
    const catEmoji = { Cake:'🎂', Pastry:'🥐', Cupcake:'🧁', Cookie:'🍪', Bread:'🍞', Drink:'🥤', Dessert:'🍮', Custom:'🎨' };

    // Top bar
    document.getElementById('pp-title').textContent = product.title;

    // Gallery
    const track = document.getElementById('pp-gallery-track');
    const dots = document.getElementById('pp-gallery-dots');
    if (gallery.length) {
        track.innerHTML = gallery.map(img => {
            const src = imageCache[img.url] || img.url;
            return src
                ? `<img style="min-width:100%;aspect-ratio:1/1;object-fit:contain;background:#111;" src="${_ppEsc(src)}" alt="${_ppEsc(img.alt||product.title)}" loading="eager">`
                : `<div style="min-width:100%;aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;font-size:4rem;background:#1a1a1a;">🧁</div>`;
        }).join('');
        if (gallery.length > 1) {
            dots.innerHTML = gallery.map((_, i) => `<div style="width:7px;height:7px;border-radius:50%;background:${i===0?'#b45309':'rgba(255,255,255,.3)'};" data-gi="${i}"></div>`).join('');
            dots.style.display = 'flex';
            let sx = 0;
            const goTo = i => {
                _ppGalleryIndex = Math.max(0, Math.min(gallery.length-1, i));
                track.style.transform = `translateX(-${_ppGalleryIndex*100}%)`;
                dots.querySelectorAll('[data-gi]').forEach((d,j) => d.style.background = j===_ppGalleryIndex?'#b45309':'rgba(255,255,255,.3)');
            };
            track.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
            track.addEventListener('touchend', e => {
                const dx = e.changedTouches[0].clientX - sx;
                if (Math.abs(dx) > 40) dx < 0 ? goTo(_ppGalleryIndex+1) : goTo(_ppGalleryIndex-1);
            }, { passive: true });
        } else { dots.style.display = 'none'; }
    } else {
        track.innerHTML = `<div style="min-width:100%;aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;font-size:4rem;background:#1a1a1a;">🧁</div>`;
        dots.style.display = 'none';
    }

    // Badge
    const badge = document.getElementById('pp-avail-badge');
    badge.style.display = '';
    badge.style.color = avail==='available'?'#22c55e':avail==='custom'?'#a78bfa':'#ef4444';
    badge.textContent = avail==='available'?'✅ Available':avail==='custom'?'🎨 Custom':'❌ Out of Stock';

    // Title & Category
    document.getElementById('pp-cat').textContent = (catEmoji[product.category]||'🍽️') + ' ' + (product.category||'Bakery');
    document.getElementById('pp-name').textContent = product.title;

    // Price
    document.getElementById('pp-price').textContent = `Rs. ${price.toLocaleString()}`;
    const mrpEl = document.getElementById('pp-mrp'); const offEl = document.getElementById('pp-off');
    if (origPrice > 0 && origPrice > price) {
        const pct = Math.round((1-price/origPrice)*100);
        mrpEl.textContent = `Rs. ${origPrice.toLocaleString()}`; mrpEl.style.display='';
        offEl.textContent = `${pct}% OFF`; offEl.style.display='';
    } else { mrpEl.style.display='none'; offEl.style.display='none'; }

    // Description
    const descWrap = document.getElementById('pp-desc-wrap');
    const descEl = document.getElementById('pp-desc');
    const showMoreBtn = document.getElementById('pp-show-more');
    if (product.description) {
        descWrap.style.display='';
        descEl.textContent = product.description;
        descEl.style.cssText = 'font-size:.9rem;line-height:1.6;color:#a3a3a3;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;';
        showMoreBtn.style.display='none'; showMoreBtn.textContent='...show more';
        requestAnimationFrame(() => { if (descEl.scrollHeight > descEl.clientHeight+2) showMoreBtn.style.display='inline-block'; });
        showMoreBtn.onclick = () => {
            const exp = descEl.style.webkitLineClamp === 'unset';
            descEl.style.webkitLineClamp = exp ? '3' : 'unset';
            descEl.style.overflow = exp ? 'hidden' : 'visible';
            descEl.style.display = exp ? '-webkit-box' : 'block';
            showMoreBtn.textContent = exp ? '...show more' : 'show less ▲';
        };
    } else { descWrap.style.display='none'; }

    // Ingredients
    const ingWrap = document.getElementById('pp-ing-wrap');
    if (product.ingredients?.length) {
        ingWrap.style.display='';
        document.getElementById('pp-ings').innerHTML = product.ingredients.map(i=>`<span style="background:#242424;border:1px solid rgba(255,255,255,.08);border-radius:20px;padding:.25rem .7rem;font-size:.73rem;color:#a3a3a3;">${_ppEsc(i)}</span>`).join('');
    } else { ingWrap.style.display='none'; }

    // Tags
    const tagsWrap = document.getElementById('pp-tags-wrap');
    if (product.tags?.length) {
        tagsWrap.style.display='';
        document.getElementById('pp-tags').innerHTML = product.tags.map(t=>`<span style="background:#242424;border:1px solid rgba(255,255,255,.08);border-radius:20px;padding:.25rem .7rem;font-size:.73rem;color:#a3a3a3;">#${_ppEsc(t)}</span>`).join('');
    } else { tagsWrap.style.display='none'; }

    // Note
    const noteEl = document.getElementById('pp-note');
    if (product.note) { noteEl.textContent='📝 '+product.note; noteEl.style.display=''; } else { noteEl.style.display='none'; }

    // Qty
    document.getElementById('pp-qty-val').textContent = '1';
    document.getElementById('pp-qty-minus').onclick = () => { if(_ppQty>1){_ppQty--;document.getElementById('pp-qty-val').textContent=_ppQty;} };
    document.getElementById('pp-qty-plus').onclick = () => { if(_ppQty<20){_ppQty++;document.getElementById('pp-qty-val').textContent=_ppQty;} };

    // Order
    const orderBtn = document.getElementById('pp-order-btn');
    if (avail === 'out of stock') {
        orderBtn.disabled=true; orderBtn.textContent='❌ Out of Stock'; orderBtn.style.opacity='.5';
    } else {
        orderBtn.disabled=false; orderBtn.innerHTML='📲 Order on WhatsApp'; orderBtn.style.opacity='1';
        orderBtn.onclick = () => {
            if (!waNumber) { alert('WhatsApp not configured yet.'); return; }
            try {
                const url = buildWhatsAppUrl({ phoneNumber: waNumber, product, qty: _ppQty });
                window.open(url, '_blank');
            } catch(_) {}
        };
    }

    // Share
    const shareUrl = `${location.origin}${location.pathname}?product=${encodeURIComponent(product.id)}`;
    const doShare = () => {
        if (navigator.share) navigator.share({ title: product.title, text:`Check out ${product.title} at V3 Cafe!`, url: shareUrl });
        else { navigator.clipboard?.writeText(shareUrl); showToast('Link copied!'); }
    };
    document.getElementById('pp-share').onclick = doShare;
    document.getElementById('pp-share-bar').onclick = doShare;

    // Recommendations
    const others = (allProducts||[]).filter(p=>p.id!==product.id).sort(()=>Math.random()-.5).slice(0,8);
    const recGrid = document.getElementById('pp-rec-grid');
    const recSection = document.getElementById('pp-rec-section');
    if (others.length) {
        recSection.style.display='';
        recGrid.innerHTML = others.map(p=>{
            const src = imageCache[p.mainImage]||p.mainImage;
            const img = src ? `<img style="width:100%;aspect-ratio:1/1;object-fit:cover;" src="${_ppEsc(src)}" alt="${_ppEsc(p.title)}" loading="lazy">` : `<div style="width:100%;aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;font-size:2.5rem;background:#1a1a1a;">🧁</div>`;
            return `<div data-rid="${_ppEsc(p.id)}" style="background:#1a1a1a;border:1px solid rgba(255,255,255,.08);border-radius:14px;overflow:hidden;cursor:pointer;">${img}<div style="padding:.6rem .7rem;"><div style="font-size:.82rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#f5f5f5;">${_ppEsc(p.title)}</div><div style="font-size:.78rem;color:#b45309;font-weight:700;margin-top:2px;">Rs. ${(Number(p.price)||0).toLocaleString()}</div></div></div>`;
        }).join('');
        recGrid.querySelectorAll('[data-rid]').forEach(card => {
            card.addEventListener('click', () => {
                const rp = (allProducts||[]).find(x=>x.id===card.dataset.rid);
                if (rp) _openMobilePage(rp, allProducts, waNumber);
            });
        });
    } else { recSection.style.display='none'; }

    // Show the page
    page.style.display='block';
    document.body.style.overflow='hidden';
}

export async function openProductModal(id) {
    if (!id) return;

    // Fast lookup in already-loaded products
    let product = _products.find(p => p.id === id || p.slug === id);

    // If on mobile, use SPA layer (zero reload, instant)
    if (window.innerWidth <= 900 && product) {
        sessionStorage.setItem('v3_scrollY', String(window.scrollY));
        openMobilePage(product, _products, window.__v3WaNumber || '');
        history.pushState({ productId: id }, '', `?product=${encodeURIComponent(id)}`);
        safeTrackProductView(product.id);
        return;
    }

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

    const gallery = (p.gallery && p.gallery.length)
        ? p.gallery
        : (p.mainImage ? [{ url: p.mainImage, alt: p.title }] : []);

    if (!gallery.length) {
        if (mainImg) mainImg.style.display = "none";
        if (imgPh) imgPh.style.display = "flex";
        if (thumbsEl) thumbsEl.innerHTML = "";
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
