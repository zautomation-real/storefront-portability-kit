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

async function publicFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", ".shopify-media", "dist", "node_modules"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await publicFiles(absolute));
    if (entry.isFile()) found.push(path.relative(root, absolute));
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

test("local credentials stay outside the public repository", async () => {
  const ignore = await readFile(path.join(root, ".gitignore"), "utf8");

  assert.match(ignore, /^\.env$/m);
  assert.match(ignore, /^\.env\.\*$/m);
  assert.match(ignore, /^!\.env\.example$/m);
});

test("private showcase identities stay outside the public method", async () => {
  const forbidden = [
    ["vale", "and", "vow"].join("-"),
    ["cedar", "90"].join("-"),
    ["form", "01"].join("-"),
    ["vale", "&", "vow"].join(" "),
    ["cedar", "/", "90"].join(" "),
    ["form", "/", "01"].join(" ")
  ];
  const textExtensions = new Set([".css", ".html", ".js", ".json", ".liquid", ".md", ".mjs", ".txt", ".yml", ".yaml"]);

  for (const relative of await publicFiles(root)) {
    const lowercasePath = relative.toLowerCase();
    for (const identity of forbidden) assert.equal(lowercasePath.includes(identity), false, `${relative} exposes a private showcase identity`);
    if (!textExtensions.has(path.extname(relative).toLowerCase()) && path.extname(relative) !== "") continue;
    const contents = (await readFile(path.join(root, relative), "utf8")).toLowerCase();
    for (const identity of forbidden) assert.equal(contents.includes(identity), false, `${relative} exposes a private showcase identity`);
  }
});
