import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { parseArgs, resolveWorkspacePaths, root } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const paths = resolveWorkspacePaths(args);
const brands = (await readdir(paths.brandsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const cli = path.join(root, "node_modules", "@shopify", "cli", "bin", "run.js");

for (const brand of brands) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "theme", "check", "--path", path.join(paths.outputRoot, brand, "shopify-theme")], {
      cwd: root,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Shopify Theme Check failed for ${brand} (${code})`)));
  });
}
