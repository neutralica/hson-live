import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";
import * as configuration from "./validation-config.mjs";

export const repositoryRoot = resolve(import.meta.dirname, "..");
const editor = "editors/vscode-hson";
const sourceExtension = /\.(?:m?[jt]s|tsx|html)$/;
const executable = /(?:\.acceptance\.(?:mts|mjs|html)|\.test\.(?:ts|mjs))$/;
const ignored = new Set(["historical", "node_modules", "dist", ".test-dist", ".hson", "out"]);

// Static metadata parsing is shared with the existing metadata acceptance suite.
// A missing object is allowed for legacy suites, and reported. Declared objects
// must be literal, valid and unique; a path identity always exists independently.
export function readMetadata(source) {
  const ast = ts.createSourceFile("metadata.mts", source, ts.ScriptTarget.Latest, true);
  const declarations = ast.statements.filter(statement => ts.isVariableStatement(statement)
    && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
    && statement.declarationList.declarations.some(declaration => declaration.name.getText(ast) === "HSON_LIVE_TEST_METADATA"));
  if (declarations.length === 0) return null;
  const matches = [...source.matchAll(/export const HSON_LIVE_TEST_METADATA = Object\.freeze\((\{[\s\S]*?\})\);/g)];
  if (declarations.length !== 1 || matches.length !== 1) throw new Error("Expected exactly one literal suite metadata object.");
  const parsed = /^\{\s*id:\s*"([^"]+)",\s*title:\s*"([^"]+)",\s*category:\s*"([^"]+)",\s*runtime:\s*"([^"]+)",\s*tags:\s*Object\.freeze\(\[\s*(?:(?:"[^"]*"\s*,\s*)*"[^"]*"\s*)?\]\),?\s*\}$/.exec(matches[0][1]);
  if (!parsed) throw new Error("Suite metadata must use the exact static literal grammar.");
  const [, id, title, category, runtime] = parsed;
  if (!new Set(["node", "node-synthetic-dom", "node-real-websocket", "node-real-websocket-process", "node-real-http1", "node-real-http2"]).has(runtime)) throw new Error("Invalid suite runtime.");
  const tags = [...matches[0][1].match(/tags:\s*Object\.freeze\(\[([\s\S]*?)\]/)[1].matchAll(/"([^"]*)"/g)].map(match => match[1]);
  return { id, title, category, runtime, tags };
}

function walk(root, folder) {
  const result = [];
  for (const entry of readdirSync(resolve(root, folder), { withFileTypes: true })) {
    const path = `${folder}/${entry.name}`;
    if (entry.isDirectory() && !ignored.has(entry.name)) result.push(...walk(root, path));
    else if (entry.isFile() && sourceExtension.test(path)) result.push(path);
  }
  return result;
}

export function createInventory(root = repositoryRoot, config = configuration) {
  const { ordinary, extended, maintenance, gateCommands, existingRepeatedBodies, requiredCapabilities, declaredExecution } = config;
  const read = path => readFileSync(resolve(root, path), "utf8");
  const packages = { "": JSON.parse(read("package.json")).scripts,
    [editor]: JSON.parse(read(`${editor}/package.json`)).scripts };
  const scripts = packages[""];
  const errors = [];
  const files = new Map();
  for (const folder of ["tests", "scripts", `${editor}/tests`, `${editor}/scripts`]) {
    for (const path of walk(root, folder)) files.set(path, { path, source: read(path), edges: new Set(), requirements: new Set(["node"]), prerequisites: new Set() });
  }
  const known = path => files.has(path) ? path
    : files.has(path.replace(/\.js$/, ".ts")) ? path.replace(/\.js$/, ".ts") : undefined;
  const generated = new Map();
  const compilerOptions = ts.readConfigFile(resolve(root, "tsconfig.json"), ts.sys.readFile).config?.compilerOptions ?? {};
  const builder = ts.createSourceFile("build-tests.mjs", read(`${editor}/scripts/build-tests.mjs`), ts.ScriptTarget.Latest, true);
  function entries(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(builder) === "entryPoints" && ts.isObjectLiteralExpression(node.initializer)) {
      for (const property of node.initializer.properties) {
        if (ts.isPropertyAssignment(property) && ts.isStringLiteral(property.initializer)) {
          const key = property.name.getText(builder).replaceAll('"', "");
          generated.set(`${editor}/.test-dist/${key}.cjs`, `${editor}/${property.initializer.text}`);
        }
      }
    }
    ts.forEachChild(node, entries);
  }
  entries(builder);
  const relationships = [];
  const runtimeImport = node => {
    if (ts.isExportDeclaration(node)) return !node.isTypeOnly && (!node.exportClause
      || !ts.isNamedExports(node.exportClause) || node.exportClause.elements.length === 0
      || node.exportClause.elements.some(item => !item.isTypeOnly));
    const clause = node.importClause;
    return !clause || !clause.isTypeOnly && (clause.name || !clause.namedBindings
      || ts.isNamespaceImport(clause.namedBindings) || clause.namedBindings.elements.length === 0
      || clause.namedBindings.elements.some(item => !item.isTypeOnly));
  };
  for (const file of files.values()) {
    // Build inputs alone never execute. Editor aliases are used only by an
    // invoked package command or a reviewed runner declaration below.
    if (file.path === `${editor}/scripts/build-tests.mjs`) continue;
    const ast = ts.createSourceFile(file.path, file.source, ts.ScriptTarget.Latest, true);
    // Source TS runners erase unused/value-as-type bindings too. Inspect the
    // compiler's in-memory import erasure; never emit files or infer a call graph.
    const emitted = /\.(?:mts|ts|tsx)$/.test(file.path) ? ts.createSourceFile(file.path,
      ts.transpileModule(file.source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
        verbatimModuleSyntax: compilerOptions.verbatimModuleSyntax === true } }).outputText,
      ts.ScriptTarget.Latest, true) : ast;
    const runtimeSpecifiers = new Set(emitted.statements.filter(node =>
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && runtimeImport(node))
      .map(node => node.moduleSpecifier.text));
    const targets = value => {
      const candidates = value.startsWith(".") && !value.startsWith(".test-dist/")
        ? [relative(root, resolve(root, dirname(file.path), value))]
        : [value, `${editor}/${value.replace(/^\.\//, "")}`];
      return candidates.map(candidate => generated.get(candidate) ?? known(candidate)).filter(target => files.has(target) && target !== file.path);
    };
    const relate = (value, kind, execution) => {
      if (value.startsWith("node:") && ["static-import", "dynamic-import", "type-only", "erased-import"].includes(kind)) {
        relationships.push({ from: file.path, to: value, kind, execution, external: true });
      }
      for (const target of targets(value)) {
        relationships.push({ from: file.path, to: target, kind, execution });
        if (execution) file.edges.add(target);
      }
    };
    const capability = name => {
      if (name === "node:worker_threads" || name.endsWith("/repository-typescript-worker.mts")) file.requirements.add("worker");
      if (name === "node:child_process") file.requirements.add("subprocess");
      if (["node:https", "node:tls"].includes(name)) file.requirements.add("tls");
      if (["node:http", "node:https", "node:http2", "ws"].includes(name)) file.requirements.add("hosted-network");
      if (name === "typescript") file.requirements.add("typescript-tooling");
      if (name === "vscode") file.requirements.add("vscode");
      if (name === "@vscode/test-electron") {
        file.requirements.add("vscode"); file.requirements.add("external-download");
      }
    };
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
        const syntaxRuntime = runtimeImport(node);
        const runtime = syntaxRuntime && runtimeSpecifiers.has(node.moduleSpecifier.text);
        relate(node.moduleSpecifier.text, runtime ? "static-import" : syntaxRuntime ? "erased-import" : "type-only", Boolean(runtime));
        if (runtime) capability(node.moduleSpecifier.text);
      }
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
        relate(node.argument.literal.text, "type-only", false);
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteralLike(node.arguments[0])) {
        relate(node.arguments[0].text, "dynamic-import", false);
        // A possible runtime import still imposes a capability requirement, but
        // cannot certify that another suite's body executes.
        capability(node.arguments[0].text);
      }
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const name = node.expression.getText(ast);
        if (name.endsWith(".listen") || ["WebSocketServer", "start_node_application_host"].includes(name)) file.requirements.add("loopback-listener");
      }
      if (ts.isPropertyAccessExpression(node) && node.name.text === "HSON_CHROME_BIN") file.requirements.add("chrome");
      if (ts.isStringLiteralLike(node)) {
        const value = node.text;
        if (value.endsWith(".pem")) { file.requirements.add("tls"); file.prerequisites.add("TLS fixture material"); }
        if (/\.(?:m?[jt]s|tsx|html|cjs)$/.test(value) && !value.includes("\n")) relate(value, "reference", false);
        if (value.includes("dist/")) file.prerequisites.add(value.includes(".test-dist/") ? "editor test bundle"
          : value.includes("editors/vscode-hson/") || file.path.startsWith(editor) ? "editor build output" : "root build output");
        if (value.startsWith("hson-live")) file.prerequisites.add("root build output");
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    if (file.path.endsWith(".html")) {
      for (const match of file.source.matchAll(/<script\b([^>]*)>[^]*?<\/script>/gi)) {
        const source = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(match[1]);
        const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(match[1]);
        if (source && (!type || ["module", "text/javascript", "application/javascript"].includes(type[1]))) relate(source[1], "browser-script", false);
      }
    }
  }
  // A declaration is a reviewed route, not a claim that this analyzer interpreted
  // callbacks. Pin the complete launch sources, including helper/HTML plumbing.
  // Any edit requires renewed review; existence or a matching string is insufficient.
  for (const [from, evidence] of Object.entries(declaredExecution)) {
    const fresh = evidence.sha256 && Array.isArray(evidence.sources)
      && [[from, evidence.sha256], ...evidence.sources].every(([path, sha256]) => files.has(path)
      && createHash("sha256").update(files.get(path).source).digest("hex") === sha256);
    for (const [to, kind] of evidence.targets) {
      const supported = ["worker-launch", "subprocess-launch", "dynamic-import", "browser-runner", "editor-runner"].includes(kind);
      const verified = Boolean(fresh && evidence.route && supported && files.has(from) && files.has(to));
      relationships.push({ from, to, kind, execution: verified, declared: true,
        verification: verified ? "reviewed-source-pinned" : "declared-unverified",
        independentlyVerified: false, evidence });
      if (!verified) { errors.push(`Stale or unsupported ${kind} declaration evidence: ${from} -> ${to}`); continue; }
      files.get(from).edges.add(to);
    }
  }

  const commandCache = new Map();
  const commandProjects = new Map();
  const nestedCommands = new Map();
  for (const [name, mode] of [["check", "check"], ["check:full", "full"], ["check:extended", "extended"]]) {
    if (scripts[name] !== `node scripts/run-current-acceptance.mjs ${mode}`) errors.push(`Public gate command does not match configuration: ${name}`);
  }
  function command(name, prefix = "", trail = []) {
    const id = prefix ? `${prefix}:${name}` : name;
    if (trail.includes(id)) { errors.push(`Command cycle: ${[...trail, id].join(" -> ")}`); return new Set(); }
    if (commandCache.has(id)) return commandCache.get(id);
    const text = packages[prefix]?.[name];
    if (typeof text !== "string") { errors.push(`Unknown registered command: ${id}`); return new Set(); }
    const targets = new Set();
    const projects = new Set();
    commandProjects.set(id, projects);
    const nested = [];
    nestedCommands.set(id, nested);
    // Public aggregates are resolved from the gate configuration.
    if (!prefix && ["check", "check:full", "check:extended"].includes(name)) return targets;
    // This is a command grammar, not a shell parser. Only unquoted safe tokens
    // separated by && are supported. Validate the WHOLE command before crediting
    // any entrypoint, so an echo, comment, string or shell operator cannot hide one.
    const parts = text.split(/\s+&&\s+/);
    const parsed = parts.map(part => {
      const npm = /^npm (?:--prefix ([\w/.-]+) )?run ([\w:-]+)$/.exec(part);
      if (npm) return { npm };
      const node = /^(?:HSON_BASELINE_VSIX=hson-language\.vsix )?node (?:--import=tsx )?([./\w-]+\.(?:mts|mjs|cjs|ts))((?: [./\w=:-]+)*)$/.exec(part);
      if (node) return { node };
      const tsc = /^tsc -p ([./\w-]+\.json)(?: --noEmit)?$/.exec(part);
      if (tsc) return { tsc };
      // Existing non-test commands, deliberately exact and never executable edges.
      if (["rm -rf dist", "vsce ls --tree --no-yarn --follow-symlinks"].includes(part)) return {};
      return null;
    });
    if (parsed.some(part => part === null)) {
      errors.push(`Unsupported package command form: ${id}: ${text}`);
      commandCache.set(id, targets); return targets;
    }
    for (const part of parsed) {
      if (part.npm) {
        const [, selectedPrefix, selectedName] = part.npm;
        const nestedPrefix = selectedPrefix ?? prefix;
        const nestedId = nestedPrefix ? `${nestedPrefix}:${selectedName}` : selectedName;
        nested.push(nestedId);
        for (const target of command(selectedName, nestedPrefix, [...trail, id])) targets.add(target);
        for (const project of commandProjects.get(nestedId) ?? []) projects.add(project);
      }
      if (part.node) {
        const path = relative(root, resolve(root, prefix, part.node[1]));
        const target = generated.get(path) ?? known(path);
        if (target) targets.add(target);
        else if (!existsSync(resolve(root, path)) && !path.includes("dist/")) errors.push(`Command ${id} has missing entrypoint: ${path}`);
      }
      // Only recognized compiler commands own type projects, never arbitrary args.
      const schemaProject = !prefix && part.node?.[1] === "scripts/hson-schema.mts"
        ? /^ (?:generate|build|check|verify|watch) --project ([./\w-]+\.json)$/.exec(part.node[2]) : null;
      if (part.tsc || schemaProject) {
        const path = relative(root, resolve(root, prefix, (part.tsc ?? schemaProject)[1]));
        if (!existsSync(resolve(root, path))) errors.push(`Command ${id} has missing project: ${path}`);
        projects.add(path);
      }
    }
    commandCache.set(id, targets);
    return targets;
  }
  function closure(initial) {
    const result = new Set();
    function add(path) { if (result.has(path)) return; result.add(path); for (const edge of files.get(path)?.edges ?? []) add(edge); }
    for (const path of initial) add(path);
    return result;
  }
  const gates = Object.fromEntries(["check", "full", "extended"].map(mode => [mode, gateCommands(scripts, mode)]));
  for (const [gate, names] of Object.entries(gates)) {
    if (new Set(names).size !== names.length) errors.push(`Duplicate command in ${gate}`);
    for (const name of names) if (!scripts[name]) errors.push(`Unknown ${gate} selection: ${name}`);
  }
  if (extended.some(name => ordinary.includes(name))) errors.push("Extended selection overlaps ordinary selection");
  for (const [prefix, commands] of Object.entries(packages)) for (const name of Object.keys(commands)) command(name, prefix);
  const destinations = new Map();
  function assign(name, prefix, destination) {
    const direct = command(name, prefix);
    for (const path of closure(direct)) {
      const row = { destination, registration: prefix ? `${prefix}:${name}` : name, command: prefix ? `npm --prefix ${prefix} run ${name}` : `npm run ${name}`, invocation: direct.has(path) ? "direct" : "indirect" };
      if (!destinations.has(path)) destinations.set(path, []);
      destinations.get(path).push(row);
    }
  }
  for (const name of Object.keys(scripts)) {
    if (name.startsWith("test:")) assign(name, "", ordinary.includes(name) ? "check" : extended.includes(name) ? "extended" : "full-additional");
    else if (/^(?:check:|hson-schema:check|hson-schema:verify|measure:|corpus:|operators:)/.test(name) && !["check:full", "check:extended"].includes(name)) assign(name, "", "tooling");
  }
  for (const name of Object.keys(packages[editor])) if (/^(?:test(?::|$)|validate:|benchmark$)/.test(name)) assign(name, editor, "editor");
  for (const path of maintenance) {
    if (!files.has(path)) errors.push(`Missing maintenance validator: ${path}`);
    destinations.set(path, [{ destination: "manual-maintenance", command: `node --import=tsx ${path}`, invocation: "direct" }]);
  }
  // Resolve actual TS project ownership without constructing a Program or emitting.
  const projects = [...new Set([...commandProjects.values()].flatMap(projects => [...projects]))];
  const typeOwners = new Map();
  for (const path of projects) {
    const config = ts.readConfigFile(resolve(root, path), ts.sys.readFile);
    if (config.error) { errors.push(`Unreadable TypeScript project: ${path}`); continue; }
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, resolve(root, dirname(path)));
    for (const error of parsed.errors) errors.push(`${path}: ${ts.flattenDiagnosticMessageText(error.messageText, " ")}`);
    for (const file of parsed.fileNames) {
      const name = relative(root, file);
      if (!typeOwners.has(name)) typeOwners.set(name, []);
      typeOwners.get(name).push(path);
    }
  }
  const metadataIds = new Set();
  const suites = [];
  const metadataMissing = [];
  for (const file of files.values()) {
    const typeOnly = /\.types\.ts$/.test(file.path) || file.path.startsWith("tests/entrypoints/") && /\.ts$/.test(file.path);
    const isSuite = executable.test(file.path) || typeOnly || maintenance.includes(file.path)
      || [...generated.values()].includes(file.path)
      || file.path.startsWith("tests/fixtures/") && /[.-](?:worker|restart)\.(?:mts|mjs)$/.test(file.path)
      || file.path.startsWith("tests/browser/") && file.path.endsWith(".entry.mjs")
      || /^scripts\/run-/.test(file.path) && file.path !== "scripts/run-current-acceptance.mjs";
    if (!isSuite) continue;
    let metadata = null;
    try { metadata = readMetadata(file.source); } catch (error) { errors.push(`${file.path}: ${error.message}`); }
    if (metadata) {
      if (metadataIds.has(metadata.id)) errors.push(`Duplicate suite metadata ID: ${metadata.id}`);
      metadataIds.add(metadata.id);
    } else if (!typeOnly) metadataMissing.push(file.path);
    const routes = typeOnly ? (typeOwners.get(file.path) ?? []).flatMap(project => [...commandProjects]
      .filter(([, projects]) => projects.has(project))
      .map(([registration]) => ({ destination: ordinary.includes(registration) ? "check" : registration.startsWith(`${editor}:`) ? "editor-typecheck" : "tooling-typecheck",
        registration, project, command: registration.startsWith(`${editor}:`) ? `npm --prefix ${editor} run ${registration.slice(editor.length + 1)}` : `npm run ${registration}`, invocation: "type-only" }))) : destinations.get(file.path) ?? [];
    if (routes.length === 0) errors.push(`Maintained suite has no execution destination: ${file.path}`);
    const reachable = closure([file.path]);
    const requirements = new Set(); const prerequisites = new Set();
    for (const path of reachable) {
      for (const item of files.get(path).requirements) requirements.add(item);
      for (const item of files.get(path).prerequisites) prerequisites.add(item);
    }
    const context = typeOnly ? "typescript-project" : /[.-]worker\.(?:mts|mjs)$/.test(file.path) ? "worker"
      : /[.-]restart\.(?:mts|mjs)$/.test(file.path) ? "fresh-process"
      : file.path.startsWith("tests/browser/") ? "browser" : "node";
    if (context === "worker") requirements.add("worker");
    if (context === "fresh-process") requirements.add("subprocess");
    suites.push({ identity: file.path, metadata, context, entrypoint: file.path, destinations: routes,
      requirements: [...requirements].sort(), prerequisites: [...prerequisites].sort() });
  }
  const commands = {};
  const registrations = [...new Set(Object.values(gates).flat())].map(name => [name, ""]);
  for (const name of Object.keys(packages[editor])) if (/^(?:test(?::|$)|validate:|benchmark$)/.test(name)) registrations.push([name, editor]);
  for (const [name, prefix] of registrations) {
    const reach = closure(command(name, prefix));
    const projectSet = commandProjects.get(prefix ? `${prefix}:${name}` : name) ?? new Set();
    if (name.startsWith("test:") && reach.size === 0) errors.push(`No executable entrypoint resolved for ${name}`);
    commands[prefix ? `${prefix}:${name}` : name] = { command: packages[prefix][name], suites: suites.filter(suite => reach.has(suite.entrypoint) || suite.destinations.some(route => projectSet.has(route.project))).map(suite => suite.identity),
      nestedCommands: nestedCommands.get(prefix ? `${prefix}:${name}` : name) ?? [],
      projects: [...commandProjects.get(prefix ? `${prefix}:${name}` : name) ?? []],
      requirements: [...new Set([...reach].flatMap(path => [...files.get(path).requirements]))].sort(),
      prerequisites: [...new Set([...reach].flatMap(path => [...files.get(path).prerequisites]))].sort(),
      requirementEvidence: Object.fromEntries([...new Set([...reach].flatMap(path => [...files.get(path).requirements]))].sort()
        .map(requirement => [requirement, [...reach].filter(path => files.get(path).requirements.has(requirement))])) };
  }
  for (const suite of suites) {
    for (const route of suite.destinations) {
      const account = commands[route.registration];
      if (account) {
        route.context = suite.context === "node" && account.requirements.includes("vscode") ? "vscode" : suite.context;
        route.requirements = account.requirements;
        route.prerequisites = account.prerequisites;
      }
    }
  }
  // Keep known repeated execution visible. Pass 1 preserves existing coverage/order;
  // future additions may not accidentally duplicate a command or an exact body.
  const duplicates = {};
  for (const [gate, names] of Object.entries(gates)) {
    const owners = new Map();
    for (const name of names) for (const suite of commands[name]?.suites ?? []) {
      if (suites.find(row => row.identity === suite).destinations[0]?.invocation === "type-only") continue;
      if (!owners.has(suite)) owners.set(suite, []);
      owners.get(suite).push(name);
    }
    duplicates[gate] = [...owners].filter(([, names]) => names.length > 1).map(([suite, commands]) => ({ suite, commands }));
  }
  for (const repetitions of Object.values(duplicates)) for (const { suite, commands: names } of repetitions) {
    const allowed = Object.entries(existingRepeatedBodies).filter(([ancestor]) => closure([ancestor]).has(suite)).flatMap(([, names]) => names);
    if (names.some(name => !allowed.includes(name))) errors.push(`Unintended duplicate aggregate body: ${suite} via ${names.join(", ")}`);
  }
  for (const [name, capabilities] of Object.entries(requiredCapabilities)) {
    for (const requirement of capabilities) if (!commands[name]?.requirements.includes(requirement)) errors.push(`Missing ${requirement} evidence for ${name}`);
  }
  const gateRequirements = Object.fromEntries(Object.entries(gates).map(([gate, names]) => [gate,
    [...new Set(names.flatMap(name => commands[name]?.requirements ?? []))].sort()]));
  return { schemaVersion: 1, gateRequirements,
    discoveryPolicy: "Anchored package launch grammar, runtime static imports surviving TypeScript erasure, and source-pinned reviewed execution routes. Dynamic imports, Worker/subprocess calls, HTML scripts, URLs and browser/editor references are dependencies only without reviewed evidence. Reviewed routes are explicitly not independently verified control flow; changed or unsupported evidence fails preflight. No general shell or JavaScript interpreter. Type suites use recognized TypeScript project membership.",
    relationships,
    support: [...files.keys()].filter(path => !suites.some(suite => suite.identity === path)).map(path => ({ path, destinations: destinations.get(path) ?? [], typeProjects: typeOwners.get(path) ?? [], requirements: [...files.get(path).requirements], prerequisites: [...files.get(path).prerequisites] })),
    metadataPolicy: "Missing legacy metadata is reported; malformed or duplicate declared metadata is rejected. File paths are authoritative identities.",
    gates, commands, suites, duplicates, metadataMissing, errors: [...new Set(errors)] };
}

export function assertInventory(inventory) {
  if (inventory.errors.length) throw new Error(`Validation inventory preflight failed:\n${inventory.errors.map(error => `- ${error}`).join("\n")}`);
  return inventory;
}
