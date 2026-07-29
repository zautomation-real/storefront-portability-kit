import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const root = path.resolve(import.meta.dirname, "..");

const presentationLayouts = new Set(["standard", "editorial", "technical"]);
const productZoomModes = new Set(["click", "hover"]);
const safeSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isSafeSlug(value) {
  return typeof value === "string" && safeSlugPattern.test(value);
}

export function assertSafeSlug(value, label = "Identifier") {
  if (!isSafeSlug(value)) throw new Error(`${label} must use lowercase letters, numbers and single hyphens only`);
  return value;
}

export function presentationLayout(brand) {
  const candidate = brand?.presentation?.layout;
  return presentationLayouts.has(candidate) ? candidate : "standard";
}

export function productZoomMode(brand) {
  const candidate = brand?.presentation?.productZoom;
  return productZoomModes.has(candidate) ? candidate : "click";
}

export function productMediaFocalPoint(brand) {
  const candidate = Number(brand?.presentation?.productMediaHorizontalFocus);
  const horizontal = Number.isFinite(candidate) && candidate >= 0 && candidate <= 100 ? candidate : 50;
  return `${horizontal}% center`;
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export async function exists(file) {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

export async function resetDir(directory) {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
}

export async function copyIfPresent(source, destination) {
  try {
    await cp(source, destination, { recursive: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export async function copyDirectoryFlat(source, destination, prefix = "") {
  await mkdir(destination, { recursive: true });
  let entries = [];
  try {
    entries = await readdir(source, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      throw new Error(`Brand assets must be flat; nested directory found: ${path.join(source, entry.name)}`);
    }
    if (!entry.isFile() || entry.name.endsWith("-source.png")) continue;
    await cp(path.join(source, entry.name), path.join(destination, `${prefix}${entry.name}`));
  }
}

export async function replaceTokens(directory, tokens) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await replaceTokens(file, tokens);
      continue;
    }
    if (!/\.(liquid|json|php|css|html|txt|md)$/i.test(entry.name)) continue;
    let contents = await readFile(file, "utf8");
    for (const [token, value] of Object.entries(tokens)) contents = contents.replaceAll(token, value);
    await writeFile(file, contents, "utf8");
  }
}

export async function assertNoBuildTokens(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await assertNoBuildTokens(file);
      continue;
    }
    if (!/\.(liquid|json|php|css|html|txt|md)$/i.test(entry.name)) continue;
    const contents = await readFile(file, "utf8");
    const unresolved = contents.match(/__[A-Z][A-Z0-9_]*__/g);
    if (unresolved) throw new Error(`${path.relative(root, file)} contains unresolved build tokens: ${[...new Set(unresolved)].join(", ")}`);
  }
}

export async function writeText(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, value, "utf8");
}

export function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const separator = value.indexOf("=");
    if (separator !== -1) {
      result[value.slice(2, separator)] = value.slice(separator + 1);
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    result[key] = next && !next.startsWith("--") ? next : true;
    if (result[key] !== true) index += 1;
  }
  return result;
}

function resolveRootOption(cliValue, environmentValue, fallback, flag) {
  if (cliValue !== undefined && (typeof cliValue !== "string" || !cliValue.trim())) throw new Error(`${flag} requires a path`);
  if (environmentValue !== undefined && typeof environmentValue !== "string") throw new Error(`${flag} requires a path`);
  const configured = cliValue ?? (environmentValue?.trim() || fallback);
  return path.resolve(root, configured);
}

export function resolveWorkspacePaths(args = {}, environment = process.env) {
  return {
    brandsRoot: resolveRootOption(args["brands-root"], environment.SFK_BRANDS_ROOT, "examples", "--brands-root"),
    outputRoot: resolveRootOption(args["output-root"], environment.SFK_OUTPUT_ROOT, "dist", "--output-root")
  };
}

function resolveOptionalPath(cliValue, environmentValue, flag) {
  if (cliValue !== undefined && (typeof cliValue !== "string" || !cliValue.trim())) throw new Error(`${flag} requires a path`);
  if (environmentValue !== undefined && typeof environmentValue !== "string") throw new Error(`${flag} requires a path`);
  const configured = cliValue ?? environmentValue?.trim();
  return configured ? path.resolve(root, configured) : undefined;
}

export function resolveWooCommercePaths(args = {}, environment = process.env) {
  return {
    adapterRoot: resolveOptionalPath(
      args["woocommerce-adapter-root"],
      environment.SFK_WOOCOMMERCE_ADAPTER_ROOT,
      "--woocommerce-adapter-root"
    ),
    seedFile: resolveOptionalPath(
      args["woocommerce-seed"],
      environment.SFK_WOOCOMMERCE_SEED,
      "--woocommerce-seed"
    )
  };
}

export function workspacePathArgs({ brandsRoot, outputRoot }) {
  return ["--brands-root", path.resolve(brandsRoot), "--output-root", path.resolve(outputRoot)];
}

export function wooCommercePathArgs({ adapterRoot, seedFile }) {
  return [
    ...(adapterRoot ? ["--woocommerce-adapter-root", path.resolve(adapterRoot)] : []),
    ...(seedFile ? ["--woocommerce-seed", path.resolve(seedFile)] : [])
  ];
}

export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function productBodyHtml(product) {
  const description = `<p>${escapeHtml(product?.description)}</p>`;
  const details = Array.isArray(product?.details) ? product.details : [];
  if (!details.length) return description;
  return `${description}<div class="product-details">${details.map((detail) => `<section class="product-detail"><h2>${escapeHtml(detail.title)}</h2><p>${escapeHtml(detail.body)}</p></section>`).join("")}</div>`;
}

export function formatMoney(minor, locale, currency) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(minor / 100);
}
