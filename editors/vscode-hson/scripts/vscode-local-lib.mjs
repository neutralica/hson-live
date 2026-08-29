import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";

import JSZip from "jszip";

export const EXTENSION_ID = "terminal-gothic.hson-language";
export const CANONICAL_VSIX_NAME = "hson-language.vsix";
export const AUTHORITY_NAME = "hson-language.authority.json";
export const STABLE_MAC_CLI = "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";

export class StageError extends Error {
  constructor(stage, message, cause) {
    super(`${stage}: ${message}`, { cause });
    this.name = "StageError";
    this.stage = stage;
  }
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function normalizeManifest(manifest) {
  const normalized = structuredClone(manifest);
  delete normalized.__metadata;
  return normalized;
}

export function extensionId(manifest) {
  return `${manifest.publisher}.${manifest.name}`;
}

export async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function runProcess(command, args, options = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.capture === false ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", chunk => { stdout += chunk; });
    child.stderr?.on("data", chunk => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", code => accept({ code: code ?? 1, stdout, stderr }));
  });
}

async function requireSuccessful(stage, command, args, options = {}) {
  let result;
  try {
    result = await (options.runProcess ?? runProcess)(command, args, options);
  } catch (error) {
    throw new StageError(stage, `could not start ${command}`, error);
  }
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new StageError(stage, detail || `${command} exited with ${result.code}`);
  }
  return result;
}

function manifestStaticPaths(manifest) {
  const paths = new Set([
    String(manifest.main ?? "").replace(/^\.\//, ""),
    "dist/extension.js.map",
    "dist/onig.wasm",
  ]);
  for (const language of manifest.contributes?.languages ?? []) {
    if (language.configuration) paths.add(String(language.configuration).replace(/^\.\//, ""));
  }
  for (const grammar of manifest.contributes?.grammars ?? []) {
    if (grammar.path) paths.add(String(grammar.path).replace(/^\.\//, ""));
  }
  paths.delete("");
  return [...paths];
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJson(value[key])]));
  }
  return value;
}

function sameJson(left, right) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

export async function validateVsix(vsixPath, expectedManifest) {
  let archive;
  try {
    archive = await JSZip.loadAsync(await readFile(vsixPath), { checkCRC32: true });
  } catch (error) {
    throw new StageError("artifact validation failure", `malformed or unreadable VSIX: ${vsixPath}`, error);
  }

  const manifestEntry = archive.file("extension/package.json");
  if (!manifestEntry) throw new StageError("artifact validation failure", "VSIX is missing extension/package.json");
  if (archive.file(`extension/${AUTHORITY_NAME}`)) {
    throw new StageError("artifact validation failure", "VSIX must not contain private build-authority metadata");
  }

  let manifest;
  try {
    manifest = JSON.parse(await manifestEntry.async("string"));
  } catch (error) {
    throw new StageError("artifact validation failure", "VSIX extension/package.json is invalid JSON", error);
  }

  const actualId = extensionId(manifest);
  const expectedId = extensionId(expectedManifest);
  if (actualId !== expectedId || actualId !== EXTENSION_ID) {
    throw new StageError("artifact validation failure", `expected ${EXTENSION_ID}, found ${actualId}`);
  }
  if (manifest.version !== expectedManifest.version) {
    throw new StageError("artifact validation failure", `expected version ${expectedManifest.version}, found ${manifest.version}`);
  }
  if (!sameJson(manifest.contributes?.configuration, expectedManifest.contributes?.configuration)) {
    throw new StageError("artifact validation failure", "packaged configuration contributions differ from the current manifest");
  }

  for (const path of manifestStaticPaths(expectedManifest)) {
    const entry = archive.file(`extension/${path}`);
    if (!entry) throw new StageError("artifact validation failure", `VSIX is missing extension/${path}`);
    if ((await entry.async("uint8array")).byteLength === 0) {
      throw new StageError("artifact validation failure", `VSIX contains an empty extension/${path}`);
    }
  }

  const payloadHashes = {};
  const names = Object.keys(archive.files)
    .filter(name => name.startsWith("extension/") && !archive.files[name].dir)
    .sort();
  if (names.length === 0) throw new StageError("artifact validation failure", "VSIX contains no extension payload");
  for (const name of names) {
    payloadHashes[name.slice("extension/".length)] = sha256(await archive.files[name].async("uint8array"));
  }

  return {
    manifest,
    payloadHashes,
    vsixSha256: sha256(await readFile(vsixPath)),
  };
}

function sourcePathFromMap(extensionRoot, mapSource) {
  if (/^[a-z]+:\/\//i.test(mapSource)) return undefined;
  return resolve(extensionRoot, "dist", mapSource);
}

export async function sourceInputAuthority(extensionRoot, sourceMapText) {
  let sourceMap;
  try {
    sourceMap = JSON.parse(sourceMapText);
  } catch (error) {
    throw new StageError("build authority failure", "packaged extension source map is invalid", error);
  }
  if (!Array.isArray(sourceMap.sources) || !Array.isArray(sourceMap.sourcesContent)) {
    throw new StageError("build authority failure", "packaged source map lacks sourcesContent");
  }

  const inputs = [];
  for (let index = 0; index < sourceMap.sources.length; index += 1) {
    const source = sourceMap.sources[index];
    const localPath = sourcePathFromMap(extensionRoot, source);
    if (localPath && await pathExists(localPath)) {
      inputs.push([`local:${source}`, sha256(await readFile(localPath))]);
    } else {
      const content = sourceMap.sourcesContent[index];
      inputs.push(typeof content === "string"
        ? [`embedded:${source}`, sha256(content)]
        : [`unavailable:${source}`, sha256("source content unavailable")]);
    }
  }

  for (const name of [
    "package.json",
    "package-lock.json",
    ".vscodeignore",
    "scripts/build.mjs",
    "scripts/vscode-local-lib.mjs",
    "scripts/vscode-local.mjs",
    "language-configuration.json",
    "syntaxes/hson.tmLanguage.json",
    "README.md",
    "LICENSE",
    "node_modules/vscode-oniguruma/release/onig.wasm",
  ]) {
    inputs.push([`file:${name}`, sha256(await readFile(resolve(extensionRoot, name)))]);
  }
  inputs.sort(([left], [right]) => left.localeCompare(right));
  return {
    inputSha256: sha256(inputs.map(([name, hash]) => `${name}\0${hash}\n`).join("")),
    inputCount: inputs.length,
  };
}

async function gitIdentity(repositoryRoot, processRunner = runProcess) {
  const commitResult = await processRunner("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot });
  const statusResult = await processRunner("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repositoryRoot });
  return {
    commit: commitResult.code === 0 ? commitResult.stdout.trim() : "unknown",
    dirty: statusResult.code !== 0 ? null : statusResult.stdout.trim().length > 0,
  };
}

async function sourceMapFromVsix(vsixPath) {
  const archive = await JSZip.loadAsync(await readFile(vsixPath));
  const entry = archive.file("extension/dist/extension.js.map");
  if (!entry) throw new StageError("build authority failure", "VSIX is missing its extension source map");
  return entry.async("string");
}

export async function packageCurrentSource(options) {
  const extensionRoot = resolve(options.extensionRoot);
  const repositoryRoot = resolve(options.repositoryRoot ?? join(extensionRoot, "../.."));
  const expectedManifest = JSON.parse(await readFile(join(extensionRoot, "package.json"), "utf8"));
  const canonicalVsix = join(extensionRoot, CANONICAL_VSIX_NAME);
  const canonicalAuthority = join(extensionRoot, AUTHORITY_NAME);
  const temporaryRoot = await mkdtemp(join(extensionRoot, ".hson-vsix-"));
  const temporaryVsix = join(temporaryRoot, `hson-language-${process.pid}-${Date.now()}.vsix`);
  const temporaryAuthority = join(temporaryRoot, AUTHORITY_NAME);
  const runner = options.runProcess ?? runProcess;

  try {
    if (options.runCheck) await options.runCheck();
    else await requireSuccessful("extension check failure", "npm", ["run", "check:source"], { cwd: extensionRoot, capture: false, runProcess: runner });

    if (options.runBuild) await options.runBuild();
    else await requireSuccessful("extension build failure", "npm", ["run", "build"], { cwd: extensionRoot, capture: false, runProcess: runner });

    if (options.runWorktreeValidation) await options.runWorktreeValidation();
    else await requireSuccessful("artifact validation failure", "npm", ["run", "validate:artifact"], { cwd: extensionRoot, capture: false, runProcess: runner });

    if (options.runPackager) await options.runPackager(temporaryVsix);
    else {
      const vsce = join(extensionRoot, "node_modules", ".bin", "vsce");
      await requireSuccessful("packaging failure", vsce, ["package", "--no-dependencies", "--out", temporaryVsix], {
        cwd: extensionRoot,
        capture: false,
        runProcess: runner,
      });
    }

    if (!await pathExists(temporaryVsix)) {
      throw new StageError("packaging failure", "packager did not create the requested temporary VSIX");
    }
    const artifact = await validateVsix(temporaryVsix, expectedManifest);
    const source = await sourceInputAuthority(extensionRoot, await sourceMapFromVsix(temporaryVsix));
    const git = await gitIdentity(repositoryRoot, runner);
    const authority = {
      schemaVersion: 1,
      extension: { id: EXTENSION_ID, version: expectedManifest.version },
      source: { ...git, ...source },
      package: {
        file: CANONICAL_VSIX_NAME,
        sha256: artifact.vsixSha256,
        payloadSha256: artifact.payloadHashes,
      },
      packagedAt: new Date().toISOString(),
    };
    await writeFile(temporaryAuthority, `${JSON.stringify(authority, null, 2)}\n`);

    await rename(temporaryVsix, canonicalVsix);
    await rename(temporaryAuthority, canonicalAuthority);
    return { artifact, authority, canonicalVsix, canonicalAuthority, manifest: expectedManifest };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function executableCandidates(name, pathValue) {
  if (isAbsolute(name) || name.includes("/")) return [resolve(name)];
  return String(pathValue ?? "").split(delimiter).filter(Boolean).map(folder => join(folder, name));
}

async function resolveExecutable(name, pathValue) {
  for (const candidate of executableCandidates(name, pathValue)) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {}
  }
  return undefined;
}

async function validateCli(path, runner) {
  const result = await runner(path, ["--version"], {});
  if (result.code !== 0) return undefined;
  const version = result.stdout.split(/\r?\n/).map(line => line.trim()).find(line => /^\d+\.\d+\.\d+/.test(line));
  return version ? { path, version, channel: "Stable" } : undefined;
}

export async function discoverVsCodeCli(options = {}) {
  const env = options.env ?? process.env;
  const runner = options.runProcess ?? runProcess;
  if (env.HSON_VSCODE_CLI !== undefined && env.HSON_VSCODE_CLI !== "") {
    const explicit = await resolveExecutable(env.HSON_VSCODE_CLI, env.PATH);
    if (!explicit) throw new StageError("invalid explicit CLI", `HSON_VSCODE_CLI is not executable: ${env.HSON_VSCODE_CLI}`);
    const validated = await validateCli(explicit, runner);
    if (!validated) throw new StageError("invalid explicit CLI", `HSON_VSCODE_CLI did not report a VS Code version: ${explicit}`);
    return { ...validated, source: "HSON_VSCODE_CLI" };
  }

  const fromPath = await resolveExecutable("code", env.PATH);
  if (fromPath) {
    const validated = await validateCli(fromPath, runner);
    if (validated) return { ...validated, source: "PATH" };
  }

  const stablePath = options.stablePath ?? STABLE_MAC_CLI;
  if (await pathExists(stablePath)) {
    const validated = await validateCli(stablePath, runner);
    if (validated) return { ...validated, source: "Stable fallback" };
  }
  throw new StageError("CLI not found", "set HSON_VSCODE_CLI or install the Stable VS Code 'code' command");
}

export function parseInstalledExtensions(output) {
  const installed = new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^([^@\s]+)@([^\s]+)$/);
    if (match) installed.set(match[1].toLowerCase(), match[2]);
  }
  return installed;
}

export async function queryInstalledExtension(cli, options = {}) {
  const runner = options.runProcess ?? runProcess;
  const result = await runner(cli.path, ["--list-extensions", "--show-versions"], {});
  if (result.code !== 0) {
    throw new StageError("installed extension query failure", (result.stderr || result.stdout).trim() || `CLI exited with ${result.code}`);
  }
  return parseInstalledExtensions(result.stdout).get(EXTENSION_ID.toLowerCase());
}

export async function locateInstalledExtension(cli, options = {}) {
  const runner = options.runProcess ?? runProcess;
  const result = await runner(cli.path, ["--locate-extension", EXTENSION_ID], {});
  if (result.code !== 0) return undefined;
  const candidates = result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean).reverse();
  for (const candidate of candidates) {
    if (isAbsolute(candidate) && await pathExists(candidate) && (await stat(candidate)).isDirectory()) return candidate;
  }
  return undefined;
}

export async function compareInstalledPayload(installedRoot, vsixPath, expectedManifest) {
  const archive = await JSZip.loadAsync(await readFile(vsixPath), { checkCRC32: true });
  const mismatches = [];
  for (const name of Object.keys(archive.files).filter(name => name.startsWith("extension/") && !archive.files[name].dir).sort()) {
    const relativePath = name.slice("extension/".length);
    const installedPath = resolve(installedRoot, relativePath);
    if (!await pathExists(installedPath)) {
      mismatches.push(`${relativePath}: missing`);
      continue;
    }
    if (relativePath === "package.json") {
      try {
        const installedManifest = normalizeManifest(JSON.parse(await readFile(installedPath, "utf8")));
        const packagedManifest = normalizeManifest(JSON.parse(await archive.files[name].async("string")));
        if (!sameJson(installedManifest, packagedManifest) || !sameJson(packagedManifest, normalizeManifest(expectedManifest))) {
          mismatches.push("package.json: semantic manifest differs");
        }
      } catch (error) {
        throw new StageError("payload verification failure", `could not normalize installed manifest: ${error.message}`, error);
      }
      continue;
    }
    const packagedHash = sha256(await archive.files[name].async("uint8array"));
    const installedHash = sha256(await readFile(installedPath));
    if (packagedHash !== installedHash) mismatches.push(`${relativePath}: content differs`);
  }
  return { match: mismatches.length === 0, mismatches };
}

export async function inspectPackageAuthority(extensionRoot) {
  const root = resolve(extensionRoot);
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const vsixPath = join(root, CANONICAL_VSIX_NAME);
  const authorityPath = join(root, AUTHORITY_NAME);
  if (!await pathExists(vsixPath)) return { state: "missing", manifest, vsixPath, reason: "canonical VSIX is absent" };

  let artifact;
  try {
    artifact = await validateVsix(vsixPath, manifest);
  } catch (error) {
    return { state: "stale", manifest, vsixPath, reason: error.message };
  }
  if (!await pathExists(authorityPath)) {
    return { state: "unverified", manifest, vsixPath, artifact, reason: "build-authority metadata is absent" };
  }

  let authority;
  try {
    authority = JSON.parse(await readFile(authorityPath, "utf8"));
  } catch {
    return { state: "stale", manifest, vsixPath, artifact, reason: "build-authority metadata is unreadable" };
  }
  if (authority.extension?.id !== EXTENSION_ID || authority.extension?.version !== manifest.version) {
    return { state: "stale", manifest, vsixPath, artifact, authority, reason: "build-authority identity differs" };
  }
  if (authority.package?.sha256 !== artifact.vsixSha256 || !sameJson(authority.package?.payloadSha256, artifact.payloadHashes)) {
    return { state: "stale", manifest, vsixPath, artifact, authority, reason: "canonical VSIX differs from build-authority hashes" };
  }
  let currentSource;
  try {
    currentSource = await sourceInputAuthority(root, await sourceMapFromVsix(vsixPath));
  } catch (error) {
    return { state: "stale", manifest, vsixPath, artifact, authority, reason: error.message };
  }
  if (authority.source?.inputSha256 !== currentSource.inputSha256) {
    return { state: "stale", manifest, vsixPath, artifact, authority, reason: "extension source/build inputs changed after packaging" };
  }
  return { state: "valid", manifest, vsixPath, artifact, authority };
}

export async function inspectStatus(options) {
  const packageState = await inspectPackageAuthority(options.extensionRoot);
  const cli = options.cli ?? await discoverVsCodeCli(options);
  let installedVersion;
  try {
    installedVersion = await queryInstalledExtension(cli, options);
  } catch (error) {
    return { status: "unknown", buildMatch: false, cli, packageState, reason: error.message };
  }
  if (!installedVersion) {
    return { status: "absent", buildMatch: false, cli, packageState, reason: `${EXTENSION_ID} is not installed` };
  }
  if (installedVersion !== packageState.manifest.version) {
    return { status: "stale", buildMatch: false, cli, packageState, installedVersion, reason: `installed version ${installedVersion} differs from ${packageState.manifest.version}` };
  }
  if (packageState.state === "stale") {
    return { status: "stale", buildMatch: false, cli, packageState, installedVersion, reason: packageState.reason };
  }

  const installedRoot = await locateInstalledExtension(cli, options);
  if (!installedRoot || packageState.state !== "valid") {
    return {
      status: "version-match",
      buildMatch: false,
      cli,
      packageState,
      installedVersion,
      installedRoot,
      reason: !installedRoot ? "installed payload location is unavailable" : packageState.reason,
    };
  }
  let comparison;
  try {
    comparison = await compareInstalledPayload(installedRoot, packageState.vsixPath, packageState.manifest);
  } catch (error) {
    return { status: "unknown", buildMatch: false, cli, packageState, installedVersion, installedRoot, reason: error.message };
  }
  if (!comparison.match) {
    return { status: "stale", buildMatch: false, cli, packageState, installedVersion, installedRoot, comparison, reason: comparison.mismatches[0] };
  }
  return { status: "current", buildMatch: true, cli, packageState, installedVersion, installedRoot, comparison };
}

export async function installCurrentSource(options) {
  const cli = options.cli ?? await discoverVsCodeCli(options);
  const packaged = await packageCurrentSource(options);
  const installArtifact = await validateVsix(packaged.canonicalVsix, packaged.manifest);
  if (installArtifact.vsixSha256 !== packaged.artifact.vsixSha256) {
    throw new StageError("artifact validation failure", "canonical VSIX changed between packaging and installation");
  }
  const runner = options.runProcess ?? runProcess;
  const installResult = await runner(cli.path, ["--install-extension", packaged.canonicalVsix, "--force"], {});
  if (installResult.code !== 0) {
    throw new StageError("install failure", (installResult.stderr || installResult.stdout).trim() || `CLI exited with ${installResult.code}`);
  }
  const installedVersion = await queryInstalledExtension(cli, options);
  if (!installedVersion) throw new StageError("installed extension absent afterward", `${EXTENSION_ID} was not listed after installation`);
  if (installedVersion !== packaged.manifest.version) {
    throw new StageError("installed version mismatch", `expected ${packaged.manifest.version}, found ${installedVersion}`);
  }

  const installedRoot = await locateInstalledExtension(cli, options);
  if (!installedRoot) return { ...packaged, cli, installedVersion, status: "version-match", buildMatch: false };
  const comparison = await compareInstalledPayload(installedRoot, packaged.canonicalVsix, packaged.manifest);
  if (!comparison.match) {
    throw new StageError("payload verification failure", comparison.mismatches[0]);
  }
  return { ...packaged, cli, installedVersion, installedRoot, comparison, status: "current", buildMatch: true };
}

export function displayPath(path, repositoryRoot) {
  const local = relative(repositoryRoot, path);
  return local && !local.startsWith("..") ? local : path;
}
