import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import ts from "typescript";
import { generate_schema_compiler_project, validate_schema_project_ownership, read_owned_files, assert_no_symlinks, SCHEMA_PROJECT_COMPATIBILITY, type SourceRecord } from "./compiler-project.js";
import { ObsoleteSchemaProject, SchemaProjectSnapshot } from "./project-snapshot.js";

export type Analysis = Readonly<{
  schemas: Parameters<typeof generate_schema_compiler_project>[3];
  overlays: Parameters<typeof generate_schema_compiler_project>[4];
  diagnostics: readonly string[];
}>;
type Event = Readonly<{ state: "prepared" | "discarded" | "current"; revision: string; project?: string; manifest?: string; diagnostics?: readonly string[]; schemas?: number }>;
type Manifest = Readonly<{
  compatibility: string; publication: string; revision: string;
  observations: ReturnType<SchemaProjectSnapshot["records"]>;
  diagnostics: readonly string[]; sources: readonly SourceRecord[];
}>;
type Owned = Readonly<{ root: string; text: string; files: ReturnType<typeof read_owned_files> }>;
const PENDING = ".publishing.json";
const manifest_path = (root: string): string => join(root, "manifest.json");
const output_root = (project: string): string => join(dirname(project), ".hson", "compiler-input", basename(project));

/** Sequential polling coalesces edits; persisted observations also support unchanged startup. */
export function create_schema_compiler_project_watch(
  projectPath: string,
  analyze: (config: ts.ParsedCommandLine, program: ts.Program, configDiagnostics: readonly ts.Diagnostic[]) => Analysis,
  events: (event: Event) => void,
  beforePublish?: (event: Event) => Promise<void>,
  afterReplaceFile?: (path: string) => void,
) {
  projectPath = resolve(projectPath);
  const projectRoot = dirname(projectPath), outputRoot = output_root(projectPath);
  let previous: SchemaProjectSnapshot | undefined;
  let reused: Manifest | undefined;
  let busy = false, stopped = false;
  const poll = async (): Promise<void> => {
    if (busy || stopped) return;
    busy = true;
    let staging: string | undefined;
    let stagedFiles: readonly { path: string }[] = [];
    try {
      if (previous?.isCurrent() || reused !== undefined && SchemaProjectSnapshot.matches(reused.observations)) return;
      const prior = existing(projectPath);
      if (prior.current !== undefined) {
        const manifest = current_manifest(prior.current.text);
        if (manifest.compatibility === SCHEMA_PROJECT_COMPATIBILITY && SchemaProjectSnapshot.matches(manifest.observations)) {
          reused = manifest;
          events({ state: "current", revision: manifest.revision, project: join(outputRoot, "tsconfig.json"), manifest: manifest_path(outputRoot), diagnostics: manifest.diagnostics,
            schemas: manifest.sources.reduce((count, source) => count + source.schemas.length, 0) });
          return;
        }
      }
      reused = undefined;
      const snapshot = new SchemaProjectSnapshot();
      const read = ts.readConfigFile(projectPath, snapshot.readFile);
      const config = ts.parseJsonConfigFileContent(read.config ?? {}, snapshot.host, projectRoot, undefined, projectPath);
      const configDiagnostics = [...read.error === undefined ? [] : [read.error], ...config.errors];
      const program = ts.createProgram(config.fileNames, config.options, snapshot.compilerHost(config.options));
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
      assert_no_symlinks(projectRoot, outputRoot);
      mkdirSync(outputRoot, { recursive: true });
      staging = mkdtempSync(join(outputRoot, ".staging-"));
      let generated: ReturnType<typeof generate_schema_compiler_project>;
      try {
        generated = generate_schema_compiler_project(projectPath, config, program, analysis.schemas, analysis.overlays, {
          outputRoot: staging, finalRoot: outputRoot, snapshot, diagnostics: analysis.diagnostics,
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
      validate_schema_project_ownership(projectRoot, staging, basename(projectPath));
      const candidate = owned(projectPath, staging);
      stagedFiles = candidate.files;
      // Only competing publishers are excluded, during the short filesystem replacement.
      // Readers do not lock: they reject an incomplete publication and capture its bytes.
      const pending = join(outputRoot, PENDING);
      writeFileSync(pending, JSON.stringify({ owner: "hson-schema-publication-v1", staging: basename(staging) }) + "\n", { flag: "wx" });
      let replacing = false;
      try {
        const latest = existing(projectPath, true);
        if (latest.stamp !== prior.stamp) throw new Error("Hson compiler project changed during preparation. Retry generation.");
        const replaceable = new Set(latest.current?.files.map(file => file.path) ?? []);
        if (latest.selector !== undefined) replaceable.add("tsconfig.json");
        for (const file of candidate.files) {
          const destination = join(outputRoot, file.path);
          assert_no_symlinks(projectRoot, destination);
          if (existsSync(destination) && (!replaceable.has(file.path) || !lstatSync(destination).isFile())) {
            throw new Error(`Refusing to replace unowned Hson compiler-project file: ${destination}`);
          }
        }
        if (stopped || !snapshot.isCurrent()) throw new ObsoleteSchemaProject();
        replacing = true;
        const next = new Set(candidate.files.map(file => file.path));
        for (const file of latest.current?.files ?? []) if (!next.has(file.path)) unlinkSync(join(outputRoot, file.path));
        for (const file of candidate.files) {
          const destination = join(outputRoot, file.path);
          mkdirSync(dirname(destination), { recursive: true });
          renameSync(join(staging, file.path), destination);
          afterReplaceFile?.(destination);
        }
        // Every final-path compiler input is in place before the manifest is committed.
        renameSync(manifest_path(staging), manifest_path(outputRoot));
        for (const old of latest.legacy) remove_owned(projectPath, old, false);
        if (latest.legacy.length > 0) prune_empty(join(outputRoot, "revisions"));
        for (const old of latest.current?.files ?? []) prune_empty(dirname(join(outputRoot, old.path)), outputRoot);
        unlinkSync(pending);
      } catch (error) {
        if (!replacing) unlinkSync(pending);
        // After the first replacement, retain the marker and staged ownership inventory.
        // Incomplete state is unavailable, never a current proof or an overwrite permission.
        else staging = undefined;
        throw error;
      }
      previous = snapshot;
      events({ state: "current", revision, project: join(outputRoot, "tsconfig.json"), manifest: manifest_path(outputRoot),
        schemas: analysis.schemas.length, diagnostics: analysis.diagnostics });
    } catch (error) {
      if (!(error instanceof ObsoleteSchemaProject)) throw error;
      events({ state: "discarded", revision: "obsolete" });
    } finally {
      if (staging !== undefined) {
        if (existsSync(manifest_path(staging))) remove_owned(projectPath, owned(projectPath, staging, true), true);
        else {
          for (const file of stagedFiles) prune_empty(dirname(join(staging, file.path)), staging);
          prune_empty(staging);
        }
      }
      busy = false;
    }
  };
  return { poll, stop: () => { stopped = true; } };
}

function available(project: string): void {
  const root = output_root(project);
  assert_no_symlinks(dirname(project), join(root, PENDING));
  if (existsSync(join(root, PENDING))) throw new Error(`Hson compiler publication is incomplete or in progress: ${join(root, PENDING)}. Retry after the publisher finishes. If interrupted, inspect its staging directory and restore the manifest-owned files before retrying; do not delete unowned files.`);
}
function owned(project: string, root: string, partial = false): Owned {
  assert_no_symlinks(dirname(project), manifest_path(root));
  if (!lstatSync(manifest_path(root)).isFile()) throw new Error(`Invalid Hson ownership manifest: ${manifest_path(root)}`);
  const text = readFileSync(manifest_path(root), "utf8");
  const files = read_owned_files(root, manifest_path(root), basename(project));
  if (!partial) validate_schema_project_ownership(dirname(project), root, basename(project));
  return { root, text, files };
}
function existing(project: string, publishing = false) {
  const root = output_root(project);
  if (!publishing) available(project);
  assert_no_symlinks(dirname(project), manifest_path(root));
  assert_no_symlinks(dirname(project), join(root, "tsconfig.json"));
  const current = existsSync(manifest_path(root)) ? owned(project, root) : undefined;
  const legacy: Owned[] = [];
  let selector: string | undefined;
  if (current === undefined && existsSync(join(root, "tsconfig.json"))) {
    selector = readFileSync(join(root, "tsconfig.json"), "utf8");
    const parsed = JSON.parse(selector);
    if (parsed.$hsonSchema?.owner !== "hson-schema-compiler-selector-v1" || parsed.$hsonSchema.project !== project
      || typeof parsed.extends !== "string" || !/^\.\/revisions\/revision-[A-Za-z0-9]+\/tsconfig\.json$/.test(parsed.extends)) {
      throw new Error(`Refusing to replace unowned Hson compiler project: ${root}`);
    }
    const selected = owned(project, dirname(resolve(root, parsed.extends)));
    if (hash(selected.text) !== parsed.$hsonSchema.manifestDigest || JSON.parse(selected.text).revision !== parsed.$hsonSchema.revision) throw new Error("Edited Hson compiler-project manifest or selector.");
    const revisions = join(root, "revisions");
    assert_no_symlinks(dirname(project), revisions);
    for (const name of readdirSync(revisions).sort()) {
      if (!name.startsWith("revision-")) continue; // Unrelated neighbors stay where they are.
      const directory = join(revisions, name);
      assert_no_symlinks(dirname(project), directory);
      if (!existsSync(manifest_path(directory))) throw new Error(`Cannot migrate unrecognized revision ${directory}. Inspect and relocate ambiguous material before retrying generation.`);
      legacy.push(owned(project, directory));
    }
  }
  return { current, legacy, selector, stamp: JSON.stringify([current?.text, selector, legacy.map(entry => [entry.root, entry.text])]) };
}

/** Kept for internal callers of the previous selector validator; new projects have a manifest boundary. */
export function check_selector(_projectRoot: string, _outputRoot: string, project: string): string | undefined {
  const state = existing(resolve(project));
  return state.current?.text ?? state.selector;
}

function current_manifest(text: string): Manifest {
  const parsed = JSON.parse(text);
  const { contentDigest, ...contents } = parsed;
  if (contentDigest !== hash(JSON.stringify(contents))) throw new Error("Edited or legacy Hson compiler-project manifest. Run generate with current tooling for a legacy project.");
  if (typeof parsed.compatibility !== "string" || typeof parsed.publication !== "string" || typeof parsed.revision !== "string"
    || !Array.isArray(parsed.observations) || !Array.isArray(parsed.sources) || !Array.isArray(parsed.diagnostics)) throw new Error("Invalid Hson compiler-project manifest.");
  return parsed;
}

/** Capture ALL generated bytes before TypeScript can read any of them. No disk fallbacks inside this root. */
export function capture_schema_compiler_project(projectPath: string, afterCaptureFile?: (file: string) => void) {
  try { return capture_current(projectPath, afterCaptureFile); }
  catch (error) {
    throw new Error(`Cannot capture Hson compiler project; retry check/build after generation. ${error instanceof Error ? error.message : String(error)}`);
  }
}
function capture_current(projectPath: string, afterCaptureFile?: (file: string) => void) {
  projectPath = resolve(projectPath);
  const root = output_root(projectPath), path = manifest_path(root);
  available(projectPath);
  assert_no_symlinks(dirname(projectPath), path);
  if (!existsSync(path)) throw new Error("Missing or legacy generated Hson project. Run hson-schema generate.");
  const text = readFileSync(path, "utf8");
  const manifest = current_manifest(text);
  if (manifest.compatibility !== SCHEMA_PROJECT_COMPATIBILITY) throw new Error("Incompatible generated Hson project. Run hson-schema generate with current tooling.");
  const files = new Map<string, Buffer>();
  for (const file of read_owned_files(root, path, basename(projectPath))) {
    const absolute = join(root, file.path);
    assert_no_symlinks(dirname(projectPath), absolute);
    if (!existsSync(absolute) || !lstatSync(absolute).isFile()) throw new Error(`Incomplete generated Hson project during capture: ${absolute}. Retry after generation.`);
    const bytes = readFileSync(absolute);
    if (hash(bytes) !== file.digest) throw new Error(`Unowned/edited Hson compiler-project file or publication changed during capture: ${absolute}. Retry after generation.`);
    files.set(absolute, bytes);
    afterCaptureFile?.(absolute);
  }
  available(projectPath);
  if (readFileSync(path, "utf8") !== text) throw new Error("Hson compiler publication changed during capture. Retry check/build.");
  if (!files.has(join(root, "tsconfig.json"))) throw new Error("Incomplete generated Hson project: missing compiler configuration.");
  if (!SchemaProjectSnapshot.matches(manifest.observations)) throw new Error("Stale generated Hson project. Run hson-schema generate.");
  return { project: join(root, "tsconfig.json"), selected: root, manifest, files };
}

/** Read-only verification also accepts no mixed generated state. Invalid source is reported separately from completeness. */
export function verify_schema_compiler_project(projectPath: string) {
  const current = capture_schema_compiler_project(projectPath);
  if (current.manifest.diagnostics.length) throw new Error(current.manifest.diagnostics.join("\n"));
  return current;
}

function remove_owned(project: string, inventory: Owned, partial: boolean): void {
  const { root, text, files } = inventory;
  if (readFileSync(manifest_path(root), "utf8") !== text) throw new Error(`Edited cleanup manifest: ${root}`);
  for (const file of files) {
    const path = join(root, file.path);
    assert_no_symlinks(dirname(project), path);
    if (partial && !existsSync(path)) continue;
    if (!lstatSync(path).isFile() || hash(readFileSync(path)) !== file.digest) throw new Error(`Refusing to remove edited generated file: ${path}`);
  }
  for (const file of files) if (existsSync(join(root, file.path))) unlinkSync(join(root, file.path));
  unlinkSync(manifest_path(root));
  for (const file of files) prune_empty(dirname(join(root, file.path)), root);
  prune_empty(root);
}
function prune_empty(path: string, boundary = dirname(path)): void {
  while (path !== boundary && existsSync(path)) {
    try { rmdirSync(path); } catch (error) { if (record(error) && (error.code === "ENOTEMPTY" || error.code === "EEXIST")) return; throw error; }
    path = dirname(path);
  }
}
function hash(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
