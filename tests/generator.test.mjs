import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertSafeSlug, copyDirectoryFlat, isSafeSlug, presentationLayout, productBodyHtml, productMediaFocalPoint, productZoomMode } from "../scripts/lib.mjs";
import { renderProductPreview } from "../scripts/render-preview.mjs";
import { cardMediaChoices, combineShopifyProductCsv, productVariants, resolveVariantMedia, shopifyCardMediaSelectorSnippet, shopifyFallbackFooterSnippet, shopifyFallbackNavigationSnippet, shopifyFixtureImageSnippet, shopifyIndexTemplate, shopifyMediaManifest, shopifyPasswordTemplate, shopifyProductCsv, shopifyVariantMediaJsonSnippet, validateVariantMediaRules, wooProductCsv } from "../scripts/platform-output.mjs";

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
  variantMedia: [
    { match: { Finish: "Dark" }, image: "assets/product-dark.webp", alt: "Configured product in Dark" },
    { match: { Finish: "Dark", Service: "Installed" }, image: "assets/product-dark-installed.webp" }
  ],
  options: [
    { name: "Finish", values: ["Natural", { label: "Dark", priceModifier: 1500 }] },
    { name: "Service", values: ["Delivery", { label: "Installed", priceModifier: 3000 }] }
  ]
};

const cardSelectorProduct = {
  ...product,
  id: "finish-card-product",
  name: "Finish card product",
  cardMediaSelector: {
    option: "Finish",
    choices: [
      { value: "Natural", swatch: "#C89155" },
      { value: "Dark", swatch: "#222222" }
    ]
  }
};

test("path-bearing identifiers are restricted to safe slugs", () => {
  for (const value of ["demo-01", "large-product-6", "product9"]) assert.equal(isSafeSlug(value), true);
  for (const value of ["../escape", "nested/path", "Uppercase", "double--hyphen", ""]) assert.equal(isSafeSlug(value), false);
  assert.throws(() => assertSafeSlug("../escape", "Product id"), /Product id must use/);
});

test("flat asset copying fails instead of silently dropping nested assets", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "storefront-flat-assets-"));
  try {
    const source = path.join(directory, "source");
    await mkdir(path.join(source, "nested"), { recursive: true });
    await assert.rejects(
      copyDirectoryFlat(source, path.join(directory, "destination")),
      /Brand assets must be flat/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("presentation layouts use a closed public preset vocabulary", () => {
  assert.equal(presentationLayout({ presentation: { layout: "editorial" } }), "editorial");
  assert.equal(presentationLayout({ presentation: { layout: "unknown" } }), "standard");
  assert.equal(presentationLayout({}), "standard");
});

test("product zoom defaults to click and exposes hover as an explicit option", () => {
  assert.equal(productZoomMode({ presentation: { productZoom: "hover" } }), "hover");
  assert.equal(productZoomMode({ presentation: { productZoom: "unknown" } }), "click");
  assert.equal(productZoomMode({}), "click");
});

test("product media focal points use a constrained presentation vocabulary", () => {
  assert.equal(productMediaFocalPoint({ presentation: { productMediaHorizontalFocus: 0 } }), "0% center");
  assert.equal(productMediaFocalPoint({ presentation: { productMediaHorizontalFocus: 78 } }), "78% center");
  assert.equal(productMediaFocalPoint({ presentation: { productMediaHorizontalFocus: 101 } }), "50% center");
  assert.equal(productMediaFocalPoint({}), "50% center");
});

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
  assert.deepEqual(variants.map((variant) => variant.media.image), [
    "assets/product.webp",
    "assets/product.webp",
    "assets/product-dark.webp",
    "assets/product-dark-installed.webp"
  ]);
});

test("variant media prefers the most specific rule and rejects ambiguous matches", () => {
  assert.equal(resolveVariantMedia(product, { Finish: "Dark", Service: "Installed" }).image, "assets/product-dark-installed.webp");
  assert.throws(() => productVariants({
    ...product,
    variantMedia: [
      { match: { Finish: "Dark" }, image: "assets/dark.webp" },
      { match: { Service: "Installed" }, image: "assets/installed.webp" }
    ]
  }), /ambiguous variantMedia rules/);
  assert.throws(() => validateVariantMediaRules({
    ...product,
    variantMedia: [{ match: { Material: "Dark" }, image: "assets/dark.webp" }]
  }), /missing option Material/);
  assert.throws(() => validateVariantMediaRules({
    ...product,
    variantMedia: [
      { match: { Finish: "Dark" }, image: "assets/dark.webp" },
      { match: { Finish: "Dark" }, image: "assets/dark-again.webp" }
    ]
  }), /duplicate variantMedia rules/);
});

test("card media selectors resolve distinct media and render in preview and Shopify cards", () => {
  const choices = cardMediaChoices(cardSelectorProduct);
  assert.deepEqual(choices.map((choice) => choice.image), ["assets/product.webp", "assets/product-dark.webp"]);
  assert.equal(new Set(choices.map((choice) => choice.image)).size, 2);

  const preview = renderProductPreview(brand, product, { products: [product, cardSelectorProduct] });
  assert.equal((preview.match(/data-card-media-selector/g) || []).length, 1);
  assert.equal((preview.match(/data-card-media-choice/g) || []).length, 2);
  assert.match(preview, /data-card-media-image="\.\.\/\.\.\/assets\/product\.webp"/);
  assert.match(preview, /data-card-media-image="\.\.\/\.\.\/assets\/product-dark\.webp"/);

  const shopify = shopifyCardMediaSelectorSnippet({ products: [cardSelectorProduct] });
  assert.match(shopify, /\{% when 'finish-card-product' %\}/);
  assert.equal((shopify.match(/data-card-media-choice/g) || []).length, 2);
  assert.match(shopify, /brand-product\.webp/);
  assert.match(shopify, /brand-product-dark\.webp/);
});

test("card media selectors reject invalid options, values, swatches and repeated media", () => {
  assert.throws(() => validateVariantMediaRules({
    ...cardSelectorProduct,
    cardMediaSelector: {
      ...cardSelectorProduct.cardMediaSelector,
      option: "Material"
    }
  }), /cardMediaSelector references missing option Material/);

  assert.throws(() => validateVariantMediaRules({
    ...cardSelectorProduct,
    cardMediaSelector: {
      option: "Finish",
      choices: [
        { value: "Natural", swatch: "#C89155" },
        { value: "Missing", swatch: "#222222" }
      ]
    }
  }), /cardMediaSelector references missing value Finish=Missing/);

  assert.throws(() => validateVariantMediaRules({
    ...cardSelectorProduct,
    cardMediaSelector: {
      option: "Finish",
      choices: [
        { value: "Natural", swatch: "cedar" },
        { value: "Dark", swatch: "#222222" }
      ]
    }
  }), /needs a six-digit hex swatch/);

  assert.throws(() => validateVariantMediaRules({
    ...cardSelectorProduct,
    variantMedia: [],
    cardMediaSelector: {
      option: "Finish",
      choices: [
        { value: "Natural", swatch: "#C89155" },
        { value: "Dark", swatch: "#222222" }
      ]
    }
  }), /must resolve every choice to different media/);
});

test("products without cardMediaSelector do not emit card media controls", () => {
  const formLikeProduct = {
    ...product,
    id: "form-like-product",
    name: "FORM-like product",
    cardMediaSelector: undefined
  };
  const preview = renderProductPreview(brand, product, { products: [product, formLikeProduct] });
  const shopify = shopifyCardMediaSelectorSnippet({ products: [formLikeProduct] });

  assert.doesNotMatch(preview, /data-card-media-selector|data-card-media-choice/);
  assert.doesNotMatch(shopify, /data-card-media-selector|data-card-media-choice|\{% when 'form-like-product' %\}/);
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

test("Shopify product grids expose an explicit managed, collection or combined catalogue source", async () => {
  const configured = {
    ...brand,
    sections: [{
      type: "product-grid",
      id: "shop",
      title: "Shop",
      productIds: ["configured-product", "second-product"],
      shopifyCatalog: { mode: "combined", collectionHandle: "seasonal-extras", productLimit: 10 }
    }]
  };
  const template = JSON.parse(shopifyIndexTemplate(configured));
  const settings = template.sections["01_product_grid"].settings;

  assert.equal(settings.product_handles, "configured-product,second-product");
  assert.equal(settings.catalog_source, "combined");
  assert.equal(settings.optional_collection, "seasonal-extras");
  assert.equal(settings.maximum_products, 10);

  const managedOnly = JSON.parse(shopifyIndexTemplate({
    ...configured,
    sections: [{ ...configured.sections[0], shopifyCatalog: undefined }]
  })).sections["01_product_grid"].settings;
  assert.equal(managedOnly.catalog_source, "managed");
  assert.equal(managedOnly.optional_collection, "");
  assert.equal(managedOnly.maximum_products, 6);

  const section = await readFile(new URL("../adapters/shopify/sections/product-grid.liquid", import.meta.url), "utf8");
  assert.match(section, /catalog_source == 'managed' or catalog_source == 'combined'/);
  assert.match(section, /catalog_source == 'collection' or catalog_source == 'combined'/);
  assert.match(section, /section\.settings\.optional_collection\.products/);
  assert.match(section, /unless rendered_handles contains product_token/);
  assert.match(section, /rendered_products >= maximum_products/);
  assert.ok(section.indexOf("{% if include_managed %}") < section.indexOf("{% if include_collection"));
  assert.match(section, /Products from this native collection are read by the theme only\. They are not imported into or deleted from the managed catalog\./);
});

test("the brand contract keeps Shopify-only collections opt-in and bounded", async () => {
  const schema = JSON.parse(await readFile(new URL("../schema/brand.schema.json", import.meta.url), "utf8"));
  const contract = schema.$defs.shopifyCatalog;

  assert.deepEqual(contract.required, ["mode"]);
  assert.deepEqual(contract.properties.mode.enum, ["managed", "collection", "combined"]);
  assert.equal(contract.properties.collectionHandle.pattern, "^[a-z0-9]+(?:-[a-z0-9]+)*$");
  assert.equal(contract.properties.productLimit.minimum, 1);
  assert.equal(contract.properties.productLimit.maximum, 12);
  assert.deepEqual(contract.allOf[0].then.required, ["collectionHandle"]);
  assert.equal(contract.additionalProperties, false);
});

test("optional product details become escaped rich descriptions on every target", () => {
  const detailedProduct = {
    ...product,
    description: "A useful <script>description</script> & overview.",
    details: [
      { title: "Materials & care", body: "Wipe with a <soft> cloth & let it dry." },
      { title: "Made to fit", body: "Choose the option that works for you." }
    ]
  };
  const expected = '<p>A useful &lt;script&gt;description&lt;/script&gt; &amp; overview.</p><div class="product-details"><section class="product-detail"><h2>Materials &amp; care</h2><p>Wipe with a &lt;soft&gt; cloth &amp; let it dry.</p></section><section class="product-detail"><h2>Made to fit</h2><p>Choose the option that works for you.</p></section></div>';
  const shopifyRows = csvRows(shopifyProductCsv(brand, { products: [detailedProduct] }));
  const wooRows = csvRows(wooProductCsv(brand, { products: [detailedProduct] }));
  const preview = renderProductPreview(brand, detailedProduct);

  assert.equal(productBodyHtml(detailedProduct), expected);
  assert.equal(shopifyRows[1][shopifyRows[0].indexOf("Body (HTML)")], expected);
  assert.equal(wooRows[1][wooRows[0].indexOf("Short description")], "A useful &lt;script&gt;description&lt;/script&gt; &amp; overview.");
  assert.equal(wooRows[1][wooRows[0].indexOf("Description")], expected);
  assert.match(preview, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(expected, /<script>|<soft>/);
});

test("products without details keep their original single-paragraph body", () => {
  assert.equal(productBodyHtml(product), `<p>${product.description}</p>`);
});

test("the catalogue schema exposes optional structured product details", async () => {
  const schema = JSON.parse(await readFile(new URL("../schema/catalog.schema.json", import.meta.url), "utf8"));
  const details = schema.properties.products.items.properties.details;

  assert.equal(details.type, "array");
  assert.deepEqual(details.items.required, ["title", "body"]);
  assert.equal(details.items.additionalProperties, false);
});

test("Shopify media manifest keeps portable assets aligned to stable variant SKUs", () => {
  const manifest = JSON.parse(shopifyMediaManifest(brand, { products: [product] }));
  assert.equal(manifest.version, 1);
  assert.equal(manifest.products[product.id].image, product.image);
  assert.equal(manifest.variants["test-store-configured-product-dark-installed"].image, "assets/product-dark-installed.webp");
  const header = csvRows(shopifyProductCsv(brand, { products: [product] }))[0];
  assert.ok(header.includes("Variant Image"));
});

test("Shopify outputs reject different option labels that collapse to the same SKU", () => {
  const collision = {
    ...product,
    variantMedia: [],
    options: [{ name: "Finish", values: ["A B", "A-B"] }]
  };

  assert.throws(
    () => shopifyProductCsv(brand, { products: [collision] }),
    /Shopify variant SKU collision: test-store-configured-product-a-b/
  );
  assert.throws(
    () => shopifyMediaManifest(brand, { products: [collision] }),
    /Shopify variant SKU collision/
  );
});

test("generated Liquid fixtures carry initial and client-side variant media fallbacks", () => {
  const imageSnippet = shopifyFixtureImageSnippet({ products: [product] });
  const jsonSnippet = shopifyVariantMediaJsonSnippet({ products: [product] });
  assert.match(imageSnippet, /variant\.option1 == "Dark"/);
  assert.match(imageSnippet, /brand-product-dark-installed\.webp/);
  assert.ok(imageSnippet.indexOf("fixture_variant_asset != blank") < imageSnippet.indexOf("elsif product.featured_image"));
  assert.ok(imageSnippet.indexOf("elsif product.featured_image") < imageSnippet.indexOf("elsif fixture_base_asset != blank"));
  assert.match(jsonSnippet, /"optionNames":\["Finish","Service"\]/);
  assert.match(jsonSnippet, /asset_url \| json/);
  assert.match(jsonSnippet, /"width":900,"height":1100/);
});

test("generated Shopify variant-media JSON cannot close its script element", () => {
  const unsafeProduct = {
    ...product,
    name: "Product </script><script>unsafe()</script>",
    options: [{ name: "Finish </script>", values: ["Dark </script>"] }],
    variantMedia: [{
      match: { "Finish </script>": "Dark </script>" },
      image: "assets/product-dark.webp",
      alt: "View </script><script>unsafe()</script>"
    }]
  };
  const snippet = shopifyVariantMediaJsonSnippet({ products: [unsafeProduct] });

  assert.doesNotMatch(snippet, /<\/script>/i);
  assert.match(snippet, /\\u003c\/script>/);
});

test("Shopify password composition carries brand media without hard-coded fixture names", () => {
  const template = JSON.parse(shopifyPasswordTemplate(brand));
  assert.deepEqual(template.order, ["main"]);
  assert.equal(template.sections.main.type, "main-password");
  assert.equal(template.sections.main.settings.title, brand.displayName);
  assert.equal(template.sections.main.settings.fallback_asset, "brand-hero.webp");
});

test("static product preview exposes every product option and dynamic pricing hooks", () => {
  const html = renderProductPreview(brand, product);
  assert.match(html, /data-layout="standard"/);
  assert.equal((html.match(/data-product-option-group/g) || []).length, 2);
  assert.equal((html.match(/data-product-option data-option-name/g) || []).length, 4);
  assert.equal((html.match(/data-price-modifier="[^"]+" checked/g) || []).length, 2);
  assert.match(html, /class="product-option__input" type="radio"/);
  assert.match(html, /class="product-option__label"/);
  assert.doesNotMatch(html, /<select[^>]+data-product-option/);
  assert.match(html, /data-price-modifier="1500"/);
  assert.match(html, /data-base-compare="12000"/);
  assert.match(html, /data-preview-variant-media/);
  assert.match(html, /const selectedOptions=/);
  assert.match(html, /input\.type!=="radio"\|\|input\.checked/);
  assert.match(html, /product-dark-installed\.webp/);
  assert.match(html, /<img[^>]+data-preview-product-image>/);
  assert.doesNotMatch(html, /data-preview-product-alternate-image/);
  assert.doesNotMatch(html, /product-media-gallery/);
});

test("static product configuration reads only the selected radio from each option group", async () => {
  const runtime = await readFile(new URL("../shared/storefront.js", import.meta.url), "utf8");

  assert.match(runtime, /control\.type !== "radio" \|\| control\.checked/);
  assert.match(runtime, /control\.tagName === "SELECT" \? control\.options\[control\.selectedIndex\] : control/);
});

test("static product preview only requests engraving text for active engraving options", () => {
  const html = renderProductPreview(brand, {
    ...product,
    options: [
      ...product.options,
      { name: "Engraving", values: ["No engraving", "Up to 12 characters", "Up to 18 characters"] }
    ]
  });

  assert.match(html, /data-preview-engraving hidden/);
  assert.match(html, /<textarea[^>]+name="Engraving"[^>]+maxlength="18"[^>]+data-preview-engraving-input disabled>/);
  assert.match(html, /Maximum <span data-preview-engraving-limit>18<\/span> characters\./);
  assert.match(html, /normalized!=="none"/);
  assert.match(html, /!normalized\.includes\("no engraving"\)/);
  assert.match(html, /!normalized\.includes\("without engraving"\)/);
  assert.match(html, /engravingProperty\.hidden=!required/);
  assert.match(html, /engravingInput\.disabled=!required/);
  assert.match(html, /engravingInput\.required=required/);
  assert.match(html, /if\(!required\)engravingInput\.value=""/);
  assert.match(html, /value\.match\(\/\\d\+\//);
  assert.match(html, /Number\(statedLimit\)\|\|18/);
});

test("static product preview omits engraving controls when the product has no engraving option", () => {
  const html = renderProductPreview(brand, product);

  assert.doesNotMatch(html, /data-preview-engraving hidden/);
  assert.doesNotMatch(html, /<textarea[^>]+data-preview-engraving-input/);
});

test("generated footers preserve real destinations across nested and Shopify pages", () => {
  const html = renderProductPreview(brand, product);
  assert.match(html, /href="\.\.\/\.\.\/index\.html#shop">Shop<\/a>/);
  assert.doesNotMatch(html, /href="#">/);
  assert.match(shopifyFallbackFooterSnippet(brand), /\{\{ routes\.root_url \}\}#shop/);
});

test("Shopify fallback navigation stays useful from every template", () => {
  const navigation = shopifyFallbackNavigationSnippet({
    ...brand,
    navigation: [
      { label: "Story", href: "#story" },
      { label: "Journal", href: "pages/journal" }
    ]
  });

  assert.match(navigation, /href="\{\{ routes\.root_url \}\}#story"/);
  assert.match(navigation, /href="\{\{ routes\.root_url \}\}pages\/journal"/);
  assert.match(navigation, /routes\.all_products_collection_url/);
  assert.match(navigation, /routes\.search_url/);
});

test("mobile navigation control stays hidden on desktop", async () => {
  const stylesheet = await readFile(new URL("../shared/storefront.css", import.meta.url), "utf8");

  assert.match(stylesheet, /\.menu-button\{display:none\}/);
  assert.match(stylesheet, /@media \(max-width:900px\)[\s\S]*?\.menu-button\{display:inline-flex/);
  assert.doesNotMatch(stylesheet, /\.cart-button,\.menu-button\{display:inline-flex/);
});

test("shared storefront composition fills product media and preserves hidden controls", async () => {
  const stylesheet = await readFile(new URL("../shared/storefront.css", import.meta.url), "utf8");

  assert.match(stylesheet, /\[hidden\]\{display:none!important\}/);
  assert.match(stylesheet, /\.product-card__media>\.media,\.product-card__media>\.media img\{width:100%;height:100%\}/);
  assert.match(stylesheet, /\.product-card__media-selector\{[^}]*padding:0[^}]*border:0[^}]*background:transparent[^}]*box-shadow:none[^}]*backdrop-filter:none/);
  assert.match(stylesheet, /\.product-card__media-choice\{[^}]*width:2\.5rem[^}]*height:2\.5rem/);
  assert.match(stylesheet, /\.product-card__media-choice::before\{[^}]*width:\.9rem[^}]*height:\.9rem/);
  assert.match(stylesheet, /\.newsletter form>label\{grid-column:1;/);
  assert.match(stylesheet, /\.newsletter form>\.button\{grid-column:2;/);
});

test("responsive content reserves space for long headings, testimonials and controls", async () => {
  const [shared, shopify] = await Promise.all([
    readFile(new URL("../shared/storefront.css", import.meta.url), "utf8"),
    readFile(new URL("../adapters/shopify/assets/shopify.css", import.meta.url), "utf8")
  ]);

  assert.match(shared, /\.newsletter \.section-intro\{[^}]*margin:clamp\(/);
  assert.match(shared, /\.testimonial-grid figure\{[^}]*gap:clamp\(/);
  assert.match(shared, /\.testimonial-grid figcaption\{[^}]*margin-top:auto/);
  assert.match(shared, /@media \(max-width:800px\)\{\.testimonial-grid\{grid-template-columns:1fr\}/);
  assert.match(shared, /@media \(max-height:700px\)\{\.section-heading--sticky\{position:static\}/);
  assert.match(shared, /body\[data-layout="technical"\] \.menu-button,[^}]*text-transform:uppercase/);
  assert.match(shared, /@media \(max-width:420px\)\{[\s\S]*?\.product-option__values\{grid-template-columns:1fr\}/);
  assert.match(shared, /\.product-description\{[^}]*max-width:36rem[^}]*color:color-mix/);
  assert.match(shared, /\.product-option__input:checked\+\.product-option__label/);
  assert.doesNotMatch(shopify, /\.product-option__input:checked\+\.product-option__label/);
  assert.match(shopify, /\.rte:not\(\.product-description\)\{max-width:52rem\}/);
  assert.doesNotMatch(shopify, /\.rte\{max-width:52rem\}/);
});

test("shared card media runtime swaps media, restores responsive attributes and leaves link events alone", async () => {
  const runtime = await readFile(new URL("../shared/storefront.js", import.meta.url), "utf8");
  const functionStart = runtime.indexOf("function initCardMediaSelector(root)");
  const functionEnd = runtime.indexOf("\nfunction initRelatedCarousel", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  const functionSource = runtime.slice(functionStart, functionEnd);
  assert.doesNotMatch(functionSource, /stopPropagation/);

  const initCardMediaSelector = Function(
    "cardMediaSelectors",
    "scheduleCardMediaPreload",
    "preloadCardMedia",
    `"use strict"; ${functionSource}; return initCardMediaSelector;`
  )(new WeakSet(), () => {}, () => {});
  const attributes = new Map([
    ["src", "original.webp"],
    ["srcset", "original-450.webp 450w, original-900.webp 900w"],
    ["sizes", "(max-width: 700px) 100vw, 50vw"],
    ["alt", "Original product"]
  ]);
  const image = {
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    get src() { return this.getAttribute("src"); },
    set src(value) { this.setAttribute("src", value); },
    get alt() { return this.getAttribute("alt"); },
    set alt(value) { this.setAttribute("alt", value); }
  };
  const choice = (dataset) => {
    const listeners = new Map();
    return {
      dataset,
      addEventListener(type, listener) { listeners.set(type, listener); },
      setAttribute(name, value) { this[name] = String(value); },
      click(event) { listeners.get("click")?.(event); }
    };
  };
  const originalChoice = choice({
    cardMediaDefault: "true",
    cardMediaImage: "original.webp",
    cardMediaAlt: "Original product"
  });
  const alternateChoice = choice({
    cardMediaDefault: "false",
    cardMediaImage: "alternate.webp",
    cardMediaAlt: "Alternate finish"
  });
  const choices = [originalChoice, alternateChoice];
  const card = { querySelector: () => image };
  const root = {
    closest(selector) { return selector === ".product-card" ? card : null; },
    querySelectorAll: () => choices
  };

  initCardMediaSelector(root);
  let propagationStopped = false;
  alternateChoice.click({ stopPropagation() { propagationStopped = true; } });
  assert.equal(propagationStopped, false);
  assert.equal(image.getAttribute("src"), "alternate.webp");
  assert.equal(image.getAttribute("alt"), "Alternate finish");
  assert.equal(image.getAttribute("srcset"), null);
  assert.equal(image.getAttribute("sizes"), null);
  assert.equal(alternateChoice["aria-pressed"], "true");
  assert.equal(originalChoice["aria-pressed"], "false");

  originalChoice.click({ stopPropagation() { propagationStopped = true; } });
  assert.equal(propagationStopped, false);
  assert.equal(image.getAttribute("src"), "original.webp");
  assert.equal(image.getAttribute("alt"), "Original product");
  assert.equal(image.getAttribute("srcset"), "original-450.webp 450w, original-900.webp 900w");
  assert.equal(image.getAttribute("sizes"), "(max-width: 700px) 100vw, 50vw");
  assert.equal(originalChoice["aria-pressed"], "true");
  assert.equal(alternateChoice["aria-pressed"], "false");
});

test("the first alternate-card click reuses a decoded preload without another request", async () => {
  const runtime = await readFile(new URL("../shared/storefront.js", import.meta.url), "utf8");
  const helperStart = runtime.indexOf("function preloadCardMedia(source");
  const runtimeEnd = runtime.indexOf("\nfunction initRelatedCarousel", helperStart);
  assert.ok(helperStart >= 0 && runtimeEnd > helperStart);

  const images = [];
  class MockImage {
    constructor() {
      this.fetchPriority = "auto";
      images.push(this);
    }
    decode() {
      this.decodeCount = (this.decodeCount || 0) + 1;
      return Promise.resolve();
    }
  }

  let observerCallback;
  let observerOptions;
  let observedRoot;
  let unobservedRoot;
  class MockIntersectionObserver {
    constructor(callback, options) {
      observerCallback = callback;
      observerOptions = options;
    }
    observe(root) { observedRoot = root; }
    unobserve(root) { unobservedRoot = root; }
  }

  const cardMediaPreloads = new Map();
  const helpers = Function(
    "cardMediaPreloads",
    "cardMediaSelectors",
    "window",
    "Image",
    "IntersectionObserver",
    `"use strict"; let cardMediaPreloadObserver = null; ${runtime.slice(helperStart, runtimeEnd)}; return { initCardMediaSelector, preloadCardMedia };`
  )(
    cardMediaPreloads,
    new WeakSet(),
    { IntersectionObserver: MockIntersectionObserver },
    MockImage,
    MockIntersectionObserver
  );

  const listeners = new Map();
  const choice = (dataset) => {
    const choiceListeners = new Map();
    return {
      dataset,
      addEventListener(type, listener) { choiceListeners.set(type, listener); },
      setAttribute(name, value) { this[name] = String(value); },
      click() { choiceListeners.get("click")?.(); }
    };
  };
  const primaryChoice = choice({ cardMediaDefault: "true", cardMediaImage: "primary.webp" });
  const alternateChoice = choice({
    cardMediaDefault: "false",
    cardMediaImage: "alternate.webp",
    cardMediaAlt: "Alternate finish"
  });
  const choices = [primaryChoice, alternateChoice];
  const attributes = new Map([
    ["src", "primary.webp"],
    ["srcset", "primary-450.webp 450w, primary-900.webp 900w"],
    ["sizes", "100vw"],
    ["alt", "Primary finish"]
  ]);
  const cardImage = {
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    get src() { return this.getAttribute("src"); },
    set src(value) { this.setAttribute("src", value); },
    get alt() { return this.getAttribute("alt"); },
    set alt(value) { this.setAttribute("alt", value); }
  };
  const card = { querySelector() { return cardImage; } };
  const root = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    closest(selector) {
      if (selector === ".product-card") return card;
      if (selector === "[data-related-carousel]") return null;
      return null;
    },
    querySelectorAll() { return choices; }
  };

  helpers.initCardMediaSelector(root);
  assert.equal(observedRoot, root);
  assert.deepEqual(observerOptions, { rootMargin: "320px" });
  assert.equal(images.length, 0);

  observerCallback([{ isIntersecting: true, target: root }], { unobserve(rootToRemove) { unobservedRoot = rootToRemove; } });
  await cardMediaPreloads.get("alternate.webp").ready;
  assert.equal(unobservedRoot, root);
  assert.equal(images.length, 1);
  assert.equal(images[0].src, "alternate.webp");
  assert.equal(images[0].fetchPriority, "low");
  assert.equal(images[0].decodeCount, 1);
  assert.equal(cardMediaPreloads.has("primary.webp"), false);

  alternateChoice.click();
  assert.equal(cardImage.src, "alternate.webp");
  assert.equal(cardImage.alt, "Alternate finish");
  assert.equal(images.length, 1);
  assert.equal(images[0].decodeCount, 1);

  listeners.get("pointerenter")();
  assert.equal(images.length, 1);
  assert.equal(images[0].fetchPriority, "high");
  assert.equal(helpers.preloadCardMedia("alternate.webp", "high").image, images[0]);
});

test("Shopify builds include the generated card media selector snippet", async () => {
  const [buildScript, productCard] = await Promise.all([
    readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8"),
    readFile(new URL("../adapters/shopify/snippets/product-card.liquid", import.meta.url), "utf8")
  ]);

  assert.match(buildScript, /snippets", "card-media-selector\.liquid"\), shopifyCardMediaSelectorSnippet\(catalog\)/);
  assert.match(productCard, /\{% render 'card-media-selector', product: product %\}/);
});

test("Shopify customer-facing prices omit trailing zero decimals", async () => {
  const templates = await Promise.all([
    readFile(new URL("../adapters/shopify/snippets/product-card.liquid", import.meta.url), "utf8"),
    readFile(new URL("../adapters/shopify/sections/main-product.liquid", import.meta.url), "utf8"),
    readFile(new URL("../adapters/shopify/sections/main-cart.liquid", import.meta.url), "utf8"),
    readFile(new URL("../adapters/shopify/sections/cart-drawer.liquid", import.meta.url), "utf8")
  ]);

  for (const template of templates) {
    assert.match(template, /\|\s*money_without_trailing_zeros/);
    assert.doesNotMatch(template, /\|\s*money(?!_)/);
  }
});

test("Shopify product pages resolve native variants and preserve line-item properties", async () => {
  const template = await readFile(new URL("../adapters/shopify/sections/main-product.liquid", import.meta.url), "utf8");

  assert.match(template, /name="id"[\s\S]*data-variant-id/);
  assert.match(template, /data-product-variants/);
  assert.match(template, /data-fixture-variant-media/);
  assert.match(template, /selected_variant\.featured_image/);
  assert.match(template, /updateMedia\(variant\)/);
  assert.match(template, /data-product-option/);
  assert.match(template, /name="quantity"/);
  assert.match(template, /name="properties\[Engraving\]"/);
  assert.match(template, /data-native-cart-form/);
});

test("product pages use a dedicated vertical quantity control", async () => {
  const [template, runtime, stylesheet] = await Promise.all([
    readFile(new URL("../adapters/shopify/sections/main-product.liquid", import.meta.url), "utf8"),
    readFile(new URL("../shared/storefront.js", import.meta.url), "utf8"),
    readFile(new URL("../shared/storefront.css", import.meta.url), "utf8")
  ]);
  const preview = renderProductPreview(brand, product);

  for (const markup of [template, preview]) {
    assert.match(markup, /data-product-quantity/);
    assert.match(markup, /data-product-quantity-input/);
    assert.match(markup, /data-product-quantity-increase/);
    assert.match(markup, /data-product-quantity-decrease/);
    assert.match(markup, /name="quantity"[^>]+min="1"[^>]+step="1"/);
    assert.match(markup, /type="button"[^>]+data-product-quantity-increase/);
    assert.match(markup, /type="button"[^>]+data-product-quantity-decrease/);
  }

  assert.match(runtime, /function normalizedProductQuantity/);
  assert.match(runtime, /function connectProductQuantityControl/);
  assert.match(runtime, /function syncProductQuantity/);
  assert.match(runtime, /existing\.quantity \+= quantity/);
  assert.match(runtime, /data-product-quantity-decrease\],\[data-product-quantity-increase/);
  assert.doesNotMatch(runtime, /data-product-quantity-decrease[^\n]+requestNativeCartRemoval/);
  assert.match(stylesheet, /\.product-quantity__field\{display:grid;grid-template-columns:6\.5rem 2\.75rem/);
  assert.match(stylesheet, /\.product-quantity__button\{[^}]+min-height:2\.75rem/);
  assert.match(stylesheet, /\.product-quantity__buttons\{display:grid;grid-template-rows:1fr 1fr/);
  assert.match(stylesheet, /\.product-quantity__field input::-webkit-inner-spin-button/);
});

test("product pages show the rest of the catalogue without repeating the current product", async () => {
  const siblingOne = { ...product, id: "sibling-one", name: "Sibling one", image: "assets/sibling-one.webp", options: [] };
  const siblingTwo = { ...product, id: "sibling-two", name: "Sibling two", image: "assets/sibling-two.webp", options: [] };
  const preview = renderProductPreview(brand, product, { products: [product, siblingOne, siblingTwo] });
  const related = preview.slice(preview.indexOf('<section class="section related-products"'));
  const [template, section] = await Promise.all([
    readFile(new URL("../adapters/shopify/templates/product.json", import.meta.url), "utf8"),
    readFile(new URL("../adapters/shopify/sections/related-products.liquid", import.meta.url), "utf8")
  ]);

  assert.match(related, /href="\.\.\/sibling-one\/index\.html"/);
  assert.match(related, /href="\.\.\/sibling-two\/index\.html"/);
  assert.match(related, /src="\.\.\/\.\.\/assets\/sibling-one\.webp"/);
  assert.doesNotMatch(related, /configured-product\/index\.html/);
  assert.equal((related.match(/class="product-card"/g) || []).length, 2);
  assert.match(template, /"related": \{ "type": "related-products"/);
  assert.match(template, /"order": \["main", "related"\]/);
  assert.match(section, /related_product\.id != product\.id/);
  assert.match(section, /collections\.all\.products/);
  assert.match(section, /render 'product-card', product: related_product/);
  assert.match(section, /product-grid--related/);
  for (const markup of [related, section]) {
    assert.match(markup, /data-related-carousel/);
    assert.match(markup, /data-related-carousel-previous/);
    assert.match(markup, /data-related-carousel-next/);
    assert.match(markup, /aria-controls=/);
  }
});

test("product imagery uses a shared accessible zoom contract without replacing WooCommerce zoom", async () => {
  const [template, runtime, stylesheet, shopifyStylesheet] = await Promise.all([
    readFile(new URL("../adapters/shopify/sections/main-product.liquid", import.meta.url), "utf8"),
    readFile(new URL("../shared/storefront.js", import.meta.url), "utf8"),
    readFile(new URL("../shared/storefront.css", import.meta.url), "utf8"),
    readFile(new URL("../adapters/shopify/assets/shopify.css", import.meta.url), "utf8")
  ]);
  const preview = renderProductPreview(brand, product);
  const hoverPreview = renderProductPreview({ ...brand, presentation: { productZoom: "hover" } }, product);

  for (const markup of [template, preview]) {
    assert.match(markup, /data-product-zoom/);
    assert.match(markup, /data-product-zoom-mode=/);
    assert.match(markup, /role="button"/);
    assert.match(markup, /aria-pressed="false"/);
    assert.match(markup, /data-zoom-label=/);
    assert.match(markup, /data-unzoom-label=/);
  }

  assert.match(template, /data-product-zoom-mode="__PRODUCT_ZOOM_MODE__"/);
  assert.match(preview, /data-product-zoom-mode="click"/);
  assert.match(hoverPreview, /data-product-zoom-mode="hover"/);

  assert.match(runtime, /function initProductZoom/);
  assert.match(runtime, /function resetProductZoom/);
  assert.match(runtime, /function syncProductMediaFrame/);
  assert.match(runtime, /image\?\.naturalWidth/);
  assert.match(runtime, /data-product-media-shape/);
  assert.match(runtime, /MutationObserver/);
  assert.match(runtime, /root\.dataset\.productZoomMode === "hover"/);
  assert.match(runtime, /ArrowLeft/);
  assert.match(stylesheet, /\.product-zoom\[aria-pressed="true"\] img\{transform:scale\(var\(--product-zoom-scale\)\)\}/);
  assert.match(stylesheet, /\.product-zoom\[data-product-zoom-mode="hover"\]:hover:not\(\[aria-pressed="true"\]\) img/);
  assert.doesNotMatch(stylesheet, /\.product-zoom:hover img/);
  assert.match(stylesheet, /body\[data-layout="technical"\] \.preview-product__media\[data-product-media-shape="landscape"\].*aspect-ratio:4\/3/);
  assert.match(shopifyStylesheet, /body\[data-layout="technical"\] \.main-product__media\[data-product-media-shape="landscape"\].*aspect-ratio:4\/3/);
  assert.match(stylesheet, /@media \(max-width:900px\)[\s\S]*body\[data-layout="technical"\] \.preview-product__media\[data-product-media-shape="landscape"\]\{height:auto;min-height:0;aspect-ratio:4\/3\}/);
  assert.match(shopifyStylesheet, /@media\(max-width:900px\)[\s\S]*body\[data-layout="technical"\] \.main-product__media\[data-product-media-shape="landscape"\]\{height:auto;min-height:0;aspect-ratio:4\/3\}/);
  assert.match(stylesheet, /object-position:var\(--product-media-focus,center center\)/);
  assert.match(shopifyStylesheet, /object-position:var\(--product-media-focus,center center\)/);
  assert.doesNotMatch(template, /fixture-product-alternate-image/);
  assert.doesNotMatch(template, /data-product-alternate-image/);
  assert.match(stylesheet, /\.media:not\(\.product-zoom\) img\{transform:none!important\}/);
  assert.doesNotMatch(runtime, /woocommerce-product-gallery/);
});

test("related products become a draggable single-row rail at compact widths", async () => {
  const [runtime, stylesheet] = await Promise.all([
    readFile(new URL("../shared/storefront.js", import.meta.url), "utf8"),
    readFile(new URL("../shared/storefront.css", import.meta.url), "utf8")
  ]);

  assert.match(runtime, /function initRelatedCarousel/);
  assert.match(runtime, /function updateRelatedCarousel/);
  assert.match(runtime, /if \(!root\.closest\("\[data-related-carousel\]"\)\) scheduleCardMediaPreload\(root\)/);
  assert.match(runtime, /track\.querySelector\("\[data-card-media-selector\]"\)\) scheduleCardMediaPreload\(track\)/);
  assert.match(runtime, /setPointerCapture/);
  const relatedRuntime = runtime.slice(runtime.indexOf("function initRelatedCarousel"), runtime.indexOf("function escapeMarkup"));
  assert.ok(
    relatedRuntime.indexOf("Math.abs(delta) >= 5") < relatedRuntime.indexOf("track.setPointerCapture?.(event.pointerId)"),
    "the carousel must capture the pointer only after a real drag starts"
  );
  assert.ok(
    relatedRuntime.indexOf("track.setPointerCapture?.(event.pointerId)") < relatedRuntime.indexOf('track.dataset.carouselDragging = "true"'),
    "the drag threshold should capture the pointer before scrolling"
  );
  assert.match(runtime, /scrollBy/);
  assert.match(stylesheet, /\.product-grid--related[^}]+display:flex[^}]+overflow-x:auto/);
  assert.match(stylesheet, /scroll-snap-type:x mandatory/);
  assert.match(stylesheet, /\.product-grid--related \.product-card\{flex:0 0/);
});

test("Shopify keeps sold-out configurations explorable while blocking their purchase", async () => {
  const template = await readFile(new URL("../adapters/shopify/sections/main-product.liquid", import.meta.url), "utf8");

  assert.match(template, /const hasVariantMatch = variants\.some\(\(variant\) => variant\.options\.every/);
  assert.doesNotMatch(template, /const hasAvailableMatch = variants\.some\(\(variant\) => variant\.available/);
  assert.match(template, /input\.disabled = !hasVariantMatch && !input\.checked/);
  assert.match(template, /submit\.disabled = !available/);
});

test("Shopify keeps the section wrapper sticky instead of constraining the menu", async () => {
  const stylesheet = await readFile(new URL("../adapters/shopify/assets/shopify.css", import.meta.url), "utf8");

  assert.match(stylesheet, /#shopify-section-site-header\{position:sticky;z-index:30;top:0\}/);
  assert.match(stylesheet, /#shopify-section-site-header \.site-header\{position:relative;z-index:auto;top:auto\}/);
});

test("Shopify cart and newsletter retain native platform submissions", async () => {
  const [drawer, mainCart, newsletter, runtime] = await Promise.all([
    readFile(new URL("../adapters/shopify/sections/cart-drawer.liquid", import.meta.url), "utf8"),
    readFile(new URL("../adapters/shopify/sections/main-cart.liquid", import.meta.url), "utf8"),
    readFile(new URL("../adapters/shopify/sections/newsletter.liquid", import.meta.url), "utf8"),
    readFile(new URL("../shared/storefront.js", import.meta.url), "utf8")
  ]);

  assert.match(drawer, /name="checkout"/);
  assert.match(drawer, /data-cart-drawer-content/);
  assert.match(drawer, /item\.variant\.featured_image/);
  assert.match(drawer, /variant: item\.variant/);
  assert.match(mainCart, /item\.variant\.featured_image/);
  assert.match(mainCart, /variant: item\.variant/);
  assert.match(drawer, /data-cart-continue/);
  assert.match(newsletter, /form 'customer'/);
  assert.match(newsletter, /contact\[accepts_marketing\]/);
  assert.match(newsletter, /shop\.privacy_policy/);
  assert.match(newsletter, /privacy_text/);
  assert.match(runtime, /cart\/add\.js/);
  assert.match(runtime, /sections_url/);
  assert.match(runtime, /body\.dataset\.platform === "shopify"/);
  assert.match(runtime, /if \(!isNativeStorefront\)[\s\S]*?\[data-newsletter\]/);
  assert.match(runtime, /if \(isNativeStorefront\) refreshCartCount/);
  assert.ok((runtime.match(/focus\(\{ preventScroll: true \}\)/g) || []).length >= 2);
  assert.match(runtime, /drawerScrollPosition = window\.scrollY/);
  assert.equal((runtime.match(/window\.scrollTo\(\{ top: drawerScrollPosition, behavior: "instant" \}\)/g) || []).length, 2);
  assert.match(runtime, /setCart\(false, \{ restoreFocus: false \}\)/);
});

test("Shopify cart quantities update in place with accessible steppers and removal confirmation", async () => {
  const [drawer, mainCart, runtime, stylesheet] = await Promise.all([
    readFile(new URL("../adapters/shopify/sections/cart-drawer.liquid", import.meta.url), "utf8"),
    readFile(new URL("../adapters/shopify/sections/main-cart.liquid", import.meta.url), "utf8"),
    readFile(new URL("../shared/storefront.js", import.meta.url), "utf8"),
    readFile(new URL("../shared/cart-controls.css", import.meta.url), "utf8")
  ]);

  for (const template of [drawer, mainCart]) {
    assert.match(template, /data-cart-quantity/);
    assert.match(template, /data-quantity-decrease/);
    assert.match(template, /data-quantity-increase/);
    assert.match(template, /data-quantity-input/);
    assert.match(template, /data-cart-quantity-current="\{\{ item\.quantity \}\}"/);
    assert.match(template, /data-cart-remove/);
  }
  assert.match(drawer, /<dialog[^>]+data-cart-confirm/);
  assert.match(drawer, /aria-labelledby="CartConfirmTitle"/);
  assert.match(drawer, /data-cart-confirm-cancel/);
  assert.match(drawer, /data-cart-confirm-remove/);
  assert.match(mainCart, /data-main-cart/);
  assert.equal((mainCart.match(/name="update"/g) || []).length, 1);
  assert.match(mainCart, /<noscript><button[^>]+name="update"/);
  assert.match(mainCart, /\{% endif %\}\s*<p class="cart-status"/);

  assert.match(runtime, /nativeCartUpdateDelay = 400/);
  assert.match(runtime, /cart\/change\.js/);
  assert.match(runtime, /quantity,\s*sections: sectionIds\.join\(","\),\s*sections_url:/);
  assert.match(runtime, /fetchRenderedCartSections\(missingSections\)/);
  assert.match(runtime, /replaceCartSections\(sections\)/);
  assert.match(runtime, /window\.location\.reload\(\)/);
  assert.match(runtime, /setCart\(true, \{ preserveContext: true, focusLineKey:/);
  assert.match(runtime, /requestNativeCartRemoval/);
  assert.match(runtime, /nativeRemove[\s\S]*?event\.preventDefault\(\)/);
  assert.match(runtime, /quantity === 0[\s\S]*?requestNativeCartRemoval/);
  assert.match(runtime, /function queueNativeCartMutation/);
  assert.match(runtime, /await flushNativeCartChanges\(\)/);
  assert.match(runtime, /async function flushNativeCartChanges\(\) \{\s*while \(true\)/);
  assert.match(runtime, /nativeCartMutationActive \|\| document\.querySelector\("\[data-cart-confirm\]\[open\]"\)/);
  assert.match(runtime, /nativeCartLink[\s\S]*?window\.location\.assign\(destination\)/);
  assert.match(runtime, /event\.submitter\?\.name === "checkout"[\s\S]*?checkoutForm\.requestSubmit\(checkoutButton\)/);

  assert.match(stylesheet, /\.quantity-control/);
  assert.match(stylesheet, /-moz-appearance:textfield;appearance:textfield/);
  assert.match(stylesheet, /::-webkit-inner-spin-button/);
  assert.match(stylesheet, /\.cart-confirm::backdrop/);
});

test("static previews reuse the cart stepper and keep local drawer updates in place", async () => {
  const [runtime, buildScript, stylesheet] = await Promise.all([
    readFile(new URL("../shared/storefront.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8"),
    readFile(new URL("../shared/cart-controls.css", import.meta.url), "utf8")
  ]);
  const preview = renderProductPreview(brand, product);

  assert.match(preview, /cart-controls\.css/);
  assert.match(preview, /<dialog[^>]+data-cart-confirm/);
  assert.match(preview, /data-cart-confirm-cancel/);
  assert.match(preview, /data-cart-confirm-remove/);
  assert.match(runtime, /function previewQuantityControl/);
  assert.match(runtime, /data-quantity-decrease/);
  assert.match(runtime, /data-quantity-increase/);
  assert.match(runtime, /function updatePreviewCartQuantity/);
  assert.match(runtime, /openCartRemovalDialog\(\{ key, productTitle, source: "preview" \}\)/);
  assert.match(runtime, /function completeCartRemoval/);
  assert.match(runtime, /setCart\(true, \{ preserveContext: true, focusLineKey: key \}\)/);
  assert.match(buildScript, /shared", "cart-controls\.css/);
  assert.match(stylesheet, /\.preview-cart-line>\.quantity-control/);
});

test("Shopify production shell includes password, 404 and SEO primitives", async () => {
  const [themeLayout, passwordLayout, passwordSection, notFoundSection, settings, metaTags, structuredData] = await Promise.all([
    readFile(new URL("../adapters/shopify/layout/theme.liquid", import.meta.url), "utf8"),
    readFile(new URL("../adapters/shopify/layout/password.liquid", import.meta.url), "utf8"),
    readFile(new URL("../adapters/shopify/sections/main-password.liquid", import.meta.url), "utf8"),
    readFile(new URL("../adapters/shopify/sections/main-404.liquid", import.meta.url), "utf8"),
    readFile(new URL("../adapters/shopify/config/settings_schema.json", import.meta.url), "utf8"),
    readFile(new URL("../adapters/shopify/snippets/meta-tags.liquid", import.meta.url), "utf8"),
    readFile(new URL("../adapters/shopify/snippets/structured-data.liquid", import.meta.url), "utf8")
  ]);

  assert.match(themeLayout, /settings\.brand_name/);
  assert.match(themeLayout, /data-platform="shopify"/);
  assert.match(themeLayout, /cart-controls\.css/);
  assert.match(themeLayout, /request\.page_type == 'index'/);
  assert.match(themeLayout, /seo_title == shop\.name/);
  assert.match(themeLayout, /__SOCIAL_IMAGE_ASSET__.*asset_url/);
  assert.match(themeLayout, /render 'meta-tags'/);
  assert.match(themeLayout, /render 'structured-data'/);
  assert.match(passwordLayout, /content_for_layout/);
  assert.match(passwordSection, /form 'storefront_password'/);
  assert.match(notFoundSection, /routes\.all_products_collection_url/);
  assert.match(settings, /"id": "favicon"/);
  assert.match(settings, /"id": "social_image"/);
  assert.match(metaTags, /twitter:card/);
  assert.match(structuredData, /application\/ld\+json/);
  assert.match(structuredData, /settings\.social_image/);
  assert.match(structuredData, /__SOCIAL_IMAGE_ASSET__/);
  assert.match(structuredData, /"@type": "Product"/);
});
