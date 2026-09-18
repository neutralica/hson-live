import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export type LocalHostProjectSettings = Readonly<{
  entry: string;
  applicationExport: string;
  nodeExecutable: string;
  port: number;
}>;

export type ResolvedLocalHostProject = Readonly<{
  projectId: string;
  workspaceFolder: string;
  entry: string;
  applicationExport: string;
  nodeExecutable: string;
  port: number;
  hsonLiveRoot: string;
  hsonLiveNodeEntry: string;
  hsonLiveVersion: string;
}>;

type HsonLivePackage = Readonly<{
  name?: unknown;
  version?: unknown;
}>;

const exec_file = promisify(execFile);
const NODE_PROBE_MARKER = "HSON_LOCAL_HOST_NODE_PROBE:";

export function local_host_start_blocker(isTrusted: boolean, remoteName: string | undefined): string | undefined {
  if (!isTrusted) return "Hson local hosting cannot run in Restricted Mode. Trust this workspace, then run the command again.";
  if (remoteName !== undefined) return `Hson local hosting v1 is disabled in remote workspaces (${remoteName}) because its loopback URL belongs to the remote environment. Run it from a local desktop workspace.`;
  return undefined;
}

export async function resolve_local_host_project(
  workspaceFolder: string,
  projectId: string,
  settings: LocalHostProjectSettings,
): Promise<ResolvedLocalHostProject> {
  const root = resolve(workspaceFolder);
  if (settings.entry.trim() === "") throw new Error("Configure hson.localHost.entry with a built workspace JavaScript module before starting the local host.");
  const entry = resolve(root, settings.entry);
  if (!within(root, entry)) throw new Error("hson.localHost.entry must stay within its workspace folder.");
  if (!existsSync(entry) || !statSync(entry).isFile()) throw new Error(`The configured Hson local-host entry does not exist: ${entry}. Build the project, then try again.`);
  if (!/\.(?:c|m)?js$/i.test(entry)) throw new Error("hson.localHost.entry must name built JavaScript (.js, .mjs, or .cjs). The extension does not embed a TypeScript executor or bundler.");
  if (!/^[A-Za-z_$][\w$]*$/.test(settings.applicationExport)) throw new Error("hson.localHost.applicationExport must be a JavaScript export name.");
  if (!Number.isInteger(settings.port) || settings.port < 0 || settings.port > 65_535) throw new Error("hson.localHost.port must be an integer from 0 through 65535.");

  const configuredNode = settings.nodeExecutable.trim() === "" ? "node" : settings.nodeExecutable.trim();
  const requestedNodeExecutable = isAbsolute(configuredNode) ? configuredNode : configuredNode.includes("/") || configuredNode.includes("\\") ? resolve(root, configuredNode) : configuredNode;
  const probe = await probe_node_runtime(requestedNodeExecutable, root, entry);
  if (!is_supported_livehost_node_runtime(probe.nodeVersion)) {
    throw new Error(`The configured Node executable reports ${probe.nodeVersion}; workspace hson-live Node hosting requires >=22.12.0 <25. Configure hson.localHost.nodeExecutable with a compatible Node runtime.`);
  }
  const packageInfo = package_for_node_entry(probe.hsonLiveNodeEntry);

  return Object.freeze({
    projectId,
    workspaceFolder: root,
    entry,
    applicationExport: settings.applicationExport,
    nodeExecutable: probe.nodeExecutable,
    port: settings.port,
    hsonLiveRoot: packageInfo.packageRoot,
    hsonLiveNodeEntry: packageInfo.nodeEntry,
    hsonLiveVersion: packageInfo.packageVersion,
  });
}

function package_for_node_entry(nodeEntryUrl: string): Readonly<{ packageRoot: string; nodeEntry: string; packageVersion: string }> {
  let nodeEntry: string;
  try {
    const url = new URL(nodeEntryUrl);
    if (url.protocol !== "file:") throw new Error("not a file URL");
    nodeEntry = fileURLToPath(url);
  } catch {
    throw new Error("The application-resolved hson-live/livehost/node entry is not a local file. Reinstall the workspace dependency.");
  }
  if (!existsSync(nodeEntry) || !statSync(nodeEntry).isFile()) {
    throw new Error("The application-resolved hson-live LiveHost Node entry is missing. Build or reinstall the workspace dependency.");
  }
  let candidate = dirname(nodeEntry);
  for (;;) {
    const manifestPath = join(candidate, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = read_package(manifestPath);
      if (manifest.name === "hson-live") {
        return Object.freeze({ packageRoot: candidate, nodeEntry, packageVersion: typeof manifest.version === "string" ? manifest.version : "unknown" });
      }
    }
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error("The application-resolved LiveHost Node entry does not belong to an hson-live package. Reinstall the workspace dependency.");
}

export function is_supported_livehost_node_runtime(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (match === null) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (major === 22) return minor > 12 || (minor === 12 && patch >= 0);
  return major === 23 || major === 24;
}

async function probe_node_runtime(
  executable: string,
  cwd: string,
  applicationEntry: string,
): Promise<Readonly<{ nodeExecutable: string; nodeVersion: string; hsonLiveNodeEntry: string }>> {
  const probeSource = [
    'import { pathToFileURL } from "node:url";',
    'const applicationEntry = process.argv[1];',
    'const hsonLiveNodeEntry = import.meta.resolve("hson-live/livehost/node", pathToFileURL(applicationEntry).href);',
    `process.stdout.write(${JSON.stringify(NODE_PROBE_MARKER)} + JSON.stringify({ nodeExecutable: process.execPath, nodeVersion: process.versions.node, hsonLiveNodeEntry }) + "\\n");`,
  ].join("\n");
  try {
    const result = await exec_file(executable, ["--experimental-import-meta-resolve", "--input-type=module", "--eval", probeSource, applicationEntry], { cwd, timeout: 5_000, windowsHide: true });
    const line = result.stdout.split(/\r?\n/).find(candidate => candidate.startsWith(NODE_PROBE_MARKER));
    if (line === undefined) throw new Error("missing structured probe output");
    const value: unknown = JSON.parse(line.slice(NODE_PROBE_MARKER.length));
    if (!is_record(value) || typeof value.nodeExecutable !== "string" || value.nodeExecutable.length === 0
      || typeof value.nodeVersion !== "string" || value.nodeVersion.length === 0
      || typeof value.hsonLiveNodeEntry !== "string" || value.hsonLiveNodeEntry.length === 0) {
      throw new Error("invalid structured probe output");
    }
    return Object.freeze({ nodeExecutable: value.nodeExecutable, nodeVersion: value.nodeVersion, hsonLiveNodeEntry: value.hsonLiveNodeEntry });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not resolve hson-live/livehost/node from the configured application entry with Node executable '${executable}': ${detail}`);
  }
}

function read_package(path: string): HsonLivePackage {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return is_record(value) ? value : {};
  } catch {
    throw new Error(`Cannot read installed hson-live package metadata at ${path}. Reinstall the workspace dependency.`);
  }
}

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function within(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}
