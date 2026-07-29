import { randomUUID } from "node:crypto";
import { open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

const JSON_FILE = "catalog.json";
const CSV_FILE = "catalog.csv";

const STRING_FIELDS = ["id", "name", "image", "category", "description", "badge"];
const INTEGER_FIELDS = ["price", "compareAtPrice"];
const COMPLEX_FIELDS = ["details", "options", "cardMediaSelector", "variantMedia"];
const PRODUCT_FIELDS = [
  "id",
  "name",
  "price",
  "compareAtPrice",
  "image",
  "category",
  "description",
  "badge",
  ...COMPLEX_FIELDS
];
const REQUIRED_HEADERS = ["id", "name", "price", "image", "category", "description"];

export const catalogCsvHeaders = [...PRODUCT_FIELDS, "extra", "catalogMeta"];

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
      .map((key) => [key, canonicalValue(value[key])])
  );
}

function compactJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function encodeCsvField(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvError(message, row, column) {
  const position = [row != null ? `row ${row}` : "", column ? `column ${column}` : ""].filter(Boolean).join(", ");
  return new Error(`Invalid catalog CSV${position ? ` (${position})` : ""}: ${message}`);
}

export function parseCsv(text) {
  const input = String(text).replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let afterQuote = false;
  let endedWithRecordSeparator = false;

  const pushField = () => {
    row.push(field);
    field = "";
    afterQuote = false;
  };
  const pushRow = () => {
    pushField();
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    endedWithRecordSeparator = false;

    if (inQuotes) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (afterQuote) {
      if (character === ",") {
        pushField();
        continue;
      }
      if (character === "\r" || character === "\n") {
        if (character === "\r" && input[index + 1] === "\n") index += 1;
        pushRow();
        endedWithRecordSeparator = true;
        continue;
      }
      throw csvError("unexpected character after a closing quote", rows.length + 1, row.length + 1);
    }

    if (character === '"') {
      if (field.length) throw csvError("a quoted field must start with a quote", rows.length + 1, row.length + 1);
      inQuotes = true;
      continue;
    }
    if (character === ",") {
      pushField();
      continue;
    }
    if (character === "\r" || character === "\n") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      pushRow();
      endedWithRecordSeparator = true;
      continue;
    }
    field += character;
  }

  if (inQuotes) throw csvError("unterminated quoted field", rows.length + 1, row.length + 1);
  if (!endedWithRecordSeparator && (field.length || row.length || afterQuote)) pushRow();
  return rows;
}

function parseJsonColumn(value, rowNumber, column, fallback) {
  if (value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw csvError(`expected compact JSON (${error.message})`, rowNumber, column);
  }
}

function parseInteger(value, rowNumber, column) {
  if (value === "") return undefined;
  if (!/^-?\d+$/.test(value)) throw csvError("expected an integer", rowNumber, column);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw csvError("integer is outside JavaScript's safe range", rowNumber, column);
  return number;
}

export function parseCatalogCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw csvError("the file is empty");

  const headers = rows[0];
  const headerSet = new Set(headers);
  if (headerSet.size !== headers.length) {
    const duplicate = headers.find((header, index) => headers.indexOf(header) !== index);
    throw csvError(`duplicate header ${JSON.stringify(duplicate)}`, 1);
  }
  for (const required of REQUIRED_HEADERS) {
    if (!headerSet.has(required)) throw csvError(`missing required header ${JSON.stringify(required)}`, 1);
  }
  for (const header of headers) {
    if (!catalogCsvHeaders.includes(header)) throw csvError(`unsupported header ${JSON.stringify(header)}`, 1);
  }

  const indexOf = (header) => headers.indexOf(header);
  const products = [];
  let catalogMeta = {};

  for (const [rowIndex, cells] of rows.slice(1).entries()) {
    const rowNumber = rowIndex + 2;
    if (cells.length !== headers.length) {
      throw csvError(`expected ${headers.length} fields but received ${cells.length}`, rowNumber);
    }
    const cell = (header) => {
      const index = indexOf(header);
      return index === -1 ? "" : cells[index];
    };
    const product = {};

    for (const field of STRING_FIELDS) {
      const value = cell(field);
      if (value !== "" || REQUIRED_HEADERS.includes(field)) product[field] = value;
    }
    for (const field of INTEGER_FIELDS) {
      const value = parseInteger(cell(field), rowNumber, field);
      if (value !== undefined) product[field] = value;
    }
    for (const field of COMPLEX_FIELDS) {
      const value = parseJsonColumn(cell(field), rowNumber, field, undefined);
      if (value !== undefined) product[field] = value;
    }

    const extra = parseJsonColumn(cell("extra"), rowNumber, "extra", {});
    if (!extra || typeof extra !== "object" || Array.isArray(extra)) {
      throw csvError("extra must contain a JSON object", rowNumber, "extra");
    }
    for (const key of Object.keys(extra)) {
      if (PRODUCT_FIELDS.includes(key)) throw csvError(`extra cannot redefine ${JSON.stringify(key)}`, rowNumber, "extra");
    }

    const rowMeta = parseJsonColumn(cell("catalogMeta"), rowNumber, "catalogMeta", {});
    if (!rowMeta || typeof rowMeta !== "object" || Array.isArray(rowMeta) || Object.hasOwn(rowMeta, "products")) {
      throw csvError("catalogMeta must contain a JSON object without a products key", rowNumber, "catalogMeta");
    }
    if (Object.keys(rowMeta).length) {
      if (rowIndex !== 0) throw csvError("catalogMeta may only be set on the first product row", rowNumber, "catalogMeta");
      catalogMeta = rowMeta;
    }

    products.push({ ...product, ...extra });
  }

  return { ...catalogMeta, products };
}

export function serializeCatalogCsv(catalog) {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog) || !Array.isArray(catalog.products)) {
    throw new TypeError("Catalog must be an object with a products array");
  }
  const catalogMeta = Object.fromEntries(Object.entries(catalog).filter(([key]) => key !== "products"));
  const rows = [catalogCsvHeaders];

  for (const [index, product] of catalog.products.entries()) {
    if (!product || typeof product !== "object" || Array.isArray(product)) {
      throw new TypeError(`Catalog product ${index + 1} must be an object`);
    }
    const extra = Object.fromEntries(Object.entries(product).filter(([key]) => !PRODUCT_FIELDS.includes(key)));
    rows.push(catalogCsvHeaders.map((header) => {
      if (header === "extra") return Object.keys(extra).length ? compactJson(extra) : "";
      if (header === "catalogMeta") return index === 0 && Object.keys(catalogMeta).length ? compactJson(catalogMeta) : "";
      const value = product[header];
      if (value == null) return "";
      if (COMPLEX_FIELDS.includes(header)) return compactJson(value);
      return String(value);
    }));
  }

  return `${rows.map((row) => row.map(encodeCsvField).join(",")).join("\r\n")}\r\n`;
}

export function serializeCatalogSource(source, catalog) {
  const format = typeof source === "string" ? source : source?.format;
  if (format === "json") {
    if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) throw new TypeError("Catalog must be an object");
    return `${JSON.stringify(catalog, null, 2)}\n`;
  }
  if (format === "csv") return serializeCatalogCsv(catalog);
  throw new Error(`Unsupported catalog source format: ${format}`);
}

async function isFile(file) {
  try {
    const details = await stat(file);
    if (!details.isFile()) throw new Error(`Catalog source must be a file: ${file}`);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function readCatalogSource(brandDir) {
  const jsonPath = path.join(brandDir, JSON_FILE);
  const csvPath = path.join(brandDir, CSV_FILE);
  const [hasJson, hasCsv] = await Promise.all([isFile(jsonPath), isFile(csvPath)]);

  if (hasJson === hasCsv) {
    const found = hasJson ? "both catalog.json and catalog.csv" : "neither catalog.json nor catalog.csv";
    throw new Error(`Brand directory must contain exactly one catalog source; found ${found}`);
  }

  const format = hasJson ? "json" : "csv";
  const sourcePath = hasJson ? jsonPath : csvPath;
  const contents = await readFile(sourcePath, "utf8");
  let catalog;
  if (format === "json") {
    try {
      catalog = JSON.parse(contents);
    } catch (error) {
      throw new Error(`Invalid catalog JSON at ${sourcePath}: ${error.message}`);
    }
  } else {
    catalog = parseCatalogCsv(contents);
  }
  return { format, path: sourcePath, catalog };
}

export async function writeCatalogSource(source, catalog) {
  if (!source?.path) throw new Error("Catalog source path is required");
  const contents = serializeCatalogSource(source, catalog);
  const temporaryPath = path.join(
    path.dirname(source.path),
    `.${path.basename(source.path)}.${process.pid}.${randomUUID()}.tmp`
  );
  let handle;
  try {
    handle = await open(temporaryPath, "wx");
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, source.path);
  } finally {
    await handle?.close().catch(() => {});
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}
