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

test("the portable catalogue contract validates complete option presentation systems", () => {
  const presented = product("one", {
    options: [{
      name: "Canonical size",
      presentation: {
        label: "Size",
        controlLabel: "Size system",
        defaultSystem: "alpha",
        systems: [{ id: "alpha", label: "Alpha" }, { id: "numeric", label: "Numeric", approximate: true }],
      },
      values: [
        { label: "A", displayLabels: { alpha: "A", numeric: "1" } },
        { label: "B", displayLabels: { alpha: "B", numeric: "2" } },
      ],
    }],
  });
  assert.equal(assertPortableCatalog(brand, catalog(presented, product("two"), product("three"))), true);

  const missing = structuredClone(presented);
  delete missing.options[0].values[1].displayLabels.numeric;
  assert.throws(
    () => assertPortableCatalog(brand, catalog(missing, product("two"), product("three"))),
    /value B is missing display label numeric/,
  );

  const invalidDefault = structuredClone(presented);
  invalidDefault.options[0].presentation.defaultSystem = "missing";
  assert.throws(
    () => assertPortableCatalog(brand, catalog(invalidDefault, product("two"), product("three"))),
    /presentation.defaultSystem missing is not declared/,
  );
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
