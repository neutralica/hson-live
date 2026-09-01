import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export type ResolvedSchemaTool = Readonly<{
  packageRoot: string;
  executable: string;
  packageVersion: string;
}>;

export type SchemaWatchOutputState = "starting" | "watching" | "error";

type HsonLivePackage = Readonly<{
  name?: unknown;
  version?: unknown;
  bin?: unknown;
}>;

/** Resolves only the consuming workspace's installed public package executable. */
export function resolve_workspace_hson_schema_tool(workspaceFolder: string): ResolvedSchemaTool {
  let candidate = resolve(workspaceFolder);
  for (;;) {
    const packageRoot = join(candidate, "node_modules", "hson-live");
    const manifestPath = join(packageRoot, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = read_package(manifestPath);
      if (manifest.name !== "hson-live") throw new Error(`Workspace package metadata at ${manifestPath} is not hson-live.`);
      const bin = is_record(manifest.bin) ? manifest.bin["hson-schema"] : undefined;
      if (typeof bin !== "string" || bin.trim() === "") {
        throw new Error("The workspace hson-live dependency does not expose the required public hson-schema executable. Update hson-live to a compatible version.");
      }
      const executable = resolve(packageRoot, bin);
      if (!existsSync(executable)) {
        throw new Error("The workspace hson-live dependency declares hson-schema, but its executable is missing. Reinstall a compatible hson-live dependency.");
      }
      return Object.freeze({ packageRoot, executable, packageVersion: typeof manifest.version === "string" ? manifest.version : "unknown" });
    }
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error("No workspace-local hson-live dependency was found. Install a compatible hson-live dependency in this workspace, then run Hson: Generate Schema Types.");
}

/** Chooses the nearest normal project for an active document, otherwise folder tsconfig. */
export function discover_schema_project(workspaceFolder: string, activeFile?: string): string {
  const root = resolve(workspaceFolder);
  let candidate = activeFile === undefined ? root : dirname(resolve(activeFile));
  if (!within(root, candidate)) candidate = root;
  for (;;) {
    const config = join(candidate, "tsconfig.json");
    if (existsSync(config)) return config;
    if (candidate === root) break;
    candidate = dirname(candidate);
  }
  throw new Error(`No tsconfig.json was found for ${workspaceFolder}. Add the workspace project configuration before running Hson Schema tooling.`);
}

export function schema_tool_arguments(tool: ResolvedSchemaTool, mode: "generate" | "check" | "watch", project: string): readonly string[] {
  return Object.freeze([tool.executable, mode, "--project", project]);
}

/** Maps the shared CLI's human lifecycle lines to extension status state. */
export function schema_watch_output_state(line: string): SchemaWatchOutputState | undefined {
  if (line.startsWith("Hson Schema watch: checking")) return "starting";
  if (line.startsWith("Hson Schema watch: current;")) return "watching";
  if (line.startsWith("Hson Schema watch: stale/error;")) return "error";
  return undefined;
}

function read_package(path: string): HsonLivePackage {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return is_record(value) ? value : {};
  } catch {
    throw new Error(`Cannot read installed hson-live package metadata at ${path}. Reinstall a compatible hson-live dependency.`);
  }
}

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function within(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}
