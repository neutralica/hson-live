import { dirname, extname, isAbsolute, resolve, sep } from "node:path";
import ts from "typescript";

export type DiscoveredTypeScriptSource = Readonly<{
  fileName: string;
  languageId: "typescript" | "typescriptreact";
  owners: readonly string[];
}>;

export type TypeScriptProjectDiscovery = Readonly<{
  sources: readonly DiscoveredTypeScriptSource[];
  configurations: readonly string[];
  errors: readonly string[];
}>;

const CONFIG_NAMES = /(?:^|[/\\])(?:tsconfig(?:\.[^/\\]+)?|jsconfig)\.json$/i;
const GENERATED_SCHEMA = /\.hson-schema\.generated\.[cm]?tsx?$/i;
const DECLARATION = /\.d\.[cm]?ts$/i;
const TYPESCRIPT_SOURCE = /\.(?:[cm]?ts|tsx)$/i;

function canonical(fileName: string): string {
  const absolute = resolve(fileName);
  return ts.sys.useCaseSensitiveFileNames ? absolute : absolute.toLowerCase();
}

function beneath(fileName: string, directory: string): boolean {
  const relative = ts.sys.resolvePath(fileName).slice(ts.sys.resolvePath(directory).length);
  return relative === "" || relative.startsWith(sep) || relative.startsWith("/");
}

export function is_workspace_typescript_source(fileName: string, outputDirectories: readonly string[] = []): boolean {
  const normalized = fileName.replaceAll("\\", "/");
  if (!TYPESCRIPT_SOURCE.test(fileName) || DECLARATION.test(fileName) || GENERATED_SCHEMA.test(fileName)) return false;
  if (normalized.includes("/node_modules/")) return false;
  return !outputDirectories.some(directory => beneath(fileName, directory));
}

function referencedConfiguration(referencePath: string): string {
  if (extname(referencePath).toLowerCase() === ".json") return referencePath;
  return resolve(referencePath, "tsconfig.json");
}

/** Discover configured TS/TSX source using the TypeScript compiler's own config parser. */
export function discover_typescript_projects(workspaceRoots: readonly string[]): TypeScriptProjectDiscovery {
  const initial = new Set<string>();
  for (const root of workspaceRoots) {
    for (const config of ts.sys.readDirectory(root, [".json"], ["**/node_modules/**"], ["**/tsconfig*.json", "**/jsconfig.json"])) {
      if (CONFIG_NAMES.test(config)) initial.add(resolve(config));
    }
  }

  const queue = [...initial];
  const configurations = new Map<string, string>();
  const owners = new Map<string, { fileName: string; owners: Set<string> }>();
  const errors: string[] = [];
  const parseHost: ts.ParseConfigFileHost = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic(diagnostic): void {
      errors.push(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    },
  };

  while (queue.length > 0) {
    const nextConfig = queue.shift();
    if (nextConfig === undefined) continue;
    const config = resolve(nextConfig);
    const key = canonical(config);
    if (configurations.has(key)) continue;
    configurations.set(key, config);
    const parsed = ts.getParsedCommandLineOfConfigFile(config, {}, parseHost);
    if (parsed === undefined) continue;
    const configFile = parsed.options.configFile;
    if (typeof configFile === "object" && configFile !== null && "extendedSourceFiles" in configFile && Array.isArray(configFile.extendedSourceFiles)) {
      for (const extended of configFile.extendedSourceFiles) {
        if (typeof extended !== "string") continue;
        const extendedPath = resolve(extended);
        configurations.set(canonical(extendedPath), extendedPath);
      }
    }
    for (const diagnostic of parsed.errors) errors.push(`${config}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`);
    const outputDirectories = [parsed.options.outDir, parsed.options.declarationDir]
      .filter((value): value is string => value !== undefined)
      .map(value => isAbsolute(value) ? value : resolve(dirname(config), value));
    for (const fileName of parsed.fileNames) {
      if (!is_workspace_typescript_source(fileName, outputDirectories)) continue;
      const sourceKey = canonical(fileName);
      const current = owners.get(sourceKey) ?? { fileName: resolve(fileName), owners: new Set<string>() };
      current.owners.add(config);
      owners.set(sourceKey, current);
    }
    for (const reference of parsed.projectReferences ?? []) queue.push(referencedConfiguration(reference.path));
  }

  const sources = [...owners.values()].map(source => {
    const languageId: DiscoveredTypeScriptSource["languageId"] = source.fileName.toLowerCase().endsWith(".tsx") ? "typescriptreact" : "typescript";
    return Object.freeze({
      fileName: source.fileName,
      languageId,
      owners: Object.freeze([...source.owners].sort()),
    });
  }).sort((left, right) => left.fileName.localeCompare(right.fileName));
  return Object.freeze({
    sources: Object.freeze(sources),
    configurations: Object.freeze([...configurations.values()].sort()),
    errors: Object.freeze(errors),
  });
}
