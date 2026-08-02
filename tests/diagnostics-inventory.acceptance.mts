import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HSON_LIVE_TEST_COMPLETION_REQUIREMENT,
  hson_live_non_launcher_test_scripts,
  hson_live_test_launchers,
  type HsonLiveTestLauncher,
} from "../src/_tests/test-launchers.ts";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(
  await readFile(join(repositoryRoot, "package.json"), "utf8"),
) as {
  scripts?: Readonly<Record<string, unknown>>;
  exports?: Readonly<Record<string, unknown>>;
};
const scripts = packageJson.scripts ?? {};
const marker = "@hson-live-external-test";
const markedModules: string[] = [];

async function collect_marked_test_modules(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collect_marked_test_modules(path);
      continue;
    }
    if (!entry.isFile() || !entry.name.includes(".acceptance.")) continue;
    const source = await readFile(path, "utf8");
    if (source.slice(0, 256).includes(marker)) {
      markedModules.push(relative(repositoryRoot, path).replaceAll("\\", "/"));
    }
  }
}

async function collect_typescript_sources(directory: string): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...await collect_typescript_sources(path));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      paths.push(path);
    }
  }
  return paths;
}
await collect_marked_test_modules(join(repositoryRoot, "tests"));
markedModules.sort();

const externallyDiscoverable = hson_live_test_launchers.filter(
  (launcher) => launcher.collections.includes("externally-discoverable"),
);
const launcherIds = hson_live_test_launchers.map((launcher) => launcher.id);
const launcherScripts = hson_live_test_launchers.map((launcher) => launcher.packageScript);
const launcherModules = hson_live_test_launchers.map((launcher) => launcher.repositoryModule);
assert.equal(
  new Set(launcherIds).size,
  launcherIds.length,
  "diagnostics launchers must have unique canonical IDs",
);
assert.equal(
  new Set(launcherScripts).size,
  launcherScripts.length,
  "diagnostics launchers must have unique package scripts",
);
assert.equal(
  new Set(launcherModules).size,
  launcherModules.length,
  "diagnostics launchers must have unique repository modules",
);
assert.deepEqual(
  externallyDiscoverable.map((launcher) => launcher.repositoryModule).sort(),
  markedModules,
  "every externally intended suite must have exactly one diagnostics registration",
);

for (const launcher of hson_live_test_launchers) {
  assert.equal(
    typeof scripts[launcher.packageScript],
    "string",
    `${launcher.id} must have a local package launcher`,
  );
  assert.match(
    String(scripts[launcher.packageScript]),
    new RegExp(launcher.repositoryModule.replaceAll(".", "\\.")),
    `${launcher.id} package launcher must execute its registered module`,
  );
  assert.ok(
    launcher.executableChecks > 0 && Number.isInteger(launcher.executableChecks),
    `${launcher.id} must declare an executable check count`,
  );
  await access(join(repositoryRoot, launcher.repositoryModule));
}

for (const launcher of externallyDiscoverable) {
  const source = await readFile(join(repositoryRoot, launcher.repositoryModule), "utf8");
  const checkCount = source.match(/^(?:await )?check\(/gm)?.length ?? 0;
  assert.equal(
    launcher.executableChecks,
    checkCount,
    `${launcher.id} declared check count must match its durable propositions`,
  );
}

assert.equal(
  HSON_LIVE_TEST_COMPLETION_REQUIREMENT,
  "exact-declared-check-count",
  "every registered launcher requires one exact terminal completion record",
);
const nonLauncherScripts = hson_live_non_launcher_test_scripts.map(
  (entry) => entry.packageScript,
);
assert.equal(
  new Set(nonLauncherScripts).size,
  nonLauncherScripts.length,
  "intentional non-launcher package scripts must be unique",
);
assert.ok(
  hson_live_non_launcher_test_scripts.every((entry) => entry.reason.trim().length > 0),
  "every intentional non-launcher package script must explain its exclusion",
);
const packageTestScripts = Object.keys(scripts)
  .filter((script): script is `test:${string}` => script.startsWith("test:"))
  .sort();
assert.deepEqual(
  packageTestScripts,
  [...launcherScripts, ...nonLauncherScripts].sort(),
  "every test:* package script must be either one registered launcher or one named non-launcher",
);

assert.ok(
  packageJson.exports?.["./diagnostics"] !== undefined,
  "the canonical diagnostics package entrypoint must remain exported",
);
assert.ok(
  packageJson.exports?.["./diagnostics/universal-circuit"] !== undefined,
  "the DOM-free universal circuit diagnostic must have one narrow worker-safe entrypoint",
);

await access(join(repositoryRoot, "dist", "diagnostics", "index.js"));
const builtDiagnostics = await import("../dist/diagnostics/index.js") as {
  hson_live_test_launchers?: readonly HsonLiveTestLauncher[];
};
assert.deepEqual(
  builtDiagnostics.hson_live_test_launchers?.map((launcher) => launcher.id),
  launcherIds,
  "the built diagnostics package must expose the complete launcher inventory",
);

const removedLiveMapPseudoQuidSymbols = [
  "LiveMapQuid",
  "LiveMapQuidOwner",
  "LiveMapQuidRef",
  "debug_livemap_quids",
  "drop_livemap_quid",
  "ensure_livemap_quid",
  "get_livemap_owner",
  "get_livemap_quid",
  "reindex_livemap_quid",
  "remint_livemap_quid",
];
const declarationRoots = [
  join(repositoryRoot, "dist", "index.d.ts"),
  join(repositoryRoot, "dist", "api", "livemap", "index.d.ts"),
  join(repositoryRoot, "dist", "types", "livemap.types.d.ts"),
];
const declarationText = (
  await Promise.all(declarationRoots.map((path) => readFile(path, "utf8")))
).join("\n");
for (const symbol of removedLiveMapPseudoQuidSymbols) {
  assert.equal(
    declarationText.includes(symbol),
    false,
    `built declarations must not expose removed LiveMap pseudo-QUID symbol ${symbol}`,
  );
}
await assert.rejects(
  access(join(repositoryRoot, "dist", "api", "livemap", "livemap.quid.js")),
  "the removed LiveMap pseudo-QUID runtime module must not be built",
);
await assert.rejects(
  access(join(repositoryRoot, "dist", "api", "livemap", "livemap.quid.d.ts")),
  "the removed LiveMap pseudo-QUID declaration module must not be built",
);

const sourcePaths = await collect_typescript_sources(join(repositoryRoot, "src"));
const productionSource = (
  await Promise.all(sourcePaths.map((path) => readFile(path, "utf8")))
).join("\n");
assert.equal(
  productionSource.includes("construct_tree") ||
    productionSource.includes("construct-tree"),
  false,
  "the obsolete LiveTree construction engine must not remain reachable in source",
);
assert.equal(
  productionSource.includes("graft_body"),
  false,
  "the obsolete graft_body compatibility alias must not remain reachable",
);
await assert.rejects(
  access(join(repositoryRoot, "dist", "api", "livetree", "creation", "construct-tree.js")),
  "the obsolete LiveTree construction runtime module must not be built",
);
await assert.rejects(
  access(join(repositoryRoot, "dist", "api", "livetree", "creation", "construct-tree.d.ts")),
  "the obsolete LiveTree construction declaration module must not be built",
);
const constructorDeclarations = await readFile(
  join(repositoryRoot, "dist", "types", "constructor.types.d.ts"),
  "utf8",
);
for (const symbol of [
  "TreeConstructor_Source",
  "DomQuerySourceConstructor",
  "DomQueryLiveTreeConstructor",
  "LiveTreeConstructor_3",
]) {
  assert.equal(
    constructorDeclarations.includes(symbol),
    false,
    `built declarations must not retain obsolete constructor symbol ${symbol}`,
  );
}

console.log(JSON.stringify({
  packageTestScripts: packageTestScripts.length,
  registeredLaunchers: hson_live_test_launchers.length,
  registeredChecks: hson_live_test_launchers.reduce(
    (total, launcher) => total + launcher.executableChecks,
    0,
  ),
  nonLauncherScripts: hson_live_non_launcher_test_scripts,
  completionRequirement: HSON_LIVE_TEST_COMPLETION_REQUIREMENT,
  externallyDiscoverableSuites: externallyDiscoverable.length,
  durableChecks: externallyDiscoverable.reduce(
    (total, launcher) => total + launcher.executableChecks,
    0,
  ),
  ids: externallyDiscoverable.map((launcher) => launcher.id),
}));
