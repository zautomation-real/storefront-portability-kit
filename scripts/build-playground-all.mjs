import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { parseArgs, resolveWooCommercePaths, resolveWorkspacePaths, root, wooCommercePathArgs, workspacePathArgs } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const paths = resolveWorkspacePaths(args);
const wooCommercePaths = resolveWooCommercePaths(args);
if (!wooCommercePaths.adapterRoot || !wooCommercePaths.seedFile) {
  throw new Error("WooCommerce Playground requires both --woocommerce-adapter-root and --woocommerce-seed (or both SFK environment variables)");
}
const brands = (await readdir(paths.brandsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

for (const brand of brands) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(root, "scripts", "build-playground.mjs"),
      "--brand",
      brand,
      ...workspacePathArgs(paths),
      ...wooCommercePathArgs(wooCommercePaths)
    ], {
      cwd: root,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Playground bundle failed for ${brand} (${code})`)));
  });
}

console.log(`Built ${brands.length} WooCommerce Playground bundles.`);
