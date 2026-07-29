import { escapeHtml, formatMoney, presentationLayout } from "./lib.mjs";

const action = (item, className = "button") =>
  `<a class="${className}" href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`;

const footerLinks = (items = [], homePath = "") => items
  .map((item) => {
    const href = item.href.startsWith("#") ? `${homePath}${item.href}` : item.href;
    return `<a href="${escapeHtml(href)}">${escapeHtml(item.label)}</a>`;
  })
  .join("");

function media(pathname, alt, className = "", loading = "lazy") {
  const priority = loading === "eager" ? ' fetchpriority="high"' : "";
  return `<div class="media ${className}"><img src="${escapeHtml(pathname)}" alt="${escapeHtml(alt)}" width="1200" height="1400" loading="${loading}"${priority}></div>`;
}

function productCard(product, brand) {
  const price = formatMoney(product.price, brand.locale, brand.currency);
  const compare = product.compareAtPrice
    ? `<s>${formatMoney(product.compareAtPrice, brand.locale, brand.currency)}</s>`
    : "";
  const needsConfiguration = (product.options || []).some((option) => option.values.length > 1) || (product.options || []).length > 1;
  return `<article class="product-card">
    <a class="product-card__media" href="products/${escapeHtml(product.id)}/index.html">
      ${media(product.image, product.name)}
      ${product.badge ? `<span class="product-card__badge">${escapeHtml(product.badge)}</span>` : ""}
    </a>
    <div class="product-card__body">
      <p class="product-card__category">${escapeHtml(product.category)}</p>
      <h3><a href="products/${escapeHtml(product.id)}/index.html">${escapeHtml(product.name)}</a></h3>
      <p>${escapeHtml(product.description)}</p>
      <div class="product-card__buy">
        <span>${price} ${compare}</span>
        ${needsConfiguration ? `<a class="text-button" href="products/${escapeHtml(product.id)}/index.html">Choose options</a>` : `<button class="text-button" type="button" data-add-to-cart data-product-id="${escapeHtml(product.id)}" data-product="${escapeHtml(product.name)}" data-image="${escapeHtml(product.image)}" data-price="${product.price}">Add</button>`}
      </div>
    </div>
  </article>`;
}

function renderSection(section, brand, catalog) {
  const heading = `${section.eyebrow ? `<p class="eyebrow">${escapeHtml(section.eyebrow)}</p>` : ""}
    ${section.title ? `<h2>${escapeHtml(section.title)}</h2>` : ""}
    ${section.body ? `<p class="section-intro">${escapeHtml(section.body)}</p>` : ""}`;

  if (section.type === "proof-strip") {
    return `<section class="proof-strip" id="${escapeHtml(section.id || "proof")}" aria-label="Store assurances"><div class="proof-strip__inner">
      ${section.items.map((item) => `<div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.body)}</span></div>`).join("")}
    </div></section>`;
  }

  if (section.type === "product-grid") {
    const products = section.productIds
      .map((id) => catalog.products.find((product) => product.id === id))
      .filter(Boolean);
    return `<section class="section product-section" id="${escapeHtml(section.id || "shop")}">
      <div class="section-heading">${heading}</div>
      <div class="product-grid">${products.map((product) => productCard(product, brand)).join("")}</div>
    </section>`;
  }

  if (section.type === "steps") {
    return `<section class="section steps" id="${escapeHtml(section.id || "steps")}">
      <div class="section-heading section-heading--sticky">${heading}</div>
      <div class="steps__list">${section.items.map((item) => `<article><span>${escapeHtml(item.number)}</span><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body)}</p></div></article>`).join("")}</div>
    </section>`;
  }

  if (section.type === "editorial-split") {
    return `<section class="section editorial" id="${escapeHtml(section.id || "editorial")}">
      <div class="editorial__copy">${heading}${section.action ? action(section.action, "text-link") : ""}</div>
      ${media(section.media, section.title, "editorial__media")}
    </section>`;
  }

  if (section.type === "testimonials") {
    return `<section class="section testimonials" id="${escapeHtml(section.id || "testimonials")}">
      <div class="section-heading">${heading}</div>
      <div class="testimonial-grid">${section.items.map((item) => `<figure><blockquote>“${escapeHtml(item.quote)}”</blockquote><figcaption><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.meta)}</span></figcaption></figure>`).join("")}</div>
    </section>`;
  }

  if (section.type === "comparison") {
    return `<section class="section comparison" id="${escapeHtml(section.id || "compare")}"><div class="section-heading">${heading}</div><div class="comparison-table" role="table">${section.items.map((item) => `<article class="comparison-row" role="row"><h3 role="cell">${escapeHtml(item.title)}</h3><p role="cell">${escapeHtml(item.body)}</p>${item.meta ? `<strong role="cell">${escapeHtml(item.meta)}</strong>` : ""}</article>`).join("")}</div></section>`;
  }

  if (section.type === "newsletter") {
    return `<section class="newsletter" id="${escapeHtml(section.id || "newsletter")}"><div>${heading}</div><form data-newsletter><label><span>Email address</span><input type="email" placeholder="you@example.com" required></label><button class="button" type="submit">Join the list</button></form></section>`;
  }

  return "";
}

export function renderPreview(brand, catalog) {
  const brandStyle = `:root{--ink:${brand.palette.ink};--paper:${brand.palette.paper};--muted:${brand.palette.muted};--accent:${brand.palette.accent};--accent-contrast:${brand.palette.accentContrast};--line:${brand.palette.line};--surface:${brand.palette.surface};--soft:${brand.palette.soft};--font-display:${brand.typography.display};--font-body:${brand.typography.body};}`;
  const layout = presentationLayout(brand);
  return `<!doctype html>
<html lang="${escapeHtml(brand.locale.split("-")[0])}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="${escapeHtml(brand.hero.body)}">
  <title>${escapeHtml(brand.displayName)} — storefront demonstration</title>
  <style>${brandStyle}</style>
  <link rel="stylesheet" href="storefront.css">
  <script src="storefront.js" defer></script>
</head>
<body data-brand="${escapeHtml(brand.id)}" data-layout="${escapeHtml(layout)}" data-platform="preview" data-root="" data-locale="${escapeHtml(brand.locale)}" data-currency="${escapeHtml(brand.currency)}">
  <a class="skip-link" href="#main">Skip to content</a>
  <div class="announcement">${escapeHtml(brand.announcement)}</div>
  <header class="site-header">
    <a class="wordmark" href="#top" aria-label="${escapeHtml(brand.displayName)} home">${escapeHtml(brand.displayName)}</a>
    <button class="menu-button" type="button" data-menu-toggle aria-expanded="false" aria-controls="primary-nav">Menu</button>
    <nav id="primary-nav" class="primary-nav" aria-label="Primary navigation">
      ${brand.navigation.map((item) => `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`).join("")}
    </nav>
    <button class="cart-button" type="button" data-cart-toggle aria-controls="cart-drawer">Bag <span data-cart-count>0</span></button>
  </header>
  <main id="main">
    <section class="hero" id="top">
      <div class="hero__copy">
        <p class="eyebrow">${escapeHtml(brand.hero.eyebrow)}</p>
        <h1>${escapeHtml(brand.hero.title)}</h1>
        <p>${escapeHtml(brand.hero.body)}</p>
        <div class="actions">${action(brand.hero.primaryAction)}${brand.hero.secondaryAction ? action(brand.hero.secondaryAction, "button button--quiet") : ""}</div>
      </div>
      ${media(brand.hero.media, `${brand.displayName} hero`, "hero__media", "eager")}
    </section>
    ${brand.sections.map((section) => renderSection(section, brand, catalog)).join("\n")}
  </main>
  <footer class="site-footer">
    <a class="wordmark" href="#top">${escapeHtml(brand.displayName)}</a>
    <p>${escapeHtml(brand.footer.note)}</p>
    <nav aria-label="Footer navigation">${footerLinks(brand.footer.links)}</nav>
  </footer>
  <aside class="cart-drawer" id="cart-drawer" aria-hidden="true" aria-label="Shopping bag">
    <div class="cart-drawer__head"><h2>Your bag</h2><button type="button" data-cart-close aria-label="Close bag">Close</button></div>
    <div class="cart-drawer__items" data-cart-items><p>Your bag is waiting.</p></div>
    <a class="button button--full" href="cart/index.html">Review bag</a>
  </aside>
  <div class="scrim" data-scrim hidden></div>
</body>
</html>`;
}

function nestedDocument(brand, { rootPath, title, description, content, bodyClass = "" }) {
  const navigation = brand.navigation.map((item) => `<a href="${rootPath}index.html${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`).join("");
  const layout = presentationLayout(brand);
  return `<!doctype html>
<html lang="${escapeHtml(brand.locale.split("-")[0])}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="${escapeHtml(description)}">
  <title>${escapeHtml(title)} — ${escapeHtml(brand.displayName)}</title>
  <style>:root{--ink:${brand.palette.ink};--paper:${brand.palette.paper};--muted:${brand.palette.muted};--accent:${brand.palette.accent};--accent-contrast:${brand.palette.accentContrast};--line:${brand.palette.line};--surface:${brand.palette.surface};--soft:${brand.palette.soft};--font-display:${brand.typography.display};--font-body:${brand.typography.body};}</style>
  <link rel="stylesheet" href="${rootPath}storefront.css">
  <script src="${rootPath}storefront.js" defer></script>
</head>
<body class="${bodyClass}" data-brand="${escapeHtml(brand.id)}" data-layout="${escapeHtml(layout)}" data-platform="preview" data-root="${rootPath}" data-locale="${escapeHtml(brand.locale)}" data-currency="${escapeHtml(brand.currency)}">
  <a class="skip-link" href="#main">Skip to content</a>
  <div class="announcement">${escapeHtml(brand.announcement)}</div>
  <header class="site-header">
    <a class="wordmark" href="${rootPath}index.html">${escapeHtml(brand.displayName)}</a>
    <button class="menu-button" type="button" data-menu-toggle aria-expanded="false" aria-controls="primary-nav">Menu</button>
    <nav id="primary-nav" class="primary-nav" aria-label="Primary navigation">${navigation}</nav>
    <a class="cart-button" href="${rootPath}cart/index.html" data-cart-toggle>Bag <span data-cart-count>0</span></a>
  </header>
  ${content}
  <footer class="site-footer"><a class="wordmark" href="${rootPath}index.html">${escapeHtml(brand.displayName)}</a><p>${escapeHtml(brand.footer.note)}</p><nav aria-label="Footer navigation">${footerLinks(brand.footer.links, `${rootPath}index.html`)}</nav></footer>
  <aside class="cart-drawer" id="cart-drawer" aria-hidden="true" aria-label="Shopping bag" inert><div class="cart-drawer__head"><h2>Your bag</h2><button type="button" data-cart-close aria-label="Close bag">Close</button></div><div class="cart-drawer__items" data-cart-items><p>Your bag is waiting.</p></div><a class="button button--full" href="${rootPath}cart/index.html">Review bag</a></aside>
  <div class="scrim" data-scrim hidden></div>
</body>
</html>`;
}

export function renderProductPreview(brand, product) {
  const rootPath = "../../";
  const price = formatMoney(product.price, brand.locale, brand.currency);
  const compare = product.compareAtPrice ? `<s>${formatMoney(product.compareAtPrice, brand.locale, brand.currency)}</s>` : "";
  const options = product.options || [];
  const content = `<main id="main"><section class="preview-product">
    <div class="media preview-product__media"><img src="${rootPath}${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" width="1200" height="1400" loading="eager" fetchpriority="high"></div>
    <div class="preview-product__content"><p class="eyebrow">${escapeHtml(product.category)}</p><h1>${escapeHtml(product.name)}</h1><p class="preview-product__price" data-preview-price data-base-compare="${product.compareAtPrice || 0}">${price} ${compare}</p><p class="preview-product__description">${escapeHtml(product.description)}</p>
      <form class="preview-product__form">${options.map((option) => `<label><span>${escapeHtml(option.name)}</span><select name="${escapeHtml(option.name)}" data-product-option data-option-name="${escapeHtml(option.name)}">${option.values.map((rawValue) => { const value = typeof rawValue === "string" ? { label: rawValue, priceModifier: 0 } : rawValue; const change = value.priceModifier ? ` (${value.priceModifier > 0 ? "+" : "−"}${formatMoney(Math.abs(value.priceModifier), brand.locale, brand.currency)})` : ""; return `<option value="${escapeHtml(value.label)}" data-price-modifier="${value.priceModifier || 0}">${escapeHtml(value.label)}${change}</option>`; }).join("")}</select></label>`).join("")}<button class="button button--full" type="button" data-add-to-cart data-product-id="${escapeHtml(product.id)}" data-product="${escapeHtml(product.name)}" data-image="${escapeHtml(product.image)}" data-base-price="${product.price}" data-price="${product.price}">Add to bag</button></form>
      <div class="product-assurances"><p>Secure checkout in the native store.</p><p>Delivery details are shown before payment.</p></div>
    </div>
  </section></main>`;
  return nestedDocument(brand, { rootPath, title: product.name, description: product.description, content, bodyClass: "product-preview" });
}

export function renderCartPreview(brand) {
  const rootPath = "../";
  const content = `<main id="main"><section class="section cart-page"><div class="section-heading"><p class="eyebrow">Shopping bag</p><h1>Your bag</h1><p class="section-intro">Review the products and options selected in this preview.</p></div><div data-cart-page></div></section></main>`;
  return nestedDocument(brand, { rootPath, title: "Your bag", description: "Storefront preview shopping bag", content, bodyClass: "cart-preview" });
}
