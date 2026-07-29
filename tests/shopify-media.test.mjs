import assert from "node:assert/strict";
import test from "node:test";
import { hydrateShopifyMediaCsv, parseCsvDocument, parseShopifyMediaMap, runCli } from "../scripts/hydrate-shopify-media.mjs";

const csv = [
  "Handle,Title,Option1 Name,Option1 Value,Variant SKU,Image Src,Image Position,Image Alt Text,Status",
  "first-product,First product,Size,Small,first-small,,,,active",
  "first-product,,Size,Large,first-large,https://old.example/variant.jpg,2,Old variant image,",
  "second-product,Second product,Title,Default Title,second-default,,,,active"
].join("\n");

test("Shopify media hydration assigns one primary image and preserves variant data", () => {
  const mapping = JSON.stringify({
    "first-product": {
      url: "https://cdn.example.com/first.webp",
      alt: "First product on a neutral background",
      position: 1
    },
    "second-product": { url: "https://cdn.example.com/second.webp" }
  });
  const before = csv;
  const rows = parseCsvDocument(hydrateShopifyMediaCsv(csv, mapping));
  const header = rows[0];
  const source = header.indexOf("Image Src");
  const position = header.indexOf("Image Position");
  const alt = header.indexOf("Image Alt Text");

  assert.equal(csv, before);
  assert.deepEqual(rows[1].slice(0, 5), ["first-product", "First product", "Size", "Small", "first-small"]);
  assert.deepEqual(rows[2].slice(0, 5), ["first-product", "", "Size", "Large", "first-large"]);
  assert.equal(rows[1][source], "https://cdn.example.com/first.webp");
  assert.equal(rows[1][position], "1");
  assert.equal(rows[1][alt], "First product on a neutral background");
  assert.equal(rows[2][source], "");
  assert.equal(rows[2][position], "");
  assert.equal(rows[2][alt], "");
  assert.equal(rows[3][source], "https://cdn.example.com/second.webp");
  assert.equal(rows[3][position], "1");
  assert.equal(rows[3][alt], "");
});

test("Shopify media hydration rejects unknown handles", () => {
  assert.throws(
    () => hydrateShopifyMediaCsv(csv, JSON.stringify({ missing: { url: "https://cdn.example.com/missing.webp" } })),
    /unknown Shopify handles: missing/
  );
});

test("media maps reject duplicate and normalized duplicate handles", () => {
  assert.throws(
    () => parseShopifyMediaMap('{"first-product":{"url":"https://cdn.example.com/one.webp"},"first-product":{"url":"https://cdn.example.com/two.webp"}}'),
    /Duplicate media-map handle: first-product/
  );
  assert.throws(
    () => parseShopifyMediaMap('{"first-product":{"url":"https://cdn.example.com/one.webp"}," first-product ":{"url":"https://cdn.example.com/two.webp"}}'),
    /Duplicate media-map handle after trimming: first-product/
  );
});

test("media maps require HTTPS URLs and valid image positions", () => {
  assert.throws(
    () => parseShopifyMediaMap(JSON.stringify({ product: { url: "http://cdn.example.com/image.webp" } })),
    /must use an HTTPS URL/
  );
  assert.throws(
    () => parseShopifyMediaMap(JSON.stringify({ product: { url: "https://cdn.example.com/image.webp", position: 0 } })),
    /positive integer position/
  );
});

test("Shopify media hydration validates required image columns", () => {
  const map = JSON.stringify({ product: { url: "https://cdn.example.com/image.webp" } });
  assert.throws(
    () => hydrateShopifyMediaCsv("Handle,Image Src,Image Position\nproduct,,", map),
    /missing required column: Image Alt Text/
  );
  assert.throws(
    () => hydrateShopifyMediaCsv("Handle,Image Src,Image Position,Image Alt Text,Image Src\nproduct,,,,", map),
    /duplicate column: Image Src/
  );
});

test("Shopify media hydration preserves quoted multiline fields", () => {
  const source = [
    "Handle,Body (HTML),Image Src,Image Position,Image Alt Text",
    'product,"First line, with comma\nSecond line",,,'
  ].join("\n");
  const output = hydrateShopifyMediaCsv(
    source,
    JSON.stringify({ product: { url: "https://cdn.example.com/image.webp", alt: "Product" } })
  );
  const rows = parseCsvDocument(output);
  assert.equal(rows[1][1], "First line, with comma\nSecond line");
  assert.equal(rows[1][2], "https://cdn.example.com/image.webp");
});

test("the CLI refuses to replace its canonical input", async () => {
  await assert.rejects(
    runCli(["--input", "products.csv", "--map", "media.json", "--output", "products.csv"]),
    /--output must be different from --input/
  );
});
