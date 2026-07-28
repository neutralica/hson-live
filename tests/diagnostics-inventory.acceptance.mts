import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
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
await collect_marked_test_modules(join(repositoryRoot, "tests"));
markedModules.sort();

const externallyDiscoverable = hson_live_test_launchers.filter(
  (launcher) => launcher.collections.includes("externally-discoverable"),
);
const launcherIds = hson_live_test_launchers.map((launcher) => launcher.id);
assert.equal(
  new Set(launcherIds).size,
  launcherIds.length,
  "diagnostics launchers must have unique canonical IDs",
);
assert.deepEqual(
  externallyDiscoverable.map((launcher) => launcher.repositoryModule).sort(),
  markedModules,
  "every externally intended suite must have exactly one diagnostics registration",
);

for (const launcher of externallyDiscoverable) {
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
  const source = await readFile(join(repositoryRoot, launcher.repositoryModule), "utf8");
  const checkCount = source.match(/^check\(/gm)?.length ?? 0;
  assert.equal(
    launcher.executableChecks,
    checkCount,
    `${launcher.id} declared check count must match its durable propositions`,
  );
}

assert.ok(
  packageJson.exports?.["./diagnostics"] !== undefined,
  "the canonical diagnostics package entrypoint must remain exported",
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

console.log(JSON.stringify({
  externallyDiscoverableSuites: externallyDiscoverable.length,
  durableChecks: externallyDiscoverable.reduce(
    (total, launcher) => total + launcher.executableChecks,
    0,
  ),
  ids: externallyDiscoverable.map((launcher) => launcher.id),
}));
