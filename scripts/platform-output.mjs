import { escapeHtml } from "./lib.mjs";

function sectionId(index, type) {
  return `${String(index + 1).padStart(2, "0")}_${type.replaceAll("-", "_")}`;
}

function blocks(items = [], map) {
  return Object.fromEntries(items.map((item, index) => [`item_${index + 1}`, { type: "item", settings: map(item) }]));
}

export function shopifyIndexTemplate(brand) {
  const sections = {
    hero: {
      type: "hero",
      settings: {
        eyebrow: brand.hero.eyebrow,
        title: brand.hero.title,
        body: brand.hero.body,
        fallback_asset: `brand-${brand.hero.media.split("/").at(-1)}`,
        primary_label: brand.hero.primaryAction.label,
        primary_url: brand.hero.primaryAction.href,
        secondary_label: brand.hero.secondaryAction?.label || "",
        secondary_url: brand.hero.secondaryAction?.href || ""
      }
    }
  };
  const order = ["hero"];

  brand.sections.forEach((section, index) => {
    const id = sectionId(index, section.type);
    const base = {
      type: section.type,
      settings: {
        anchor_id: section.id || section.type,
        eyebrow: section.eyebrow || "",
        title: section.title || "",
        body: section.body || ""
      }
    };
    if (section.media) base.settings.fallback_asset = `brand-${section.media.split("/").at(-1)}`;
    if (section.action) {
      base.settings.action_label = section.action.label;
      base.settings.action_url = section.action.href;
    }
    if (section.type === "product-grid") base.settings.product_handles = (section.productIds || []).join(",");
    if (["proof-strip", "steps", "testimonials", "comparison"].includes(section.type)) {
      base.blocks = blocks(section.items, (item) => item);
      base.block_order = Object.keys(base.blocks);
    }
    sections[id] = base;
    order.push(id);
  });

  return JSON.stringify({ sections, order }, null, 2);
}

function csvCell(value) {
  const string = value == null ? "" : String(value);
  return /[",\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

function skuPart(value = "default") {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "default";
}

function optionValue(value) {
  return typeof value === "string"
    ? { label: value, priceModifier: 0 }
    : { label: value.label, priceModifier: value.priceModifier || 0 };
}

function assertValidShopifyImageColumns(header, rows) {
  const sourceIndex = header.indexOf("Image Src");
  const positionIndex = header.indexOf("Image Position");
  const altIndex = header.indexOf("Image Alt Text");
  for (const [index, row] of rows.entries()) {
    const source = String(row[sourceIndex] ?? "").trim();
    const position = String(row[positionIndex] ?? "").trim();
    const alt = String(row[altIndex] ?? "").trim();
    if (!source && (position || alt)) {
      throw new Error(`Shopify CSV row ${index + 2} includes image metadata without Image Src`);
    }
  }
}

export function combineShopifyProductCsv(documents) {
  if (!Array.isArray(documents) || !documents.length) throw new Error("At least one Shopify CSV is required");
  let expectedHeader = "";
  const bodies = documents.map((document, index) => {
    const normalized = String(document).replace(/^\uFEFF/, "").trimEnd();
    const firstLineBreak = normalized.indexOf("\n");
    if (firstLineBreak < 0) throw new Error(`Shopify CSV ${index + 1} has no product rows`);
    const header = normalized.slice(0, firstLineBreak).replace(/\r$/, "");
    if (!expectedHeader) expectedHeader = header;
    if (header !== expectedHeader) throw new Error(`Shopify CSV ${index + 1} has a different header`);
    return normalized.slice(firstLineBreak + 1);
  });
  return [expectedHeader, ...bodies].join("\n");
}

export function productVariants(product) {
  const options = (product.options || []).slice(0, 3);
  if (!options.length) return [{ values: [{ label: "Default Title", priceModifier: 0 }], price: product.price }];
  return options.reduce((variants, option) => variants.flatMap((variant) => option.values.map((rawValue) => {
    const value = optionValue(rawValue);
    return { values: [...variant.values, value], price: variant.price + value.priceModifier };
  })), [{ values: [], price: product.price }]);
}

export function shopifyProductCsv(brand, catalog) {
  const header = ["Handle", "Title", "Body (HTML)", "Vendor", "Product Category", "Type", "Tags", "Published", "Option1 Name", "Option1 Value", "Option2 Name", "Option2 Value", "Option3 Name", "Option3 Value", "Variant SKU", "Variant Price", "Variant Compare At Price", "Variant Requires Shipping", "Variant Taxable", "Image Src", "Image Position", "Image Alt Text", "Status"];
  const rows = catalog.products.flatMap((product) => {
    const options = (product.options || []).slice(0, 3);
    return productVariants(product).map((variant, index) => {
      const optionFields = [0, 1, 2].flatMap((optionIndex) => {
        if (optionIndex === 0 && !options.length) return ["Title", "Default Title"];
        return [options[optionIndex]?.name || "", variant.values[optionIndex]?.label || ""];
      });
      const modifier = variant.price - product.price;
      return [
        product.id,
        index === 0 ? product.name : "",
        index === 0 ? `<p>${escapeHtml(product.description)}</p>` : "",
        index === 0 ? brand.displayName : "",
        "",
        index === 0 ? product.category : "",
        index === 0 ? [product.category, product.badge].filter(Boolean).join(", ") : "",
        index === 0 ? "TRUE" : "",
        ...optionFields,
        `${brand.id}-${product.id}-${variant.values.map((value) => skuPart(value.label)).join("-")}`,
        (variant.price / 100).toFixed(2),
        product.compareAtPrice ? ((product.compareAtPrice + modifier) / 100).toFixed(2) : "",
        "TRUE",
        "TRUE",
        "",
        "",
        "",
        index === 0 ? "active" : ""
      ];
    });
  });
  assertValidShopifyImageColumns(header, rows);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

export function wooProductCsv(brand, catalog) {
  const attributeHeaders = [1, 2, 3].flatMap((index) => [`Attribute ${index} name`, `Attribute ${index} value(s)`, `Attribute ${index} visible`, `Attribute ${index} global`]);
  const header = ["Type", "SKU", "Name", "Published", "Is featured?", "Visibility in catalog", "Short description", "Description", "Regular price", "Sale price", "Categories", "Tags", "Images", "Parent", ...attributeHeaders];
  const rows = catalog.products.flatMap((product) => {
    const options = (product.options || []).slice(0, 3);
    const variants = productVariants(product);
    const parentSku = `${brand.id}-${product.id}`;
    const isVariable = variants.length > 1;
    const parentAttributes = [0, 1, 2].flatMap((index) => {
      const option = options[index];
      return option ? [option.name, option.values.map((value) => optionValue(value).label).join(", "), 1, 0] : ["", "", "", ""];
    });
    const parent = [
      isVariable ? "variable" : "simple",
      parentSku,
      product.name,
      1,
      0,
      "visible",
      product.description,
      product.description,
      isVariable ? "" : ((product.compareAtPrice || product.price) / 100).toFixed(2),
      isVariable || !product.compareAtPrice ? "" : (product.price / 100).toFixed(2),
      product.category,
      product.badge || "",
      "",
      "",
      ...parentAttributes
    ];
    if (!isVariable) return [parent];
    const variations = variants.map((variant) => {
      const modifier = variant.price - product.price;
      const attributes = [0, 1, 2].flatMap((index) => options[index] ? [options[index].name, variant.values[index].label, 1, 0] : ["", "", "", ""]);
      return [
        "variation",
        `${parentSku}-${variant.values.map((value) => skuPart(value.label)).join("-")}`,
        `${product.name} - ${variant.values.map((value) => value.label).join(" / ")}`,
        1,
        0,
        "visible",
        "",
        "",
        (((product.compareAtPrice || product.price) + modifier) / 100).toFixed(2),
        product.compareAtPrice ? (variant.price / 100).toFixed(2) : "",
        "",
        "",
        "",
        parentSku,
        ...attributes
      ];
    });
    return [parent, ...variations];
  });
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

export function brandCss(brand) {
  return `:root{--ink:${brand.palette.ink};--paper:${brand.palette.paper};--muted:${brand.palette.muted};--accent:${brand.palette.accent};--accent-contrast:${brand.palette.accentContrast};--line:${brand.palette.line};--surface:${brand.palette.surface};--soft:${brand.palette.soft};--font-display:${brand.typography.display};--font-body:${brand.typography.body};}`;
}

export function shopifyFixtureImageSnippet(catalog) {
  const cases = catalog.products.map((product) => {
    const asset = `brand-${product.image.split("/").at(-1)}`;
    return `  {% when '${product.id}' %}{% assign fixture_asset = '${asset}' %}`;
  }).join("\n");
  return `{% comment %}Build-time fallback media for an imported product that has no Shopify media yet.{% endcomment %}
{% assign fixture_asset = blank %}
{% case product.handle %}
${cases}
{% endcase %}
{% if fixture_asset != blank %}<img src="{{ fixture_asset | asset_url }}" alt="{{ product.title | escape }}" width="900" height="1100" loading="{{ loading | default: 'lazy' }}">{% else %}{{ 'product-1' | placeholder_svg_tag }}{% endif %}`;
}

export function shopifyFallbackNavigationSnippet(brand) {
  return brand.navigation.map((item) => {
    const href = item.href.startsWith("#") ? `{{ routes.root_url }}${item.href}` : escapeHtml(item.href);
    return `<a href="${href}">${escapeHtml(item.label)}</a>`;
  }).join("\n");
}

export function shopifyFallbackFooterSnippet(brand) {
  return (brand.footer?.links || []).map((item) => {
    const href = item.href.startsWith("#") ? `{{ routes.root_url }}${item.href}` : escapeHtml(item.href);
    return `<a href="${href}">${escapeHtml(item.label)}</a>`;
  }).join("\n");
}
