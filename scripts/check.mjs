import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { isSafeSlug, parseArgs, readJson, resolveWooCommercePaths, resolveWorkspacePaths, root } from "./lib.mjs";
import { assertUniqueShopifyVariantSkus, productVariants } from "./platform-output.mjs";
import { readCatalogSource } from "./catalog-source.mjs";

const args = parseArgs(process.argv.slice(2));
const { brandsRoot } = resolveWorkspacePaths(args);
const { adapterRoot: wooCommerceAdapterRoot, seedFile: wooCommerceSeedFile } = resolveWooCommercePaths(args);
const shopifyRoot = path.join(root, "adapters", "shopify");
const wooRenderer = wooCommerceAdapterRoot
  ? await readFile(path.join(wooCommerceAdapterRoot, "inc", "storefront-kit.php"), "utf8")
  : undefined;
const wooHeader = wooCommerceAdapterRoot ? await readFile(path.join(wooCommerceAdapterRoot, "header.php"), "utf8") : undefined;
const wooFunctions = wooCommerceAdapterRoot ? await readFile(path.join(wooCommerceAdapterRoot, "functions.php"), "utf8") : undefined;
const wooScript = wooCommerceAdapterRoot ? await readFile(path.join(wooCommerceAdapterRoot, "assets", "woocommerce.js"), "utf8") : undefined;
const wooStyles = wooCommerceAdapterRoot ? await readFile(path.join(wooCommerceAdapterRoot, "assets", "woocommerce.css"), "utf8") : undefined;
const wooSeed = wooCommerceSeedFile ? await readFile(wooCommerceSeedFile, "utf8") : undefined;
const supportedSections = ["proof-strip", "product-grid", "editorial-split", "steps", "testimonials", "comparison", "newsletter"];
const entries = await readdir(brandsRoot, { withFileTypes: true });
const brands = entries.filter((item) => item.isDirectory());
const errors = [];

function fail(scope, message) {
  errors.push(`${scope}: ${message}`);
}

function isNonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function optionValue(value) {
  return typeof value === "string"
    ? { label: value, priceModifier: 0 }
    : { label: value?.label, priceModifier: value?.priceModifier || 0 };
}

async function checkAsset(brandDir, scope, relative) {
  if (!isNonEmpty(relative) || !/^assets\/[a-z0-9][a-z0-9._-]*$/i.test(relative)) {
    fail(scope, `invalid asset path ${JSON.stringify(relative)}`);
    return;
  }
  const absolute = path.resolve(brandDir, relative);
  if (!absolute.startsWith(`${path.resolve(brandDir)}${path.sep}`)) {
    fail(scope, `asset escapes its brand directory: ${relative}`);
    return;
  }
  try {
    const details = await stat(absolute);
    if (!details.isFile() || details.size < 500) fail(scope, `asset is missing or empty: ${relative}`);
  } catch {
    fail(scope, `asset does not exist: ${relative}`);
  }
}

for (const entry of brands) {
  const id = entry.name;
  const brandDir = path.join(brandsRoot, id);
  let brand;
  let catalog;
  try {
    brand = await readJson(path.join(brandDir, "brand.json"));
  } catch (error) {
    fail(id, `invalid brand JSON (${error.message})`);
    continue;
  }
  try {
    ({ catalog } = await readCatalogSource(brandDir));
  } catch (error) {
    fail(id, `invalid catalog source (${error.message})`);
    continue;
  }

  if (!isSafeSlug(id)) fail(id, "brand directory must use lowercase letters, numbers and single hyphens only");
  if (brand.id !== id) fail(id, "brand.id must match its directory");
  if (!isSafeSlug(brand.id)) fail(id, "brand.id must use lowercase letters, numbers and single hyphens only");
  for (const key of ["displayName", "vertical", "locale", "currency", "announcement"]) {
    if (!isNonEmpty(brand[key])) fail(id, `${key} is required`);
  }
  if (brand.presentation != null && (typeof brand.presentation !== "object" || Array.isArray(brand.presentation))) {
    fail(id, "presentation must be an object");
  } else {
    if (brand.presentation?.layout != null && !["standard", "editorial", "technical"].includes(brand.presentation.layout)) {
      fail(id, `unsupported presentation.layout ${brand.presentation.layout}`);
    }
    if (brand.presentation?.productZoom != null && !["click", "hover"].includes(brand.presentation.productZoom)) {
      fail(id, `unsupported presentation.productZoom ${brand.presentation.productZoom}`);
    }
  }
  for (const token of ["ink", "paper", "muted", "accent", "accentContrast", "line", "surface", "soft"]) {
    if (!isNonEmpty(brand.palette?.[token])) fail(id, `palette.${token} is required`);
  }
  if (!Array.isArray(brand.navigation) || brand.navigation.length < 3) fail(id, "at least 3 navigation entries are required");
  if (!Array.isArray(brand.sections) || brand.sections.length < 4) fail(id, "at least 4 commercial sections are required");
  if (!Array.isArray(catalog.products) || catalog.products.length < 3) fail(id, "catalog must include at least 3 products");

  await checkAsset(brandDir, `${id}/hero`, brand.hero?.media);

  const productIds = new Set();
  for (const product of catalog.products || []) {
    const scope = `${id}/${product.id || "product"}`;
    if (!isSafeSlug(product.id)) fail(scope, "product id must use lowercase letters, numbers and single hyphens only");
    if (productIds.has(product.id)) fail(scope, `duplicate product id ${product.id}`);
    productIds.add(product.id);
    if (!isNonEmpty(product.name) || !isNonEmpty(product.category) || !isNonEmpty(product.description)) fail(scope, "name, category and description are required");
    if (product.details != null) {
      if (!Array.isArray(product.details) || !product.details.length) {
        fail(scope, "details must be a non-empty array when supplied");
      } else {
        for (const [index, detail] of product.details.entries()) {
          const detailScope = `${scope}/details:${index + 1}`;
          if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
            fail(detailScope, "detail must be an object");
          } else if (!isNonEmpty(detail.title) || !isNonEmpty(detail.body)) {
            fail(detailScope, "title and body are required");
          }
        }
      }
    }
    if (!Number.isInteger(product.price) || product.price < 0) fail(scope, "price must use non-negative minor currency units");
    if (product.compareAtPrice != null && (!Number.isInteger(product.compareAtPrice) || product.compareAtPrice <= product.price)) fail(scope, "compareAtPrice must be an integer above price");
    await checkAsset(brandDir, scope, product.image);

    const options = product.options || [];
    if (!Array.isArray(options) || options.length > 3) fail(scope, "products support at most 3 options");
    const optionNames = new Set();
    const optionValuesByName = new Map();
    for (const option of options) {
      if (!isNonEmpty(option.name)) fail(scope, "each option needs a name");
      if (optionNames.has(option.name)) fail(scope, `duplicate option name ${option.name}`);
      optionNames.add(option.name);
      if (!Array.isArray(option.values) || !option.values.length) fail(scope, `${option.name || "option"} needs at least one value`);
      const values = new Set();
      for (const rawValue of option.values || []) {
        const value = optionValue(rawValue);
        if (!isNonEmpty(value.label)) fail(scope, `${option.name || "option"} contains an empty value`);
        if (values.has(value.label)) fail(scope, `${option.name || "option"} repeats ${value.label}`);
        values.add(value.label);
        if (!Number.isInteger(value.priceModifier)) fail(scope, `${option.name || "option"}/${value.label} priceModifier must be an integer`);
        if (product.price + value.priceModifier < 0) fail(scope, `${option.name || "option"}/${value.label} produces a negative price`);
      }
      optionValuesByName.set(option.name, values);
    }

    const mediaRules = product.variantMedia || [];
    if (!Array.isArray(mediaRules)) {
      fail(scope, "variantMedia must be an array");
    } else {
      const fingerprints = new Set();
      for (const [index, rule] of mediaRules.entries()) {
        const ruleScope = `${scope}/variantMedia:${index + 1}`;
        if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
          fail(ruleScope, "rule must be an object");
          continue;
        }
        const match = rule.match;
        if (!match || typeof match !== "object" || Array.isArray(match) || !Object.keys(match).length) {
          fail(ruleScope, "match must contain at least one option");
        } else {
          const fingerprint = JSON.stringify(Object.entries(match).sort(([left], [right]) => left.localeCompare(right)));
          if (fingerprints.has(fingerprint)) fail(ruleScope, "duplicates an earlier match rule");
          fingerprints.add(fingerprint);
          for (const [name, value] of Object.entries(match)) {
            if (!optionValuesByName.has(name)) fail(ruleScope, `references missing option ${name}`);
            else if (!optionValuesByName.get(name).has(value)) fail(ruleScope, `references missing value ${name}=${value}`);
          }
        }
        if (rule.alt != null && !isNonEmpty(rule.alt)) fail(ruleScope, "alt must be non-empty text when supplied");
        await checkAsset(brandDir, ruleScope, rule.image);
      }
    }
    try {
      const variants = productVariants(product);
      if (variants.length > 100) fail(scope, `${variants.length} variants exceed the 100-variant fixture limit`);
      if (variants.some((variant) => !Number.isInteger(variant.price) || variant.price < 0)) fail(scope, "every generated variant needs a valid price");
    } catch (error) {
      fail(scope, error.message);
    }
  }

  if (Array.isArray(catalog.products)) {
    try {
      assertUniqueShopifyVariantSkus(brand, catalog);
    } catch (error) {
      fail(id, error.message);
    }
  }

  const anchors = new Set(["top"]);
  for (const section of brand.sections || []) {
    const scope = `${id}/section:${section.id || section.type || "unknown"}`;
    if (!supportedSections.includes(section.type)) fail(scope, `unsupported section type ${section.type}`);
    if (!isSafeSlug(section.id)) fail(scope, "section id must use lowercase letters, numbers and single hyphens only");
    if (anchors.has(section.id)) fail(scope, `duplicate section id ${section.id}`);
    anchors.add(section.id);
    if (section.media) await checkAsset(brandDir, scope, section.media);
    if (section.type === "product-grid") {
      if (!Array.isArray(section.productIds) || !section.productIds.length) fail(scope, "product-grid needs productIds");
      for (const productId of section.productIds || []) if (!productIds.has(productId)) fail(scope, `references missing product ${productId}`);
    }
    if (["proof-strip", "steps", "testimonials", "comparison"].includes(section.type) && (!Array.isArray(section.items) || !section.items.length)) {
      fail(scope, `${section.type} needs items`);
    }
  }

  const actions = [...(brand.navigation || []), brand.hero?.primaryAction, brand.hero?.secondaryAction, ...(brand.sections || []).map((section) => section.action), ...(brand.footer?.links || [])].filter(Boolean);
  for (const item of actions) {
    if (!isNonEmpty(item.label) || !isNonEmpty(item.href)) fail(id, "navigation and actions need label and href");
    if (item.href?.startsWith("#") && item.href !== "#" && !anchors.has(item.href.slice(1))) fail(id, `link targets missing anchor ${item.href}`);
  }
}

for (const type of supportedSections) {
  try {
    await stat(path.join(shopifyRoot, "sections", `${type}.liquid`));
  } catch {
    fail("shopify", `missing section adapter ${type}.liquid`);
  }
  if (wooRenderer && !wooRenderer.includes(`$type === '${type}'`)) fail("woocommerce", `missing section renderer for ${type}`);
}

if (wooCommerceAdapterRoot) {
  if (!wooHeader?.includes('data-layout="')) fail("woocommerce", "header must expose the shared layout preset");
  if (!wooHeader?.includes('data-platform="woocommerce"')) fail("woocommerce", "header must identify the WooCommerce runtime");
  if (!wooRenderer?.includes("data-card-media-selector") || !wooRenderer?.includes("sfk_resolve_variant_media")) {
    fail("woocommerce", "product cards must implement the shared variant-media selector contract");
  }
  if (!wooFunctions?.includes("woocommerce_add_to_cart_fragments")) fail("woocommerce", "bag count must refresh after native AJAX additions");
  if (!wooFunctions?.includes("assets/woocommerce.js")) fail("woocommerce", "native variation controls must load their adapter runtime");
  if (!wooScript?.includes("woocommerce_update_variation_values")) fail("woocommerce", "visual option controls must stay synchronized with native variations");
  if (!wooScript?.includes("wc-blocks_removed_from_cart") || !wooScript?.includes("wc/store/v1/cart")) {
    fail("woocommerce", "bag count must stay synchronized with native Cart and Checkout blocks");
  }
  if (!wooScript?.includes("data-woo-engraving-property") || !wooFunctions?.includes("woocommerce_add_cart_item_data") || !wooFunctions?.includes("woocommerce_checkout_create_order_line_item")) {
    fail("woocommerce", "engraving choices must collect, validate and preserve their native line-item text");
  }
  if (!wooStyles?.includes(".woocommerce div.product div.images") || !wooStyles?.includes(".sfk-native-variation-select")) {
    fail("woocommerce", "native product layouts must reset WooCommerce widths and preserve accessible visual options");
  }
  if (!wooSeed?.includes("sfk_seed_resolve_variant_media") || !wooSeed?.includes("set_image_id($variation_image_id)")) {
    fail("woocommerce", "the catalogue seed must assign resolved media to every native variation");
  }
  if (!wooSeed?.includes("sfk_seed_sku_part")) fail("woocommerce", "seeded variation SKUs must match the portable CSV convention");
}

for (const directory of [path.join(shopifyRoot, "config"), path.join(shopifyRoot, "templates")]) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || path.extname(entry.name) !== ".json") continue;
    try {
      JSON.parse(await readFile(path.join(directory, entry.name), "utf8"));
    } catch (error) {
      fail("shopify", `${entry.name} contains invalid JSON (${error.message})`);
    }
  }
}

for (const entry of await readdir(path.join(shopifyRoot, "sections"), { withFileTypes: true })) {
  if (!entry.isFile() || path.extname(entry.name) !== ".liquid") continue;
  const contents = await readFile(path.join(shopifyRoot, "sections", entry.name), "utf8");
  if (/\|\s*asset_url\s*\|\s*image_tag/.test(contents)) {
    fail("shopify", `${entry.name} sends an asset URL string into image_tag; render theme assets with an img element`);
  }
  const match = contents.match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/);
  if (!match) {
    fail("shopify", `${entry.name} is missing a schema block`);
    continue;
  }
  try {
    JSON.parse(match[1]);
  } catch (error) {
    fail("shopify", `${entry.name} has invalid schema JSON (${error.message})`);
  }
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  const adapterScope = wooRenderer ? "both native adapters" : "the public Shopify adapter";
  console.log(`Checked ${brands.length} brand packs, ${supportedSections.length} shared sections and ${adapterScope}.`);
}
