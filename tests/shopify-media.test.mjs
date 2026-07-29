import assert from "node:assert/strict";
import test from "node:test";
import { hydrateShopifyMediaCsv, parseCsvDocument, parseShopifyMediaManifest, parseShopifyMediaMap, runCli } from "../scripts/hydrate-shopify-media.mjs";

const csv = [
  "Handle,Title,Option1 Name,Option1 Value,Variant SKU,Image Src,Image Position,Image Alt Text,Variant Image,Status",
  "first-product,First product,Size,Small,first-small,,,,,active",
  "first-product,,Size,Large,first-large,https://old.example/variant.jpg,2,Old variant image,https://old.example/variant.jpg,",
  "second-product,Second product,Title,Default Title,second-default,,,,,active"
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
  const variantImage = header.indexOf("Variant Image");

  assert.equal(csv, before);
  assert.deepEqual(rows[1].slice(0, 5), ["first-product", "First product", "Size", "Small", "first-small"]);
  assert.deepEqual(rows[2].slice(0, 5), ["first-product", "", "Size", "Large", "first-large"]);
  assert.equal(rows[1][source], "https://cdn.example.com/first.webp");
  assert.equal(rows[1][position], "1");
  assert.equal(rows[1][alt], "First product on a neutral background");
  assert.equal(rows[2][source], "");
  assert.equal(rows[2][position], "");
  assert.equal(rows[2][alt], "");
  assert.equal(rows[2][variantImage], "https://old.example/variant.jpg");
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
    () => hydrateShopifyMediaCsv("Handle,Variant SKU,Image Src,Image Position,Variant Image\nproduct,sku,,,", map),
    /missing required column: Image Alt Text/
  );
  assert.throws(
    () => hydrateShopifyMediaCsv("Handle,Variant SKU,Image Src,Image Position,Image Alt Text,Variant Image,Image Src\nproduct,sku,,,,,", map),
    /duplicate column: Image Src/
  );
});

test("Shopify media hydration preserves quoted multiline fields", () => {
  const source = [
    "Handle,Body (HTML),Variant SKU,Image Src,Image Position,Image Alt Text,Variant Image",
    'product,"First line, with comma\nSecond line",product-default,,,, '
  ].join("\n");
  const output = hydrateShopifyMediaCsv(
    source,
    JSON.stringify({ product: { url: "https://cdn.example.com/image.webp", alt: "Product" } })
  );
  const rows = parseCsvDocument(output);
  assert.equal(rows[1][1], "First line, with comma\nSecond line");
  assert.equal(rows[1][3], "https://cdn.example.com/image.webp");
});

test("Shopify media hydration maps portable variant assets to CDN URLs", () => {
  const mapping = JSON.stringify({
    "first-product": {
      url: "https://cdn.example.com/first.webp",
      variantAssets: {
        "assets/first-large.webp": { url: "https://cdn.example.com/first-large.webp" }
      }
    },
    "second-product": { url: "https://cdn.example.com/second.webp" }
  });
  const manifest = JSON.stringify({
    version: 1,
    products: {
      "first-product": { image: "assets/first.webp", alt: "First product" },
      "second-product": { image: "assets/second.webp", alt: "Second product" }
    },
    variants: {
      "first-small": { handle: "first-product", image: "assets/first.webp", alt: "First product" },
      "first-large": { handle: "first-product", image: "assets/first-large.webp", alt: "First product large" },
      "second-default": { handle: "second-product", image: "assets/second.webp", alt: "Second product" }
    }
  });
  assert.equal(parseShopifyMediaManifest(manifest).variants.size, 3);
  const rows = parseCsvDocument(hydrateShopifyMediaCsv(csv, mapping, manifest));
  const variantImage = rows[0].indexOf("Variant Image");
  assert.equal(rows[1][variantImage], "https://cdn.example.com/first.webp");
  assert.equal(rows[2][variantImage], "https://cdn.example.com/first-large.webp");
  assert.equal(rows[3][variantImage], "https://cdn.example.com/second.webp");
});

test("Shopify media hydration supports a partial media map with a full manifest", () => {
  const mapping = JSON.stringify({
    "first-product": {
      url: "https://cdn.example.com/first.webp",
      variantAssets: {
        "assets/first-large.webp": { url: "https://cdn.example.com/first-large.webp" }
      }
    }
  });
  const manifest = JSON.stringify({
    version: 1,
    products: {
      "first-product": { image: "assets/first.webp", alt: "First product" },
      "second-product": { image: "assets/second.webp", alt: "Second product" }
    },
    variants: {
      "first-small": { handle: "first-product", image: "assets/first.webp", alt: "First product" },
      "first-large": { handle: "first-product", image: "assets/first-large.webp", alt: "First product large" },
      "second-default": { handle: "second-product", image: "assets/second.webp", alt: "Second product" }
    }
  });
  const rows = parseCsvDocument(hydrateShopifyMediaCsv(csv, mapping, manifest));
  const source = rows[0].indexOf("Image Src");
  const variantImage = rows[0].indexOf("Variant Image");

  assert.equal(rows[1][variantImage], "https://cdn.example.com/first.webp");
  assert.equal(rows[2][variantImage], "https://cdn.example.com/first-large.webp");
  assert.equal(rows[3][source], "");
  assert.equal(rows[3][variantImage], "");
});

test("Shopify media hydration requires an exact manifest SKU set for each mapped handle", () => {
  const mapping = JSON.stringify({
    "first-product": {
      url: "https://cdn.example.com/first.webp",
      variantAssets: {
        "assets/first-large.webp": { url: "https://cdn.example.com/first-large.webp" }
      }
    }
  });
  const products = {
    "first-product": { image: "assets/first.webp", alt: "First product" }
  };
  const missingVariant = JSON.stringify({
    version: 1,
    products,
    variants: {
      "first-small": { handle: "first-product", image: "assets/first.webp", alt: "First product" }
    }
  });
  const extraVariant = JSON.stringify({
    version: 1,
    products,
    variants: {
      "first-small": { handle: "first-product", image: "assets/first.webp", alt: "First product" },
      "first-large": { handle: "first-product", image: "assets/first-large.webp", alt: "First product large" },
      "first-extra": { handle: "first-product", image: "assets/first.webp", alt: "Unexpected" }
    }
  });

  assert.throws(
    () => hydrateShopifyMediaCsv(csv, mapping, missingVariant),
    /missing Variant SKU first-large for first-product/
  );
  assert.throws(
    () => hydrateShopifyMediaCsv(csv, mapping, extraVariant),
    /unknown Variant SKU for first-product: first-extra/
  );
});

test("the CLI refuses to replace its canonical input", async () => {
  await assert.rejects(
    runCli(["--input", "products.csv", "--map", "media.json", "--output", "products.csv"]),
    /--output must be different from --input/
  );
});
