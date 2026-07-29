import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderProductPreview } from "../scripts/render-preview.mjs";
import { combineShopifyProductCsv, productVariants, shopifyFallbackFooterSnippet, shopifyIndexTemplate, shopifyProductCsv, wooProductCsv } from "../scripts/platform-output.mjs";

const brand = {
  id: "test-store",
  displayName: "TEST STORE",
  locale: "en-GB",
  currency: "GBP",
  hero: { eyebrow: "Test", title: "Test", body: "Test", media: "assets/hero.webp", primaryAction: { label: "Shop", href: "#shop" } },
  sections: [{ type: "comparison", id: "compare", title: "Compare", items: [{ title: "A", body: "B", meta: "C" }] }],
  navigation: [],
  footer: { note: "", links: [{ label: "Shop", href: "#shop" }] },
  palette: { ink: "#000", paper: "#fff", muted: "#eee", accent: "#333", accentContrast: "#fff", line: "#aaa", surface: "#eee", soft: "#fafafa" },
  typography: { display: "serif", body: "sans-serif" }
};

const product = {
  id: "configured-product",
  name: "Configured product",
  price: 10000,
  compareAtPrice: 12000,
  image: "assets/product.webp",
  category: "Test",
  description: "A product with native options.",
  options: [
    { name: "Finish", values: ["Natural", { label: "Dark", priceModifier: 1500 }] },
    { name: "Service", values: ["Delivery", { label: "Installed", priceModifier: 3000 }] }
  ]
};

function csvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted && character === '"' && text[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && character === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (character !== "\r") {
      cell += character;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

test("variant generation creates the full Cartesian product with additive prices", () => {
  const variants = productVariants(product);
  assert.equal(variants.length, 4);
  assert.deepEqual(variants.map((variant) => variant.price), [10000, 13000, 11500, 14500]);
});

test("Shopify and WooCommerce CSVs keep every row aligned", () => {
  for (const output of [shopifyProductCsv(brand, { products: [product] }), wooProductCsv(brand, { products: [product] })]) {
    const rows = csvRows(output);
    assert.ok(rows.length > 2);
    assert.ok(rows.slice(1).every((row) => row.length === rows[0].length));
  }
});

test("Shopify CSV never emits image metadata without an image source", () => {
  const rows = csvRows(shopifyProductCsv(brand, { products: [product] }));
  const sourceIndex = rows[0].indexOf("Image Src");
  const positionIndex = rows[0].indexOf("Image Position");
  const altIndex = rows[0].indexOf("Image Alt Text");

  for (const row of rows.slice(1)) {
    if (row[sourceIndex]) continue;
    assert.equal(row[positionIndex], "");
    assert.equal(row[altIndex], "");
  }
});

test("combined Shopify catalog keeps one header and all product rows", () => {
  const catalog = shopifyProductCsv(brand, { products: [product] });
  const rows = csvRows(combineShopifyProductCsv([catalog, catalog]));
  assert.equal(rows.filter((row) => row[0] === "Handle").length, 1);
  assert.equal(rows.length, (csvRows(catalog).length - 1) * 2 + 1);
});

test("Shopify composition includes portable section settings and blocks", () => {
  const template = JSON.parse(shopifyIndexTemplate(brand));
  assert.deepEqual(template.order, ["hero", "01_comparison"]);
  assert.equal(template.sections.hero.settings.fallback_asset, "brand-hero.webp");
  assert.equal(template.sections["01_comparison"].settings.anchor_id, "compare");
  assert.equal(template.sections["01_comparison"].block_order.length, 1);
});

test("static product preview exposes every product option and dynamic pricing hooks", () => {
  const html = renderProductPreview(brand, product);
  assert.equal((html.match(/data-product-option/g) || []).length, 2);
  assert.match(html, /data-price-modifier="1500"/);
  assert.match(html, /data-base-compare="12000"/);
});

test("generated footers preserve real destinations across nested and Shopify pages", () => {
  const html = renderProductPreview(brand, product);
  assert.match(html, /href="\.\.\/\.\.\/index\.html#shop">Shop<\/a>/);
  assert.doesNotMatch(html, /href="#">/);
  assert.match(shopifyFallbackFooterSnippet(brand), /\{\{ routes\.root_url \}\}#shop/);
});

test("Shopify product pages resolve native variants and preserve line-item properties", async () => {
  const template = await readFile(new URL("../adapters/shopify/sections/main-product.liquid", import.meta.url), "utf8");

  assert.match(template, /name="id"[\s\S]*data-variant-id/);
  assert.match(template, /data-product-variants/);
  assert.match(template, /data-product-option/);
  assert.match(template, /name="quantity"/);
  assert.match(template, /name="properties\[Engraving\]"/);
  assert.match(template, /data-native-cart-form/);
});

test("Shopify cart and newsletter retain native platform submissions", async () => {
  const [drawer, newsletter, runtime] = await Promise.all([
    readFile(new URL("../adapters/shopify/sections/cart-drawer.liquid", import.meta.url), "utf8"),
    readFile(new URL("../adapters/shopify/sections/newsletter.liquid", import.meta.url), "utf8"),
    readFile(new URL("../shared/storefront.js", import.meta.url), "utf8")
  ]);

  assert.match(drawer, /name="checkout"/);
  assert.match(drawer, /data-cart-drawer-content/);
  assert.match(newsletter, /form 'customer'/);
  assert.match(newsletter, /contact\[accepts_marketing\]/);
  assert.match(runtime, /cart\/add\.js/);
  assert.match(runtime, /sections_url/);
});
