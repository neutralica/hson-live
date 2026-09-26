import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { generate_schema_compiler_project, validate_schema_project_ownership } from "./compiler-project.js";
import { ObsoleteSchemaProject, SchemaProjectSnapshot } from "./project-snapshot.js";

type Analysis = Readonly<{
  schemas: Parameters<typeof generate_schema_compiler_project>[3];
  overlays: Parameters<typeof generate_schema_compiler_project>[4];
  diagnostics: readonly string[];
}>;
type Event = Readonly<{ state: "prepared" | "discarded" | "current"; revision: string; project?: string; manifest?: string; diagnostics?: readonly string[]; schemas?: number }>;
const SELECTOR_OWNER = "hson-schema-compiler-selector-v1";

/** Sequential polling coalesces edits; the snapshot's queries, not a successful program, define dependencies. */
export function create_schema_compiler_project_watch(
  projectPath: string,
  analyze: (config: ts.ParsedCommandLine, program: ts.Program, configDiagnostics: readonly ts.Diagnostic[]) => Analysis,
  events: (event: Event) => void,
  beforePublish?: (event: Event) => Promise<void>,
) {
  projectPath = resolve(projectPath);
  const projectRoot = dirname(projectPath);
  const outputRoot = join(projectRoot, ".hson", "compiler-input", basename(projectPath));
  const selectorPath = join(outputRoot, "tsconfig.json");
  let previous: SchemaProjectSnapshot | undefined;
  let busy = false;
  let stopped = false;
  const poll = async (): Promise<void> => {
    if (busy || stopped) return;
    busy = true;
    let candidateRoot: string | undefined;
    try {
      if (previous?.isCurrent()) return;
      const snapshot = new SchemaProjectSnapshot();
      const read = ts.readConfigFile(projectPath, snapshot.readFile);
      // Even broken config text establishes default directory discovery and missing-config observations.
      const config = ts.parseJsonConfigFileContent(read.config ?? {}, snapshot.host, projectRoot, undefined, projectPath);
      const configDiagnostics = [...read.error === undefined ? [] : [read.error], ...config.errors];
      const program = ts.createProgram(config.fileNames, config.options, snapshot.compilerHost(config.options));
      // The official-binding check also consults package names. Track ancestor scopes even
      // when the selected TS module mode does not itself read their package.json files.
      const scopes = new Set<string>();
      for (const file of program.getSourceFiles()) {
        let directory = dirname(resolve(file.fileName));
        while (!scopes.has(directory)) {
          scopes.add(directory);
          const packagePath = join(directory, "package.json");
          if (snapshot.fileExists(packagePath)) { snapshot.readFile(packagePath); break; }
          const parent = dirname(directory);
          if (parent === directory) break;
          directory = parent;
        }
      }
      const analysis = analyze(config, program, configDiagnostics);
      if (!snapshot.isCurrent()) throw new ObsoleteSchemaProject();
      const priorSelector = check_selector(projectRoot, outputRoot, projectPath);
      const revisions = join(outputRoot, "revisions");
      no_symlinks(projectRoot, revisions);
      mkdirSync(revisions, { recursive: true });
      candidateRoot = mkdtempSync(join(revisions, "revision-"));
      let generated: ReturnType<typeof generate_schema_compiler_project>;
      try {
        generated = generate_schema_compiler_project(projectPath, config, program, analysis.schemas, analysis.overlays, {
          outputRoot: candidateRoot, snapshot, diagnostics: analysis.diagnostics,
        });
      } catch (error) {
        if (!snapshot.isCurrent()) throw new ObsoleteSchemaProject();
        throw error;
      }
      const revision = snapshot.fingerprint();
      const prepared: Event = { state: "prepared", revision, ...generated, diagnostics: analysis.diagnostics };
      events(prepared);
      await beforePublish?.(prepared);
      if (stopped || !snapshot.isCurrent()) throw new ObsoleteSchemaProject();
      validate_schema_project_ownership(projectRoot, candidateRoot, basename(projectPath));
      // Detect edited generated output/selector while the candidate was being prepared.
      if (check_selector(projectRoot, outputRoot, projectPath) !== priorSelector) throw new Error("Hson compiler-project selector changed during preparation.");
      const manifestDigest = hash(readFileSync(generated.manifest));
      const selector = JSON.stringify({
        extends: `./revisions/${basename(candidateRoot)}/tsconfig.json`,
        $hsonSchema: { owner: SELECTOR_OWNER, project: projectPath, manifestDigest, revision },
      }, null, 2) + "\n";
      const pending = join(candidateRoot, "selector.pending.json");
      writeFileSync(pending, selector, { flag: "wx" });
      // Last input check immediately before the one authority-changing filesystem operation.
      if (stopped || !snapshot.isCurrent()) { unlinkSync(pending); throw new ObsoleteSchemaProject(); }
      renameSync(pending, selectorPath);
      candidateRoot = undefined; // Published directories are never mutated or collected.
      previous = snapshot;
      events({ state: "current", revision, project: selectorPath, manifest: generated.manifest,
        schemas: analysis.schemas.length, diagnostics: analysis.diagnostics });
    } catch (error) {
      if (!(error instanceof ObsoleteSchemaProject)) throw error;
      events({ state: "discarded", revision: "obsolete" });
    } finally {
      if (candidateRoot !== undefined) discard_candidate(projectRoot, candidateRoot, basename(projectPath));
      busy = false;
    }
  };
  return { poll, stop: () => { stopped = true; } };
}

function check_selector(projectRoot: string, outputRoot: string, project: string): string | undefined {
  const path = join(outputRoot, "tsconfig.json");
  no_symlinks(projectRoot, path);
  if (!existsSync(path)) return undefined;
  const content = readFileSync(path, "utf8");
  const parsed: unknown = JSON.parse(content);
  if (record(parsed) && record(parsed.$hsonSchema) && parsed.$hsonSchema.owner === SELECTOR_OWNER
    && parsed.$hsonSchema.project === project && typeof parsed.extends === "string"
    && /^\.\/revisions\/revision-[A-Za-z0-9]+\/tsconfig\.json$/.test(parsed.extends)) {
    const selected = dirname(resolve(outputRoot, parsed.extends));
    validate_schema_project_ownership(projectRoot, selected, basename(project));
    if (hash(readFileSync(join(selected, "manifest.json"))) !== parsed.$hsonSchema.manifestDigest) throw new Error("Edited Hson compiler-project manifest.");
  } else {
    // A Phase 1 project can be adopted only when its manifest owns its unchanged selector.
    validate_schema_project_ownership(projectRoot, outputRoot, basename(project));
    const manifest = JSON.parse(readFileSync(join(outputRoot, "manifest.json"), "utf8"));
    if (!manifest.files.some((file: { path: string; digest: string }) => file.path === "tsconfig.json" && file.digest === hash(content))) {
      throw new Error(`Refusing to replace unowned Hson compiler-project selector: ${path}`);
    }
  }
  return content;
}

function discard_candidate(projectRoot: string, root: string, project: string): void {
  // A failed pre-manifest preparation is retained, never guessed to be safe to recursively delete.
  const path = join(root, "manifest.json");
  if (!existsSync(path)) return;
  validate_schema_project_ownership(projectRoot, root, project);
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  for (const file of manifest.files) unlinkSync(join(root, file.path));
  unlinkSync(path);
  // Only empty directories can be removed. Unlisted neighbors are always retained.
  try { rmdirSync(root); } catch (error) { if (!record(error) || error.code !== "ENOTEMPTY") throw error; }
}
function no_symlinks(root: string, path: string): void {
  let current = resolve(root);
  for (const part of relative(root, path).split(sep)) {
    current = join(current, part);
    try { if (lstatSync(current).isSymbolicLink()) throw new Error(`Generated destination must not traverse a symlink: ${current}`); }
    catch (error) { if (!record(error) || error.code !== "ENOENT") throw error; }
  }
}
function hash(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
