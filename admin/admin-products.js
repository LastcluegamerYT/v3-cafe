// admin-products.js — Products CRUD, image handling, form management

// ── Firebase imports FIRST ──
import { ref, get } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import bakeryDB from "../connection/connection.js?v=2";

const {
    getAllProducts, createProduct, updateProduct, deleteProduct,
    getProductById, compressImageFile, blobToDataURL, buildProductDetail
} = bakeryDB;

// ── Module state ──
let allProducts  = [];
let editingId    = null;
let imageSlots   = []; // [{url, isMain, file|null, objectUrl|null}]
let activeFilter = "all";
let searchTerm   = "";
let _navigate    = null;
let _toast       = null;
let _confirm     = null;

// ── Wire external dependencies ──
export function initProducts(navigateFn, toastFn, confirmFn) {
    _navigate = navigateFn;
    _toast    = toastFn;
    _confirm  = confirmFn;
}

// ══════════════════════════════════════════
//  PRODUCTS LIST
// ══════════════════════════════════════════
export async function loadProducts(force = false) {
    try {
        allProducts = await getAllProducts({ force });
        renderProductsGrid();
        updateProductBadge();
        return allProducts;
    } catch (err) {
        _toast?.("Failed to load products: " + err.message, "error");
        return [];
    }
}

export function getLoadedProducts() {
    return allProducts;
}

export function updateProductBadge() {
    const el = document.getElementById("nb-products");
    if (el) el.textContent = allProducts.length;
}

function getFilteredProducts() {
    let list = [...allProducts];

    if (activeFilter !== "all") {
        if (activeFilter === "featured") {
            list = list.filter(p => p.featured);
        } else {
            list = list.filter(p =>
                (p.availability || "").toLowerCase() === activeFilter
            );
        }
    }

    if (searchTerm) {
        const q = searchTerm.toLowerCase();
        list = list.filter(p => {
            const hay = [p.title, p.description, p.category, ...(p.tags || [])]
                .join(" ").toLowerCase();
            return hay.includes(q);
        });
    }

    return list;
}

export function renderProductsGrid() {
    const grid = document.getElementById("products-grid");
    if (!grid) return;

    const list = getFilteredProducts();

    if (!list.length) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--text2)">
            <div style="font-size:3rem;margin-bottom:.75rem">🧁</div>
            <div style="font-size:1rem;font-weight:600">${searchTerm || activeFilter !== "all" ? "No products match your filter." : "No products yet!"}</div>
            <div style="font-size:.82rem;margin-top:.3rem">${searchTerm || activeFilter !== "all" ? "Try a different filter." : "Click + Add Product to get started."}</div>
        </div>`;
        return;
    }

    grid.innerHTML = list.map(p => buildProductCard(p)).join("");

    // Bind card buttons — use event delegation for performance
    grid.addEventListener("click", handleGridClick, { once: true });

    // Re-bind (since innerHTML replaces the element each time)
    grid.querySelectorAll(".pc-btn.edit").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            openEditForm(btn.dataset.id);
        });
    });
    grid.querySelectorAll(".pc-btn.del").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            confirmDeleteProduct(btn.dataset.id, btn.dataset.title);
        });
    });
}

function handleGridClick() {} // placeholder for delegation cleanup

function buildProductCard(p) {
    const origPrice   = Number(p.meta?.originalPrice) || 0;
    const salePrice   = Number(p.price) || 0;
    const discountPct = origPrice > 0 && origPrice > salePrice
        ? Math.round((1 - salePrice / origPrice) * 100) : 0;

    const avail = (p.availability || "available").toLowerCase();
    const badgeClass = avail === "available" ? "badge-available"
        : avail === "custom" ? "badge-custom" : "badge-out";
    const badgeTxt = avail === "available" ? "Available"
        : avail === "custom" ? "Custom" : "Out of Stock";

    // Image with fallback placeholder
    const imgHTML = p.mainImage
        ? `<img class="pc-img" src="${esc(p.mainImage)}" alt="${esc(p.title)}" loading="lazy"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
          + `<div class="pc-img-ph" style="display:none">🧁</div>`
        : `<div class="pc-img-ph">🧁</div>`;

    const priceHTML = origPrice > 0 && origPrice > salePrice
        ? `<span class="pc-sale">Rs. ${salePrice.toLocaleString()}</span>
           <span class="pc-mrp">Rs. ${origPrice.toLocaleString()}</span>
           <span class="pc-off">${discountPct}% OFF</span>`
        : `<span class="pc-sale">Rs. ${salePrice.toLocaleString()}</span>`;

    return `
    <div class="prod-card">
      <div class="pc-wrap">
        ${imgHTML}
        ${p.featured ? `<span class="pc-featured">⭐ Featured</span>` : ""}
      </div>
      <div class="pc-body">
        <div class="pc-top">
          <span class="pc-title">${esc(p.title)}</span>
          <span class="pc-badge ${badgeClass}">${badgeTxt}</span>
        </div>
        <div class="pc-cat">${esc(p.category || "—")} · Rank: ${p.orderRank || 0}</div>
        <div class="pc-price">${priceHTML}</div>
        <div class="pc-actions">
          <button class="pc-btn edit" data-id="${esc(p.id)}" data-title="${esc(p.title)}">✏️ Edit</button>
          <button class="pc-btn del"  data-id="${esc(p.id)}" data-title="${esc(p.title)}">🗑️ Delete</button>
        </div>
      </div>
    </div>`;
}

// ── Toolbar: search + filter chips ──
export function initProductsToolbar() {
    const searchEl = document.getElementById("prod-search");
    if (searchEl) {
        // Debounce search for performance
        let searchTimer;
        searchEl.addEventListener("input", e => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                searchTerm = e.target.value.trim();
                renderProductsGrid();
            }, 200);
        });
    }

    document.querySelectorAll(".filter-chips .chip").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".filter-chips .chip").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            activeFilter = btn.dataset.filter || "all";
            renderProductsGrid();
        });
    });
}

// ══════════════════════════════════════════
//  PRODUCT FORM
// ══════════════════════════════════════════
export function openAddForm() {
    editingId  = null;
    revokeAllObjectURLs();
    imageSlots = [];
    document.getElementById("form-heading").textContent  = "Add Product";
    document.getElementById("form-sub").textContent      = "Fill in the details below";
    document.getElementById("save-btn-txt").textContent  = "💾 Save Product";
    clearForm();
    _navigate?.("add-product");
    // Scroll form to top
    document.getElementById("sec-add-product")?.scrollTo?.(0, 0);
    window.scrollTo(0, 0);
}

export async function openEditForm(id) {
    if (!id) { _toast?.("Invalid product ID.", "error"); return; }
    _toast?.("Loading product…", "info", 1500);

    try {
        const p = await getProductById(id);
        if (!p) { _toast?.("Product not found.", "error"); return; }

        editingId = id;
        revokeAllObjectURLs();
        imageSlots = [];

        document.getElementById("form-heading").textContent  = "Edit Product";
        document.getElementById("form-sub").textContent      = `Editing: ${p.title}`;
        document.getElementById("save-btn-txt").textContent  = "💾 Update Product";

        // Populate all fields
        setVal("f-title",          p.title          || "");
        setVal("f-category",       p.category        || "");
        setVal("f-desc",           p.description     || "");
        setVal("f-ingredients",   (p.ingredients || []).join(", "));
        setVal("f-tags",           (p.tags        || []).join(", "));
        setVal("f-price",          p.price          ?? "");
        setVal("f-original-price", p.meta?.originalPrice || "");
        setVal("f-availability",   p.availability    || "available");
        setVal("f-rank",           p.orderRank       ?? 0);
        setVal("f-wa-text",        p.whatsappText    || "");
        setVal("f-note",           p.note            || "");

        const featEl = document.getElementById("f-featured");
        if (featEl) featEl.checked = !!p.featured;

        // Load images — FIX: only first image should have isMain=true
        const detail = buildProductDetail(p);
        if (detail.gallery?.length) {
            imageSlots = detail.gallery.map((img, i) => ({
                url:       img.url,
                isMain:    img.url === p.mainImage, // exact match only
                file:      null,
                objectUrl: null
            }));
            // Ensure exactly one isMain (fallback to first)
            if (!imageSlots.some(s => s.isMain) && imageSlots.length) {
                imageSlots[0].isMain = true;
            }
        }

        renderImagePreviews();
        updateDiscountBadge();
        _navigate?.("add-product");
        window.scrollTo(0, 0);

    } catch (err) {
        _toast?.("Error loading product: " + err.message, "error");
    }
}

function clearForm() {
    ["f-title","f-desc","f-ingredients","f-tags",
     "f-price","f-original-price","f-wa-text","f-note"].forEach(id => setVal(id, ""));
    setVal("f-category",     "");
    setVal("f-availability", "available");
    setVal("f-rank",         "0");

    const featEl = document.getElementById("f-featured");
    if (featEl) featEl.checked = false;

    const previewList = document.getElementById("img-preview-list");
    if (previewList) previewList.innerHTML = "";

    const urlInp = document.getElementById("img-url-inp");
    if (urlInp) urlInp.value = "";

    const fileInp = document.getElementById("img-file-inp");
    if (fileInp) fileInp.value = "";

    const badge = document.getElementById("discount-badge");
    if (badge) { badge.textContent = "—"; badge.style.color = ""; }
}

// ── Form submit handler ──
export function initProductForm() {
    const form = document.getElementById("product-form");
    if (form) {
        form.addEventListener("submit", async e => {
            e.preventDefault();
            await saveProduct();
        });
    }

    // Discount live calculation
    document.getElementById("f-price")?.addEventListener("input", updateDiscountBadge);
    document.getElementById("f-original-price")?.addEventListener("input", updateDiscountBadge);

    // Cancel buttons
    ["cancel-form", "cancel-form-2"].forEach(id => {
        document.getElementById(id)?.addEventListener("click", () => {
            revokeAllObjectURLs();
            _navigate?.(editingId ? "products" : "dashboard");
            editingId = null;
        });
    });

    initImageHandlers();
    initProductsToolbar();
}

function updateDiscountBadge() {
    const orig  = parseFloat(document.getElementById("f-original-price")?.value) || 0;
    const sale  = parseFloat(document.getElementById("f-price")?.value) || 0;
    const badge = document.getElementById("discount-badge");
    if (!badge) return;

    if (orig > 0 && sale > 0 && orig > sale) {
        const pct = Math.round((1 - sale / orig) * 100);
        badge.textContent = `${pct}% OFF`;
        badge.style.color = "var(--green)";
    } else if (orig > 0 && sale > 0 && sale >= orig) {
        badge.textContent = "No discount";
        badge.style.color = "var(--text3)";
    } else {
        badge.textContent = "—";
        badge.style.color = "";
    }
}

async function saveProduct() {
    const title = (document.getElementById("f-title")?.value || "").trim();
    if (!title) {
        _toast?.("Product name is required.", "error");
        document.getElementById("f-title")?.focus();
        return;
    }

    const priceRaw = document.getElementById("f-price")?.value;
    const price = parseFloat(priceRaw);
    // BUG FIX: price of 0 is valid (free items), but empty string is not
    if (priceRaw === "" || priceRaw === null || priceRaw === undefined || isNaN(price)) {
        _toast?.("Sale price is required.", "error");
        document.getElementById("f-price")?.focus();
        return;
    }
    if (price < 0) {
        _toast?.("Price cannot be negative.", "error");
        return;
    }

    const saveTxt = document.getElementById("save-btn-txt");
    const saveSpn = document.getElementById("save-spinner");
    if (saveTxt) saveTxt.classList.add("hidden");
    if (saveSpn) saveSpn.classList.remove("hidden");

    // Disable save button to prevent double-submit
    const saveBtn = document.getElementById("save-product-btn");
    if (saveBtn) saveBtn.disabled = true;

    try {
        // Compress any file-based images and resolve final URLs
        const finalImages = await resolveImageSlots();

        // Determine main image
        const mainSlot  = imageSlots.find(s => s.isMain);
        const mainImage = mainSlot?.url || finalImages[0]?.url || "";

        const origPrice = parseFloat(document.getElementById("f-original-price")?.value) || 0;

        const data = {
            title,
            category:     (document.getElementById("f-category")?.value || "Other"),
            description:  (document.getElementById("f-desc")?.value     || "").trim(),
            price,
            availability: (document.getElementById("f-availability")?.value || "available"),
            featured:     !!(document.getElementById("f-featured")?.checked),
            orderRank:    Math.max(0, parseInt(document.getElementById("f-rank")?.value) || 0),
            whatsappText: (document.getElementById("f-wa-text")?.value  || "").trim(),
            note:         (document.getElementById("f-note")?.value     || "").trim(),
            tags:         splitComma(document.getElementById("f-tags")?.value),
            ingredients:  splitComma(document.getElementById("f-ingredients")?.value),
            images:       finalImages,
            mainImage,
            meta: {
                originalPrice: origPrice > 0 ? origPrice : null
            }
        };

        if (editingId) {
            await updateProduct(editingId, data);
            _toast?.("✅ Product updated!", "success");
        } else {
            await createProduct(data);
            _toast?.("✅ Product added!", "success");
        }

        // Reload and navigate
        await loadProducts(true);
        revokeAllObjectURLs();
        editingId  = null;
        imageSlots = [];
        clearForm();
        _navigate?.("products");

    } catch (err) {
        _toast?.("Error saving product: " + err.message, "error");
    } finally {
        if (saveTxt) saveTxt.classList.remove("hidden");
        if (saveSpn) saveSpn.classList.add("hidden");
        if (saveBtn) saveBtn.disabled = false;
    }
}

// Compress file-based slots, update slot.url with compressed dataURL
async function resolveImageSlots() {
    const results = [];
    for (let i = 0; i < imageSlots.length; i++) {
        const slot = imageSlots[i];
        if (slot.file) {
            try {
                const compressed = await compressImageFile(slot.file, {
                    maxWidth: 900, quality: 0.78, mimeType: "image/webp"
                });
                // Revoke old object URL to free memory
                if (slot.objectUrl) {
                    URL.revokeObjectURL(slot.objectUrl);
                    slot.objectUrl = null;
                }
                slot.url  = compressed.dataURL;
                slot.file = null; // Done, no longer a file
            } catch (e) {
                // compression failed — keep original object URL (won't persist well but won't crash)
                console.warn("Image compression failed:", e.message);
            }
        }
        if (slot.url) {
            results.push({ url: slot.url, alt: "", order: i });
        }
    }
    return results;
}

// ── Delete product ──
function confirmDeleteProduct(id, title) {
    if (!id) return;
    _confirm?.(
        "Delete Product",
        `Are you sure you want to delete "${title || id}"? This cannot be undone.`,
        "🗑️",
        async () => {
            try {
                await deleteProduct(id);
                _toast?.("🗑️ Product deleted.", "info");
                await loadProducts(true);
            } catch (err) {
                _toast?.("Delete failed: " + err.message, "error");
            }
        }
    );
}

// ══════════════════════════════════════════
//  IMAGE HANDLERS
// ══════════════════════════════════════════
function initImageHandlers() {
    const dropZone  = document.getElementById("drop-zone");
    const fileInp   = document.getElementById("img-file-inp");
    const urlInp    = document.getElementById("img-url-inp");
    const addUrlBtn = document.getElementById("add-url-btn");

    // File input change
    if (fileInp) {
        fileInp.addEventListener("change", e => {
            if (e.target.files?.length) {
                handleFiles(Array.from(e.target.files));
                // Reset so same file can be re-added if removed
                e.target.value = "";
            }
        });
    }

    // Drag & Drop
    if (dropZone) {
        dropZone.addEventListener("dragover", e => {
            e.preventDefault();
            dropZone.classList.add("drag-over");
        });
        dropZone.addEventListener("dragleave", e => {
            // Only remove if leaving the zone entirely
            if (!dropZone.contains(e.relatedTarget)) {
                dropZone.classList.remove("drag-over");
            }
        });
        dropZone.addEventListener("drop", e => {
            e.preventDefault();
            dropZone.classList.remove("drag-over");
            const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith("image/"));
            if (files.length) handleFiles(files);
        });
        // BUG FIX: only trigger file input if click is NOT on the label or file input itself
        dropZone.addEventListener("click", e => {
            const tag = e.target.tagName.toLowerCase();
            if (tag === "label" || tag === "input") return; // label handles it natively
            fileInp?.click();
        });
    }

    // URL add button
    if (addUrlBtn) {
        addUrlBtn.addEventListener("click", () => {
            const url = (urlInp?.value || "").trim();
            if (!url) { _toast?.("Please enter a valid URL.", "warning"); return; }
            // Basic URL validation
            try { new URL(url); } catch (_) { _toast?.("Invalid URL format.", "error"); return; }
            addImageSlot({ url, file: null, objectUrl: null });
            if (urlInp) urlInp.value = "";
        });
    }

    // Press Enter in URL field
    if (urlInp) {
        urlInp.addEventListener("keydown", e => {
            if (e.key === "Enter") { e.preventDefault(); addUrlBtn?.click(); }
        });
    }
}

function handleFiles(files) {
    const remaining = 5 - imageSlots.length;
    if (remaining <= 0) { _toast?.("Max 5 images allowed.", "warning"); return; }

    const toAdd = files.slice(0, remaining);
    if (files.length > remaining) {
        _toast?.(`Only ${remaining} more image(s) can be added (max 5).`, "warning");
    }

    toAdd.forEach(file => {
        const objectUrl = URL.createObjectURL(file);
        addImageSlot({ url: objectUrl, file, objectUrl });
    });
}

function addImageSlot(slot) {
    if (imageSlots.length >= 5) { _toast?.("Max 5 images allowed.", "warning"); return; }
    const isFirst = imageSlots.length === 0;
    imageSlots.push({ ...slot, isMain: isFirst });
    renderImagePreviews();
}

function renderImagePreviews() {
    const list = document.getElementById("img-preview-list");
    if (!list) return;

    if (!imageSlots.length) {
        list.innerHTML = "";
        return;
    }

    list.innerHTML = imageSlots.map((slot, i) => `
        <div class="img-prev-item ${slot.isMain ? "is-main" : ""}" data-idx="${i}" title="${slot.isMain ? "Main image" : "Click to set as main"}">
            <img src="${esc(slot.url)}" alt="Image ${i + 1}" loading="lazy"
                 onerror="this.style.background='var(--border)';this.style.display='flex';this.alt='⚠ Load error'" />
            ${slot.isMain ? `<span class="img-main-badge">MAIN</span>` : ""}
            <button type="button" class="img-del-btn" data-idx="${i}" title="Remove image">✕</button>
        </div>
    `).join("");

    // Click to set as main image
    list.querySelectorAll(".img-prev-item").forEach(el => {
        el.addEventListener("click", e => {
            if (e.target.classList.contains("img-del-btn")) return;
            const idx = parseInt(el.dataset.idx);
            if (isNaN(idx) || idx < 0 || idx >= imageSlots.length) return;
            imageSlots.forEach((s, i) => { s.isMain = (i === idx); });
            renderImagePreviews();
        });
    });

    // Delete buttons
    list.querySelectorAll(".img-del-btn").forEach(btn => {
        btn.addEventListener("click", e => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.idx);
            if (isNaN(idx) || idx < 0 || idx >= imageSlots.length) return;

            // Revoke object URL to prevent memory leak
            const slot = imageSlots[idx];
            if (slot.objectUrl) URL.revokeObjectURL(slot.objectUrl);

            imageSlots.splice(idx, 1);

            // Re-assign main if needed
            if (imageSlots.length && !imageSlots.some(s => s.isMain)) {
                imageSlots[0].isMain = true;
            }
            renderImagePreviews();
        });
    });
}

// Free all object URLs created for previews
function revokeAllObjectURLs() {
    imageSlots.forEach(slot => {
        if (slot.objectUrl) {
            URL.revokeObjectURL(slot.objectUrl);
            slot.objectUrl = null;
        }
    });
}

// ══════════════════════════════════════════
//  RECENT PRODUCTS (Dashboard)
// ══════════════════════════════════════════
export function renderRecentProducts(products) {
    const el = document.getElementById("recent-products");
    if (!el) return;

    const recent = [...(products || [])]
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, 5);

    if (!recent.length) {
        el.innerHTML = `<div class="loading-ph">No products yet.</div>`;
        return;
    }

    el.innerHTML = recent.map(p => {
        const avail = (p.availability || "available").toLowerCase();
        return `
        <div class="r-item">
            ${p.mainImage
                ? `<img class="r-thumb" src="${esc(p.mainImage)}" alt="${esc(p.title)}" loading="lazy"
                       onerror="this.style.display='none';this.nextSibling.style.display='flex'">`
                  + `<div class="r-thumb-ph" style="display:none">🧁</div>`
                : `<div class="r-thumb-ph">🧁</div>`}
            <div class="r-info">
                <div class="r-name">${esc(p.title)}</div>
                <div class="r-meta">Rs. ${Number(p.price || 0).toLocaleString()} · ${esc(p.category || "—")}</div>
            </div>
            <span class="pc-badge ${avail === "available" ? "badge-available" : avail === "custom" ? "badge-custom" : "badge-out"}">
                ${avail === "available" ? "✅" : avail === "custom" ? "🎨" : "❌"}
            </span>
        </div>`;
    }).join("");
}

// ── Tiny helpers ──
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
function splitComma(s) {
    return s ? String(s).split(",").map(x => x.trim()).filter(Boolean) : [];
}
