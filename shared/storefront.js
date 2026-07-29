const body = document.body;
const isNativeStorefront = body.dataset.platform === "shopify";
const rootPath = body.dataset.root || "";
const cartKey = `sfk-cart:${body.dataset.brand || "preview"}`;
let drawerReturnFocus = null;
let drawerScrollPosition = 0;
const nativeCartUpdateTimers = new Map();
const nativeCartPendingQuantities = new Map();
const nativeCartUpdateDelay = 400;
let nativeCartQueue = Promise.resolve();
let nativeCartMutationActive = false;
let pendingCartRemoval = null;
let productQuantityControlIndex = 0;
const productZoomFinePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const productZooms = new Set();
const productZoomStates = new WeakMap();
const relatedCarousels = new Set();
const relatedCarouselStates = new WeakMap();

const getMenuButton = () => document.querySelector("[data-menu-toggle]");
const getNav = () => document.querySelector("#primary-nav");
const getCart = () => document.querySelector("#cart-drawer");
const getScrim = () => document.querySelector("[data-scrim]");

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function zoomState(root) {
  if (!productZoomStates.has(root)) {
    productZoomStates.set(root, {
      pointerId: null,
      startX: 0,
      startY: 0,
      startOriginX: 50,
      startOriginY: 50,
      dragged: false,
      suppressClick: false
    });
  }
  return productZoomStates.get(root);
}

function productZoomOrigin(root) {
  return {
    x: Number(root.dataset.zoomX || 50),
    y: Number(root.dataset.zoomY || 50)
  };
}

function setProductZoomOrigin(root, x, y) {
  const nextX = clamp(Number(x) || 0, 0, 100);
  const nextY = clamp(Number(y) || 0, 0, 100);
  root.dataset.zoomX = String(nextX);
  root.dataset.zoomY = String(nextY);
  root.style.setProperty("--zoom-x", `${nextX}%`);
  root.style.setProperty("--zoom-y", `${nextY}%`);
}

function setProductZoomOriginFromPointer(root, event) {
  const bounds = root.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  setProductZoomOrigin(
    root,
    ((event.clientX - bounds.left) / bounds.width) * 100,
    ((event.clientY - bounds.top) / bounds.height) * 100
  );
}

function setProductZoomPinned(root, pinned) {
  root.setAttribute("aria-pressed", String(pinned));
  root.setAttribute("aria-label", pinned ? root.dataset.unzoomLabel : root.dataset.zoomLabel);
  if (!pinned) root.removeAttribute("data-zoom-dragging");
}

function resetProductZoom(root) {
  const state = zoomState(root);
  if (state.pointerId !== null && root.hasPointerCapture?.(state.pointerId)) root.releasePointerCapture(state.pointerId);
  state.pointerId = null;
  state.dragged = false;
  state.suppressClick = false;
  setProductZoomOrigin(root, 50, 50);
  setProductZoomPinned(root, false);
}

function resetAllProductZooms() {
  productZooms.forEach(resetProductZoom);
}

function toggleProductZoom(root, event) {
  const pinned = root.getAttribute("aria-pressed") !== "true";
  if (pinned && Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY) && (event.clientX || event.clientY)) {
    setProductZoomOriginFromPointer(root, event);
  }
  setProductZoomPinned(root, pinned);
  if (!pinned) setProductZoomOrigin(root, 50, 50);
}

function initProductZoom(root) {
  if (productZooms.has(root)) return;
  productZooms.add(root);
  const state = zoomState(root);
  const image = root.querySelector("img");
  if (image) {
    image.draggable = false;
    new MutationObserver(() => resetProductZoom(root)).observe(image, { attributes: true, attributeFilter: ["src", "srcset"] });
  }

  root.addEventListener("pointermove", (event) => {
    const pinned = root.getAttribute("aria-pressed") === "true";
    if (!pinned && productZoomFinePointer.matches && event.pointerType === "mouse") {
      setProductZoomOriginFromPointer(root, event);
      return;
    }
    if (!pinned || state.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - state.startX;
    const deltaY = event.clientY - state.startY;
    if (!state.dragged && Math.hypot(deltaX, deltaY) >= 5) {
      state.dragged = true;
      root.dataset.zoomDragging = "true";
    }
    if (!state.dragged) return;
    event.preventDefault();
    const bounds = root.getBoundingClientRect();
    const scale = Math.max(1.01, Number.parseFloat(getComputedStyle(root).getPropertyValue("--product-zoom-scale")) || 1.85);
    setProductZoomOrigin(
      root,
      state.startOriginX - (deltaX / bounds.width) * (100 / (scale - 1)),
      state.startOriginY - (deltaY / bounds.height) * (100 / (scale - 1))
    );
  });

  root.addEventListener("pointerleave", () => {
    if (root.getAttribute("aria-pressed") !== "true") setProductZoomOrigin(root, 50, 50);
  });

  root.addEventListener("pointerdown", (event) => {
    if (root.getAttribute("aria-pressed") !== "true" || event.button !== 0) return;
    const origin = productZoomOrigin(root);
    state.pointerId = event.pointerId;
    state.startX = event.clientX;
    state.startY = event.clientY;
    state.startOriginX = origin.x;
    state.startOriginY = origin.y;
    state.dragged = false;
    root.setPointerCapture?.(event.pointerId);
  });

  const finishPointer = (event) => {
    if (state.pointerId !== event.pointerId) return;
    if (state.dragged) state.suppressClick = true;
    if (root.hasPointerCapture?.(event.pointerId)) root.releasePointerCapture(event.pointerId);
    state.pointerId = null;
    state.dragged = false;
    root.removeAttribute("data-zoom-dragging");
    if (state.suppressClick) setTimeout(() => { state.suppressClick = false; }, 0);
  };
  root.addEventListener("pointerup", finishPointer);
  root.addEventListener("pointercancel", finishPointer);

  root.addEventListener("click", (event) => {
    if (state.suppressClick) {
      event.preventDefault();
      state.suppressClick = false;
      return;
    }
    event.preventDefault();
    root.focus({ preventScroll: true });
    toggleProductZoom(root, event);
  });

  root.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleProductZoom(root);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      resetProductZoom(root);
      return;
    }
    if (root.getAttribute("aria-pressed") !== "true" || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const origin = productZoomOrigin(root);
    setProductZoomOrigin(
      root,
      origin.x + (event.key === "ArrowRight" ? 6 : event.key === "ArrowLeft" ? -6 : 0),
      origin.y + (event.key === "ArrowDown" ? 6 : event.key === "ArrowUp" ? -6 : 0)
    );
  });
}

function updateRelatedCarousel(track) {
  const controls = track.closest(".related-products")?.querySelector("[data-related-carousel-controls]");
  const previous = controls?.querySelector("[data-related-carousel-previous]");
  const next = controls?.querySelector("[data-related-carousel-next]");
  const maximum = Math.max(0, track.scrollWidth - track.clientWidth);
  const overflows = maximum > 2;
  if (controls) controls.hidden = !overflows;
  if (previous) previous.disabled = !overflows || track.scrollLeft <= 2;
  if (next) next.disabled = !overflows || track.scrollLeft >= maximum - 2;
}

function scrollRelatedCarousel(track, direction) {
  track.scrollBy({ left: direction * Math.max(280, track.clientWidth * .82), behavior: prefersReducedMotion.matches ? "auto" : "smooth" });
}

function initRelatedCarousel(track) {
  if (relatedCarousels.has(track)) return;
  relatedCarousels.add(track);
  const state = { pointerId: null, startX: 0, startScroll: 0, dragged: false, suppressClick: false, frame: 0 };
  relatedCarouselStates.set(track, state);
  const controls = track.closest(".related-products")?.querySelector("[data-related-carousel-controls]");
  controls?.querySelector("[data-related-carousel-previous]")?.addEventListener("click", () => scrollRelatedCarousel(track, -1));
  controls?.querySelector("[data-related-carousel-next]")?.addEventListener("click", () => scrollRelatedCarousel(track, 1));

  track.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0 || track.scrollWidth <= track.clientWidth + 2) return;
    state.pointerId = event.pointerId;
    state.startX = event.clientX;
    state.startScroll = track.scrollLeft;
    state.dragged = false;
    track.setPointerCapture?.(event.pointerId);
  });
  track.addEventListener("pointermove", (event) => {
    if (state.pointerId !== event.pointerId) return;
    const delta = event.clientX - state.startX;
    if (!state.dragged && Math.abs(delta) >= 5) {
      state.dragged = true;
      track.dataset.carouselDragging = "true";
    }
    if (!state.dragged) return;
    event.preventDefault();
    track.scrollLeft = state.startScroll - delta;
  });
  const finishPointer = (event) => {
    if (state.pointerId !== event.pointerId) return;
    if (state.dragged) state.suppressClick = true;
    if (track.hasPointerCapture?.(event.pointerId)) track.releasePointerCapture(event.pointerId);
    state.pointerId = null;
    state.dragged = false;
    track.removeAttribute("data-carousel-dragging");
    if (state.suppressClick) setTimeout(() => { state.suppressClick = false; }, 0);
  };
  track.addEventListener("pointerup", finishPointer);
  track.addEventListener("pointercancel", finishPointer);
  track.addEventListener("click", (event) => {
    if (!state.suppressClick) return;
    event.preventDefault();
    event.stopPropagation();
    state.suppressClick = false;
  }, true);
  track.addEventListener("dragstart", (event) => event.preventDefault());
  track.addEventListener("keydown", (event) => {
    if (event.target !== track || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const behavior = prefersReducedMotion.matches ? "auto" : "smooth";
    if (event.key === "Home") track.scrollTo({ left: 0, behavior });
    else if (event.key === "End") track.scrollTo({ left: track.scrollWidth, behavior });
    else scrollRelatedCarousel(track, event.key === "ArrowRight" ? 1 : -1);
  });
  track.addEventListener("scroll", () => {
    if (state.frame) return;
    state.frame = requestAnimationFrame(() => {
      state.frame = 0;
      updateRelatedCarousel(track);
    });
  }, { passive: true });
  updateRelatedCarousel(track);
}

function escapeMarkup(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeAssetPath(value = "") {
  return /^[a-z0-9_./-]+$/i.test(value) && !value.includes("..") ? value : "";
}

function readCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(cartKey) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && Number.isFinite(Number(item.price)) && Number.isFinite(Number(item.quantity)))
      .map((item) => ({
        id: String(item.id || ""),
        name: String(item.name || "Product"),
        image: String(item.image || ""),
        price: Math.max(0, Math.round(Number(item.price))),
        option: String(item.option || ""),
        quantity: Math.max(1, Math.round(Number(item.quantity)))
      }));
  } catch {
    return [];
  }
}

let items = readCart();

function saveCart() {
  localStorage.setItem(cartKey, JSON.stringify(items));
}

function money(minor) {
  return new Intl.NumberFormat(body.dataset.locale || "en-GB", {
    style: "currency",
    currency: body.dataset.currency || "GBP",
    maximumFractionDigits: 0
  }).format(minor / 100);
}

function totalQuantity() {
  return items.reduce((total, item) => total + item.quantity, 0);
}

function totalPrice() {
  return items.reduce((total, item) => total + item.price * item.quantity, 0);
}

function setCart(open, { restoreFocus = true, preserveContext = false, focusLineKey = "", focusEmptyState = false } = {}) {
  const cart = getCart();
  const scrim = getScrim();
  if (!cart || !scrim) return;
  if (open) resetAllProductZooms();
  cart.setAttribute("aria-hidden", String(!open));
  body.classList.toggle("drawer-open", open);
  scrim.hidden = !open;
  if (open) {
    if (!preserveContext) {
      drawerScrollPosition = window.scrollY;
      drawerReturnFocus = document.activeElement;
    }
    cart.removeAttribute("inert");
    requestAnimationFrame(() => {
      const lineInput = focusLineKey
        ? [...cart.querySelectorAll("[data-quantity-input]")].find((input) => input.dataset.cartLineKey === focusLineKey)
        : null;
      const emptyAction = focusEmptyState ? cart.querySelector("[data-cart-continue]") : null;
      (lineInput || emptyAction || cart.querySelector("[data-cart-close]"))?.focus({ preventScroll: true });
      window.scrollTo({ top: drawerScrollPosition, behavior: "instant" });
    });
  } else {
    cart.setAttribute("inert", "");
    if (restoreFocus && drawerReturnFocus instanceof HTMLElement) drawerReturnFocus.focus({ preventScroll: true });
    drawerReturnFocus = null;
    window.scrollTo({ top: drawerScrollPosition, behavior: "instant" });
  }
}

function lineKey(item) {
  return `${item.id}:${item.option || ""}`;
}

function previewQuantityControl(item) {
  const key = escapeMarkup(lineKey(item));
  const name = escapeMarkup(item.name);
  return `<div class="quantity-control" data-cart-quantity data-line-key="${key}" data-product-title="${name}"><button class="quantity-control__button" type="button" data-quantity-decrease aria-label="Decrease quantity for ${name}">&minus;</button><label class="quantity-control__label"><span>Quantity for ${name}</span><input type="number" value="${item.quantity}" min="0" step="1" inputmode="numeric" data-quantity-input data-cart-line-key="${key}" data-cart-quantity-current="${item.quantity}" aria-label="Quantity for ${name}"></label><button class="quantity-control__button" type="button" data-quantity-increase aria-label="Increase quantity for ${name}">&plus;</button></div>`;
}

function renderDrawer() {
  const cartCount = document.querySelector("[data-cart-count]");
  const cartItems = document.querySelector("[data-cart-items]");
  if (cartCount) cartCount.textContent = String(totalQuantity());
  if (!cartItems) return;
  if (!items.length) {
    cartItems.innerHTML = "<p>Your bag is waiting.</p>";
    return;
  }
  cartItems.innerHTML = items.map((item) => `<article class="cart-drawer__item" data-cart-line data-line-key="${escapeMarkup(lineKey(item))}"><img src="${rootPath}${safeAssetPath(item.image)}" alt=""><p><strong>${escapeMarkup(item.name)}</strong><br>${escapeMarkup(item.option || "")}<br>${item.quantity} × ${money(item.price)}</p><div class="cart-drawer__line-actions">${previewQuantityControl(item)}<button class="text-button" type="button" data-cart-remove data-line-key="${escapeMarkup(lineKey(item))}" data-product-title="${escapeMarkup(item.name)}">Remove</button></div></article>`).join("");
}

function renderCartPage() {
  const cartPage = document.querySelector("[data-cart-page]");
  if (!cartPage) return;
  if (!items.length) {
    cartPage.innerHTML = `<p>Your bag is empty.</p><a class="button" href="${rootPath}index.html#shop">Continue shopping</a>`;
    return;
  }
  cartPage.innerHTML = `<div class="preview-cart-lines">${items.map((item) => `<article class="preview-cart-line" data-cart-line data-line-key="${escapeMarkup(lineKey(item))}"><img src="${rootPath}${safeAssetPath(item.image)}" alt=""><div><h2>${escapeMarkup(item.name)}</h2><p>${escapeMarkup(item.option || "")}</p><button class="text-button" type="button" data-cart-remove data-line-key="${escapeMarkup(lineKey(item))}" data-product-title="${escapeMarkup(item.name)}">Remove</button></div>${previewQuantityControl(item)}<strong>${money(item.price * item.quantity)}</strong></article>`).join("")}</div><div class="preview-cart-summary"><p>Subtotal <strong>${money(totalPrice())}</strong></p><a class="button button--quiet" href="${rootPath}index.html#shop">Continue shopping</a><p class="preview-cart-note">Checkout continues in the native Shopify or WooCommerce build.</p></div>`;
}

function configurationFor(form) {
  const selects = [...(form?.querySelectorAll("[data-product-option]") || [])];
  const engraving = form?.querySelector("[data-preview-engraving-input]:not([disabled])")?.value.trim();
  const option = [
    ...selects.map((select) => `${select.dataset.optionName}: ${select.value}`),
    engraving ? `Engraving text: ${engraving}` : ""
  ].filter(Boolean).join(" / ");
  const modifier = selects.reduce((total, select) => {
    const selected = select.options[select.selectedIndex];
    return total + Number(selected?.dataset.priceModifier || 0);
  }, 0);
  return { option, modifier };
}

function updateProductForm(form) {
  const button = form?.querySelector("[data-add-to-cart]");
  if (!button) return;
  const { modifier } = configurationFor(form);
  const basePrice = Number(button.dataset.basePrice || button.dataset.price || 0);
  const price = basePrice + modifier;
  button.dataset.price = String(price);
  const priceOutput = form.closest(".preview-product__content")?.querySelector("[data-preview-price]");
  if (!priceOutput) return;
  const baseCompare = Number(priceOutput.dataset.baseCompare || 0);
  priceOutput.innerHTML = `${money(price)}${baseCompare ? ` <s>${money(baseCompare + modifier)}</s>` : ""}`;
}

function productQuantityInput(control) {
  return control?.querySelector("[data-product-quantity-input],input.qty,input[name='quantity']");
}

function connectProductQuantityControl(control) {
  const input = productQuantityInput(control);
  if (!input) return null;
  if (!input.id) {
    productQuantityControlIndex += 1;
    input.id = `product-quantity-${productQuantityControlIndex}`;
  }
  control.querySelectorAll("[data-product-quantity-decrease],[data-product-quantity-increase]").forEach((button) => {
    button.setAttribute("aria-controls", input.id);
  });
  return input;
}

function normalizedProductQuantity(input, requested = input?.value) {
  if (!input) return 1;
  const minimum = Math.max(1, Math.floor(Number(input.min) || 1));
  const parsedMaximum = Math.floor(Number(input.max));
  const maximum = Number.isFinite(parsedMaximum) && parsedMaximum >= minimum ? parsedMaximum : 999;
  const candidate = Math.floor(Number(requested));
  return Math.min(maximum, Math.max(minimum, Number.isFinite(candidate) ? candidate : minimum));
}

function syncProductQuantity(control, requested) {
  const input = connectProductQuantityControl(control);
  if (!input) return 1;
  const quantity = normalizedProductQuantity(input, requested);
  input.value = String(quantity);
  const minimum = Math.max(1, Math.floor(Number(input.min) || 1));
  const parsedMaximum = Math.floor(Number(input.max));
  const maximum = Number.isFinite(parsedMaximum) && parsedMaximum >= minimum ? parsedMaximum : 999;
  const decrease = control.querySelector("[data-product-quantity-decrease]");
  const increase = control.querySelector("[data-product-quantity-increase]");
  if (decrease) decrease.disabled = quantity <= minimum;
  if (increase) increase.disabled = quantity >= maximum;
  return quantity;
}

function renderCart() {
  renderDrawer();
  renderCartPage();
}

function removeLine(key) {
  items = items.filter((item) => lineKey(item) !== key);
  saveCart();
  renderCart();
}

function updatePreviewCartQuantity(key, quantity) {
  const item = items.find((candidate) => lineKey(candidate) === key);
  if (!item) return;
  const keepDrawerOpen = getCart()?.getAttribute("aria-hidden") === "false";
  item.quantity = Math.max(1, Math.floor(quantity));
  saveCart();
  renderCart();
  if (keepDrawerOpen) setCart(true, { preserveContext: true, focusLineKey: key });
}

function completePreviewCartRemoval(key) {
  const keepDrawerOpen = getCart()?.getAttribute("aria-hidden") === "false";
  removeLine(key);
  if (keepDrawerOpen) setCart(true, { preserveContext: true });
}

function completeCartRemoval(removal) {
  if (!removal?.key) return;
  if (removal.source === "preview") {
    completePreviewCartRemoval(removal.key);
    return;
  }
  nativeCartInputsFor(removal.key).forEach((input) => { input.value = "0"; });
  queueNativeCartChange(removal.key, 0);
}

function openCartRemovalDialog({ key, productTitle = "this item", source }) {
  if (!key) return;
  pendingCartRemoval = { key, productTitle, source };
  const dialog = document.querySelector("[data-cart-confirm]");
  const name = dialog?.querySelector("[data-cart-confirm-name]");
  if (name) name.textContent = productTitle;
  if (dialog?.showModal) {
    if (!dialog.open) dialog.showModal();
    return;
  }
  const removal = pendingCartRemoval;
  pendingCartRemoval = null;
  if (window.confirm(`Remove ${productTitle} from your bag?`)) completeCartRemoval(removal);
  else resetPendingCartRemoval();
}

function removePreviewCartLine(key, productTitle = "this item") {
  openCartRemovalDialog({ key, productTitle, source: "preview" });
}

function closeMenu({ restoreFocus = false } = {}) {
  const menuButton = getMenuButton();
  const nav = getNav();
  if (!menuButton || !nav) return;
  const wasOpen = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", "false");
  nav.classList.remove("is-open");
  if (restoreFocus && wasOpen) menuButton.focus();
}

function toggleMenu() {
  const menuButton = getMenuButton();
  const nav = getNav();
  if (!menuButton || !nav) return;
  const open = menuButton.getAttribute("aria-expanded") !== "true";
  menuButton.setAttribute("aria-expanded", String(open));
  nav.classList.toggle("is-open", open);
  if (open) requestAnimationFrame(() => nav.querySelector("a")?.focus());
}

function nativeCartSectionIds() {
  const roots = [getCart(), document.querySelector("[data-main-cart]")];
  return [...new Set(roots.map((root) => root?.closest('[id^="shopify-section-"]')?.id?.replace(/^shopify-section-/, "")).filter(Boolean))];
}

function replaceShopifySection(sectionId, html) {
  if (!sectionId || !html) return false;
  const current = document.getElementById(`shopify-section-${sectionId}`);
  if (!current) return false;
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  const replacement = template.content.querySelector(`[id="shopify-section-${sectionId}"]`);
  if (replacement) current.replaceWith(replacement);
  else current.replaceChildren(template.content);
  return true;
}

function replaceCartSections(sections = {}) {
  return new Set(Object.entries(sections).filter(([sectionId, html]) => replaceShopifySection(sectionId, html)).map(([sectionId]) => sectionId));
}

async function fetchRenderedCartSections(sectionIds) {
  if (!sectionIds.length) return {};
  const url = new URL(window.location.href);
  url.searchParams.set("sections", sectionIds.join(","));
  const response = await fetch(url, { headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" } });
  if (!response.ok) return {};
  return response.json();
}

function updateNativeCartCount(count) {
  document.querySelectorAll("[data-cart-count]").forEach((output) => {
    output.textContent = String(count || 0);
  });
}

function setNativeCartStatus(message, state = "success") {
  document.querySelectorAll("[data-cart-status]").forEach((status) => {
    status.textContent = message;
    status.dataset.state = state;
    status.hidden = !message;
  });
}

function nativeCartInputsFor(key) {
  return [...document.querySelectorAll("[data-quantity-input]")].filter((input) => input.dataset.cartLineKey === key);
}

function setNativeCartLineBusy(key, busy) {
  document.querySelectorAll("[data-cart-quantity]").forEach((control) => {
    if (control.dataset.lineKey !== key) return;
    control.toggleAttribute("aria-busy", busy);
    control.querySelectorAll("button,input").forEach((element) => { element.disabled = busy; });
  });
}

function restoreNativeCartQuantity(key) {
  nativeCartInputsFor(key).forEach((input) => {
    input.value = input.dataset.cartQuantityCurrent || "1";
  });
}

async function changeNativeCartLine(key, quantity) {
  const sectionIds = nativeCartSectionIds();
  const keepDrawerOpen = getCart()?.getAttribute("aria-hidden") === "false";
  const previousReturnFocus = drawerReturnFocus;
  const previousScrollPosition = drawerScrollPosition;
  setNativeCartLineBusy(key, true);
  setNativeCartStatus("Updating your bag…");

  try {
    const route = `${window.Shopify?.routes?.root || "/"}cart/change.js`;
    const response = await fetch(route, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
      body: JSON.stringify({
        id: key,
        quantity,
        sections: sectionIds.join(","),
        sections_url: `${window.location.pathname}${window.location.search}`
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.description || result.message || "Your bag could not be updated.");

    const sections = { ...(result.sections || {}) };
    const missingSections = sectionIds.filter((sectionId) => !sections[sectionId]);
    if (missingSections.length) Object.assign(sections, await fetchRenderedCartSections(missingSections));
    const replacedSections = replaceCartSections(sections);
    updateNativeCartCount(result.item_count);
    if (sectionIds.some((sectionId) => !replacedSections.has(sectionId))) {
      setNativeCartStatus("Bag updated. Refreshing the page…");
      window.location.reload();
      return false;
    }

    drawerReturnFocus = previousReturnFocus;
    drawerScrollPosition = previousScrollPosition;
    if (keepDrawerOpen) {
      setCart(true, { preserveContext: true, focusLineKey: quantity > 0 ? key : "", focusEmptyState: result.item_count === 0 });
    } else {
      requestAnimationFrame(() => {
        const nextInput = quantity > 0
          ? nativeCartInputsFor(key)[0]
          : document.querySelector("[data-main-cart] [data-quantity-input], [data-main-cart] .empty-state a");
        nextInput?.focus({ preventScroll: true });
      });
    }
    setNativeCartStatus("Bag updated.");
    return true;
  } catch (error) {
    restoreNativeCartQuantity(key);
    setNativeCartStatus(error.message || "Your bag could not be updated. Please try again.", "error");
    return false;
  } finally {
    setNativeCartLineBusy(key, false);
  }
}

function queueNativeCartMutation(task) {
  nativeCartQueue = nativeCartQueue.catch(() => {}).then(async () => {
    nativeCartMutationActive = true;
    try {
      return await task();
    } finally {
      nativeCartMutationActive = false;
    }
  });
  return nativeCartQueue;
}

function queueNativeCartChange(key, quantity) {
  return queueNativeCartMutation(() => changeNativeCartLine(key, quantity));
}

async function flushNativeCartChanges() {
  while (true) {
    const pending = [...nativeCartPendingQuantities.entries()];
    nativeCartPendingQuantities.clear();
    for (const [key, quantity] of pending) {
      const timer = nativeCartUpdateTimers.get(key);
      if (timer) clearTimeout(timer);
      nativeCartUpdateTimers.delete(key);
      if (quantity === 0) {
        const control = [...document.querySelectorAll("[data-cart-quantity]")].find((candidate) => candidate.dataset.lineKey === key);
        requestNativeCartRemoval({ key, productTitle: control?.dataset.productTitle });
        return false;
      }
      if (!await queueNativeCartChange(key, quantity)) return false;
    }
    await nativeCartQueue.catch(() => {});
    if (!nativeCartPendingQuantities.size && !nativeCartUpdateTimers.size && !nativeCartMutationActive) return true;
  }
}

function resetPendingCartRemoval() {
  if (pendingCartRemoval?.key) restoreNativeCartQuantity(pendingCartRemoval.key);
  pendingCartRemoval = null;
}

function requestNativeCartRemoval({ key, productTitle = "this item" }) {
  if (!key) return;
  const timer = nativeCartUpdateTimers.get(key);
  if (timer) clearTimeout(timer);
  nativeCartUpdateTimers.delete(key);
  nativeCartPendingQuantities.delete(key);
  openCartRemovalDialog({ key, productTitle, source: "native" });
}

function scheduleNativeCartChange(input, delay = nativeCartUpdateDelay) {
  const key = input?.dataset.cartLineKey;
  if (!key || input.value === "") return;
  const quantity = Math.max(0, Math.min(999, Math.floor(Number(input.value))));
  if (!Number.isFinite(quantity)) return;
  input.value = String(quantity);
  const earlier = nativeCartUpdateTimers.get(key);
  if (earlier) clearTimeout(earlier);
  nativeCartPendingQuantities.set(key, quantity);
  const commit = () => {
    if (nativeCartMutationActive || document.querySelector("[data-cart-confirm][open]")) {
      nativeCartUpdateTimers.set(key, setTimeout(commit, 100));
      return;
    }
    nativeCartUpdateTimers.delete(key);
    nativeCartPendingQuantities.delete(key);
    if (quantity === 0) {
      const control = input.closest("[data-cart-quantity]");
      requestNativeCartRemoval({ key, productTitle: control?.dataset.productTitle });
    } else if (quantity !== Number(input.dataset.cartQuantityCurrent || 0)) {
      queueNativeCartChange(key, quantity);
    }
  };
  nativeCartUpdateTimers.set(key, setTimeout(commit, delay));
}

async function refreshCartCount() {
  const route = `${window.Shopify?.routes?.root || "/"}cart.js`;
  const response = await fetch(route, { headers: { Accept: "application/json" } });
  if (!response.ok) return;
  const currentCart = await response.json();
  updateNativeCartCount(currentCart.item_count);
}

async function addToNativeCart(form) {
  const button = form.querySelector("[data-product-submit], button[type='submit']");
  const status = form.querySelector("[data-product-status], [data-form-status]");
  const defaultLabel = button?.textContent || "Add to bag";
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = "Adding…";
  }
  if (status) {
    status.hidden = true;
    status.textContent = "";
  }

  try {
    if (!await flushNativeCartChanges()) return;
    await queueNativeCartMutation(async () => {
      const data = new FormData(form);
      data.set("sections", "cart-drawer");
      data.set("sections_url", `${window.location.pathname}${window.location.search}`);
      const route = `${window.Shopify?.routes?.root || "/"}cart/add.js`;
      const response = await fetch(route, {
        method: "POST",
        headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: data
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.description || result.message || "This product could not be added.");
      const replacedSections = replaceCartSections(result.sections);
      if (!replacedSections.has("cart-drawer")) throw new Error("Your item was added, but the bag could not be refreshed. Reload the page to continue.");
      await refreshCartCount();
      setCart(true);
    });
    if (status) {
      status.textContent = "Added to your bag.";
      status.hidden = false;
    }
  } catch (error) {
    if (status) {
      status.textContent = error.message || "This product could not be added. Please try again.";
      status.hidden = false;
    }
  } finally {
    if (button) {
      button.removeAttribute("aria-busy");
      button.disabled = button.dataset.available === "false";
      button.textContent = button.disabled ? "Sold out" : defaultLabel;
    }
  }
}

document.querySelectorAll("[data-add-to-cart]").forEach((button) => {
  button.addEventListener("click", () => {
    const form = button.closest("form");
    const { option } = configurationFor(form);
    const quantityControl = form?.querySelector("[data-product-quantity]");
    const quantity = quantityControl ? syncProductQuantity(quantityControl) : 1;
    const candidate = {
      id: button.dataset.productId,
      name: button.dataset.product,
      image: button.dataset.image,
      price: Number(button.dataset.price),
      option,
      quantity
    };
    const existing = items.find((item) => lineKey(item) === lineKey(candidate));
    if (existing) existing.quantity += quantity;
    else items.push(candidate);
    saveCart();
    renderCart();
    setCart(true);
  });
});

document.addEventListener("click", (event) => {
  const productQuantityButton = event.target.closest("[data-product-quantity-decrease],[data-product-quantity-increase]");
  if (productQuantityButton) {
    event.preventDefault();
    const control = productQuantityButton.closest("[data-product-quantity]");
    const input = productQuantityInput(control);
    if (!input) return;
    const current = normalizedProductQuantity(input);
    const next = productQuantityButton.matches("[data-product-quantity-increase]") ? current + 1 : current - 1;
    syncProductQuantity(control, next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  const confirmCancel = event.target.closest("[data-cart-confirm-cancel]");
  if (confirmCancel) {
    const dialog = confirmCancel.closest("[data-cart-confirm]");
    resetPendingCartRemoval();
    dialog?.close?.();
    return;
  }
  const confirmRemove = event.target.closest("[data-cart-confirm-remove]");
  if (confirmRemove) {
    const dialog = confirmRemove.closest("[data-cart-confirm]");
    const removal = pendingCartRemoval;
    pendingCartRemoval = null;
    dialog?.close?.();
    completeCartRemoval(removal);
    return;
  }
  const quantityButton = event.target.closest("[data-quantity-decrease],[data-quantity-increase]");
  if (quantityButton) {
    event.preventDefault();
    if (isNativeStorefront && nativeCartMutationActive) {
      setNativeCartStatus("Finishing the current bag update…");
      return;
    }
    const control = quantityButton.closest("[data-cart-quantity]");
    const input = control?.querySelector("[data-quantity-input]");
    if (!input) return;
    const current = Math.max(0, Number(input.value) || 0);
    if (quantityButton.matches("[data-quantity-decrease]") && current <= 1) {
      if (isNativeStorefront) requestNativeCartRemoval({ key: input.dataset.cartLineKey, productTitle: control.dataset.productTitle });
      else removePreviewCartLine(input.dataset.cartLineKey, control.dataset.productTitle);
    } else {
      const nextQuantity = quantityButton.matches("[data-quantity-increase]") ? current + 1 : current - 1;
      input.value = String(nextQuantity);
      if (isNativeStorefront) scheduleNativeCartChange(input);
      else updatePreviewCartQuantity(input.dataset.cartLineKey, nextQuantity);
    }
    return;
  }
  const nativeRemove = event.target.closest("[data-cart-remove]");
  if (nativeRemove) {
    event.preventDefault();
    if (isNativeStorefront && nativeCartMutationActive) {
      setNativeCartStatus("Finishing the current bag update…");
      return;
    }
    if (isNativeStorefront) requestNativeCartRemoval({ key: nativeRemove.dataset.lineKey, productTitle: nativeRemove.dataset.productTitle });
    else removePreviewCartLine(nativeRemove.dataset.lineKey, nativeRemove.dataset.productTitle);
    return;
  }
  const nativeCartLink = isNativeStorefront
    ? event.target.closest("#cart-drawer a[href], [data-main-cart] a[href]")
    : null;
  if (nativeCartLink && (nativeCartUpdateTimers.size || nativeCartPendingQuantities.size || nativeCartMutationActive)) {
    event.preventDefault();
    const destination = nativeCartLink.href;
    void flushNativeCartChanges().then((ready) => {
      if (ready) window.location.assign(destination);
    });
    return;
  }
  const menuToggle = event.target.closest("[data-menu-toggle]");
  if (menuToggle) {
    event.preventDefault();
    toggleMenu();
    return;
  }
  const cartToggle = event.target.closest("[data-cart-toggle]");
  if (cartToggle && getCart()) {
    event.preventDefault();
    setCart(true);
    return;
  }
  if (event.target.closest("[data-cart-close]") || event.target.closest("[data-scrim]")) {
    setCart(false);
    return;
  }
  const continueShopping = event.target.closest("[data-cart-continue]");
  if (continueShopping && getCart()?.contains(continueShopping)) {
    setCart(false, { restoreFocus: false });
    return;
  }
  if (event.target.closest("#primary-nav a")) closeMenu();
  else if (getNav()?.classList.contains("is-open") && !event.target.closest(".site-header")) closeMenu();
});

document.addEventListener("input", (event) => {
  const productInput = event.target.closest("[data-product-quantity-input],[data-product-quantity] input.qty");
  if (productInput) {
    const control = productInput.closest("[data-product-quantity]");
    if (control && productInput.value !== "") syncProductQuantity(control);
    return;
  }
  if (!isNativeStorefront) return;
  const input = event.target.closest("[data-quantity-input]");
  if (input) scheduleNativeCartChange(input);
});

document.addEventListener("cancel", (event) => {
  if (!event.target.matches?.("[data-cart-confirm]")) return;
  resetPendingCartRemoval();
}, true);

document.addEventListener("submit", (event) => {
  if (isNativeStorefront && event.submitter?.name === "checkout" && event.target.dataset.cartFlushed !== "true") {
    event.preventDefault();
    const fromDrawer = Boolean(event.target.closest("#cart-drawer"));
    void flushNativeCartChanges().then((ready) => {
      if (!ready) return;
      const scope = fromDrawer ? getCart() : document.querySelector("[data-main-cart]");
      const checkoutButton = scope?.querySelector('button[name="checkout"]');
      const checkoutForm = checkoutButton?.form;
      if (!checkoutForm) return;
      checkoutForm.dataset.cartFlushed = "true";
      checkoutForm.requestSubmit(checkoutButton);
    });
    return;
  }
  const form = event.target.closest("form[data-native-cart-form]");
  if (!form) return;
  const productQuantity = form.querySelector("[data-product-quantity]");
  if (productQuantity) syncProductQuantity(productQuantity);
  event.preventDefault();
  addToNativeCart(form);
});

document.addEventListener("change", (event) => {
  const productInput = event.target.closest("[data-product-quantity-input],[data-product-quantity] input.qty");
  if (productInput) {
    const control = productInput.closest("[data-product-quantity]");
    if (control) syncProductQuantity(control);
    return;
  }
  if (isNativeStorefront) {
    const nativeQuantity = event.target.closest("[data-quantity-input]");
    if (nativeQuantity?.value === "") restoreNativeCartQuantity(nativeQuantity.dataset.cartLineKey);
    return;
  }
  const productOption = event.target.closest("[data-product-option]");
  if (productOption) {
    updateProductForm(productOption.closest("form"));
    return;
  }
  const input = event.target.closest("[data-quantity-input]");
  if (!input) return;
  const quantity = Math.max(0, Math.floor(Number(input.value) || 0));
  if (quantity === 0) removePreviewCartLine(input.dataset.cartLineKey, input.closest("[data-cart-quantity]")?.dataset.productTitle);
  else updatePreviewCartQuantity(input.dataset.cartLineKey, quantity);
});

if (!isNativeStorefront) {
  document.querySelector("[data-newsletter]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    button.textContent = "You are on the list";
    button.disabled = true;
  });
}

document.addEventListener("keydown", (event) => {
  const nativeQuantity = isNativeStorefront ? event.target.closest?.("[data-quantity-input]") : null;
  if (nativeQuantity && event.key === "Enter") {
    event.preventDefault();
    scheduleNativeCartChange(nativeQuantity, 0);
    return;
  }
  if (event.key === "Escape") {
    if (document.querySelector("[data-cart-confirm][open]")) return;
    if (getCart()?.getAttribute("aria-hidden") === "false") setCart(false);
    else closeMenu({ restoreFocus: true });
    return;
  }
  if (event.key !== "Tab") return;
  const drawer = getCart();
  if (!drawer || drawer.getAttribute("aria-hidden") !== "false") return;
  const focusable = [...drawer.querySelectorAll("a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])")];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

window.matchMedia("(min-width: 901px)").addEventListener("change", (event) => {
  if (event.matches) closeMenu();
});

document.querySelectorAll("[data-product-quantity]").forEach((control) => syncProductQuantity(control));
document.querySelectorAll("[data-product-zoom]").forEach(initProductZoom);
document.querySelectorAll("[data-related-carousel]").forEach(initRelatedCarousel);

window.addEventListener("resize", () => {
  resetAllProductZooms();
  relatedCarousels.forEach(updateRelatedCarousel);
});

if (isNativeStorefront) refreshCartCount().catch(() => {});
else renderCart();
document.querySelectorAll(".preview-product__form").forEach(updateProductForm);
