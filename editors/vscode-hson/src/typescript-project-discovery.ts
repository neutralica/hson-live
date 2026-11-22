import { statSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { create_hson_project_program, hson_source_syntactic_eligibility, is_hson_typescript_source_file, resolved_hson_event_imports } from "../../../src/internal/embedded-hson/discover-hson-tagged-templates.js";
import { event_source_text_hash, type EventSourceEvidence } from "./event-source-evidence.js";
import type { SchemaSourceMapping } from "../../../src/internal/hson-schema/source-mapping.js";

export type DiscoveredTypeScriptSource = Readonly<{
  fileName: string;
  languageId: "typescript" | "typescriptreact";
  owners: readonly string[];
  eventEvidence?: EventSourceEvidence;
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
export type ProjectRevisions = readonly (readonly [project: string, revision: string])[];
export type ProjectDiscoveryResponse = Readonly<{ sessionId: string; revision: ProjectRevisions; discoveryId?: string; projects?: TypeScriptProjectDiscovery }>;
export type ActiveTypeScriptProject = Readonly<{ program: ts.Program; mapping?: (fileName: string) => SchemaSourceMapping | undefined }>;

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

function read_configurations(ts: typeof import("typescript"), workspaceRoots: readonly string[]): ConfiguredProjects {
  const queue: string[] = [];
  for (const root of workspaceRoots) {
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

type ProjectSource = Readonly<{ fileName: string; identity?: string; publish: boolean; eventEvidence?: EventSourceEvidence }>;
type ProjectSources = Readonly<{
  files: ReadonlyMap<string, string | null>;
  activeProgram?: ts.Program;
  sources: readonly ProjectSource[];
}>;

function read_project_sources(ts: typeof import("typescript"), program: ts.Program, workspaceRoots: readonly string[],
  snapshots: ReadonlyMap<string, string>, configured: boolean, proveEvents: boolean, active?: ActiveTypeScriptProject,
): ProjectSources {
  const options = program.getCompilerOptions();
  const outputs = [options.outDir, options.declarationDir].filter((value): value is string => value !== undefined);
  const roots = new Set(program.getRootFileNames().map(canonical));
  const eligible = hson_source_syntactic_eligibility(ts, program);
  const files = new Map<string, string | null>(), sources: ProjectSource[] = [];
  for (const file of program.getSourceFiles()) {
    const fileName = resolve(file.fileName), key = canonical(fileName);
    const identity = physical(fileName);
    files.set(key, identity ?? null);
    if (identity) files.set(identity, null);
    // Every included source can veto another spelling of the same file. Output
    // directories and external-library status only control URI publication.
    const root = roots.has(key);
    const publishable = is_workspace_typescript_source(fileName, outputs) && !program.isSourceFileFromExternalLibrary(file)
      && (workspaceRoots.some(folder => beneath(fileName, folder)) || root && configured || snapshots.has(key));
    const candidate = !file.isDeclarationFile && could_author_event(ts, file);
    let eventEvidence: EventSourceEvidence | undefined;
    if (proveEvents && identity !== undefined && candidate && is_hson_typescript_source_file(fileName)) {
      const mapping = active?.mapping?.(file.fileName);
      if (mapping === undefined || mapping.text === file.text) {
        const offsets = resolved_hson_event_imports(ts, program, file, eligible);
        const importOffsets: number[] = [];
        for (const offset of offsets) {
          const authored = mapping === undefined ? offset : mapping.authored_edit({ start: offset, length: 1 })?.start;
          if (authored !== undefined) importOffsets.push(authored);
        }
        if (importOffsets.length) eventEvidence = { fileName, textHash: event_source_text_hash(mapping?.authored ?? file.text),
          importOffsets: importOffsets.sort((a, b) => a - b) };
      }
    }
    sources.push({ fileName, identity, publish: publishable && (root || candidate || snapshots.has(key)), eventEvidence });
  }
  return { files, sources, activeProgram: active?.program };
}

function agreed_evidence(left: EventSourceEvidence | undefined, right: EventSourceEvidence | undefined): EventSourceEvidence | undefined {
  if (left === undefined || right === undefined || left.textHash !== right.textHash) return undefined;
  const importOffsets = left.importOffsets.filter(offset => right.importOffsets.includes(offset));
  return importOffsets.length === 0 ? undefined : { ...left, importOffsets };
}

/** The existing workspace scan owns these per-config observations. Source edits
 * refresh programs containing the changed file. Config and topology changes
 * rescan, since a previously missing candidate may now resolve. */
export class TypeScriptProjectScanner {
  private configuration?: ConfiguredProjects;
  private observations = new Map<string, ProjectSources>();
  private revision = 0;

  constructor(private readonly sdk = ts, private readonly proveEvents = true) {}

  *scan(workspaceRoots: readonly string[], openFiles: ReadonlyMap<string, string>,
    changedFiles?: readonly string[], activeProjects: ReadonlyMap<string, ActiveTypeScriptProject> = new Map(),
  ): Generator<void, TypeScriptProjectDiscovery> {
    const revision = ++this.revision;
    const changes = changedFiles?.flatMap(project_file_keys);
    const previousConfiguration = this.configuration;
    const previousObservations = this.observations;
    const configuration = changes === undefined || previousConfiguration === undefined
      ? read_configurations(this.sdk, workspaceRoots) : previousConfiguration;
    const observations = new Map<string, ProjectSources>();
    const snapshots = new Map([...openFiles].map(([fileName, text]) => [canonical(fileName), text]));
    // Each compiler resolves its own path spelling. Only agreement and change
    // invalidation use physical identity. Diagnostics are still published per editor URI.
    type Ownership = { projects: Set<string>; publicationPaths: Set<string>; eventEvidence?: EventSourceEvidence };
    const owners = new Map<string, Ownership>();
    const documents = new Map<string, Ownership>();
    const observe = (source: ProjectSource, config?: string) => {
      const key = source.identity ?? canonical(source.fileName);
      let owner = owners.get(key);
      if (owner === undefined) {
        owner = { projects: new Set(), publicationPaths: new Set(), eventEvidence: source.eventEvidence };
        owners.set(key, owner);
      } else owner.eventEvidence = agreed_evidence(owner.eventEvidence, source.eventEvidence);
      if (config !== undefined) owner.projects.add(config);
      if (source.publish) owner.publicationPaths.add(source.fileName);
      documents.set(canonical(source.fileName), owner);
    };
    for (const config of new Set([...configuration.parsed.keys(), ...activeProjects.keys()])) {
      const parsed = configuration.parsed.get(config);
      const active = activeProjects.get(config);
      const previous = configuration === previousConfiguration ? previousObservations.get(config) : undefined;
      let observed = previous;
      if (!previous || previous.activeProgram !== active?.program || changes?.some(file => previous.files.has(file))) {
        const program = active?.program ?? (parsed && create_hson_project_program(this.sdk, parsed, dirname(config), name => snapshots.get(canonical(name))));
        if (!program) continue;
        const current = !active || !program.getSourceFiles().some(file => {
          const snapshot = snapshots.get(canonical(file.fileName));
          if (snapshot === undefined) return false;
          const mapping = active.mapping?.(file.fileName);
          return mapping === undefined ? snapshot !== file.text : snapshot !== mapping.authored || file.text !== mapping.text;
        });
        observed = read_project_sources(this.sdk, program, workspaceRoots, snapshots, parsed !== undefined, this.proveEvents && current
          && !parsed?.errors.length && !program.getConfigFileParsingDiagnostics().length, active);
      }
      if (!observed) continue;
      observations.set(config, observed);
      for (const source of observed.sources) observe(source, config);
      if (observed !== previous) yield;
    }
    for (const [fileName, text] of openFiles) {
      const key = canonical(fileName);
      const owner = documents.get(key);
      if (owner !== undefined) {
        if (owner.eventEvidence && event_source_text_hash(text) !== owner.eventEvidence.textHash) owner.eventEvidence = undefined;
        continue;
      }
      if (is_workspace_typescript_source(fileName)) observe({ fileName, identity: physical(fileName), publish: true });
    }
    if (revision === this.revision) {
      this.configuration = configuration;
      this.observations = observations;
    }
    const sources = [...owners.values()].flatMap(owner =>
      [...owner.publicationPaths].map((fileName): DiscoveredTypeScriptSource => ({
        fileName, languageId: fileName.toLowerCase().endsWith(".tsx") ? "typescriptreact" : "typescript",
        owners: [...owner.projects].sort(), eventEvidence: owner.eventEvidence && { ...owner.eventEvidence, fileName },
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

function could_author_event(ts: typeof import("typescript"), file: ts.SourceFile): boolean {
  const imports = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const binding of bindings.elements) if ((binding.propertyName ?? binding.name).text === "Hson") imports.add(binding.name.text);
  }
  if (imports.size === 0) return false;
  const visit = (node: ts.Node): true | undefined => ts.isPropertyAccessExpression(node)
    && node.name.text === "event" && ts.isIdentifier(node.expression) && imports.has(node.expression.text)
    ? true : ts.forEachChild(node, visit);
  return visit(file) === true;
}
