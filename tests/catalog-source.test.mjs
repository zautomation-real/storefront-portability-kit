import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  catalogCsvHeaders,
  parseCatalogCsv,
  parseCsv,
  readCatalogSource,
  serializeCatalogCsv,
  serializeCatalogSource,
  writeCatalogSource
} from "../scripts/catalog-source.mjs";
import { root } from "../scripts/lib.mjs";

const richCatalog = {
  $schema: "../../schema/catalog.schema.json",
  revision: 3,
  products: [
    {
      id: "quiet-serum",
      name: "Quiet, \"Night\" Serum",
      price: 4200,
      compareAtPrice: 4800,
      image: "assets/quiet-serum.webp",
      category: "Skin\ncare",
      description: "A calm first line.\nA second line, with a comma and \"quotes\".",
      badge: "Editor’s pick",
      details: [{ title: "How it feels", body: "Soft, then weightless." }],
      options: [{ values: ["30 ml", { priceModifier: 1200, label: "60 ml" }], name: "Size" }],
      cardMediaSelector: {
        choices: [{ swatch: "#112233", value: "Night" }, { value: "Dawn", swatch: "#DDEEFF" }],
        option: "Finish"
      },
      variantMedia: [{ image: "assets/night.webp", match: { Finish: "Night" }, alt: "Night bottle" }],
      customFlags: { featured: true, channels: ["web", "retail"] }
    },
    {
      id: "daily-oil",
      name: "Daily Oil",
      price: 0,
      image: "assets/daily-oil.webp",
      category: "Skin care",
      description: "Simple and direct."
    }
  ]
};

async function temporaryDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "storefront-catalog-source-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("readCatalogSource requires exactly one JSON or CSV source", async (t) => {
  const directory = await temporaryDirectory(t);

  await assert.rejects(readCatalogSource(directory), /exactly one catalog source; found neither/);

  const jsonPath = path.join(directory, "catalog.json");
  await writeFile(jsonPath, JSON.stringify(richCatalog), "utf8");
  const jsonSource = await readCatalogSource(directory);
  assert.equal(jsonSource.format, "json");
  assert.equal(jsonSource.path, jsonPath);
  assert.deepEqual(jsonSource.catalog, richCatalog);

  await writeFile(path.join(directory, "catalog.csv"), serializeCatalogCsv(richCatalog), "utf8");
  await assert.rejects(readCatalogSource(directory), /exactly one catalog source; found both/);

  await rm(jsonPath);
  const csvSource = await readCatalogSource(directory);
  assert.equal(csvSource.format, "csv");
  assert.equal(csvSource.path, path.join(directory, "catalog.csv"));
  assert.deepEqual(csvSource.catalog, richCatalog);
});

test("catalog CSV is RFC 4180-safe and round-trips scalar, complex and extension fields", () => {
  const csv = serializeCatalogCsv(richCatalog);
  assert.ok(csv.endsWith("\r\n"));
  assert.equal(parseCsv(csv)[0].join(","), catalogCsvHeaders.join(","));
  assert.match(csv, /"Quiet, ""Night"" Serum"/);
  assert.match(csv, /"A calm first line\.\nA second line, with a comma and ""quotes""\."/);
  assert.deepEqual(parseCatalogCsv(`\uFEFF${csv}`), richCatalog);
});

test("CSV serialization is canonical while JSON preserves its human field order", () => {
  const reordered = {
    products: richCatalog.products.map((product) => Object.fromEntries(Object.entries(product).reverse())),
    revision: 3,
    $schema: "../../schema/catalog.schema.json"
  };

  assert.equal(serializeCatalogSource("json", richCatalog), `${JSON.stringify(richCatalog, null, 2)}\n`);
  assert.notEqual(serializeCatalogSource("json", reordered), serializeCatalogSource("json", richCatalog));
  assert.equal(serializeCatalogSource("csv", reordered), serializeCatalogSource("csv", richCatalog));
});

test("writeCatalogSource preserves the selected source format and path", async (t) => {
  const directory = await temporaryDirectory(t);
  const sourcePath = path.join(directory, "catalog.csv");
  const source = { format: "csv", path: sourcePath };

  await writeCatalogSource(source, richCatalog);
  assert.deepEqual((await readCatalogSource(directory)).catalog, richCatalog);
  await assert.rejects(stat(path.join(directory, "catalog.json")), { code: "ENOENT" });
  assert.deepEqual(await readdir(directory), ["catalog.csv"]);

  const previousContents = await readFile(sourcePath, "utf8");
  await assert.rejects(writeCatalogSource(source, { products: [null] }), /must be an object/);
  assert.equal(await readFile(sourcePath, "utf8"), previousContents);
  assert.deepEqual(await readdir(directory), ["catalog.csv"]);
});

test("catalog CSV rejects malformed structure instead of guessing", () => {
  const validHeader = catalogCsvHeaders.join(",");
  const invalidIntegerRow = catalogCsvHeaders.map((header) => header === "price" ? "not-a-number" : "");
  const invalidJsonRow = catalogCsvHeaders.map((header) => header === "details" ? '"{""broken"":}"' : "");
  assert.throws(() => parseCatalogCsv("id,name\r\nfirst,First\r\n"), /missing required header "price"/);
  assert.throws(() => parseCatalogCsv(`${validHeader}\r\n"unfinished`), /unterminated quoted field/);
  assert.throws(() => parseCatalogCsv(`${validHeader}\r\n${invalidIntegerRow.join(",")}\r\n`), /expected an integer/);
  assert.throws(() => parseCatalogCsv(`${validHeader}\r\n${invalidJsonRow.join(",")}\r\n`), /expected compact JSON/);
  assert.throws(() => parseCatalogCsv("id,id,name,price,image,category,description\r\na,a,A,1,x,C,D\r\n"), /duplicate header "id"/);
  assert.throws(() => parseCsv('a,"b"tail\r\n'), /unexpected character after a closing quote/);
});

test("build and check consume a CSV-only brand through the shared loader", async (t) => {
  const directory = await temporaryDirectory(t);
  const brandsRoot = path.join(directory, "brands");
  const outputRoot = path.join(directory, "output");
  const brandDir = path.join(brandsRoot, "example-store");
  await mkdir(brandsRoot, { recursive: true });
  await cp(path.join(root, "examples", "example-store"), brandDir, { recursive: true });

  const catalog = JSON.parse(await readFile(path.join(brandDir, "catalog.json"), "utf8"));
  await writeFile(path.join(brandDir, "catalog.csv"), serializeCatalogCsv(catalog), "utf8");
  await rm(path.join(brandDir, "catalog.json"));

  const checkOutput = execFileSync(process.execPath, [
    path.join(root, "scripts", "check.mjs"),
    "--brands-root", brandsRoot
  ], { cwd: root, encoding: "utf8" });
  assert.match(checkOutput, /Checked 1 brand packs/);

  const buildOutput = execFileSync(process.execPath, [
    path.join(root, "scripts", "build.mjs"),
    "--brand", "example-store",
    "--target", "preview",
    "--brands-root", brandsRoot,
    "--output-root", outputRoot
  ], { cwd: root, encoding: "utf8" });
  assert.match(buildOutput, /Built example-store \(preview\)/);
  assert.ok((await stat(path.join(outputRoot, "example-store", "preview", "index.html"))).isFile());
});
