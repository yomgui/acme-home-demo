import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { definitions, resourceUri, widgetIds } from "../shared/contract.ts";
import { createSyntheticProvider } from "../server/provider.ts";

const formerColor = ["b", "l", "u", "e"].join("");
const formerName = ["y", "o", "n", "d", "e", "r"].join("");
const forbidden = [
  new RegExp(`${formerColor}[\\s_-]*${formerName}`, "i"),
  new RegExp(`${formerColor}[\\s_-]*${["g", "p", "t"].join("")}`, "i"),
  new RegExp(
    `${["a", "g", "e", "n", "t"].join("")}[\\s_-]*${formerColor}`,
    "i",
  ),
  new RegExp(`\\b${["B", "Y"].join("")}[-_]\\d+`),
  new RegExp(`["'>]${["B", "Y"].join("")}["'<]`),
];
const root = fileURLToPath(new URL("../", import.meta.url));
const ignored = new Set([".git", "node_modules"]);
const binaryExtensions = new Set([".png", ".jpg", ".webp", ".zip"]);

function assertNeutral(text: string, label: string) {
  for (const pattern of forbidden)
    assert.equal(
      pattern.test(text),
      false,
      `${label}: legacy branding detected`,
    );
}

async function inspect(directory: string): Promise<number> {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    const label = relative(root, path);
    assertNeutral(label, label);
    assert.equal(
      entry.isSymbolicLink(),
      false,
      `${label}: authored files must not link to external content`,
    );
    if (entry.isDirectory()) count += await inspect(path);
    else if (!binaryExtensions.has(extname(path))) {
      assertNeutral(await readFile(path, "utf8"), label);
      count++;
    }
  }
  return count;
}

test("authored source, lockfile and generated artifacts contain only neutral branding", async () => {
  assert.ok((await inspect(root)) >= 20);
  for (const id of [...widgetIds, "home"] as const) {
    const html = await readFile(join(root, "dist", `${id}.html`), "utf8");
    assertNeutral(html, `${id} bundle`);
    assert.ok(html.includes("Acme Home"));
    assertNeutral(JSON.stringify(definitions[id]), id);
    assert.match(resourceUri(id), /^ui:\/\/acme-home\//);
  }
  const provider = createSyntheticProvider();
  for (const id of widgetIds)
    assertNeutral(JSON.stringify(await provider(id)), `${id} provider`);
});

test("branding guard detects constructed legacy variants without embedding them in source", () => {
  for (const value of [
    formerColor + formerName,
    [formerColor, formerName].join("-"),
    [formerColor, formerName].join("_"),
    [formerColor, formerName].join(" "),
    formerColor + ["G", "P", "T"].join(""),
    ["Agent", formerColor].join(" "),
    ["B", "Y", "-1042"].join(""),
    '"' + ["B", "Y"].join("") + '"',
  ]) {
    assert.throws(
      () => assertNeutral(value, "constructed fixture"),
      /legacy branding detected/,
    );
  }
  assertNeutral(
    "Acme Home ACME-1042 acme_home ui://acme-home/home.html",
    "current identity",
  );
});
