import { statSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { create_hson_project_program, is_hson_typescript_source_file } from "../../../src/internal/embedded-hson/discover-hson-tagged-templates.js";

export type DiscoveredTypeScriptSource = Readonly<{
  fileName: string;
  languageId: "typescript" | "typescriptreact";
  owners: readonly string[];
}>;

export type TypeScriptProjectDiscovery = Readonly<{
  sources: readonly DiscoveredTypeScriptSource[];
  projectFiles: readonly (readonly [project: string, files: readonly (readonly [key: string, identity: string | null])[]])[];
  configurations: readonly string[];
  errors: readonly string[];
}>;

export const PROJECT_DISCOVERY_COMMAND = "_hson.discoverTypeScriptProjects";
export type ProjectDiscoveryRequest = Readonly<{
  roots: readonly string[];
  openFiles: readonly (readonly [fileName: string, text: string, dirty: boolean])[];
  changedFiles?: readonly string[];
}>;

export function is_typescript_configuration_path(fileName: string): boolean {
  return /(?:^|[/\\])(?:tsconfig(?:\.[^/\\]+)?|jsconfig)\.json$/i.test(fileName);
}

function canonical(fileName: string): string {
  const absolute = resolve(fileName);
  return ts.sys.useCaseSensitiveFileNames ? absolute : absolute.toLowerCase();
}

function physical(fileName: string): string | undefined {
  try {
    const stat = statSync(fileName, { bigint: true, throwIfNoEntry: false });
    if (stat?.isFile() && stat.ino !== 0n) return `file:${stat.dev}:${stat.ino}`;
  } catch { /* An unavailable physical identity cannot carry positive evidence. */ }
  return undefined;
}

export function project_file_keys(fileName: string): [path: string] | [path: string, identity: string] {
  const identity = physical(fileName);
  return identity === undefined ? [canonical(fileName)] : [canonical(fileName), identity];
}

function beneath(fileName: string, directory: string): boolean {
  const path = relative(canonical(directory), canonical(fileName));
  return path !== ".." && !path.startsWith(".." + sep) && !isAbsolute(path);
}

export function is_workspace_typescript_source(fileName: string, outputDirectories: readonly string[] = []): boolean {
  return is_hson_typescript_source_file(fileName) && !outputDirectories.some(directory => beneath(fileName, directory));
}

function referencedConfiguration(referencePath: string): string {
  if (extname(referencePath).toLowerCase() === ".json") return referencePath;
  return resolve(referencePath, "tsconfig.json");
}

type ConfiguredProjects = Readonly<{
  parsed: ReadonlyMap<string, ts.ParsedCommandLine>;
  configurations: readonly string[];
  errors: readonly string[];
}>;

function read_configurations(ts: typeof import("typescript"), workspaceRoots: readonly string[],
  entryConfigurations?: readonly string[],
): ConfiguredProjects {
  const queue = entryConfigurations?.map(config => resolve(config)) ?? [];
  for (const root of entryConfigurations === undefined ? workspaceRoots : []) {
    for (const config of ts.sys.readDirectory(root, [".json"], ["**/node_modules/**"], ["**/tsconfig*.json", "**/jsconfig.json"])) {
      if (is_typescript_configuration_path(config)) queue.push(resolve(config));
    }
  }
  const visited = new Set<string>();
  const configurations = new Map<string, string>();
  const parsed = new Map<string, ts.ParsedCommandLine>();
  const errors: string[] = [];
  const parseHost: ts.ParseConfigFileHost = {
    ...ts.sys,
    fileExists(fileName) {
      if (/\.json$/i.test(fileName) && workspaceRoots.some(root => beneath(fileName, root))) {
        configurations.set(canonical(fileName), resolve(fileName));
      }
      return ts.sys.fileExists(fileName);
    },
    onUnRecoverableConfigFileDiagnostic(diagnostic): void {
      errors.push(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    },
  };
  for (let index = 0; index < queue.length; index++) {
    const config = queue[index]!, key = canonical(config);
    if (visited.has(key)) continue;
    visited.add(key);
    configurations.set(key, config);
    const project = ts.getParsedCommandLineOfConfigFile(config, {}, parseHost);
    if (project === undefined) continue;
    parsed.set(config, project);
    const configFile = project.options.configFile;
    if (typeof configFile === "object" && configFile !== null && "extendedSourceFiles" in configFile && Array.isArray(configFile.extendedSourceFiles)) {
      for (const extended of configFile.extendedSourceFiles) {
        if (typeof extended !== "string") continue;
        const name = resolve(extended);
        configurations.set(canonical(name), name);
      }
    }
    for (const diagnostic of project.errors) errors.push(`${config}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`);
    for (const reference of project.projectReferences ?? []) queue.push(referencedConfiguration(reference.path));
  }
  return { parsed, configurations: [...configurations.values()].sort(), errors };
}

/** Read configured, on-disk programs for one-shot validation. The editor scan keeps
 * its own active-program and incremental discovery lifecycle. */
export function visit_configured_typescript_projects(workspaceRoot: string, configurations: readonly string[],
  visit: (configuration: string, parsed: ts.ParsedCommandLine, program: ts.Program) => void,
): readonly string[] {
  const { parsed, errors } = read_configurations(ts, [workspaceRoot], configurations);
  for (const [name, project] of parsed) {
    if (project.errors.length === 0) {
      visit(name, project, create_hson_project_program(ts, project, dirname(name), () => undefined));
    }
  }
  return errors;
}

type ProjectSource = Readonly<{ fileName: string; identity?: string; publish: boolean }>;
type ProjectSources = Readonly<{
  files: ReadonlyMap<string, string | null>;
  /** null denotes a loaded project whose native Program is not ready. */
  activeProgram?: ts.Program | null;
  sources: readonly ProjectSource[];
}>;

function read_project_sources(program: ts.Program, workspaceRoots: readonly string[],
  snapshots: ReadonlyMap<string, string>, configured: boolean, activeProgram?: ts.Program | null,
): ProjectSources {
  const options = program.getCompilerOptions();
  const outputs = [options.outDir, options.declarationDir].filter((value): value is string => value !== undefined);
  const roots = new Set(program.getRootFileNames().map(canonical));
  const files = new Map<string, string | null>(), sources: ProjectSource[] = [];
  for (const file of program.getSourceFiles()) {
    const fileName = resolve(file.fileName), key = canonical(fileName);
    const identity = physical(fileName);
    files.set(key, identity ?? null);
    if (identity) files.set(identity, null);
    // Preserve membership for every compiler input. Output and external-library
    // status affect only whether the source gets workspace diagnostics.
    const root = roots.has(key);
    const publishable = (identity !== undefined || snapshots.has(key) || ts.sys.fileExists(fileName))
      && is_workspace_typescript_source(fileName, outputs) && !program.isSourceFileFromExternalLibrary(file)
      && (workspaceRoots.some(folder => beneath(fileName, folder)) || root && configured || snapshots.has(key));
    sources.push({ fileName, identity, publish: publishable });
  }
  return { files, sources, activeProgram };
}

/** The existing workspace scan owns these per-config observations. Source edits
 * refresh programs containing the changed file. Config and topology changes
 * rescan, since a previously missing candidate may now resolve. */
export class TypeScriptProjectScanner {
  private configuration?: ConfiguredProjects;
  private observations = new Map<string, ProjectSources>();
  private revision = 0;

  constructor(private readonly sdk = ts) {}

  *scan(workspaceRoots: readonly string[], openFiles: ReadonlyMap<string, string>,
    changedFiles?: readonly string[], activeProjects: ReadonlyMap<string, ts.Program | null> = new Map(),
  ): Generator<void, TypeScriptProjectDiscovery> {
    const revision = ++this.revision;
    const changes = changedFiles?.flatMap(project_file_keys);
    const previousConfiguration = this.configuration;
    const previousObservations = this.observations;
    const configuration = changes === undefined || previousConfiguration === undefined
      ? read_configurations(this.sdk, workspaceRoots) : previousConfiguration;
    const observations = new Map<string, ProjectSources>();
    const snapshots = new Map([...openFiles].map(([fileName, text]) => [canonical(fileName), text]));
    // Each compiler resolves its own path spelling. Only membership and change
    // invalidation use physical identity. Diagnostics are still published per editor URI.
    type Ownership = { projects: Set<string>; publicationPaths: Set<string> };
    const owners = new Map<string, Ownership>();
    const documents = new Map<string, Ownership>();
    const observe = (source: ProjectSource, config?: string) => {
      const key = source.identity ?? canonical(source.fileName);
      let owner = owners.get(key);
      if (owner === undefined) {
        owner = { projects: new Set(), publicationPaths: new Set() };
        owners.set(key, owner);
      }
      if (config !== undefined) owner.projects.add(config);
      if (source.publish) owner.publicationPaths.add(source.fileName);
      documents.set(canonical(source.fileName), owner);
    };
    for (const config of new Set([...configuration.parsed.keys(), ...activeProjects.keys()])) {
      const parsed = configuration.parsed.get(config);
      const active = activeProjects.get(config);
      const previous = configuration === previousConfiguration ? previousObservations.get(config) : undefined;
      let observed = previous;
      if (previous === undefined || previous.activeProgram !== active || changes?.some(file => previous.files.has(file))) {
        const program = active ?? (parsed && create_hson_project_program(this.sdk, parsed, dirname(config), name => snapshots.get(canonical(name))));
        if (!program) continue;
        observed = read_project_sources(program, workspaceRoots, snapshots, parsed !== undefined, active);
      }
      if (!observed) continue;
      observations.set(config, observed);
      for (const source of observed.sources) observe(source, config);
      if (observed !== previous) yield;
    }
    for (const fileName of openFiles.keys()) {
      if (!documents.has(canonical(fileName)) && is_workspace_typescript_source(fileName)) {
        observe({ fileName, identity: physical(fileName), publish: true });
      }
    }
    if (revision === this.revision) {
      this.configuration = configuration;
      this.observations = observations;
    }
    const sources = [...owners.values()].flatMap(owner =>
      [...owner.publicationPaths].map((fileName): DiscoveredTypeScriptSource => ({
        fileName, languageId: fileName.toLowerCase().endsWith(".tsx") ? "typescriptreact" : "typescript",
        owners: [...owner.projects].sort(),
      }))).sort((left, right) => left.fileName.localeCompare(right.fileName));
    const projectFiles = [...observations].map(([project, observation]) => [project, [...observation.files]] as const);
    return { sources, projectFiles, configurations: configuration.configurations, errors: configuration.errors };
  }
}

export function discover_typescript_projects(workspaceRoots: readonly string[],
  openFiles: ReadonlyMap<string, string> = new Map(),
): TypeScriptProjectDiscovery {
  const scan = new TypeScriptProjectScanner().scan(workspaceRoots, openFiles);
  let step = scan.next();
  while (!step.done) step = scan.next();
  return step.value;
}
