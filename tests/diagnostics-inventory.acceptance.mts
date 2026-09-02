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
  await access(join(repositoryRoot, launcher.repositoryModule));
}

assert.equal(
  HSON_LIVE_TEST_COMPLETION_REQUIREMENT,
  "valid-terminal-completion",
  "every registered launcher requires one valid terminal completion record",
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

const builtDiagnostics = await import("../dist/diagnostics/index.js") as {
  hson_live_test_launchers?: readonly HsonLiveTestLauncher[];
};
assert.deepEqual(
  builtDiagnostics.hson_live_test_launchers?.map((launcher) => launcher.id),
  launcherIds,
  "the built diagnostics package must expose the complete launcher inventory",
);

console.log(JSON.stringify({
  packageTestScripts: packageTestScripts.length,
  registeredLaunchers: hson_live_test_launchers.length,
  nonLauncherScripts: hson_live_non_launcher_test_scripts,
  completionRequirement: HSON_LIVE_TEST_COMPLETION_REQUIREMENT,
  externallyDiscoverableSuites: externallyDiscoverable.length,
  ids: externallyDiscoverable.map((launcher) => launcher.id),
}));
