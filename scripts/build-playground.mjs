import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs, readJson, resetDir, resolveWooCommercePaths, resolveWorkspacePaths, root, wooCommercePathArgs, workspacePathArgs, writeText } from "./lib.mjs";
import { zipDirectory } from "./zip.mjs";

const defaults = {
  php: "8.3",
  wordpress: "6.9",
  woocommerce: "10.9.4"
};

const args = parseArgs(process.argv.slice(2));
const brandId = args.brand || "example-store";
const paths = resolveWorkspacePaths(args);
const wooCommercePaths = resolveWooCommercePaths(args);
if (!wooCommercePaths.adapterRoot || !wooCommercePaths.seedFile) {
  throw new Error("WooCommerce Playground requires both --woocommerce-adapter-root and --woocommerce-seed (or both SFK environment variables)");
}
const versions = {
  php: args.php || defaults.php,
  wordpress: args.wordpress || defaults.wordpress,
  woocommerce: args.woocommerce || defaults.woocommerce
};
const brandDir = path.join(paths.brandsRoot, brandId);
const brand = await readJson(path.join(brandDir, "brand.json"));
const catalog = await readJson(path.join(brandDir, "catalog.json"));
if (brand.id !== brandId) throw new Error(`Brand id mismatch: expected ${brandId}, received ${brand.id}`);

function runNode(script, scriptArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...scriptArgs], { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(script)} exited with code ${code}`)));
  });
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function assertMedia() {
  const references = [
    ["hero.media", brand.hero?.media],
    ...((brand.sections || []).map((section, index) => [`sections[${index}].media`, section.media])),
    ...((catalog.products || []).map((product, index) => [`products[${index}].image`, product.image]))
  ].filter(([, relative]) => relative);
  const missing = [];
  for (const [label, relative] of references) {
    try {
      await readFile(path.join(brandDir, relative));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      missing.push(`${label}: ${relative}`);
    }
  }
  if (missing.length) throw new Error(`Missing media for ${brandId}:\n- ${missing.join("\n- ")}`);
}

await assertMedia();
await runNode(path.join(root, "scripts", "build.mjs"), [
  "--brand",
  brandId,
  "--target",
  "woocommerce",
  ...workspacePathArgs(paths),
  ...wooCommercePathArgs(wooCommercePaths)
]);

const output = path.join(paths.outputRoot, brandId, "playground");
const bundle = path.join(output, "bundle");
const themeSource = path.join(paths.outputRoot, brandId, "woocommerce-theme");
const themeSlug = `storefront-kit-${brandId}`;
const themeZipName = `${themeSlug}.zip`;
const themeZip = path.join(bundle, themeZipName);
const seedSource = wooCommercePaths.seedFile;
const seedTarget = path.join(bundle, "seed.php");

await resetDir(output);
await mkdir(bundle, { recursive: true });
await zipDirectory(themeSource, themeZip, {
  prefix: themeSlug,
  include: (file) => !file.endsWith("-source.png") && !file.startsWith("fixtures/")
});
await copyFile(seedSource, seedTarget);

const pluginUrl = `https://downloads.wordpress.org/plugin/woocommerce.${versions.woocommerce}.zip`;
const blueprint = {
  $schema: "https://playground.wordpress.net/blueprint-schema.json",
  meta: {
    title: `${brand.displayName} WooCommerce demo`,
    author: "Zay / Creative Systems",
    description: "A native WooCommerce storefront built from the shared storefront contract."
  },
  preferredVersions: { php: versions.php, wp: versions.wordpress },
  features: { networking: true },
  landingPage: "/",
  login: true,
  steps: [
    {
      step: "installPlugin",
      pluginData: { resource: "url", url: pluginUrl },
      options: { activate: true }
    },
    {
      step: "installTheme",
      themeData: { resource: "bundled", path: `/${themeZipName}` },
      options: { activate: true }
    },
    {
      step: "writeFile",
      path: "/tmp/sfk-seed.php",
      data: { resource: "bundled", path: "/seed.php" }
    },
    {
      step: "runPHP",
      code: "<?php require '/tmp/sfk-seed.php';"
    }
  ]
};

const blueprintFile = path.join(bundle, "blueprint.json");
await writeText(blueprintFile, `${JSON.stringify(blueprint, null, 2)}\n`);
const manifest = {
  brand: brandId,
  generatedBy: "scripts/build-playground.mjs",
  versions,
  woocommerce: { url: pluginUrl },
  files: {
    [themeZipName]: await sha256(themeZip),
    "seed.php": await sha256(seedTarget),
    "blueprint.json": await sha256(blueprintFile)
  }
};
await writeText(path.join(bundle, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const bundleZip = path.join(output, `${brandId}-playground.zip`);
await zipDirectory(bundle, bundleZip);
console.log(`Built ${brandId} Playground bundle in ${path.relative(root, bundleZip)}`);
