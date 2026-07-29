import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { assertNoBuildTokens, copyDirectoryFlat, copyIfPresent, parseArgs, readJson, replaceTokens, resetDir, resolveWooCommercePaths, resolveWorkspacePaths, root, writeText } from "./lib.mjs";
import { renderCartPreview, renderPreview, renderProductPreview } from "./render-preview.mjs";
import { brandCss, shopifyFallbackFooterSnippet, shopifyFallbackNavigationSnippet, shopifyFixtureImageSnippet, shopifyIndexTemplate, shopifyProductCsv, wooProductCsv } from "./platform-output.mjs";

const args = parseArgs(process.argv.slice(2));
const brandId = args.brand || "example-store";
const target = args.target || "preview";
const { brandsRoot, outputRoot: generatedRoot } = resolveWorkspacePaths(args);
const { adapterRoot: wooCommerceAdapterRoot } = resolveWooCommercePaths(args);
const brandDir = path.join(brandsRoot, brandId);
const brand = await readJson(path.join(brandDir, "brand.json"));
const catalog = await readJson(path.join(brandDir, "catalog.json"));
const outputRoot = path.join(generatedRoot, brandId);

if (brand.id !== brandId) throw new Error(`Brand id mismatch: expected ${brandId}, received ${brand.id}`);

async function buildPreview() {
  const output = path.join(outputRoot, "preview");
  await resetDir(output);
  await writeText(path.join(output, "index.html"), renderPreview(brand, catalog));
  for (const product of catalog.products) {
    await writeText(path.join(output, "products", product.id, "index.html"), renderProductPreview(brand, product));
  }
  await writeText(path.join(output, "cart", "index.html"), renderCartPreview(brand));
  await copyIfPresent(path.join(root, "shared", "storefront.css"), path.join(output, "storefront.css"));
  await copyIfPresent(path.join(root, "shared", "storefront.js"), path.join(output, "storefront.js"));
  await copyDirectoryFlat(path.join(brandDir, "assets"), path.join(output, "assets"));
}

async function removeGenerated(relative) {
  const generated = path.resolve(outputRoot, relative);
  const boundary = `${path.resolve(outputRoot)}${path.sep}`;
  if (!generated.startsWith(boundary)) throw new Error(`Refusing to remove output outside ${outputRoot}: ${generated}`);
  await rm(generated, { recursive: true, force: true });
}

async function buildAdapter(name, source = path.join(root, "adapters", name)) {
  const details = await stat(source).catch((error) => {
    if (error.code === "ENOENT") throw new Error(`${name} adapter does not exist at ${source}`);
    throw error;
  });
  if (!details.isDirectory()) throw new Error(`${name} adapter is not a directory: ${source}`);
  const output = path.join(outputRoot, `${name}-theme`);
  await resetDir(output);
  await copyIfPresent(source, output);
  await copyIfPresent(path.join(root, "shared", "storefront.css"), path.join(output, "assets", "storefront.css"));
  await copyIfPresent(path.join(root, "shared", "storefront.js"), path.join(output, "assets", "storefront.js"));
  if (name === "shopify") {
    await copyDirectoryFlat(path.join(brandDir, "assets"), path.join(output, "assets"), "brand-");
    await writeText(path.join(output, "templates", "index.json"), shopifyIndexTemplate(brand));
    await writeText(path.join(output, "snippets", "fixture-product-image.liquid"), shopifyFixtureImageSnippet(catalog));
    await writeText(path.join(output, "snippets", "fallback-navigation.liquid"), shopifyFallbackNavigationSnippet(brand));
    await writeText(path.join(output, "snippets", "fallback-footer.liquid"), shopifyFallbackFooterSnippet(brand));
    await writeText(path.join(outputRoot, "imports", "shopify-products.csv"), shopifyProductCsv(brand, catalog));
  } else {
    await copyDirectoryFlat(path.join(brandDir, "assets"), path.join(output, "assets", "brand"));
    await writeText(path.join(outputRoot, "imports", "woocommerce-products.csv"), wooProductCsv(brand, catalog));
    await writeText(path.join(output, "config", "brand.json"), JSON.stringify(brand, null, 2));
    await writeText(path.join(output, "config", "catalog.json"), JSON.stringify(catalog, null, 2));
  }
  await writeText(path.join(output, "assets", "brand.css"), brandCss(brand));
  await replaceTokens(output, {
    "__BRAND_NAME__": brand.displayName,
    "__ANNOUNCEMENT__": brand.announcement || "",
    "__FOOTER_NOTE__": brand.footer?.note || "",
    "__BRAND_ID__": brand.id,
    "__THEME_COLOR__": brand.palette.ink
  });
  await assertNoBuildTokens(output);
}

if (target === "preview" || target === "all") await buildPreview();
if (target === "shopify" || target === "all") await buildAdapter("shopify");
if (target === "woocommerce") {
  if (!wooCommerceAdapterRoot) throw new Error("The WooCommerce target requires --woocommerce-adapter-root or SFK_WOOCOMMERCE_ADAPTER_ROOT");
  await buildAdapter("woocommerce", wooCommerceAdapterRoot);
}
if (target === "all" && wooCommerceAdapterRoot) await buildAdapter("woocommerce", wooCommerceAdapterRoot);
if (target === "all" && !wooCommerceAdapterRoot) {
  await removeGenerated("woocommerce-theme");
  await removeGenerated("playground");
  await removeGenerated(path.join("imports", "woocommerce-products.csv"));
}

if (!["preview", "shopify", "woocommerce", "all"].includes(target)) {
  throw new Error(`Unknown target: ${target}`);
}

console.log(`Built ${brandId} (${target}) in ${path.relative(root, outputRoot)}`);
