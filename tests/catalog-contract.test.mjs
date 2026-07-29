import assert from "node:assert/strict";
import test from "node:test";
import { assertPortableCatalog } from "../scripts/catalog-contract.mjs";

const brand = { id: "test-brand", displayName: "Test Brand" };

function product(id, overrides = {}) {
  return {
    id,
    name: `Product ${id}`,
    price: 1000,
    image: `assets/${id}.webp`,
    category: "Category",
    description: "Description",
    ...overrides,
  };
}

function catalog(...products) {
  return { products };
}

test("the portable catalogue contract accepts a valid source", () => {
  assert.equal(assertPortableCatalog(brand, catalog(
    product("one"),
    product("two", { options: [{ name: "Size", values: ["Small", { label: "Large", priceModifier: 200 }] }] }),
    product("three", { compareAtPrice: 1500 }),
  )), true);
});

test("the portable catalogue contract fails closed on duplicate product ids", () => {
  assert.throws(
    () => assertPortableCatalog(brand, catalog(product("same"), product("same"), product("other"))),
    (error) => error.code === "INVALID_PORTABLE_CATALOG" && /duplicate product id same/.test(error.message),
  );
});

test("the portable catalogue contract fails closed on generated SKU collisions", () => {
  assert.throws(
    () => assertPortableCatalog(brand, catalog(
      product("same-slug", {
        options: [{ name: "Finish", values: ["Warm White", "Warm-White"] }],
      }),
      product("second"),
      product("other"),
    )),
    (error) => error.code === "INVALID_PORTABLE_CATALOG" &&
      /Shopify variant SKU collision/.test(error.message),
  );
});

test("the portable catalogue contract rejects silent option truncation and invalid variant prices", () => {
  assert.throws(
    () => assertPortableCatalog(brand, catalog(
      product("one", {
        options: [
          { name: "A", values: ["a"] },
          { name: "B", values: ["b"] },
          { name: "C", values: ["c"] },
          { name: "D", values: ["d"] },
        ],
      }),
      product("two", { options: [{ name: "Size", values: [{ label: "Bad", priceModifier: -1200 }] }] }),
      product("three"),
    )),
    (error) => error.code === "INVALID_PORTABLE_CATALOG" &&
      /at most 3 options/.test(error.message) &&
      /valid non-negative price/.test(error.message),
  );
});
