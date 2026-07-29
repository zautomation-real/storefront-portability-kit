import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { presentationLayout, productBodyHtml } from "../scripts/lib.mjs";
import { renderProductPreview } from "../scripts/render-preview.mjs";
import { combineShopifyProductCsv, productVariants, resolveVariantMedia, shopifyFallbackFooterSnippet, shopifyFallbackNavigationSnippet, shopifyFixtureImageSnippet, shopifyIndexTemplate, shopifyMediaManifest, shopifyPasswordTemplate, shopifyProductCsv, shopifyVariantMediaJsonSnippet, validateVariantMediaRules, wooProductCsv } from "../scripts/platform-output.mjs";

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

test("presentation layouts use a closed public preset vocabulary", () => {
  assert.equal(presentationLayout({ presentation: { layout: "editorial" } }), "editorial");
  assert.equal(presentationLayout({ presentation: { layout: "unknown" } }), "standard");
  assert.equal(presentationLayout({}), "standard");
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
  assert.equal((html.match(/data-product-option data-option-name/g) || []).length, 2);
  assert.match(html, /data-price-modifier="1500"/);
  assert.match(html, /data-base-compare="12000"/);
  assert.match(html, /data-preview-variant-media/);
  assert.match(html, /product-dark-installed\.webp/);
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
  assert.match(shopify, /@media\(max-width:420px\)\{[\s\S]*?\.product-option__values\{grid-template-columns:1fr\}/);
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
  assert.match(runtime, /function previewQuantityControl/);
  assert.match(runtime, /data-quantity-decrease/);
  assert.match(runtime, /data-quantity-increase/);
  assert.match(runtime, /function updatePreviewCartQuantity/);
  assert.match(runtime, /window\.confirm\(`Remove \$\{productTitle\} from your bag\?`\)/);
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
