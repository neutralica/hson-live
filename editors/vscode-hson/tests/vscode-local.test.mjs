import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import JSZip from "jszip";

import {
  AUTHORITY_NAME,
  CANONICAL_VSIX_NAME,
  EXTENSION_ID,
  StageError,
  compareInstalledPayload,
  discoverVsCodeCli,
  inspectStatus,
  installCurrentSource,
  normalizeManifest,
  packageCurrentSource,
  validateVsix,
} from "../scripts/vscode-local-lib.mjs";

let checks = 0;
async function check(name, body) {
  await body();
  process.stdout.write(`ok ${++checks} - ${name}\n`);
}

const root = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(root, "../..");

function fixtureManifest(version = "0.1.1") {
  return {
    name: "hson-language",
    publisher: "terminal-gothic",
    version,
    main: "./dist/extension.js",
    contributes: {
      configuration: [{ title: "Hson", properties: { "hson.example": { type: "boolean", default: true } } }],
      languages: [{ id: "hson", configuration: "./language-configuration.json" }],
      grammars: [{ language: "hson", scopeName: "source.hson", path: "./syntaxes/hson.tmLanguage.json" }],
    },
  };
}

async function makeFixture(label = "authority fixture with spaces") {
  const parent = await mkdtemp(join(tmpdir(), "hson-local-authority-"));
  const extensionRoot = join(parent, label, "editors", "vscode-hson");
  const fixtureRepository = resolve(extensionRoot, "../..");
  await mkdir(join(extensionRoot, "scripts"), { recursive: true });
  await mkdir(join(extensionRoot, "syntaxes"), { recursive: true });
  await mkdir(join(extensionRoot, "src"), { recursive: true });
  await mkdir(join(extensionRoot, "node_modules", "vscode-oniguruma", "release"), { recursive: true });
  await writeFile(join(extensionRoot, "package.json"), `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  await writeFile(join(extensionRoot, "package-lock.json"), "{}\n");
  await writeFile(join(extensionRoot, ".vscodeignore"), "*.vsix\n");
  await writeFile(join(extensionRoot, "scripts", "build.mjs"), "// fixture builder\n");
  await writeFile(join(extensionRoot, "scripts", "vscode-local-lib.mjs"), "// fixture authority library\n");
  await writeFile(join(extensionRoot, "scripts", "vscode-local.mjs"), "// fixture authority command\n");
  await writeFile(join(extensionRoot, "language-configuration.json"), "{}\n");
  await writeFile(join(extensionRoot, "syntaxes", "hson.tmLanguage.json"), "{}\n");
  await writeFile(join(extensionRoot, "README.md"), "fixture readme\n");
  await writeFile(join(extensionRoot, "LICENSE"), "fixture license\n");
  await writeFile(join(extensionRoot, "node_modules", "vscode-oniguruma", "release", "onig.wasm"), "wasm");
  await writeFile(join(extensionRoot, "src", "extension.ts"), "export const fixture = 1;\n");
  return { parent, extensionRoot, repositoryRoot: fixtureRepository };
}

async function makeVsix(path, manifest, overrides = {}) {
  const zip = new JSZip();
  const sourceText = overrides.sourceText ?? "export const fixture = 1;\n";
  const sourceMap = JSON.stringify({
    version: 3,
    sources: ["../src/extension.ts"],
    sourcesContent: [sourceText],
    mappings: "",
  });
  const payload = {
    "package.json": JSON.stringify(overrides.manifest ?? manifest),
    "dist/extension.js": overrides.bundle ?? "module.exports = 1;\n",
    "dist/extension.js.map": sourceMap,
    "dist/onig.wasm": "wasm",
    "language-configuration.json": "{}\n",
    "syntaxes/hson.tmLanguage.json": "{}\n",
    "readme.md": "fixture\n",
    ...overrides.payload,
  };
  for (const [name, content] of Object.entries(payload)) {
    if (content !== null) zip.file(`extension/${name}`, content);
  }
  await writeFile(path, await zip.generateAsync({ type: "nodebuffer" }));
}

function successfulGitAndCliRunner(options = {}) {
  return async (command, args) => {
    if (command === "git" && args[0] === "rev-parse") return { code: 0, stdout: "abcdef1234567890\n", stderr: "" };
    if (command === "git" && args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (args[0] === "--version") return { code: 0, stdout: "1.134.0\ncommit\narm64\n", stderr: "" };
    if (args[0] === "--install-extension") {
      options.installs?.push({ command, args });
      return { code: options.installCode ?? 0, stdout: "installed\n", stderr: options.installCode ? "install broke" : "" };
    }
    if (args[0] === "--list-extensions") {
      if (options.queryCode) return { code: options.queryCode, stdout: "", stderr: "query broke" };
      return { code: 0, stdout: options.listOutput ?? `${EXTENSION_ID}@0.1.1\n`, stderr: "" };
    }
    if (args[0] === "--locate-extension") {
      return options.installedRoot
        ? { code: 0, stdout: `${options.installedRoot}\n`, stderr: "" }
        : { code: 1, stdout: "", stderr: "unsupported" };
    }
    return { code: 1, stdout: "", stderr: `unexpected ${command} ${args.join(" ")}` };
  };
}

async function fixturePackageOptions(fixture, extra = {}) {
  return {
    extensionRoot: fixture.extensionRoot,
    repositoryRoot: fixture.repositoryRoot,
    runCheck: async () => {},
    runBuild: async () => {},
    runWorktreeValidation: async () => {},
    runPackager: async path => makeVsix(path, fixtureManifest()),
    runProcess: successfulGitAndCliRunner(),
    ...extra,
  };
}

async function extractInstalled(vsixPath, installedRoot, metadata = true) {
  const zip = await JSZip.loadAsync(await readFile(vsixPath));
  await mkdir(installedRoot, { recursive: true });
  for (const name of Object.keys(zip.files).filter(name => name.startsWith("extension/") && !zip.files[name].dir)) {
    const relativePath = name.slice("extension/".length);
    const target = join(installedRoot, relativePath);
    await mkdir(resolve(target, ".."), { recursive: true });
    if (relativePath === "package.json" && metadata) {
      const manifest = JSON.parse(await zip.files[name].async("string"));
      manifest.__metadata = { installedTimestamp: 123, size: 456 };
      await writeFile(target, JSON.stringify(manifest));
    } else {
      await writeFile(target, await zip.files[name].async("nodebuffer"));
    }
  }
}

await check("root scripts delegate to extension-owned commands", async () => {
  const scripts = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8")).scripts;
  assert.equal(scripts["vscode:package"], "npm --prefix editors/vscode-hson run package:vsix");
  assert.equal(scripts["vscode:install"], "npm --prefix editors/vscode-hson run vscode:install");
  assert.equal(scripts["vscode:status"], "npm --prefix editors/vscode-hson run vscode:status");
});

await check("package uses a fresh temporary VSIX and atomically replaces canonical output", async () => {
  const fixture = await makeFixture();
  try {
    const canonical = join(fixture.extensionRoot, CANONICAL_VSIX_NAME);
    await writeFile(canonical, "old bytes");
    let requested;
    const result = await packageCurrentSource(await fixturePackageOptions(fixture, {
      runPackager: async path => { requested = path; await makeVsix(path, fixtureManifest()); },
    }));
    assert.notEqual(requested, canonical);
    assert.equal(result.canonicalVsix, canonical);
    assert.notEqual((await readFile(canonical, "utf8")).slice(0, 9), "old bytes");
    assert.ok(JSON.parse(await readFile(join(fixture.extensionRoot, AUTHORITY_NAME), "utf8")).package.sha256);
  } finally { await rm(fixture.parent, { recursive: true, force: true }); }
});

await check("failed packaging preserves the old canonical artifact without promoting temporary output", async () => {
  const fixture = await makeFixture();
  try {
    const canonical = join(fixture.extensionRoot, CANONICAL_VSIX_NAME);
    await writeFile(canonical, "known old canonical");
    await assert.rejects(packageCurrentSource(await fixturePackageOptions(fixture, {
      runPackager: async () => { throw new StageError("packaging failure", "fixture failure"); },
    })), /fixture failure/);
    assert.equal(await readFile(canonical, "utf8"), "known old canonical");
  } finally { await rm(fixture.parent, { recursive: true, force: true }); }
});

await check("package failure prevents every install invocation", async () => {
  const fixture = await makeFixture();
  const installs = [];
  try {
    await assert.rejects(installCurrentSource({
      ...await fixturePackageOptions(fixture),
      cli: { path: "/fake/code", version: "1.134.0", channel: "Stable" },
      runPackager: async () => { throw new StageError("packaging failure", "stop before install"); },
      runProcess: successfulGitAndCliRunner({ installs }),
    }), /stop before install/);
    assert.equal(installs.length, 0);
  } finally { await rm(fixture.parent, { recursive: true, force: true }); }
});

await check("VSIX validation accepts the current identity and derived configuration surface", async () => {
  const fixture = await makeFixture();
  try {
    const path = join(fixture.parent, "valid.vsix"); await makeVsix(path, fixtureManifest());
    const result = await validateVsix(path, fixtureManifest());
    assert.equal(`${result.manifest.publisher}.${result.manifest.name}`, EXTENSION_ID);
    assert.ok(result.payloadHashes["dist/extension.js"]);
  } finally { await rm(fixture.parent, { recursive: true, force: true }); }
});

await check("VSIX validation rejects malformed archives", async () => {
  const fixture = await makeFixture();
  try {
    const path = join(fixture.parent, "bad.vsix"); await writeFile(path, "not zip");
    await assert.rejects(validateVsix(path, fixtureManifest()), /malformed or unreadable VSIX/);
  } finally { await rm(fixture.parent, { recursive: true, force: true }); }
});

await check("VSIX validation rejects incomplete payloads", async () => {
  const fixture = await makeFixture();
  try {
    const path = join(fixture.parent, "incomplete.vsix");
    await makeVsix(path, fixtureManifest(), { payload: { "dist/onig.wasm": null } });
    await assert.rejects(validateVsix(path, fixtureManifest()), /missing extension\/dist\/onig\.wasm/);
  } finally { await rm(fixture.parent, { recursive: true, force: true }); }
});

await check("VSIX validation rejects wrong identity, version, and configuration", async () => {
  const fixture = await makeFixture();
  try {
    for (const [name, mutate, pattern] of [
      ["identity", m => { m.publisher = "wrong"; }, /expected terminal-gothic/],
      ["version", m => { m.version = "9.9.9"; }, /expected version/],
      ["configuration", m => { m.contributes.configuration = []; }, /configuration contributions differ/],
    ]) {
      const manifest = fixtureManifest(); mutate(manifest);
      const path = join(fixture.parent, `${name}.vsix`); await makeVsix(path, fixtureManifest(), { manifest });
      await assert.rejects(validateVsix(path, fixtureManifest()), pattern);
    }
  } finally { await rm(fixture.parent, { recursive: true, force: true }); }
});

await check("explicit CLI override is selected and validated", async () => {
  const fixture = await makeFixture("cli path with spaces");
  try {
    const cli = join(fixture.parent, "cli path with spaces", "code fake");
    await mkdir(resolve(cli, ".."), { recursive: true });
    await writeFile(cli, "#!/bin/sh\nprintf '1.134.0\\ncommit\\narm64\\n'\n"); await chmod(cli, 0o755);
    const result = await discoverVsCodeCli({ env: { HSON_VSCODE_CLI: cli, PATH: "" } });
    assert.equal(result.path, cli); assert.equal(result.source, "HSON_VSCODE_CLI");
  } finally { await rm(fixture.parent, { recursive: true, force: true }); }
});

await check("invalid explicit CLI fails without fallback", async () => {
  await assert.rejects(discoverVsCodeCli({
    env: { HSON_VSCODE_CLI: "/missing/hson-code", PATH: "/usr/bin" },
    stablePath: "/bin/sh",
  }), /invalid explicit CLI/);
});

await check("PATH code is preferred over Stable fallback", async () => {
  const fixture = await makeFixture();
  try {
    const bin = join(fixture.parent, "bin"); await mkdir(bin);
    const cli = join(bin, "code"); await writeFile(cli, "#!/bin/sh\nprintf '1.2.3\\n'\n"); await chmod(cli, 0o755);
    const result = await discoverVsCodeCli({ env: { PATH: bin }, stablePath: "/missing/stable" });
    assert.equal(result.path, cli); assert.equal(result.source, "PATH");
  } finally { await rm(fixture.parent, { recursive: true, force: true }); }
});

await check("Stable fallback is used only when PATH has no valid code", async () => {
  const fixture = await makeFixture();
  try {
    const cli = join(fixture.parent, "stable code"); await writeFile(cli, "#!/bin/sh\nprintf '1.134.0\\n'\n"); await chmod(cli, 0o755);
    const result = await discoverVsCodeCli({ env: { PATH: "" }, stablePath: cli });
    assert.equal(result.path, cli); assert.equal(result.source, "Stable fallback");
  } finally { await rm(fixture.parent, { recursive: true, force: true }); }
});

await check("missing CLI fails clearly", async () => {
  await assert.rejects(discoverVsCodeCli({ env: { PATH: "" }, stablePath: "/missing/stable" }), /CLI not found/);
});

await check("install passes the exact freshly promoted VSIX path with --force", async () => {
  const fixture = await makeFixture(); const installs = [];
  try {
    const result = await installCurrentSource({
      ...await fixturePackageOptions(fixture),
      cli: { path: "/fake/code with spaces", version: "1.134.0", channel: "Stable" },
      runProcess: successfulGitAndCliRunner({ installs }),
    });
    assert.deepEqual(installs[0].args, ["--install-extension", join(fixture.extensionRoot, CANONICAL_VSIX_NAME), "--force"]);
    assert.equal(result.status, "version-match");
  } finally { await rm(fixture.parent, { recursive: true, force: true }); }
});

await check("post-install verification rejects an absent extension", async () => {
  const fixture = await makeFixture();
  try {
    await assert.rejects(installCurrentSource({
      ...await fixturePackageOptions(fixture),
      cli: { path: "/fake/code", version: "1.134.0", channel: "Stable" },
      runProcess: successfulGitAndCliRunner({ listOutput: "other.extension@1.0.0\n" }),
    }), /installed extension absent afterward/);
  } finally { await rm(fixture.parent, { recursive: true, force: true }); }
});

await check("post-install verification rejects a version mismatch", async () => {
  const fixture = await makeFixture();
  try {
    await assert.rejects(installCurrentSource({
      ...await fixturePackageOptions(fixture),
      cli: { path: "/fake/code", version: "1.134.0", channel: "Stable" },
      runProcess: successfulGitAndCliRunner({ listOutput: `${EXTENSION_ID}@0.1.0\n` }),
    }), /installed version mismatch/);
  } finally { await rm(fixture.parent, { recursive: true, force: true }); }
});

await check("installed manifest normalization removes only VS Code __metadata", async () => {
  const manifest = { ...fixtureManifest(), __metadata: { installedTimestamp: 1 } };
  assert.equal(normalizeManifest(manifest).__metadata, undefined);
  assert.equal(normalizeManifest(manifest).version, "0.1.1");
});

await check("payload comparison accepts normalized manifest metadata and matching files", async () => {
  const fixture = await makeFixture();
  try {
    const vsix = join(fixture.parent, "payload.vsix"); await makeVsix(vsix, fixtureManifest());
    const installed = join(fixture.parent, "installed"); await extractInstalled(vsix, installed, true);
    assert.equal((await compareInstalledPayload(installed, vsix, fixtureManifest())).match, true);
  } finally { await rm(fixture.parent, { recursive: true, force: true }); }
});

await check("payload comparison detects a same-version bundle mismatch", async () => {
  const fixture = await makeFixture();
  try {
    const vsix = join(fixture.parent, "payload.vsix"); await makeVsix(vsix, fixtureManifest());
    const installed = join(fixture.parent, "installed"); await extractInstalled(vsix, installed);
    await writeFile(join(installed, "dist", "extension.js"), "stale bundle");
    const result = await compareInstalledPayload(installed, vsix, fixtureManifest());
    assert.equal(result.match, false); assert.match(result.mismatches[0], /content differs/);
  } finally { await rm(fixture.parent, { recursive: true, force: true }); }
});

await check("status is current only with valid source authority and exact payload match", async () => {
  const fixture = await makeFixture();
  try {
    const packaged = await packageCurrentSource(await fixturePackageOptions(fixture));
    const installed = join(fixture.parent, "installed"); await extractInstalled(packaged.canonicalVsix, installed);
    const result = await inspectStatus({
      extensionRoot: fixture.extensionRoot,
      cli: { path: "/fake/code", version: "1.134.0", channel: "Stable" },
      runProcess: successfulGitAndCliRunner({ installedRoot: installed }),
    });
    assert.equal(result.status, "current"); assert.equal(result.buildMatch, true);
  } finally { await rm(fixture.parent, { recursive: true, force: true }); }
});

await check("status is version-match when semver matches but locate is unavailable", async () => {
  const fixture = await makeFixture();
  try {
    await packageCurrentSource(await fixturePackageOptions(fixture));
    const result = await inspectStatus({
      extensionRoot: fixture.extensionRoot,
      cli: { path: "/fake/code", version: "1.134.0", channel: "Stable" },
      runProcess: successfulGitAndCliRunner(),
    });
    assert.equal(result.status, "version-match");
  } finally { await rm(fixture.parent, { recursive: true, force: true }); }
});

await check("status is stale for changed source authority or installed payload", async () => {
  const fixture = await makeFixture();
  try {
    const packaged = await packageCurrentSource(await fixturePackageOptions(fixture));
    const installed = join(fixture.parent, "installed"); await extractInstalled(packaged.canonicalVsix, installed);
    await writeFile(join(fixture.extensionRoot, "src", "extension.ts"), "export const fixture = 2;\n");
    let result = await inspectStatus({
      extensionRoot: fixture.extensionRoot,
      cli: { path: "/fake/code", version: "1.134.0", channel: "Stable" },
      runProcess: successfulGitAndCliRunner({ installedRoot: installed }),
    });
    assert.equal(result.status, "stale"); assert.match(result.reason, /source\/build inputs changed/);
    await writeFile(join(fixture.extensionRoot, "src", "extension.ts"), "export const fixture = 1;\n");
    await writeFile(join(installed, "dist", "extension.js"), "stale");
    result = await inspectStatus({
      extensionRoot: fixture.extensionRoot,
      cli: { path: "/fake/code", version: "1.134.0", channel: "Stable" },
      runProcess: successfulGitAndCliRunner({ installedRoot: installed }),
    });
    assert.equal(result.status, "stale"); assert.match(result.reason, /content differs/);
  } finally { await rm(fixture.parent, { recursive: true, force: true }); }
});

await check("status is absent when the exact extension ID is not listed", async () => {
  const fixture = await makeFixture();
  try {
    await packageCurrentSource(await fixturePackageOptions(fixture));
    const result = await inspectStatus({
      extensionRoot: fixture.extensionRoot,
      cli: { path: "/fake/code", version: "1.134.0", channel: "Stable" },
      runProcess: successfulGitAndCliRunner({ listOutput: "other.extension@1.0.0\n" }),
    });
    assert.equal(result.status, "absent");
  } finally { await rm(fixture.parent, { recursive: true, force: true }); }
});

await check("status is unknown when the supported extension query fails", async () => {
  const fixture = await makeFixture();
  try {
    await packageCurrentSource(await fixturePackageOptions(fixture));
    const result = await inspectStatus({
      extensionRoot: fixture.extensionRoot,
      cli: { path: "/fake/code", version: "1.134.0", channel: "Stable" },
      runProcess: successfulGitAndCliRunner({ queryCode: 2 }),
    });
    assert.equal(result.status, "unknown");
  } finally { await rm(fixture.parent, { recursive: true, force: true }); }
});

await check("normal install output retains the explicit reload instruction", async () => {
  const source = await readFile(join(root, "scripts", "vscode-local.mjs"), "utf8");
  assert.match(source, /Developer: Reload Window/);
  assert.doesNotMatch(source, /--profile|--user-data-dir|--extensions-dir/);
});

await check("existing integration launchers retain isolated user-data and extension directories", async () => {
  const full = await readFile(join(root, "tests", "integration", "run.mjs"), "utf8");
  const baseline = await readFile(join(root, "tests", "integration", "run-baseline.mjs"), "utf8");
  for (const source of [full, baseline]) {
    assert.match(source, /--user-data-dir/); assert.match(source, /--extensions-dir/);
    assert.doesNotMatch(source, /vscode:install/);
  }
  assert.match(full, /downloadAndUnzipVSCode\("1\.95\.3"\)/);
});

process.stdout.write(`ok - ${checks} focused local VS Code authority checks passed\n`);
