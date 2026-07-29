const body = document.body;
const isNativeStorefront = body.dataset.platform === "shopify";
const rootPath = body.dataset.root || "";
const cartKey = `sfk-cart:${body.dataset.brand || "preview"}`;
let drawerReturnFocus = null;

const getMenuButton = () => document.querySelector("[data-menu-toggle]");
const getNav = () => document.querySelector("#primary-nav");
const getCart = () => document.querySelector("#cart-drawer");
const getScrim = () => document.querySelector("[data-scrim]");

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

function setCart(open, { restoreFocus = true } = {}) {
  const cart = getCart();
  const scrim = getScrim();
  if (!cart || !scrim) return;
  cart.setAttribute("aria-hidden", String(!open));
  body.classList.toggle("drawer-open", open);
  scrim.hidden = !open;
  if (open) {
    drawerReturnFocus = document.activeElement;
    cart.removeAttribute("inert");
    requestAnimationFrame(() => cart.querySelector("[data-cart-close]")?.focus({ preventScroll: true }));
  } else {
    cart.setAttribute("inert", "");
    if (restoreFocus && drawerReturnFocus instanceof HTMLElement) drawerReturnFocus.focus({ preventScroll: true });
    drawerReturnFocus = null;
  }
}

function lineKey(item) {
  return `${item.id}:${item.option || ""}`;
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
  cartItems.innerHTML = items.map((item) => `<article class="cart-drawer__item"><img src="${rootPath}${safeAssetPath(item.image)}" alt=""><p><strong>${escapeMarkup(item.name)}</strong><br>${escapeMarkup(item.option || "")}<br>${item.quantity} × ${money(item.price)}</p><button type="button" data-remove-line="${escapeMarkup(lineKey(item))}">Remove</button></article>`).join("");
}

function renderCartPage() {
  const cartPage = document.querySelector("[data-cart-page]");
  if (!cartPage) return;
  if (!items.length) {
    cartPage.innerHTML = `<p>Your bag is empty.</p><a class="button" href="${rootPath}index.html#shop">Continue shopping</a>`;
    return;
  }
  cartPage.innerHTML = `<div class="preview-cart-lines">${items.map((item) => `<article class="preview-cart-line"><img src="${rootPath}${safeAssetPath(item.image)}" alt=""><div><h2>${escapeMarkup(item.name)}</h2><p>${escapeMarkup(item.option || "")}</p><button class="text-button" type="button" data-remove-line="${escapeMarkup(lineKey(item))}">Remove</button></div><label><span>Quantity</span><input type="number" min="1" value="${item.quantity}" data-quantity-line="${escapeMarkup(lineKey(item))}"></label><strong>${money(item.price * item.quantity)}</strong></article>`).join("")}</div><div class="preview-cart-summary"><p>Subtotal <strong>${money(totalPrice())}</strong></p><a class="button button--quiet" href="${rootPath}index.html#shop">Continue shopping</a><p class="preview-cart-note">Checkout continues in the native Shopify or WooCommerce build.</p></div>`;
}

function configurationFor(form) {
  const selects = [...(form?.querySelectorAll("[data-product-option]") || [])];
  const option = selects
    .map((select) => `${select.dataset.optionName}: ${select.value}`)
    .join(" / ");
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

function renderCart() {
  renderDrawer();
  renderCartPage();
}

function removeLine(key) {
  items = items.filter((item) => lineKey(item) !== key);
  saveCart();
  renderCart();
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

function replaceCartDrawer(html) {
  if (!html) return;
  const current = document.querySelector("#shopify-section-cart-drawer");
  if (!current) return;
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  const replacement = template.content.firstElementChild;
  if (replacement) current.replaceWith(replacement);
}

async function refreshCartCount() {
  const route = `${window.Shopify?.routes?.root || "/"}cart.js`;
  const response = await fetch(route, { headers: { Accept: "application/json" } });
  if (!response.ok) return;
  const currentCart = await response.json();
  document.querySelectorAll("[data-cart-count]").forEach((count) => {
    count.textContent = String(currentCart.item_count || 0);
  });
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
    replaceCartDrawer(result.sections?.["cart-drawer"]);
    await refreshCartCount();
    if (status) {
      status.textContent = "Added to your bag.";
      status.hidden = false;
    }
    setCart(true);
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
    const { option } = configurationFor(button.closest("form"));
    const candidate = {
      id: button.dataset.productId,
      name: button.dataset.product,
      image: button.dataset.image,
      price: Number(button.dataset.price),
      option,
      quantity: 1
    };
    const existing = items.find((item) => lineKey(item) === lineKey(candidate));
    if (existing) existing.quantity += 1;
    else items.push(candidate);
    saveCart();
    renderCart();
    setCart(true);
  });
});

document.addEventListener("click", (event) => {
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
  const removeButton = event.target.closest("[data-remove-line]");
  if (removeButton) removeLine(removeButton.dataset.removeLine);
});

document.addEventListener("submit", (event) => {
  const form = event.target.closest("form[data-native-cart-form]");
  if (!form) return;
  event.preventDefault();
  addToNativeCart(form);
});

document.addEventListener("change", (event) => {
  if (isNativeStorefront) return;
  const productOption = event.target.closest("[data-product-option]");
  if (productOption) {
    updateProductForm(productOption.closest("form"));
    return;
  }
  const input = event.target.closest("[data-quantity-line]");
  if (!input) return;
  const item = items.find((candidate) => lineKey(candidate) === input.dataset.quantityLine);
  if (!item) return;
  item.quantity = Math.max(1, Number(input.value) || 1);
  saveCart();
  renderCart();
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
  if (event.key === "Escape") {
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

if (isNativeStorefront) refreshCartCount().catch(() => {});
else renderCart();
document.querySelectorAll(".preview-product__form").forEach(updateProductForm);
