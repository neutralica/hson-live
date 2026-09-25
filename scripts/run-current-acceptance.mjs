import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const scripts = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).scripts;
const browser = new Set([
  "test:transform-trust-ingress-browser",
  "test:canonical-interactions-browser",
  "test:browser-realization-parser-closure",
  "test:document-ssr-browser",
  "test:livemap-document-css-browser",
  "test:stylesheet-ingress-browser",
]);
const network = new Set(["test:livehost-node-http2", "test:livehost-node-hosting"]);
const environmentDependent = new Set([...browser, ...network]);
const testNames = Object.keys(scripts).filter((name) => name.startsWith("test:"));
const standard = new Set([...scripts.check.matchAll(/npm run (test:[\w-]+)/g)].map((match) => match[1]));

assert([...standard].every((name) => testNames.includes(name)), "Standard gate references an unknown test script.");
assert([...environmentDependent].every((name) => testNames.includes(name)), "Extended gate references an unknown test script.");
assert([...standard].every((name) => !environmentDependent.has(name)), "Environment-dependent test is in the standard gate.");
for (const file of readdirSync(resolve(root, "tests"))) {
  if (!/\.acceptance\.(?:mjs|mts)$/.test(file)) continue;
  assert(Object.values(scripts).some((command) => command.includes(`tests/${file}`)),
    `Unscripted current acceptance: ${file}`);
}
const browserRunners = readdirSync(resolve(root, "scripts"))
  .filter((file) => /^run-.*\.mjs$/.test(file))
  .map((file) => readFileSync(resolve(root, "scripts", file), "utf8"));
for (const file of readdirSync(resolve(root, "tests/browser"))) {
  if (!file.endsWith(".acceptance.html")) continue;
  assert(browserRunners.some((source) => source.includes(file)), `Unscripted current browser acceptance: ${file}`);
}
assert(Object.values(scripts).every((command) => !command.includes("tests/historical/")),
  "Historical acceptance must not be in current package scripts.");

const mode = process.argv[2];
assert(mode === "full" || mode === "extended", "Usage: run-current-acceptance.mjs full|extended");
const selected = testNames.filter((name) => mode === "full"
  ? !standard.has(name) && !environmentDependent.has(name)
  : environmentDependent.has(name));
const failed = [];
const commands = mode === "full"
  ? ["hson-schema:check", "measure:echo-browser-packaging", ...selected]
  : selected;
for (const [index, name] of commands.entries()) {
  console.log(`[${index + 1}/${commands.length}] ${name}`);
  const result = spawnSync("npm", ["run", name], { cwd: root, stdio: "inherit", timeout: 180_000 });
  if (result.status !== 0) failed.push(`${name}: ${result.error?.message ?? `exit ${String(result.status)}`}`);
}
console.log(JSON.stringify({ gate: mode, standard: standard.size, selected: selected.length,
  environmentDependent: environmentDependent.size, failures: failed }));
if (failed.length > 0) process.exitCode = 1;
