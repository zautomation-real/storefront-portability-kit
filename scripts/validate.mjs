import { spawn } from "node:child_process";
import path from "node:path";
import { parseArgs, resolveWooCommercePaths, resolveWorkspacePaths, root, wooCommercePathArgs, workspacePathArgs } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const workspaceArgs = workspacePathArgs(resolveWorkspacePaths(args));
const wooCommercePaths = resolveWooCommercePaths(args);
const wooCommerceArgs = wooCommercePathArgs(wooCommercePaths);
const wooCommerceEnabled = Boolean(wooCommercePaths.adapterRoot || wooCommercePaths.seedFile);

if (wooCommerceEnabled && (!wooCommercePaths.adapterRoot || !wooCommercePaths.seedFile)) {
  throw new Error("Complete WooCommerce validation requires both --woocommerce-adapter-root and --woocommerce-seed (or both SFK environment variables)");
}

function runNode(scriptArgs, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, scriptArgs, { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${label} exited with code ${code}`)));
  });
}

await runNode([path.join(root, "scripts", "check.mjs"), ...workspaceArgs, ...wooCommerceArgs], "check");
await runNode(["--test"], "test");
await runNode([path.join(root, "scripts", "build-all.mjs"), ...workspaceArgs, ...wooCommerceArgs], "build-all");
if (wooCommerceEnabled) {
  await runNode([path.join(root, "scripts", "build-playground-all.mjs"), ...workspaceArgs, ...wooCommerceArgs], "build-playground-all");
}
await runNode([path.join(root, "scripts", "theme-check.mjs"), ...workspaceArgs], "theme-check");
