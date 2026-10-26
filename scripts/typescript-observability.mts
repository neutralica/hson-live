import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import ts from "typescript";

export type ObservabilityClass = "ordinary" | "negative" | "generated" | "artifact";
export type ProjectRole = "primary" | "subordinate";
export type ProjectSpec = Readonly<{ path: string; role: ProjectRole; authority: string }>;
export type ProjectInclusion = "root" | "dependency";
export type ProjectOwnership = Readonly<{ project: string; role: ProjectRole; inclusion: ProjectInclusion }>;
export type Exemption = Readonly<{
  file: string;
  kind: "negative-compile-fixture" | "non-typechecked-artifact";
  authority: string;
  reason: string;
}>;
export type ObservabilityManifest = Readonly<{
  projects: readonly ProjectSpec[];
  exemptions: readonly Exemption[];
}>;
export type ProjectInventory = Readonly<{
  owners: ReadonlyMap<string, readonly ProjectOwnership[]>;
}>;
export type EditorParityAudit = Readonly<{
  primaryProjects: ReadonlyMap<string, string>;
  configuredOrdinary: number;
  parityOrdinary: number;
  classifiedProjects: Readonly<{
    negative: Readonly<{ configured: number; inferred: number }>;
    artifact: Readonly<{ configured: number; inferred: number }>;
  }>;
  errors: readonly string[];
}>;
export type CoverageAudit = Readonly<{
  classes: Readonly<Record<ObservabilityClass, readonly string[]>>;
  editor: EditorParityAudit;
  errors: readonly string[];
}>;
export type EditorSelection = Readonly<{
  primaryProjects: ReadonlyMap<string, string>;
  editorDiagnostics: ReadonlyMap<string, readonly string[]>;
  configuredOrdinary: number;
  classifiedProjects: Readonly<{
    negative: Readonly<{ configured: number; inferred: number }>;
    artifact: Readonly<{ configured: number; inferred: number }>;
  }>;
  errors: readonly string[];
}>;
export type ProjectDiagnosticResult = Readonly<{
  project: string;
  files: readonly string[];
  parityFiles: readonly string[];
  errors: readonly string[];
}>;

const TYPESCRIPT_FAMILY = /\.(?:ts|tsx|mts|cts)$/;
const GENERATED_SCHEMA_DECLARATION = /\.hson-schema\.generated\.ts$/;

export function tracked_typescript_files(repositoryRoot: string): readonly string[] {
  const command = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "*.ts", "*.tsx", "*.mts", "*.cts"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (command.status !== 0) throw new Error(command.stderr || "git ls-files failed.");
  return Object.freeze(command.stdout.split("\0")
    .filter((file) => TYPESCRIPT_FAMILY.test(file) && existsSync(resolve(repositoryRoot, file)))
    .sort());
}

export function read_observability_manifest(path: string): ObservabilityManifest {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!is_manifest(value)) throw new Error(`${path}: invalid TypeScript observability manifest.`);
  return value;
}

export function resolved_project_inventory(repositoryRoot: string, projects: readonly ProjectSpec[]): ProjectInventory {
  const owners = new Map<string, ProjectOwnership[]>();
  const seenProjects = new Set<string>();
  for (const project of projects) {
    if (seenProjects.has(project.path)) throw new Error(`Duplicate TypeScript project ${project.path}.`);
    seenProjects.add(project.path);
    const configPath = resolve(repositoryRoot, project.path);
    if (!existsSync(configPath)) throw new Error(`Missing authoritative TypeScript project ${project.path}.`);
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (read.error !== undefined) throw new Error(format_diagnostic(read.error));
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(configPath), undefined, configPath);
    if (parsed.errors.length > 0) throw new Error(parsed.errors.map(format_diagnostic).join("\n"));
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    const roots = new Set(parsed.fileNames.map(normalized_absolute_path));
    for (const sourceFile of program.getSourceFiles()) {
      const file = repository_path(repositoryRoot, sourceFile.fileName);
      if (file === undefined || !TYPESCRIPT_FAMILY.test(file)) continue;
      const existing = owners.get(file) ?? [];
      existing.push(Object.freeze({
        project: project.path,
        role: project.role,
        inclusion: roots.has(normalized_absolute_path(sourceFile.fileName)) ? "root" : "dependency",
      }));
      owners.set(file, existing);
    }
  }
  return Object.freeze({ owners });
}

export function resolved_project_coverage(repositoryRoot: string, projects: readonly ProjectSpec[]): ReadonlyMap<string, readonly string[]> {
  const inventory = resolved_project_inventory(repositoryRoot, projects);
  return new Map([...inventory.owners].map(([file, ownership]) => [file, ownership.map((owner) => owner.project)]));
}

export function audit_coverage(
  tracked: readonly string[],
  owners: ReadonlyMap<string, readonly ProjectOwnership[]>,
  exemptions: readonly Exemption[],
): Omit<CoverageAudit, "editor"> {
  const trackedSet = new Set(tracked);
  const exemptionsByFile = new Map(exemptions.map((entry) => [entry.file, entry]));
  const classes: Record<ObservabilityClass, string[]> = { ordinary: [], negative: [], generated: [], artifact: [] };
  const errors: string[] = [];

  for (const exemption of exemptions) {
    if (!trackedSet.has(exemption.file)) errors.push(`Exemption target is missing or untracked: ${exemption.file}`);
    if (exemption.authority.trim() === "" || exemption.reason.trim() === "") errors.push(`Exemption lacks authority or reason: ${exemption.file}`);
    if (exemption.kind === "non-typechecked-artifact" && owners.has(exemption.file)) {
      errors.push(`Non-typechecked artifact is covered by an authoritative project and its exemption is stale: ${exemption.file}`);
    }
  }

  for (const file of tracked) {
    const exemption = exemptionsByFile.get(file);
    if (GENERATED_SCHEMA_DECLARATION.test(file)) {
      classes.generated.push(file);
      if (!owners.has(file)) errors.push(`Generated TypeScript file has no authoritative project: ${file}`);
    } else if (exemption?.kind === "negative-compile-fixture") {
      classes.negative.push(file);
      if (!owners.has(file)) errors.push(`Negative TypeScript fixture has no authoritative project: ${file}`);
    } else if (exemption?.kind === "non-typechecked-artifact") {
      classes.artifact.push(file);
    } else {
      classes.ordinary.push(file);
      if (!owners.has(file)) errors.push(`Ordinary TypeScript file has no authoritative project: ${file}`);
    }
  }

  return Object.freeze({
    classes: Object.freeze({
      ordinary: Object.freeze(classes.ordinary),
      negative: Object.freeze(classes.negative),
      generated: Object.freeze(classes.generated),
      artifact: Object.freeze(classes.artifact),
    }),
    errors: Object.freeze(errors),
  });
}

export function audit_editor_parity(
  repositoryRoot: string,
  ordinaryFiles: readonly string[],
  projects: readonly ProjectSpec[],
  inventory: ProjectInventory,
  classifiedFiles: Readonly<{ negative: readonly string[]; artifact: readonly string[] }> = { negative: [], artifact: [] },
): EditorParityAudit {
  const selection = select_editor_projects(repositoryRoot, ordinaryFiles, projects, inventory, classifiedFiles);
  const results = [...new Set(selection.primaryProjects.values())].map((project) => {
    const files = [...selection.primaryProjects].filter(([, selected]) => selected === project).map(([file]) => file);
    return compare_project_diagnostics(repositoryRoot, project, files, selection.editorDiagnostics);
  });
  return aggregate_project_results(selection, results);
}

export function select_editor_projects(
  repositoryRoot: string,
  ordinaryFiles: readonly string[],
  projects: readonly ProjectSpec[],
  inventory: ProjectInventory,
  classifiedFiles: Readonly<{ negative: readonly string[]; artifact: readonly string[] }> = { negative: [], artifact: [] },
): EditorSelection {
  const errors: string[] = [];
  const primaryProjects = new Map<string, string>();
  const editorDiagnostics = new Map<string, readonly string[]>();
  const primarySpecs = new Map(projects.filter((project) => project.role === "primary").map((project) => [project.path, project]));
  const filesByPrimaryProject = new Map<string, string[]>();
  const service = create_project_service(repositoryRoot);
  let configuredOrdinary = 0;
  const classifiedProjects = {
    negative: { configured: 0, inferred: 0 },
    artifact: { configured: 0, inferred: 0 },
  };
  const filesToOpen = [...new Set([...ordinaryFiles, ...classifiedFiles.negative, ...classifiedFiles.artifact])];

  try {
    for (const file of filesToOpen) {
      const opened = service.openClientFile(resolve(repositoryRoot, file), undefined, undefined, repositoryRoot);
      if (opened.configFileErrors !== undefined && opened.configFileErrors.length > 0) {
        errors.push(`${file}: editor project configuration failed: ${opened.configFileErrors.map(format_diagnostic).join(" | ")}`);
      }
    }

    for (const kind of ["negative", "artifact"] as const) {
      for (const file of classifiedFiles[kind]) {
        const project = service.getDefaultProjectForFile(ts.server.toNormalizedPath(resolve(repositoryRoot, file)), true);
        if (project?.projectKind === ts.server.ProjectKind.Configured) classifiedProjects[kind].configured += 1;
        else classifiedProjects[kind].inferred += 1;
      }
    }

    for (const file of ordinaryFiles) {
      const absoluteFile = resolve(repositoryRoot, file);
      const project = service.getDefaultProjectForFile(ts.server.toNormalizedPath(absoluteFile), true);
      if (project === undefined || project.projectKind !== ts.server.ProjectKind.Configured) {
        errors.push(`${file}: TypeScript ProjectService selected an inferred or missing project.`);
        continue;
      }

      const projectPath = repository_path(repositoryRoot, project.getProjectName());
      if (projectPath === undefined || !primarySpecs.has(projectPath)) {
        errors.push(`${file}: TypeScript ProjectService selected non-primary project ${projectPath ?? project.getProjectName()}.`);
        continue;
      }
      configuredOrdinary += 1;
      primaryProjects.set(file, projectPath);
      const projectFiles = filesByPrimaryProject.get(projectPath) ?? [];
      projectFiles.push(file);
      filesByPrimaryProject.set(projectPath, projectFiles);

      const ownership = inventory.owners.get(file)?.find((owner) => owner.project === projectPath);
      if (ownership === undefined) {
        errors.push(`${file}: selected primary project ${projectPath} does not contain the file as a root or dependency.`);
        continue;
      }

    }

    for (const files of filesByPrimaryProject.values()) {
      for (const file of files) {
        const absoluteFile = resolve(repositoryRoot, file);
        const editorProject = service.getDefaultProjectForFile(ts.server.toNormalizedPath(absoluteFile), true);
        if (editorProject === undefined) {
          errors.push(`${file}: cannot resolve editor diagnostics from the selected primary project.`);
          continue;
        }
        const languageService = editorProject.getLanguageService(true);
        editorDiagnostics.set(file, [...diagnostic_keys([
          ...languageService.getSyntacticDiagnostics(absoluteFile),
          ...languageService.getSemanticDiagnostics(absoluteFile),
        ])]);
      }
    }
  } finally {
    for (const file of filesToOpen) service.closeClientFile(resolve(repositoryRoot, file));
    service.closeLog();
  }

  return Object.freeze({
    primaryProjects,
    editorDiagnostics,
    configuredOrdinary,
    classifiedProjects: Object.freeze({
      negative: Object.freeze(classifiedProjects.negative),
      artifact: Object.freeze(classifiedProjects.artifact),
    }),
    errors: Object.freeze(errors),
  });
}

export function compare_project_diagnostics(
  repositoryRoot: string,
  project: string,
  files: readonly string[],
  editorDiagnostics: ReadonlyMap<string, readonly string[]>,
): ProjectDiagnosticResult {
  const errors: string[] = [];
  const parityFiles: string[] = [];
  const program = read_project_program(repositoryRoot, project);
  const sourceFiles = new Map(program.getSourceFiles().map((source) => [normalized_absolute_path(source.fileName), source]));
  for (const file of files) {
    const absoluteFile = resolve(repositoryRoot, file);
    const source = sourceFiles.get(normalized_absolute_path(absoluteFile));
    const editor = editorDiagnostics.get(file);
    if (source === undefined || editor === undefined) {
      errors.push(`${file}: missing authoritative source or editor diagnostic result for ${project}.`);
      continue;
    }
    const authoritative = diagnostic_keys([
      ...program.getSyntacticDiagnostics(source),
      ...program.getSemanticDiagnostics(source),
      ...program.getDeclarationDiagnostics(source),
    ]);
    const editorSet = new Set(editor);
    const editorOnly = [...editorSet].filter((key) => !authoritative.has(key));
    const authoritativeOnly = [...authoritative].filter((key) => !editorSet.has(key));
    if (editorOnly.length > 0 || authoritativeOnly.length > 0) {
      errors.push(`${file}: editor diagnostics differ from primary project ${project} (editor-only ${editorOnly.length}, authoritative-only ${authoritativeOnly.length}).`);
    } else {
      parityFiles.push(file);
    }
  }
  return Object.freeze({ project, files: Object.freeze([...files]), parityFiles: Object.freeze(parityFiles), errors: Object.freeze(errors) });
}

export function aggregate_project_results(selection: EditorSelection, results: readonly unknown[]): EditorParityAudit {
  const selectedFilesByProject = new Map<string, string[]>();
  for (const [file, project] of selection.primaryProjects) {
    const files = selectedFilesByProject.get(project) ?? [];
    files.push(file);
    selectedFilesByProject.set(project, files);
  }
  const expectedProjects = new Set(selectedFilesByProject.keys());
  const seenProjects = new Set<string>();
  const seenFiles = new Set<string>();
  const errors = [...selection.errors];
  let parityOrdinary = 0;
  for (const result of results) {
    if (!is_project_diagnostic_result(result)) throw new Error("Malformed TypeScript project diagnostic result.");
    if (!expectedProjects.has(result.project)) throw new Error(`Unexpected TypeScript project diagnostic result: ${result.project}.`);
    if (seenProjects.has(result.project)) throw new Error(`Duplicate TypeScript project diagnostic result: ${result.project}.`);
    seenProjects.add(result.project);
    const expectedFiles = new Set(selectedFilesByProject.get(result.project) ?? []);
    if (result.files.length !== expectedFiles.size || result.files.some((file) => !expectedFiles.has(file))) {
      throw new Error(`Incomplete or unexpected file results for TypeScript project ${result.project}.`);
    }
    for (const file of result.files) {
      if (seenFiles.has(file)) throw new Error(`Duplicate TypeScript diagnostic result for ${file}.`);
      seenFiles.add(file);
    }
    const parity = new Set(result.parityFiles);
    if (parity.size !== result.parityFiles.length || result.parityFiles.some((file) => !expectedFiles.has(file))) {
      throw new Error(`Malformed parity file results for TypeScript project ${result.project}.`);
    }
    parityOrdinary += parity.size;
    errors.push(...result.errors);
  }
  for (const project of expectedProjects) if (!seenProjects.has(project)) throw new Error(`Missing TypeScript project diagnostic result: ${project}.`);
  if (seenFiles.size !== selection.configuredOrdinary) throw new Error("TypeScript diagnostic aggregation did not cover every configured ordinary file.");
  return Object.freeze({
    primaryProjects: selection.primaryProjects,
    configuredOrdinary: selection.configuredOrdinary,
    parityOrdinary,
    classifiedProjects: selection.classifiedProjects,
    errors: Object.freeze(errors),
  });
}

export function run_selected_project_comparisons(
  selection: EditorSelection,
  runChild: (project: string) => ProjectDiagnosticResult,
): EditorParityAudit {
  const projects = [...new Set(selection.primaryProjects.values())];
  const results = projects.map((project) => runChild(project));
  return aggregate_project_results(selection, results);
}

export function run_observability_check(repositoryRoot: string): CoverageAudit {
  const wire = invoke_internal_child(repositoryRoot, "prepare");
  if (!is_prepared_wire(wire)) throw new Error("Malformed TypeScript observability preparation result.");
  const prepared = decode_prepared_wire(wire);
  const editor = run_selected_project_comparisons(prepared.selection, (project) => invoke_project_child(repositoryRoot, project, prepared.selection));
  return Object.freeze({ classes: prepared.classes, editor, errors: Object.freeze([...prepared.coverageErrors, ...editor.errors]) });
}

type PreparedPayload = Readonly<{
  classes: CoverageAudit["classes"];
  coverageErrors: readonly string[];
  selection: EditorSelection;
}>;

function invoke_project_child(repositoryRoot: string, project: string, selection: EditorSelection): ProjectDiagnosticResult {
  const files = [...selection.primaryProjects].filter(([, selected]) => selected === project).map(([file]) => file);
  const editorDiagnostics = Object.fromEntries(files.map((file) => [file, selection.editorDiagnostics.get(file)]));
  const result = invoke_internal_child(repositoryRoot, "compare", JSON.stringify({ project, files, editorDiagnostics }));
  if (!is_project_diagnostic_result(result) || result.project !== project) {
    throw new Error(`Malformed TypeScript diagnostic result for ${project}.`);
  }
  return result;
}

function invoke_internal_child(repositoryRoot: string, mode: "prepare" | "compare", input?: string): unknown {
  const scriptPath = fileURLToPath(import.meta.url);
  const child = spawnSync(process.execPath, ["--import=tsx", scriptPath, "--internal", mode, repositoryRoot], {
    cwd: repositoryRoot,
    encoding: "utf8",
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (child.error !== undefined) throw child.error;
  if (child.status !== 0) throw new Error(child.stderr.trim() || `TypeScript observability ${mode} child exited with status ${child.status}.`);
  if (child.stdout.trim() === "") throw new Error(`TypeScript observability ${mode} child returned no result.`);
  try {
    const parsed: unknown = JSON.parse(child.stdout);
    return parsed;
  } catch {
    throw new Error(`TypeScript observability ${mode} child returned malformed JSON.`);
  }
}

function prepare_observability(repositoryRoot: string): PreparedPayload {
  const manifest = read_observability_manifest(resolve(repositoryRoot, "typescript-observability.json"));
  const tracked = tracked_typescript_files(repositoryRoot);
  const inventory = resolved_project_inventory(repositoryRoot, manifest.projects);
  const coverage = audit_coverage(tracked, inventory.owners, manifest.exemptions);
  const selection = select_editor_projects(repositoryRoot, coverage.classes.ordinary, manifest.projects, inventory, {
    negative: coverage.classes.negative,
    artifact: coverage.classes.artifact,
  });
  return Object.freeze({ classes: coverage.classes, coverageErrors: coverage.errors, selection });
}

function parse_internal_selection(value: unknown): Readonly<{
  project: string;
  files: readonly string[];
  editorDiagnostics: ReadonlyMap<string, readonly string[]>;
}> {
  if (!is_record(value) || typeof value.project !== "string" || !is_string_array(value.files) || !is_record(value.editorDiagnostics)) {
    throw new Error("Malformed internal TypeScript comparison request.");
  }
  const editorDiagnostics = new Map<string, readonly string[]>();
  for (const [file, diagnostics] of Object.entries(value.editorDiagnostics)) {
    if (!is_string_array(diagnostics)) throw new Error(`Malformed editor diagnostic data for ${file}.`);
    editorDiagnostics.set(file, diagnostics);
  }
  return { project: value.project, files: value.files, editorDiagnostics };
}

function is_string_array(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function is_project_diagnostic_result(value: unknown): value is ProjectDiagnosticResult {
  return is_record(value) && typeof value.project === "string" && is_string_array(value.files)
    && is_string_array(value.parityFiles) && is_string_array(value.errors);
}

type PreparedWire = Readonly<{
  classes: CoverageAudit["classes"];
  coverageErrors: readonly string[];
  selection: Readonly<{
    primaryProjects: Readonly<Record<string, string>>;
    editorDiagnostics: Readonly<Record<string, readonly string[]>>;
    configuredOrdinary: number;
    classifiedProjects: EditorSelection["classifiedProjects"];
    errors: readonly string[];
  }>;
}>;

function is_prepared_wire(value: unknown): value is PreparedWire {
  if (!is_record(value) || !is_record(value.classes) || !is_string_array(value.coverageErrors) || !is_record(value.selection)) return false;
  const classes = value.classes;
  if (!is_string_array(classes.ordinary) || !is_string_array(classes.negative)
      || !is_string_array(classes.generated) || !is_string_array(classes.artifact)) return false;
  const selection = value.selection;
  if (!is_record(selection.primaryProjects) || !is_record(selection.editorDiagnostics)
      || typeof selection.configuredOrdinary !== "number" || !Number.isInteger(selection.configuredOrdinary)
      || !is_string_array(selection.errors) || !is_record(selection.classifiedProjects)) return false;
  const classified = selection.classifiedProjects;
  if (!is_record(classified.negative) || !is_record(classified.artifact)) return false;
  for (const kind of [classified.negative, classified.artifact]) {
    if (typeof kind.configured !== "number" || typeof kind.inferred !== "number") return false;
  }
  return Object.values(selection.primaryProjects).every((project) => typeof project === "string")
    && Object.values(selection.editorDiagnostics).every(is_string_array);
}

function decode_prepared_wire(wire: PreparedWire): PreparedPayload {
  const primaryProjects = new Map(Object.entries(wire.selection.primaryProjects));
  const editorDiagnostics = new Map(Object.entries(wire.selection.editorDiagnostics));
  return Object.freeze({
    classes: wire.classes,
    coverageErrors: wire.coverageErrors,
    selection: Object.freeze({ ...wire.selection, primaryProjects, editorDiagnostics }),
  });
}

function create_project_service(repositoryRoot: string): ts.server.ProjectService {
  const noopWatcher: ts.FileWatcher = { close() {} };
  const host: ts.server.ServerHost = {
    ...ts.sys,
    watchFile: () => noopWatcher,
    watchDirectory: () => noopWatcher,
    setTimeout: () => 0,
    clearTimeout() {},
    setImmediate: () => 0,
    clearImmediate() {},
  };
  const logger: ts.server.Logger = {
    close() {},
    hasLevel: () => false,
    loggingEnabled: () => false,
    perftrc() {},
    info() {},
    startGroup() {},
    endGroup() {},
    msg() {},
    getLogFileName: () => undefined,
  };
  return new ts.server.ProjectService({
    host,
    logger,
    cancellationToken: ts.server.nullCancellationToken,
    useSingleInferredProject: false,
    useInferredProjectPerProjectRoot: true,
    typingsInstaller: ts.server.nullTypingsInstaller,
    canUseWatchEvents: false,
    suppressDiagnosticEvents: true,
    session: undefined,
  });
}

function read_project_program(repositoryRoot: string, projectPath: string): ts.Program {
  const configPath = resolve(repositoryRoot, projectPath);
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error !== undefined) throw new Error(format_diagnostic(read.error));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(configPath), undefined, configPath);
  if (parsed.errors.length > 0) throw new Error(parsed.errors.map(format_diagnostic).join("\n"));
  return ts.createProgram(parsed.fileNames, parsed.options);
}

function diagnostic_keys(diagnostics: readonly ts.Diagnostic[]): ReadonlySet<string> {
  return new Set(diagnostics.map((diagnostic) => [
    diagnostic.code,
    diagnostic.category,
    diagnostic.start ?? -1,
    diagnostic.length ?? -1,
    ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  ].join(":")));
}

function is_manifest(value: unknown): value is ObservabilityManifest {
  if (!is_record(value) || !Array.isArray(value.projects) || !Array.isArray(value.exemptions)) return false;
  return value.projects.every((project: unknown) => is_record(project)
      && typeof project.path === "string"
      && (project.role === "primary" || project.role === "subordinate")
      && typeof project.authority === "string")
    && value.exemptions.every((entry: unknown) => is_record(entry)
      && typeof entry.file === "string"
      && (entry.kind === "negative-compile-fixture" || entry.kind === "non-typechecked-artifact")
      && typeof entry.authority === "string"
      && typeof entry.reason === "string");
}

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalized_absolute_path(fileName: string): string {
  return resolve(fileName).split(sep).join("/");
}

function repository_path(repositoryRoot: string, fileName: string): string | undefined {
  const path = relative(repositoryRoot, resolve(fileName)).split(sep).join("/");
  return path.startsWith("../") ? undefined : path;
}

function format_diagnostic(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  const internal = process.argv[2] === "--internal";
  if (internal) {
    const mode = process.argv[3];
    const repositoryRoot = resolve(process.argv[4] ?? dirname(fileURLToPath(import.meta.url)) + "/..");
    try {
      if (mode === "prepare") {
        const prepared = prepare_observability(repositoryRoot);
        console.log(JSON.stringify({
          classes: prepared.classes,
          coverageErrors: prepared.coverageErrors,
          selection: {
            ...prepared.selection,
            primaryProjects: Object.fromEntries(prepared.selection.primaryProjects),
            editorDiagnostics: Object.fromEntries(prepared.selection.editorDiagnostics),
          },
        }));
      } else if (mode === "compare") {
        const request: unknown = JSON.parse(readFileSync(0, "utf8"));
        const parsed = parse_internal_selection(request);
        console.log(JSON.stringify(compare_project_diagnostics(repositoryRoot, parsed.project, parsed.files, parsed.editorDiagnostics)));
      } else {
        throw new Error("Unknown internal TypeScript observability operation.");
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Internal TypeScript observability operation failed.");
      process.exitCode = 1;
    }
  } else {
    try {
      const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
      const audit = run_observability_check(repositoryRoot);
      const counts = {
        ordinary: audit.classes.ordinary.length,
        negative: audit.classes.negative.length,
        generated: audit.classes.generated.length,
        artifact: audit.classes.artifact.length,
        editorConfigured: audit.editor.configuredOrdinary,
        editorParity: audit.editor.parityOrdinary,
        inferredNegative: audit.editor.classifiedProjects.negative.inferred,
        inferredArtifact: audit.editor.classifiedProjects.artifact.inferred,
      };
      if (audit.errors.length > 0) {
        console.error(audit.errors.join("\n"));
        process.exitCode = 1;
      } else {
        console.log(JSON.stringify({ typescriptObservability: "ok", counts }));
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : "TypeScript observability failed.");
      process.exitCode = 1;
    }
  }
}
