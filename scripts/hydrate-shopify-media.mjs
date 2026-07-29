import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./lib.mjs";

const REQUIRED_COLUMNS = ["Handle", "Variant SKU", "Image Src", "Image Position", "Image Alt Text", "Variant Image"];

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function parseCsvDocument(document) {
  const source = String(document).replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  let cellStarted = false;

  function finishRow() {
    row.push(cell);
    rows.push(row);
    row = [];
    cell = "";
    cellStarted = false;
  }

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"') {
      if (cellStarted || cell) throw new Error(`Invalid CSV quote at character ${index + 1}`);
      quoted = true;
      cellStarted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
      cellStarted = false;
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      finishRow();
    } else {
      cell += character;
      cellStarted = true;
    }
  }

  if (quoted) throw new Error("CSV contains an unterminated quoted field");
  if (cellStarted || cell || row.length) finishRow();
  if (!rows.length) throw new Error("Shopify CSV is empty");
  return rows;
}

export function serializeCsvDocument(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function topLevelJsonKeys(source) {
  const keys = [];
  let depth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      const start = index;
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
          continue;
        }
        if (source[index] === '"') break;
        index += 1;
      }
      if (index >= source.length) return keys;

      let next = index + 1;
      while (/\s/.test(source[next] || "")) next += 1;
      let previous = start - 1;
      while (/\s/.test(source[previous] || "")) previous -= 1;
      if (depth === 1 && source[next] === ":" && ["{", ","].includes(source[previous])) {
        keys.push(JSON.parse(source.slice(start, index + 1)));
      }
      continue;
    }
    if (character === "{" || character === "[") depth += 1;
    if (character === "}" || character === "]") depth -= 1;
  }

  return keys;
}

function assertNoDuplicateTopLevelKeys(source) {
  const seen = new Set();
  for (const key of topLevelJsonKeys(source)) {
    if (seen.has(key)) throw new Error(`Duplicate media-map handle: ${key}`);
    seen.add(key);
  }
}

function validateMediaEntry(handle, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Media-map entry "${handle}" must be an object`);
  }
  if (typeof value.url !== "string" || !value.url.trim()) {
    throw new Error(`Media-map entry "${handle}" requires a URL`);
  }

  let url;
  try {
    url = new URL(value.url.trim());
  } catch {
    throw new Error(`Media-map entry "${handle}" has an invalid URL`);
  }
  if (url.protocol !== "https:" || !url.hostname) {
    throw new Error(`Media-map entry "${handle}" must use an HTTPS URL`);
  }
  if (value.alt !== undefined && typeof value.alt !== "string") {
    throw new Error(`Media-map entry "${handle}" has a non-text alt value`);
  }

  const position = value.position ?? 1;
  if (!Number.isInteger(position) || position < 1) {
    throw new Error(`Media-map entry "${handle}" requires a positive integer position`);
  }

  const variantAssets = new Map();
  if (value.variantAssets !== undefined) {
    if (!value.variantAssets || typeof value.variantAssets !== "object" || Array.isArray(value.variantAssets)) {
      throw new Error(`Media-map entry "${handle}" variantAssets must be an object`);
    }
    for (const [rawAsset, assetValue] of Object.entries(value.variantAssets)) {
      const asset = rawAsset.trim();
      if (!asset) throw new Error(`Media-map entry "${handle}" contains an empty variant asset`);
      if (variantAssets.has(asset)) throw new Error(`Media-map entry "${handle}" repeats variant asset ${asset}`);
      variantAssets.set(asset, validateMediaEntry(`${handle}/${asset}`, assetValue));
    }
  }

  return {
    url: url.toString(),
    alt: value.alt?.trim() || "",
    position,
    variantAssets
  };
}

export function parseShopifyMediaManifest(document) {
  let parsed;
  try {
    parsed = JSON.parse(String(document).replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`Media manifest is not valid JSON: ${error.message}`);
  }
  if (!parsed || parsed.version !== 1 || !parsed.products || typeof parsed.products !== "object" || Array.isArray(parsed.products) || !parsed.variants || typeof parsed.variants !== "object" || Array.isArray(parsed.variants)) {
    throw new Error("Media manifest must contain version 1 products and variants");
  }
  for (const [handle, product] of Object.entries(parsed.products)) {
    if (!handle.trim() || !product || typeof product !== "object" || Array.isArray(product) || typeof product.image !== "string" || !product.image.trim()) {
      throw new Error(`Media manifest contains an invalid product: ${handle || "(empty handle)"}`);
    }
  }
  for (const [sku, variant] of Object.entries(parsed.variants)) {
    if (!sku.trim() || !variant || typeof variant !== "object" || Array.isArray(variant) || typeof variant.handle !== "string" || !variant.handle.trim() || typeof variant.image !== "string" || !variant.image.trim()) {
      throw new Error(`Media manifest contains an invalid variant: ${sku || "(empty SKU)"}`);
    }
  }
  return {
    products: new Map(Object.entries(parsed.products)),
    variants: new Map(Object.entries(parsed.variants))
  };
}

export function parseShopifyMediaMap(document) {
  const source = String(document).replace(/^\uFEFF/, "");
  assertNoDuplicateTopLevelKeys(source);

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`Media map is not valid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Media map must be a JSON object keyed by product handle");
  }

  const entries = new Map();
  for (const [rawHandle, value] of Object.entries(parsed)) {
    const handle = rawHandle.trim();
    if (!handle) throw new Error("Media map contains an empty handle");
    if (entries.has(handle)) throw new Error(`Duplicate media-map handle after trimming: ${handle}`);
    entries.set(handle, validateMediaEntry(handle, value));
  }
  if (!entries.size) throw new Error("Media map contains no product handles");
  return entries;
}

function requiredColumnIndexes(header) {
  const indexes = {};
  for (const column of REQUIRED_COLUMNS) {
    const matches = header.flatMap((value, index) => value === column ? [index] : []);
    if (!matches.length) throw new Error(`Shopify CSV is missing required column: ${column}`);
    if (matches.length > 1) throw new Error(`Shopify CSV contains duplicate column: ${column}`);
    indexes[column] = matches[0];
  }
  return indexes;
}

export function hydrateShopifyMediaCsv(csvDocument, mapDocument, manifestDocument) {
  const rows = parseCsvDocument(csvDocument);
  const header = rows[0];
  const indexes = requiredColumnIndexes(header);
  const media = parseShopifyMediaMap(mapDocument);
  const productRows = rows.slice(1).map((row, index) => {
    if (row.length > header.length) throw new Error(`Shopify CSV row ${index + 2} has more fields than its header`);
    return [...row, ...Array(header.length - row.length).fill("")];
  });

  const firstRowByHandle = new Map();
  for (const [index, row] of productRows.entries()) {
    const handle = row[indexes.Handle].trim();
    if (!handle) throw new Error(`Shopify CSV row ${index + 2} has an empty Handle`);
    if (!firstRowByHandle.has(handle)) firstRowByHandle.set(handle, index);
  }

  const unknownHandles = [...media.keys()].filter((handle) => !firstRowByHandle.has(handle));
  if (unknownHandles.length) {
    throw new Error(`Media map contains unknown Shopify handles: ${unknownHandles.join(", ")}`);
  }

  for (const [handle, entry] of media) {
    const firstIndex = firstRowByHandle.get(handle);
    for (const [index, row] of productRows.entries()) {
      if (row[indexes.Handle].trim() !== handle) continue;
      row[indexes["Image Src"]] = index === firstIndex ? entry.url : "";
      row[indexes["Image Position"]] = index === firstIndex ? String(entry.position) : "";
      row[indexes["Image Alt Text"]] = index === firstIndex ? entry.alt : "";
    }
  }

  const hasVariantAssets = [...media.values()].some((entry) => entry.variantAssets.size);
  if (hasVariantAssets && !manifestDocument) {
    throw new Error("A Shopify media manifest is required when the media map contains variantAssets");
  }

  if (manifestDocument) {
    const manifest = parseShopifyMediaManifest(manifestDocument);
    const rowBySku = new Map();
    const rowsByMappedHandle = new Map([...media.keys()].map((handle) => [handle, []]));
    for (const [index, row] of productRows.entries()) {
      const handle = row[indexes.Handle].trim();
      if (!media.has(handle)) continue;
      const sku = row[indexes["Variant SKU"]].trim();
      if (!sku) throw new Error(`Shopify CSV row ${index + 2} has an empty Variant SKU`);
      if (rowBySku.has(sku)) throw new Error(`Shopify CSV repeats Variant SKU: ${sku}`);
      rowBySku.set(sku, row);
      rowsByMappedHandle.get(handle).push({ row, sku });
    }

    for (const [handle, productMedia] of media) {
      const product = manifest.products.get(handle);
      if (!product) throw new Error(`Media manifest is missing product ${handle}`);
      const rowsForHandle = rowsByMappedHandle.get(handle);
      const manifestSkus = new Set();

      for (const [sku, variant] of manifest.variants) {
        if (variant.handle === handle) manifestSkus.add(sku);
      }

      for (const { row, sku } of rowsForHandle) {
        const variant = manifest.variants.get(sku);
        if (!variant) throw new Error(`Media manifest is missing Variant SKU ${sku} for ${handle}`);
        if (variant.handle !== handle) throw new Error(`Media manifest handle mismatch for Variant SKU ${sku}`);
        const mapped = variant.image === product.image
          ? productMedia
          : productMedia.variantAssets.get(variant.image);
        if (!mapped) throw new Error(`Media map is missing variant asset ${handle}/${variant.image}`);
        row[indexes["Variant Image"]] = mapped.url;
        manifestSkus.delete(sku);
      }

      if (manifestSkus.size) {
        throw new Error(`Media manifest contains unknown Variant SKU for ${handle}: ${[...manifestSkus].join(", ")}`);
      }
    }
  }

  return serializeCsvDocument([header, ...productRows]);
}

function usage() {
  return [
    "Hydrate a generated Shopify product CSV with store-specific media URLs.",
    "",
    "Usage:",
    "  npm run shopify:hydrate-media -- --input <products.csv> --map <media.json> [--manifest <media-manifest.json>] --output <products-with-media.csv>",
    "",
    "The input and output paths must be different. The input CSV is never modified."
  ].join("\n");
}

export async function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || args.h) {
    console.log(usage());
    return;
  }

  for (const flag of ["input", "map", "output"]) {
    if (typeof args[flag] !== "string" || !args[flag].trim()) {
      throw new Error(`--${flag} requires a path\n\n${usage()}`);
    }
  }

  const input = path.resolve(process.cwd(), args.input);
  const map = path.resolve(process.cwd(), args.map);
  const output = path.resolve(process.cwd(), args.output);
  if (input === output) throw new Error("--output must be different from --input; the canonical CSV is not modified");

  const manifest = typeof args.manifest === "string" && args.manifest.trim()
    ? path.resolve(process.cwd(), args.manifest)
    : undefined;
  const [csvDocument, mapDocument, manifestDocument] = await Promise.all([
    readFile(input, "utf8"),
    readFile(map, "utf8"),
    manifest ? readFile(manifest, "utf8") : undefined
  ]);
  const hydrated = hydrateShopifyMediaCsv(csvDocument, mapDocument, manifestDocument);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, hydrated, "utf8");
  console.log(`Wrote Shopify media CSV: ${output}`);
}

const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  runCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
