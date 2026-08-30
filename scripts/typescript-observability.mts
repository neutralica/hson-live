import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import ts from "typescript";

export type ObservabilityClass = "ordinary" | "negative" | "generated" | "artifact";
export type ProjectSpec = Readonly<{ path: string; authority: string }>;
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
export type CoverageAudit = Readonly<{
  classes: Readonly<Record<ObservabilityClass, readonly string[]>>;
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

export function resolved_project_coverage(repositoryRoot: string, projects: readonly ProjectSpec[]): ReadonlyMap<string, readonly string[]> {
  const owners = new Map<string, string[]>();
  for (const project of projects) {
    const configPath = resolve(repositoryRoot, project.path);
    if (!existsSync(configPath)) throw new Error(`Missing authoritative TypeScript project ${project.path}.`);
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (read.error !== undefined) throw new Error(format_diagnostic(read.error));
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(configPath), undefined, configPath);
    if (parsed.errors.length > 0) throw new Error(parsed.errors.map(format_diagnostic).join("\n"));
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    for (const sourceFile of program.getSourceFiles()) {
      const file = repository_path(repositoryRoot, sourceFile.fileName);
      if (file === undefined || !TYPESCRIPT_FAMILY.test(file)) continue;
      const existing = owners.get(file) ?? [];
      existing.push(project.path);
      owners.set(file, existing);
    }
  }
  return owners;
}

export function audit_coverage(
  tracked: readonly string[],
  owners: ReadonlyMap<string, readonly string[]>,
  exemptions: readonly Exemption[],
): CoverageAudit {
  const trackedSet = new Set(tracked);
  const exemptionsByFile = new Map(exemptions.map((entry) => [entry.file, entry]));
  const classes: Record<ObservabilityClass, string[]> = { ordinary: [], negative: [], generated: [], artifact: [] };
  const errors: string[] = [];

  for (const exemption of exemptions) {
    if (!trackedSet.has(exemption.file)) errors.push(`Exemption target is missing or untracked: ${exemption.file}`);
    if (exemption.authority.trim() === "" || exemption.reason.trim() === "") errors.push(`Exemption lacks authority or reason: ${exemption.file}`);
    if (owners.has(exemption.file)) errors.push(`Exempt file is already covered and its exemption is stale: ${exemption.file}`);
  }

  for (const file of tracked) {
    const exemption = exemptionsByFile.get(file);
    if (GENERATED_SCHEMA_DECLARATION.test(file)) {
      classes.generated.push(file);
      if (!owners.has(file)) errors.push(`Generated TypeScript file has no authoritative project: ${file}`);
    } else if (exemption?.kind === "negative-compile-fixture") {
      classes.negative.push(file);
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

export function run_observability_check(repositoryRoot: string): CoverageAudit {
  const manifest = read_observability_manifest(resolve(repositoryRoot, "typescript-observability.json"));
  const tracked = tracked_typescript_files(repositoryRoot);
  const owners = resolved_project_coverage(repositoryRoot, manifest.projects);
  return audit_coverage(tracked, owners, manifest.exemptions);
}

function is_manifest(value: unknown): value is ObservabilityManifest {
  if (!is_record(value) || !Array.isArray(value.projects) || !Array.isArray(value.exemptions)) return false;
  return value.projects.every((project: unknown) => is_record(project) && typeof project.path === "string" && typeof project.authority === "string")
    && value.exemptions.every((entry: unknown) => is_record(entry)
      && typeof entry.file === "string"
      && (entry.kind === "negative-compile-fixture" || entry.kind === "non-typechecked-artifact")
      && typeof entry.authority === "string"
      && typeof entry.reason === "string");
}

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
  };
  if (audit.errors.length > 0) {
    console.error(audit.errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ typescriptObservability: "ok", counts }));
  }
}
