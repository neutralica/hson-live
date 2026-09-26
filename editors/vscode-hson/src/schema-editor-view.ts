import type ts from "typescript";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { generate_hson_schema_evidence } from "../../../src/internal/hson-schema/generated-evidence.js";
import { library_schema_attachment_plan, schema_association_edits, schema_source_plan, unwrap_tagged_schema, type PreciseSchemaFact, type SchemaSourceEdit } from "../../../src/internal/hson-schema/source-transformation.js";
import { compile_hson_schema } from "../../../src/internal/hson-schema/compiler.js";
import { SchemaSourceMapping } from "../../../src/internal/hson-schema/source-mapping.js";
import { discover_hson_schema_declarations } from "../../../src/internal/hson-schema/schema-discovery.js";

type Snapshot = Readonly<{ text: string; snapshot: ts.IScriptSnapshot; version: string }>;
type SourceView = Snapshot & Readonly<{ mapping: SchemaSourceMapping; source: ts.SourceFile; generatedNames: readonly string[] }>;

/** The authored service resolves bindings and source edits; the existing service consumes the overlay. */
export function install_live_schema_view(typescript: typeof ts, host: ts.LanguageServiceHost, projectPath: string, registerEvidence?: (file: string, text: string | undefined) => void) {
  const original: ts.LanguageServiceHost = {
    ...host,
    getCompilationSettings: host.getCompilationSettings.bind(host),
    getScriptFileNames: host.getScriptFileNames.bind(host),
    getScriptVersion: host.getScriptVersion.bind(host),
    getScriptSnapshot: host.getScriptSnapshot.bind(host),
    getCurrentDirectory: host.getCurrentDirectory.bind(host),
    getDefaultLibFileName: host.getDefaultLibFileName.bind(host),
    fileExists: host.fileExists.bind(host), readFile: host.readFile.bind(host),
    ...(host.getProjectVersion === undefined ? {} : { getProjectVersion: host.getProjectVersion.bind(host) }),
    ...(host.resolveModuleNameLiterals === undefined ? {} : { resolveModuleNameLiterals: host.resolveModuleNameLiterals.bind(host) }),
    ...(host.resolveModuleNames === undefined ? {} : { resolveModuleNames: host.resolveModuleNames.bind(host) }),
  };
  // Bind optional prototype methods too: tsserver's Project is not a plain object.
  for (const key of ["directoryExists", "getDirectories", "realpath", "readDirectory", "useCaseSensitiveFileNames", "getProjectReferences", "getScriptKind", "getTypeRootsVersion",
    "getCancellationToken", "getLocalizedDiagnosticMessages", "getNewLine", "resolveTypeReferenceDirectives", "resolveTypeReferenceDirectiveReferences", "getParsedCommandLine",
  ] as const) {
    const method = host[key];
    if (method !== undefined) Object.defineProperty(original, key, { value: method.bind(host), enumerable: true });
  }
  const authoredService = typescript.createLanguageService(original);
  let previous: ts.Program | undefined;
  let revision = 0;
  let sources = new Map<string, SourceView>();
  let evidence = new Map<string, Snapshot>();
  let evidenceByDeclaration = new Map<string, string>();
  let evidenceLabels = new Map<string, string>();
  const canonical = (file: string): string => {
    const path = resolve(file);
    return host.useCaseSensitiveFileNames?.() === false ? path.toLowerCase() : path;
  };
  const snapshot = (text: string, old?: Snapshot): Snapshot => old?.text === text ? old
    : { text, snapshot: typescript.ScriptSnapshot.fromString(text), version: createHash("sha256").update(text).digest("hex") };
  const virtual = (source: string, name: string): string => {
    const extension = source.endsWith(".mts") ? ".mts" : source.endsWith(".cts") ? ".cts" : ".ts";
    return join(dirname(source), ".hson", "editor-evidence", basename(source), `${name}.hson-schema.generated${extension}`);
  };
  const declarationKey = (file: string, name: string): string => `${canonical(file)}#${name}`;

  const refresh = (): void => {
    const program = authoredService.getProgram();
    if (program === previous || program === undefined) return;
    const nextSources = new Map<string, SourceView>();
    const nextEvidence = new Map<string, Snapshot>();
    const nextDeclarations = new Map<string, string>();
    const nextLabels = new Map<string, string>();
    const checker = program.getTypeChecker();
    const schemaFacts: PreciseSchemaFact[] = [];
    const discoveries = new Map<string, ReturnType<typeof discover_hson_schema_declarations>>();
    for (const candidate of program.getSourceFiles()) {
      if (candidate.isDeclarationFile || program.isSourceFileFromExternalLibrary(candidate)
        || !/\.[cm]?tsx?$/.test(candidate.fileName) || candidate.fileName.includes(".hson-schema.generated.")) continue;
      const found = discover_hson_schema_declarations(typescript, candidate, checker);
      discoveries.set(canonical(candidate.fileName), found);
      for (const { declaration, tagged: tag, eligible } of found) {
        if (!eligible || !typescript.isNoSubstitutionTemplateLiteral(tag.template)) continue;
        const compiled = compile_hson_schema(tag.template.getText(candidate).slice(1, -1));
        if (!compiled.ok) continue;
        const mode = compiled.value.semantic.kind === "document" || compiled.value.semantic.kind === "document-element"
          ? "document" as const : "data" as const;
        schemaFacts.push(Object.freeze({ declaration, mode }));
      }
    }
    for (const source of program.getSourceFiles()) {
      if (source.isDeclarationFile || program.isSourceFileFromExternalLibrary(source)
        || !/\.[cm]?tsx?$/.test(source.fileName) || source.fileName.includes(".hson-schema.generated.")) continue;
      const schemas: { declaration: ts.VariableDeclaration; name: string; specifier: string }[] = [];
      const broad: SchemaSourceEdit[] = [];
      const eligible = new Map((discoveries.get(canonical(source.fileName)) ?? [])
        .filter(item => item.eligible).map(item => [item.declaration, item]));
      for (const statement of source.statements) {
        if (!typescript.isVariableStatement(statement)) continue;
        const supported = (statement.declarationList.flags & typescript.NodeFlags.Const) !== 0 && statement.declarationList.declarations.length === 1;
        for (const declaration of statement.declarationList.declarations) {
          if (!typescript.isIdentifier(declaration.name)) continue;
          const tag = declaration.initializer === undefined ? undefined : unwrap_tagged_schema(declaration.initializer);
          const legacy = declaration.type !== undefined && typescript.isTypeReferenceNode(declaration.type)
            && typescript.isIdentifier(declaration.type.typeName) && declaration.type.typeName.text === "__HsonSchema";
          let valid = false;
          if (supported && tag !== undefined && eligible.has(declaration)
            && typescript.isNoSubstitutionTemplateLiteral(tag.template) && !tag.template.isUnterminated) {
            try {
              const name = declaration.name.text;
              const identity = `${relative(dirname(projectPath), source.fileName).split(sep).join("/")}#${name}`;
              const generated = generate_hson_schema_evidence(name, tag.template.getText(source).slice(1, -1), identity);
              const file = virtual(source.fileName, name);
              const key = canonical(file);
              nextEvidence.set(key, snapshot(generated.declaration, evidence.get(key)));
              nextDeclarations.set(declarationKey(source.fileName, name), file);
              nextLabels.set(file.replace(/\.[cm]?ts$/, ""), `${relative(dirname(projectPath), source.fileName).split(sep).join("/")}#${name}`);
              const runtime = file.replace(/\.mts$/, ".mjs").replace(/\.cts$/, ".cjs").replace(/\.ts$/, ".js");
              schemas.push({ declaration, name, specifier: `./${relative(dirname(source.fileName), runtime).split(sep).join("/")}` });
              valid = true;
            } catch { /* Partial/invalid editor text owns no precise evidence. */ }
          }
          if (!valid && legacy) broad.push(...schema_association_edits([{ declaration, text: 'import("hson-live").HsonSchema' }]));
        }
      }
      const attachments = library_schema_attachment_plan(source, checker, schemaFacts);
      if (schemas.length === 0 && broad.length === 0 && attachments.edits.length === 0) continue;
      const plan = schema_source_plan(source, schemas);
      const edits = [...plan.edits, ...broad, ...attachments.edits];
      const mapping = new SchemaSourceMapping(source.text, edits);
      const key = canonical(source.fileName);
      nextSources.set(key, { ...snapshot(mapping.text, sources.get(key)), mapping, source,
        generatedNames: [...plan.generatedNames, ...attachments.generatedNames] });
    }
    // tsserver's shared document registry requires a ScriptInfo for virtual modules.
    for (const [file, value] of nextEvidence) if (evidence.get(file) !== value) registerEvidence?.(file, value.text);
    for (const file of evidence.keys()) if (!nextEvidence.has(file)) registerEvidence?.(file, undefined);
    sources = nextSources; evidence = nextEvidence; evidenceByDeclaration = nextDeclarations; evidenceLabels = nextLabels;
    previous = program;
    revision += 1;
  };

  host.getScriptFileNames = () => [...original.getScriptFileNames(), ...evidence.keys()];
  host.getScriptSnapshot = file => sources.get(canonical(file))?.snapshot ?? evidence.get(canonical(file))?.snapshot ?? original.getScriptSnapshot(file);
  host.getScriptVersion = file => sources.get(canonical(file))?.version ?? evidence.get(canonical(file))?.version ?? original.getScriptVersion(file);
  host.getProjectVersion = () => `${original.getProjectVersion?.() ?? ""}:hson-view:${revision}`;
  host.readFile = (file, encoding) => sources.get(canonical(file))?.text ?? evidence.get(canonical(file))?.text ?? original.readFile(file, encoding);
  host.fileExists = file => evidence.has(canonical(file)) || original.fileExists(file);
  host.resolveModuleNameLiterals = (literals, containingFile, redirected, options, containingSource, reused) => {
    const fallback = (): readonly ts.ResolvedModuleWithFailedLookupLocations[] => original.resolveModuleNameLiterals?.(literals, containingFile, redirected, options, containingSource, reused)
      ?? literals.map(literal => typescript.resolveModuleName(literal.text, containingFile, options, original, undefined, redirected, typescript.getModeForUsageLocation(containingSource, literal, options)));
    let resolved: readonly ts.ResolvedModuleWithFailedLookupLocations[] | undefined;
    return literals.map((literal, index) => {
      const candidate = resolve(dirname(containingFile), literal.text).replace(/\.mjs$/, ".mts").replace(/\.cjs$/, ".cts").replace(/\.js$/, ".ts");
      if (literal.text.startsWith(".") && evidence.has(canonical(candidate))) return { resolvedModule: { resolvedFileName: candidate, extension: candidate.endsWith(".mts") ? typescript.Extension.Mts : candidate.endsWith(".cts") ? typescript.Extension.Cts : typescript.Extension.Ts } };
      resolved ??= fallback();
      return resolved[index] ?? { resolvedModule: undefined };
    });
  };

  return {
    refresh,
    dispose: () => { for (const file of evidence.keys()) registerEvidence?.(file, undefined); authoredService.dispose(); },
    authoredService,
    mapping: (file: string) => sources.get(canonical(file))?.mapping,
    authored_file: (file: string) => sources.get(canonical(file))?.source,
    is_evidence: (file: string) => evidence.has(canonical(file)),
    generated_name: (file: string, name: string) => sources.get(canonical(file))?.generatedNames.includes(name) === true,
    display_text: (file: string | undefined, text: string): string => {
      let output = text;
      for (const [path, label] of evidenceLabels) output = output.split(path.split(sep).join("/")).join(label);
      for (const name of file === undefined ? [] : sources.get(canonical(file))?.generatedNames ?? []) {
        const label = name.startsWith("__HsonSchema") ? "HsonSchema" : name.replace(/^__/, "").replace(/Evidence(?:_\d+)?$/, " evidence");
        output = output.replace(new RegExp(`\\b${name.replace(/[$]/g, "\\$")}\\b`, "g"), label);
      }
      return output;
    },
    evidence_file: (file: string, name: string) => evidenceByDeclaration.get(declarationKey(file, name)),
  };
}

export type LiveSchemaView = ReturnType<typeof install_live_schema_view>;
