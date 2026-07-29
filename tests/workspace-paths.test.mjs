import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { parseArgs, resolveWooCommercePaths, resolveWorkspacePaths, root, wooCommercePathArgs, workspacePathArgs } from "../scripts/lib.mjs";

test("workspace paths use the public example and dist defaults", () => {
  assert.deepEqual(resolveWorkspacePaths({}, {}), {
    brandsRoot: path.join(root, "examples"),
    outputRoot: path.join(root, "dist")
  });
});

test("workspace paths accept environment configuration relative to the project root", () => {
  assert.deepEqual(resolveWorkspacePaths({}, {
    SFK_BRANDS_ROOT: "fixtures/brand-packs",
    SFK_OUTPUT_ROOT: "generated/storefronts"
  }), {
    brandsRoot: path.join(root, "fixtures", "brand-packs"),
    outputRoot: path.join(root, "generated", "storefronts")
  });
});

test("command-line workspace paths override environment configuration", () => {
  const absoluteBrands = path.resolve(root, "..", "external-brands");
  const args = parseArgs([
    `--brands-root=${absoluteBrands}`,
    "--output-root",
    "tmp/output"
  ]);

  assert.deepEqual(resolveWorkspacePaths(args, {
    SFK_BRANDS_ROOT: "ignored-brands",
    SFK_OUTPUT_ROOT: "ignored-output"
  }), {
    brandsRoot: absoluteBrands,
    outputRoot: path.join(root, "tmp", "output")
  });
});

test("workspace path flags reject missing or empty values", () => {
  assert.throws(() => resolveWorkspacePaths(parseArgs(["--brands-root"]), {}), /--brands-root requires a path/);
  assert.throws(() => resolveWorkspacePaths(parseArgs(["--output-root="]), {}), /--output-root requires a path/);
});

test("child script arguments always contain absolute workspace paths", () => {
  const values = workspacePathArgs({ brandsRoot: "relative-brands", outputRoot: "relative-output" });
  assert.equal(values[0], "--brands-root");
  assert.equal(values[2], "--output-root");
  assert.ok(path.isAbsolute(values[1]));
  assert.ok(path.isAbsolute(values[3]));
});

test("WooCommerce extension paths are absent by default", () => {
  assert.deepEqual(resolveWooCommercePaths({}, {}), {
    adapterRoot: undefined,
    seedFile: undefined
  });
});

test("WooCommerce extension paths accept environment configuration", () => {
  assert.deepEqual(resolveWooCommercePaths({}, {
    SFK_WOOCOMMERCE_ADAPTER_ROOT: "private/woocommerce/adapter",
    SFK_WOOCOMMERCE_SEED: "private/woocommerce/playground/seed.php"
  }), {
    adapterRoot: path.join(root, "private", "woocommerce", "adapter"),
    seedFile: path.join(root, "private", "woocommerce", "playground", "seed.php")
  });
});

test("WooCommerce extension flags override the environment and propagate as absolute paths", () => {
  const paths = resolveWooCommercePaths(parseArgs([
    "--woocommerce-adapter-root=external/adapter",
    "--woocommerce-seed",
    "external/seed.php"
  ]), {
    SFK_WOOCOMMERCE_ADAPTER_ROOT: "ignored-adapter",
    SFK_WOOCOMMERCE_SEED: "ignored-seed.php"
  });
  assert.deepEqual(paths, {
    adapterRoot: path.join(root, "external", "adapter"),
    seedFile: path.join(root, "external", "seed.php")
  });
  assert.deepEqual(wooCommercePathArgs(paths), [
    "--woocommerce-adapter-root",
    paths.adapterRoot,
    "--woocommerce-seed",
    paths.seedFile
  ]);
});

test("WooCommerce extension flags reject empty values", () => {
  assert.throws(() => resolveWooCommercePaths(parseArgs(["--woocommerce-adapter-root="]), {}), /--woocommerce-adapter-root requires a path/);
  assert.throws(() => resolveWooCommercePaths(parseArgs(["--woocommerce-seed"]), {}), /--woocommerce-seed requires a path/);
});
