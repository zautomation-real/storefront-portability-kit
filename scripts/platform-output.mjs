import { escapeHtml, productBodyHtml, productMediaFocalPoint } from "./lib.mjs";
import { productOptionPresentations } from "./option-presentation.mjs";

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
    if (section.type === "product-grid") {
      const shopifyCatalog = section.shopifyCatalog || {};
      base.settings.product_handles = (section.productIds || []).join(",");
      base.settings.catalog_source = shopifyCatalog.mode || "managed";
      base.settings.optional_collection = shopifyCatalog.collectionHandle || "";
      base.settings.maximum_products = shopifyCatalog.productLimit || 6;
    }
    if (["proof-strip", "steps", "testimonials", "comparison"].includes(section.type)) {
      base.blocks = blocks(section.items, (item) => item);
      base.block_order = Object.keys(base.blocks);
    }
    sections[id] = base;
    order.push(id);
  });

  return JSON.stringify({ sections, order }, null, 2);
}

export function shopifyPasswordTemplate(brand) {
  return JSON.stringify({
    sections: {
      main: {
        type: "main-password",
        settings: {
          eyebrow: "Private preview",
          title: brand.displayName,
          body: "This storefront is being prepared. Enter the preview password to continue.",
          fallback_asset: `brand-${brand.hero.media.split("/").at(-1)}`,
          password_label: "Store password",
          button_label: "Enter store"
        }
      }
    },
    order: ["main"]
  }, null, 2);
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

function scriptSafeJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

export function shopifyVariantSku(brand, product, variant) {
  return `${brand.id}-${product.id}-${variant.values.map((value) => skuPart(value.label)).join("-")}`;
}

export function assertUniqueShopifyVariantSkus(brand, catalog) {
  const owners = new Map();
  for (const product of catalog.products) {
    for (const variant of productVariants(product)) {
      const sku = shopifyVariantSku(brand, product, variant);
      const label = `${product.id} / ${variant.values.map((value) => value.label).join(" / ")}`;
      const earlier = owners.get(sku);
      if (earlier) {
        throw new Error(`Shopify variant SKU collision: ${sku} is produced by both ${earlier} and ${label}`);
      }
      owners.set(sku, label);
    }
  }
}

function selectionFor(product, values = []) {
  return Object.fromEntries((product.options || []).map((option, index) => [option.name, values[index]?.label ?? values[index]]));
}

function variantMediaRules(product) {
  return Array.isArray(product.variantMedia) ? product.variantMedia : [];
}

export function validateVariantMediaRules(product) {
  if (product.variantMedia != null && !Array.isArray(product.variantMedia)) {
    throw new Error(`${product.id || product.name || "product"} variantMedia must be an array`);
  }
  const valuesByOption = new Map((product.options || []).map((option) => [
    option.name,
    new Set((option.values || []).map((value) => optionValue(value).label))
  ]));
  const fingerprints = new Set();
  for (const [index, rule] of variantMediaRules(product).entries()) {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      throw new Error(`${product.id || product.name || "product"} variantMedia rule ${index + 1} must be an object`);
    }
    if (!rule.match || typeof rule.match !== "object" || Array.isArray(rule.match) || !Object.keys(rule.match).length) {
      throw new Error(`${product.id || product.name || "product"} variantMedia rule ${index + 1} needs a match`);
    }
    const fingerprint = JSON.stringify(Object.entries(rule.match).sort(([left], [right]) => left.localeCompare(right)));
    if (fingerprints.has(fingerprint)) {
      throw new Error(`${product.id || product.name || "product"} has duplicate variantMedia rules`);
    }
    fingerprints.add(fingerprint);
    for (const [name, value] of Object.entries(rule.match)) {
      if (!valuesByOption.has(name)) throw new Error(`${product.id || product.name || "product"} variantMedia references missing option ${name}`);
      if (!valuesByOption.get(name).has(value)) throw new Error(`${product.id || product.name || "product"} variantMedia references missing value ${name}=${value}`);
    }
    if (typeof rule.image !== "string" || !rule.image.trim()) {
      throw new Error(`${product.id || product.name || "product"} variantMedia rule ${index + 1} needs an image`);
    }
    if (rule.alt != null && (typeof rule.alt !== "string" || !rule.alt.trim())) {
      throw new Error(`${product.id || product.name || "product"} variantMedia rule ${index + 1} has an invalid alt`);
    }
  }
  if (product.cardMediaSelector != null) {
    const selector = product.cardMediaSelector;
    if (!selector || typeof selector !== "object" || Array.isArray(selector)) {
      throw new Error(`${product.id || product.name || "product"} cardMediaSelector must be an object`);
    }
    const cardOption = (product.options || []).find((option) => option.name === selector.option);
    if (!cardOption) {
      throw new Error(`${product.id || product.name || "product"} cardMediaSelector references missing option ${selector.option}`);
    }
    if (!Array.isArray(selector.choices) || selector.choices.length < 2) {
      throw new Error(`${product.id || product.name || "product"} cardMediaSelector needs at least two choices`);
    }
    const allowedValues = new Set(cardOption.values.map((value) => optionValue(value).label));
    const selectedValues = new Set();
    for (const choice of selector.choices) {
      if (!choice || typeof choice !== "object" || !allowedValues.has(choice.value)) {
        throw new Error(`${product.id || product.name || "product"} cardMediaSelector references missing value ${selector.option}=${choice?.value}`);
      }
      if (selectedValues.has(choice.value)) {
        throw new Error(`${product.id || product.name || "product"} cardMediaSelector has duplicate value ${choice.value}`);
      }
      if (typeof choice.swatch !== "string" || !/^#[0-9a-f]{6}$/i.test(choice.swatch)) {
        throw new Error(`${product.id || product.name || "product"} cardMediaSelector choice ${choice.value} needs a six-digit hex swatch`);
      }
      selectedValues.add(choice.value);
    }
    const cards = cardMediaItems(product, cardOption, selector.choices);
    if (new Set(cards.map((item) => item.image)).size !== cards.length) {
      throw new Error(`${product.id || product.name || "product"} cardMediaSelector must resolve every choice to different media`);
    }
  }
}

export function resolveVariantMedia(product, values = []) {
  const selection = Array.isArray(values) ? selectionFor(product, values) : values;
  const matches = variantMediaRules(product)
    .map((rule, index) => ({ rule, index, specificity: Object.keys(rule.match || {}).length }))
    .filter(({ rule }) => Object.entries(rule.match || {}).every(([name, value]) => selection?.[name] === value))
    .sort((left, right) => right.specificity - left.specificity || left.index - right.index);

  if (matches.length > 1 && matches[0].specificity === matches[1].specificity) {
    const labels = Object.entries(selection || {}).map(([name, value]) => `${name}=${value}`).join(", ");
    throw new Error(`${product.id || product.name || "product"} has ambiguous variantMedia rules for ${labels || "its default variant"}`);
  }

  const selected = matches[0]?.rule;
  return {
    image: selected?.image || product.image,
    alt: selected?.alt || product.name
  };
}

function cardMediaItems(product, option, choices) {
  const options = product.options || [];
  const optionIndex = options.indexOf(option);
  const defaults = options.map((candidate) => optionValue(candidate.values[0]).label);
  return choices.map((choice) => {
    const value = choice.value;
    const selectedValues = defaults.map((defaultValue, index) => index === optionIndex ? value : defaultValue);
    const selection = Object.fromEntries(options.map((candidate, index) => [candidate.name, selectedValues[index]]));
    return { optionName: option.name, optionIndex, selectedValues, label: value, swatch: choice.swatch, ...resolveVariantMedia(product, selection) };
  });
}

export function cardMediaChoices(product) {
  if (product.cardMediaSelector == null) return [];
  validateVariantMediaRules(product);
  const option = (product.options || []).find((candidate) => candidate.name === product.cardMediaSelector.option);
  return cardMediaItems(product, option, product.cardMediaSelector.choices);
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
  validateVariantMediaRules(product);
  const options = (product.options || []).slice(0, 3);
  if (!options.length) {
    const values = [{ label: "Default Title", priceModifier: 0 }];
    return [{ values, price: product.price, media: resolveVariantMedia(product, {}) }];
  }
  const variants = options.reduce((current, option) => current.flatMap((variant) => option.values.map((rawValue) => {
    const value = optionValue(rawValue);
    return { values: [...variant.values, value], price: variant.price + value.priceModifier };
  })), [{ values: [], price: product.price }]);
  return variants.map((variant) => ({ ...variant, media: resolveVariantMedia(product, variant.values) }));
}

export function shopifyProductCsv(brand, catalog) {
  assertUniqueShopifyVariantSkus(brand, catalog);
  const header = ["Handle", "Title", "Body (HTML)", "Vendor", "Product Category", "Type", "Tags", "Published", "Option1 Name", "Option1 Value", "Option2 Name", "Option2 Value", "Option3 Name", "Option3 Value", "Variant SKU", "Variant Price", "Variant Compare At Price", "Variant Requires Shipping", "Variant Taxable", "Image Src", "Image Position", "Image Alt Text", "Variant Image", "Status"];
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
        index === 0 ? productBodyHtml(product) : "",
        index === 0 ? brand.displayName : "",
        "",
        index === 0 ? product.category : "",
        index === 0 ? [product.category, product.badge].filter(Boolean).join(", ") : "",
        index === 0 ? "TRUE" : "",
        ...optionFields,
        shopifyVariantSku(brand, product, variant),
        (variant.price / 100).toFixed(2),
        product.compareAtPrice ? ((product.compareAtPrice + modifier) / 100).toFixed(2) : "",
        "TRUE",
        "TRUE",
        "",
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

export function shopifyMediaManifest(brand, catalog) {
  assertUniqueShopifyVariantSkus(brand, catalog);
  const products = {};
  const variants = {};
  for (const product of catalog.products) {
    products[product.id] = { image: product.image, alt: product.name };
    for (const variant of productVariants(product)) {
      const sku = shopifyVariantSku(brand, product, variant);
      variants[sku] = {
        handle: product.id,
        image: variant.media.image,
        alt: variant.media.alt
      };
    }
  }
  return JSON.stringify({ version: 1, products, variants }, null, 2);
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
      escapeHtml(product.description),
      productBodyHtml(product),
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
  return `:root{--ink:${brand.palette.ink};--paper:${brand.palette.paper};--muted:${brand.palette.muted};--accent:${brand.palette.accent};--accent-contrast:${brand.palette.accentContrast};--line:${brand.palette.line};--surface:${brand.palette.surface};--soft:${brand.palette.soft};--font-display:${brand.typography.display};--font-body:${brand.typography.body};--product-media-focus:${productMediaFocalPoint(brand)};}`;
}

function liquidVariantCondition(product, rule) {
  return Object.entries(rule.match).map(([name, value]) => {
    const optionIndex = (product.options || []).findIndex((option) => option.name === name);
    return `variant.option${optionIndex + 1} == ${JSON.stringify(value)}`;
  }).join(" and ");
}

function sortedVariantMediaRules(product) {
  validateVariantMediaRules(product);
  return variantMediaRules(product)
    .map((rule, index) => ({ ...rule, index, specificity: Object.keys(rule.match).length }))
    .sort((left, right) => right.specificity - left.specificity || left.index - right.index);
}

export function shopifyFixtureImageSnippet(catalog) {
  const cases = catalog.products.map((product) => {
    const baseAsset = `brand-${product.image.split("/").at(-1)}`;
    const rules = sortedVariantMediaRules(product).map((rule, index) => {
      const keyword = index === 0 ? "if" : "elsif";
      const ruleAsset = `brand-${rule.image.split("/").at(-1)}`;
      return `    {% ${keyword} ${liquidVariantCondition(product, rule)} %}\n      {% assign fixture_variant_asset = '${ruleAsset}' %}\n      {% assign fixture_variant_alt = ${JSON.stringify(rule.alt || product.name)} %}`;
    }).join("\n");
    const ruleBlock = rules ? `\n  {% if variant != blank %}\n${rules}\n    {% endif %}\n  {% endif %}` : "";
    return `  {% when '${product.id}' %}\n  {% assign fixture_base_asset = '${baseAsset}' %}\n  {% assign fixture_base_alt = ${JSON.stringify(product.name)} %}${ruleBlock}`;
  }).join("\n");
  return `{% comment %}Build-time fallback media for an imported product that has no Shopify media yet.{% endcomment %}
{% assign fixture_base_asset = blank %}
{% assign fixture_base_alt = product.title %}
{% assign fixture_variant_asset = blank %}
{% assign fixture_variant_alt = product.title %}
{% assign fixture_loading = loading | default: 'lazy' %}
{% case product.handle %}
${cases}
{% endcase %}
{% if fixture_variant_asset != blank %}<img src="{{ fixture_variant_asset | asset_url }}" alt="{{ fixture_variant_alt | escape }}" width="900" height="1100" loading="{{ fixture_loading }}">{% elsif product.featured_image %}{{ product.featured_image | image_url: width: 1400 | image_tag: widths: '500,800,1100,1400', loading: fixture_loading, alt: product.title }}{% elsif fixture_base_asset != blank %}<img src="{{ fixture_base_asset | asset_url }}" alt="{{ fixture_base_alt | escape }}" width="900" height="1100" loading="{{ fixture_loading }}">{% else %}{{ 'product-1' | placeholder_svg_tag }}{% endif %}`;
}

export function shopifyVariantMediaJsonSnippet(catalog) {
  const cases = catalog.products.map((product) => {
    const fallbackAsset = `brand-${product.image.split("/").at(-1)}`;
    const rules = sortedVariantMediaRules(product).map((rule) => {
      const asset = `brand-${rule.image.split("/").at(-1)}`;
      return `{"match":${scriptSafeJson(rule.match)},"src":{{ '${asset}' | asset_url | json }},"alt":${scriptSafeJson(rule.alt || product.name)},"width":900,"height":1100}`;
    }).join(",");
    return `{% when '${product.id}' %}{"optionNames":${scriptSafeJson((product.options || []).map((option) => option.name))},"fallback":{"src":{{ '${fallbackAsset}' | asset_url | json }},"alt":${scriptSafeJson(product.name)},"width":900,"height":1100},"rules":[${rules}]}`;
  }).join("\n");
  return `{% case product.handle %}\n${cases}\n{% else %}{}\n{% endcase %}`;
}

export function shopifyOptionPresentationsSnippet(catalog) {
  const cases = catalog.products
    .map((product) => ({ id: product.id, presentations: productOptionPresentations(product) }))
    .filter(({ presentations }) => presentations.length)
    .map(({ id, presentations }) => `{% when '${id}' %}${scriptSafeJson(presentations)}`)
    .join("\n");
  return `{% case product.handle %}\n${cases}\n{% else %}[]\n{% endcase %}`;
}

export function shopifyCardMediaSelectorSnippet(catalog) {
  const cases = catalog.products
    .filter((product) => product.cardMediaSelector != null)
    .map((product) => {
      const controls = cardMediaChoices(product).map((item, index) => {
        const asset = `brand-${item.image.split("/").at(-1)}`;
        const condition = item.selectedValues
          .map((value, optionIndex) => `candidate_variant.option${optionIndex + 1} == ${JSON.stringify(value)}`)
          .join(" and ");
        return `{% assign card_media_variant = blank %}{% for candidate_variant in product.variants %}{% if ${condition} %}{% assign card_media_variant = candidate_variant %}{% break %}{% endif %}{% endfor %}<button class="product-card__media-choice" type="button" data-card-media-choice data-card-media-image="{% if card_media_variant.featured_image %}{{ card_media_variant.featured_image | image_url: width: 900 | escape }}{% else %}{{ '${asset}' | asset_url | escape }}{% endif %}" data-card-media-alt="{% if card_media_variant.featured_image.alt != blank %}{{ card_media_variant.featured_image.alt | escape }}{% else %}${escapeHtml(item.alt)}{% endif %}" data-card-media-default="${index === 0}" aria-label="Preview ${escapeHtml(product.name)} in ${escapeHtml(item.label)}" aria-pressed="${index === 0}" title="${escapeHtml(item.label)}" style="--card-swatch:${escapeHtml(item.swatch)}"></button>`;
      }).join("");
      return `{% when '${product.id}' %}<div class="product-card__media-selector" data-card-media-selector role="group" aria-label="Preview ${escapeHtml(product.cardMediaSelector.option)}">${controls}</div>`;
    }).join("\n");
  return `{% case product.handle %}\n${cases}\n{% endcase %}`;
}

function shopifyDestination(href) {
  const destination = String(href || "").trim();
  if (destination.startsWith("#")) return `{{ routes.root_url }}${escapeHtml(destination)}`;
  if (destination.startsWith("/") || /^(?:https?:|mailto:|tel:)/i.test(destination)) return escapeHtml(destination);
  return `{{ routes.root_url }}${escapeHtml(destination)}`;
}

export function shopifyFallbackNavigationSnippet(brand) {
  const navigation = brand.navigation.map((item) => `<a href="${shopifyDestination(item.href)}">${escapeHtml(item.label)}</a>`);
  const destinations = brand.navigation.map((item) => String(item.href || "").toLowerCase());
  const hasCatalogLink = destinations.some((href) => href.startsWith("#shop") || href.includes("collections") || href.includes("products"));
  const hasSearchLink = destinations.some((href) => href.includes("search"));

  if (!hasCatalogLink) navigation.push('<a href="{{ routes.all_products_collection_url }}">Catalog</a>');
  if (!hasSearchLink) navigation.push('<a href="{{ routes.search_url }}">Search</a>');
  return navigation.join("\n");
}

export function shopifyFallbackFooterSnippet(brand) {
  return (brand.footer?.links || []).map((item) => {
    return `<a href="${shopifyDestination(item.href)}">${escapeHtml(item.label)}</a>`;
  }).join("\n");
}
