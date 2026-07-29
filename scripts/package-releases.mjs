import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFile, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs, resetDir, resolveWooCommercePaths, resolveWorkspacePaths, root, writeText } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const paths = resolveWorkspacePaths(args);
const wooCommercePaths = resolveWooCommercePaths(args);
const wooCommerceEnabled = Boolean(wooCommercePaths.adapterRoot || wooCommercePaths.seedFile);
if (wooCommerceEnabled && (!wooCommercePaths.adapterRoot || !wooCommercePaths.seedFile)) {
  throw new Error("Packaging WooCommerce requires both --woocommerce-adapter-root and --woocommerce-seed (or both SFK environment variables)");
}
const brands = (await readdir(paths.brandsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const cli = path.join(root, "node_modules", "@shopify", "cli", "bin", "run.js");

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: root, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Shopify CLI exited with ${code}`)));
  });
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

for (const brand of brands) {
  const brandRoot = path.join(paths.outputRoot, brand);
  const shopifyTheme = path.join(brandRoot, "shopify-theme");
  await run(["theme", "package", "--path", shopifyTheme]);
  const generated = (await readdir(shopifyTheme)).filter((name) => name.endsWith(".zip"));
  if (generated.length !== 1) throw new Error(`${brand}: expected one packaged Shopify theme, found ${generated.length}`);

  const packages = path.join(brandRoot, "packages");
  await resetDir(packages);
  const outputs = {
    "shopify-theme": path.join(packages, `${brand}-shopify-theme.zip`)
  };
  if (wooCommerceEnabled) {
    outputs["woocommerce-theme"] = path.join(packages, `${brand}-woocommerce-theme.zip`);
    outputs["woocommerce-playground"] = path.join(packages, `${brand}-woocommerce-playground.zip`);
  }
  await copyFile(path.join(shopifyTheme, generated[0]), outputs["shopify-theme"]);
  if (wooCommerceEnabled) {
    await copyFile(path.join(brandRoot, "playground", "bundle", `storefront-kit-${brand}.zip`), outputs["woocommerce-theme"]);
    await copyFile(path.join(brandRoot, "playground", `${brand}-playground.zip`), outputs["woocommerce-playground"]);
  }

  const manifest = { brand, files: {} };
  for (const [type, file] of Object.entries(outputs)) {
    manifest.files[type] = { name: path.basename(file), sha256: await sha256(file) };
  }
  await writeText(path.join(packages, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Packaged ${brand} releases in ${path.relative(root, packages)}`);
}
