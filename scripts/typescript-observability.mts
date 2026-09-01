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
  const errors: string[] = [];
  const primaryProjects = new Map<string, string>();
  const primarySpecs = new Map(projects.filter((project) => project.role === "primary").map((project) => [project.path, project]));
  const filesByPrimaryProject = new Map<string, string[]>();
  const service = create_project_service(repositoryRoot);
  let configuredOrdinary = 0;
  let parityOrdinary = 0;
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

    for (const [projectPath, files] of filesByPrimaryProject) {
      const authoritativeProgram = read_project_program(repositoryRoot, projectPath);
      for (const file of files) {
        const absoluteFile = resolve(repositoryRoot, file);
        const authoritativeSource = authoritativeProgram.getSourceFiles().find((source) => normalized_absolute_path(source.fileName) === normalized_absolute_path(absoluteFile));
        const editorProject = service.getDefaultProjectForFile(ts.server.toNormalizedPath(absoluteFile), true);
        if (authoritativeSource === undefined || editorProject === undefined) {
          errors.push(`${file}: cannot resolve diagnostics from primary project ${projectPath}.`);
          continue;
        }
        const authoritative = diagnostic_keys([
          ...authoritativeProgram.getSyntacticDiagnostics(authoritativeSource),
          ...authoritativeProgram.getSemanticDiagnostics(authoritativeSource),
        ]);
        const languageService = editorProject.getLanguageService(true);
        const editor = diagnostic_keys([
          ...languageService.getSyntacticDiagnostics(absoluteFile),
          ...languageService.getSemanticDiagnostics(absoluteFile),
        ]);
        const editorOnly = [...editor].filter((key) => !authoritative.has(key));
        const authoritativeOnly = [...authoritative].filter((key) => !editor.has(key));
        if (editorOnly.length > 0 || authoritativeOnly.length > 0) {
          errors.push(`${file}: editor diagnostics differ from primary project ${projectPath} (editor-only ${editorOnly.length}, authoritative-only ${authoritativeOnly.length}).`);
          continue;
        }
        parityOrdinary += 1;
      }
    }
  } finally {
    for (const file of filesToOpen) service.closeClientFile(resolve(repositoryRoot, file));
    service.closeLog();
  }

  return Object.freeze({
    primaryProjects,
    configuredOrdinary,
    parityOrdinary,
    classifiedProjects: Object.freeze({
      negative: Object.freeze(classifiedProjects.negative),
      artifact: Object.freeze(classifiedProjects.artifact),
    }),
    errors: Object.freeze(errors),
  });
}

export function run_observability_check(repositoryRoot: string): CoverageAudit {
  const manifest = read_observability_manifest(resolve(repositoryRoot, "typescript-observability.json"));
  const tracked = tracked_typescript_files(repositoryRoot);
  const inventory = resolved_project_inventory(repositoryRoot, manifest.projects);
  const coverage = audit_coverage(tracked, inventory.owners, manifest.exemptions);
  const editor = audit_editor_parity(repositoryRoot, coverage.classes.ordinary, manifest.projects, inventory, {
    negative: coverage.classes.negative,
    artifact: coverage.classes.artifact,
  });
  return Object.freeze({ classes: coverage.classes, editor, errors: Object.freeze([...coverage.errors, ...editor.errors]) });
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
}
