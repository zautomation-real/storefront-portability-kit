import { readFile, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { parseArgs, resolveWooCommercePaths, resolveWorkspacePaths, root, wooCommercePathArgs, workspacePathArgs, writeText } from "./lib.mjs";
import { combineShopifyProductCsv } from "./platform-output.mjs";

const args = parseArgs(process.argv.slice(2));
const paths = resolveWorkspacePaths(args);
const wooCommercePaths = resolveWooCommercePaths(args);
const brands = (await readdir(paths.brandsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

for (const brand of brands) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(root, "scripts", "build.mjs"),
      "--brand",
      brand,
      "--target",
      "all",
      ...workspacePathArgs(paths),
      ...wooCommercePathArgs(wooCommercePaths)
    ], {
      cwd: root,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Build failed for ${brand} (${code})`)));
  });
}

const shopifyCatalogs = await Promise.all(brands.map((brand) => readFile(path.join(paths.outputRoot, brand, "imports", "shopify-products.csv"), "utf8")));
await writeText(path.join(paths.outputRoot, "shopify-products-all.csv"), combineShopifyProductCsv(shopifyCatalogs));

const targets = wooCommercePaths.adapterRoot ? "preview, Shopify and WooCommerce" : "preview and Shopify";
console.log(`Built ${brands.length} storefronts across ${targets}, plus one combined Shopify catalog.`);
