import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { root } from "../scripts/lib.mjs";

async function assertMissing(relative) {
  await assert.rejects(stat(path.join(root, relative)), (error) => error?.code === "ENOENT");
}

async function files(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const found = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await files(absolute));
    if (entry.isFile()) found.push(path.relative(root, absolute));
  }
  return found;
}

async function phpFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", "dist", "node_modules"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await phpFiles(absolute));
    if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".php") found.push(path.relative(root, absolute));
  }
  return found;
}

test("the public tree excludes the executable WooCommerce extension", async () => {
  assert.deepEqual(await files(path.join(root, "adapters", "woocommerce")), []);
  await assertMissing("scripts/playground/seed.php");
  assert.deepEqual(await phpFiles(root), []);
});

test("the public package points to the protected end-product licence", async () => {
  const packageData = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const licence = await readFile(path.join(root, "LICENSE"), "utf8");
  const fixtureNotice = await readFile(path.join(root, "examples", "LICENSE.md"), "utf8");

  assert.equal(packageData.license, "SEE LICENSE IN LICENSE");
  assert.match(licence, /^ZAY END-PRODUCT LICENSE 1\.0/m);
  assert.doesNotMatch(licence, /Permission is hereby granted, free of charge/);
  assert.doesNotMatch(fixtureNotice, /CC0|public domain/i);
});
