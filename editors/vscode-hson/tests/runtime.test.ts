import assert from "node:assert/strict";

import { TransformError } from "../../../src/core/errors.js";
import {
  DIAGNOSTIC_SOURCE,
  produce_document_diagnostics,
  transform_error_to_standalone_diagnostic,
  type DocumentDiagnosticSpec,
} from "../src/document-diagnostics.js";
import {
  start_diagnostics,
  type DiagnosticDocument,
  type DiagnosticHost,
  type DiagnosticPublisher,
  type Disposable,
} from "../src/diagnostics.js";
import { local_hson_schema_diagnostics } from "../src/hson-schema-local.js";

let checks = 0;
function check(name: string, body: () => void): void {
  body();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function diagnose(
  text: string,
  languageId = "hson",
  fileName = "/workspace/fixture.hson",
): readonly DocumentDiagnosticSpec[] {
  return produce_document_diagnostics({ languageId, fileName, text });
}

check("standalone valid Hson has no diagnostics", () => {
  assert.deepEqual(diagnose('<main\n  <h1 "Hello">\n>'), []);
});

check("standalone malformed point evidence receives a visible range", () => {
  const diagnostics = diagnose("+1");
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0]?.range, { start: 0, end: 1 });
  assert.equal(diagnostics[0]?.precision, "point");
  assert.equal(diagnostics[0]?.source, DIAGNOSTIC_SOURCE);
});

check("standalone EOF evidence remains zero-width", () => {
  const text = "";
  const diagnostic = diagnose(text)[0];
  assert.ok(diagnostic);
  assert.equal(diagnostic.precision, "eof");
  assert.deepEqual(diagnostic.range, { start: text.length, end: text.length });
});

check("standalone source-less and malformed evidence use a conservative fallback", () => {
  const sourceLess = new TransformError("source-less", {
    operation: "synthetic",
    code: "SOURCE_LESS",
  });
  const malformed = new TransformError("malformed", {
    operation: "synthetic",
    code: "MALFORMED",
    source: { index: Number.NaN, line: 1, column: 1 },
  });
  assert.deepEqual(transform_error_to_standalone_diagnostic(sourceLess, "abc")?.range, {
    start: 0,
    end: 3,
  });
  assert.equal(transform_error_to_standalone_diagnostic(sourceLess, "")?.range.end, 0);
  assert.equal(transform_error_to_standalone_diagnostic(malformed, "abc")?.precision, "fallback");
});

check("standalone related declaration evidence becomes related diagnostics", () => {
  const diagnostic = diagnose("<a 1 a 2>")[0];
  assert.ok(diagnostic);
  assert.equal(diagnostic.related.length, 1);
  assert.equal(diagnostic.related[0]?.message, "Related Hson source (first-declaration).");
  assert.equal("<a 1 a 2>".slice(
    diagnostic.related[0]?.range.start,
    diagnostic.related[0]?.range.end,
  ), "a");
});

check("standalone CRLF offsets remain exact", () => {
  const text = "<a 1\r\n a 2>";
  const diagnostic = diagnose(text)[0];
  assert.ok(diagnostic);
  assert.equal(text.slice(diagnostic.range.start, diagnostic.range.end), "a");
});

check("standalone astral point spans the complete surrogate pair", () => {
  const error = new TransformError("astral", {
    operation: "synthetic",
    code: "ASTRAL",
    source: { index: 0, line: 1, column: 1 },
  });
  assert.deepEqual(transform_error_to_standalone_diagnostic(error, "😀x")?.range, {
    start: 0,
    end: 2,
  });
});

const officialImport = 'import { Hson, hson } from "hson-live";';

check("local Hson Schema diagnostics reuse the proof compiler without workspace execution", () => {
  const valid = 'import { Hson, type HsonSchema } from "hson-live"; export const S: HsonSchema = Hson`<type "data" content <name "string">>`; throw new Error("not executed");';
  const invalid = valid.replace('name "string"', 'name <literal "x">');
  assert.deepEqual(local_hson_schema_diagnostics("/workspace/schema.ts", valid), []);
  assert.equal(local_hson_schema_diagnostics("/workspace/schema.ts", invalid)[0]?.code, "UNKNOWN_SCHEMA_MEMBER");
});

check("valid direct official template has no diagnostics", () => {
  const text = `${officialImport}\nconst page = Hson\`<main\n  <h1 "Hello">\n>\`;`;
  assert.deepEqual(diagnose(text, "typescript", "/workspace/page.ts"), []);
});

check("malformed direct template maps to the exact host range", () => {
  const text = `${officialImport}\nconst page = Hson\`+1\`;`;
  const diagnostic = diagnose(text, "typescript", "/workspace/page.ts")[0];
  assert.ok(diagnostic);
  assert.equal(text.slice(diagnostic.range.start, diagnostic.range.end), "+");
});

check("official import aliases are diagnosed semantically", () => {
  const text = 'import { Hson as markup } from "hson-live";\nconst page = markup\`01\`;';
  const diagnostic = diagnose(text, "typescript", "/workspace/page.ts")[0];
  assert.ok(diagnostic);
  assert.equal(text.slice(diagnostic.range.start, diagnostic.range.end), "1");
});

check("shadowed, wrong-package, and local same-name tags are excluded", () => {
  const shadowed = `${officialImport}\nfunction f(Hson: typeof String.raw) { Hson\`+1\`; }`;
  const wrong = 'import { Hson } from "other";\nHson\`+1\`;';
  const local = "const Hson = String.raw; Hson`+1`;";
  assert.deepEqual(diagnose(shadowed, "typescript", "/workspace/a.ts"), []);
  assert.deepEqual(diagnose(wrong, "typescript", "/workspace/b.ts"), []);
  assert.deepEqual(diagnose(local, "typescript", "/workspace/c.ts"), []);
});

check("multiple templates produce independent diagnostics", () => {
  const text = `${officialImport}\nconst a = Hson\`+1\`;\nconst b = Hson\`<main\n  <h1 "Hello">\n>\`;\nconst c = Hson\`01\`;`;
  const diagnostics = diagnose(text, "typescript", "/workspace/page.ts");
  assert.equal(diagnostics.length, 2);
  assert.deepEqual(diagnostics.map((item) => text.slice(item.range.start, item.range.end)), ["+", "1"]);
});

check("embedded CRLF and related evidence map to original host offsets", () => {
  const text = `${officialImport}\r\nconst page = Hson\`\r\n<a 1 a 2>\r\n\`;`;
  const diagnostic = diagnose(text, "typescript", "/workspace/page.ts")[0];
  assert.ok(diagnostic);
  assert.equal(text.slice(diagnostic.range.start, diagnostic.range.end), "a");
  assert.equal(diagnostic.related.length, 1);
  assert.equal(text.slice(
    diagnostic.related[0]?.range.start,
    diagnostic.related[0]?.range.end,
  ), "a");
});

check("TSX templates near JSX validate without affecting JSX", () => {
  const valid = `${officialImport}\nconst view = <section>{Hson\`<main\n  <h1 "Hello">\n>\`}</section>;`;
  const invalid = `${officialImport}\nconst view = <section>{Hson\`+1\`}</section>;`;
  assert.deepEqual(diagnose(valid, "typescriptreact", "/workspace/view.tsx"), []);
  const diagnostic = diagnose(invalid, "typescriptreact", "/workspace/view.tsx")[0];
  assert.ok(diagnostic);
  assert.equal(invalid.slice(diagnostic.range.start, diagnostic.range.end), "+");
});

check("interpolated templates are discovered without speculative diagnostics", () => {
  const text = `${officialImport}\nconst page = Hson\`not hson \${first} still not \${second}\`;`;
  const diagnostics = diagnose(text, "typescript", "/workspace/page.ts");
  assert.deepEqual(diagnostics, []);
});

check("ordinary templates and damaged TypeScript candidates have no Hson diagnostics", () => {
  const ordinary = "const value = `+1`;";
  const damaged = `${officialImport}\notherTag\`unterminated`;
  const optional = `${officialImport}\notherTag?.\`+1\`;`;
  assert.deepEqual(diagnose(ordinary, "typescript", "/workspace/a.ts"), []);
  assert.deepEqual(diagnose(damaged, "typescript", "/workspace/b.ts"), []);
  assert.deepEqual(diagnose(optional, "typescript", "/workspace/c.ts"), []);
});

check("unsupported document kinds and mismatched TS paths fail closed", () => {
  const source = `${officialImport}\notherTag\`+1\`;`;
  assert.deepEqual(diagnose(source, "javascript", "/workspace/a.js"), []);
  assert.deepEqual(diagnose(source, "typescript", "/workspace/a.js"), []);
  assert.deepEqual(diagnose(source, "typescriptreact", "/workspace/a.ts"), []);
});

check("diagnostic production does not mutate host text", () => {
  const text = `${officialImport}\nconst page = Hson\`+1\`;`;
  const before = text;
  diagnose(text, "typescript", "/workspace/page.ts");
  assert.equal(text, before);
});

const staticImports = 'import { hson, hsonTransform, hsonLiveMap, hsonLiveTree } from "hson-live";';

check("direct LiveMap fromHson literal receives secure syntax diagnostics", () => {
  const text = `${staticImports}\nhsonLiveMap.fromHson("+1");`;
  const diagnostic = diagnose(text, "typescript", "/workspace/static.ts")[0];
  assert.ok(diagnostic); assert.equal(text.slice(diagnostic.range.start, diagnostic.range.end), "+");
});

check("direct Transform fromHson literal receives secure syntax diagnostics", () => {
  const text = `${staticImports}\nhsonTransform.fromHson('01').toNode();`;
  const diagnostic = diagnose(text, "typescript", "/workspace/static.ts")[0];
  assert.ok(diagnostic); assert.equal(text.slice(diagnostic.range.start, diagnostic.range.end), "1");
});

check("LiveTree fromHson is also an official authored-source boundary", () => {
  const text = `${staticImports}\nhsonLiveTree.fromHson(\`+1\`);`;
  const diagnostic = diagnose(text, "typescript", "/workspace/static.ts")[0];
  assert.ok(diagnostic); assert.equal(text.slice(diagnostic.range.start, diagnostic.range.end), "+");
});

check("LiveMap top-level text semantics differ from Transform semantics", () => {
  const map = `${staticImports}\nhson.liveMap.fromHson('\"before\" <em/>');`;
  const transform = `${staticImports}\nhson.fromHson('\"before\" <em/>').toNode();`;
  assert.deepEqual(diagnose(map, "typescript", "/workspace/map.ts"), []);
  assert.equal(diagnose(transform, "typescript", "/workspace/transform.ts").length, 1);
});

check("JavaScript escape diagnostics map to the complete authored escape", () => {
  const text = `${staticImports}\nhsonLiveMap.fromHson("\\x2b1");`;
  const diagnostic = diagnose(text, "typescript", "/workspace/static.ts")[0];
  assert.ok(diagnostic); assert.equal(text.slice(diagnostic.range.start, diagnostic.range.end), "\\x2b");
});

check("cooked end-of-input failures remain inside the literal body", () => {
  const text = `${staticImports}\nhsonLiveMap.fromHson("\\n<foo");`;
  const diagnostic = diagnose(text, "typescript", "/workspace/static.ts")[0];
  assert.ok(diagnostic);
  assert.ok(diagnostic.range.start >= text.indexOf("\\n<foo"));
  assert.ok(diagnostic.range.end <= text.lastIndexOf('"'));
});

check("const aliases retain the literal occurrence as diagnostic owner", () => {
  const text = `${staticImports}\nconst authored = "\\x2b1"; const source = authored; hsonLiveMap.fromHson(source);`;
  const diagnostic = diagnose(text, "typescript", "/workspace/static.ts")[0];
  assert.ok(diagnostic); assert.equal(text.slice(diagnostic.range.start, diagnostic.range.end), "\\x2b");
});

check("dynamic ordinary templates and concatenation remain unavailable", () => {
  const interpolated = `${staticImports}\nhsonLiveMap.fromHson(\`+\${value}\`);`;
  const concatenated = `${staticImports}\nhsonLiveMap.fromHson("+" + "1");`;
  assert.deepEqual(diagnose(interpolated, "typescript", "/workspace/a.ts"), []);
  assert.deepEqual(diagnose(concatenated, "typescript", "/workspace/b.ts"), []);
});

check("wrong package and local fromHson spellings receive no authority", () => {
  const wrong = 'import { hsonLiveMap } from "other"; hsonLiveMap.fromHson("+1");';
  const local = 'const local = { fromHson(value: string) { return value; } }; local.fromHson("+1");';
  assert.deepEqual(diagnose(wrong, "typescript", "/workspace/a.ts"), []);
  assert.deepEqual(diagnose(local, "typescript", "/workspace/b.ts"), []);
});

check("editing a static literal recomputes and clears syntax diagnostics", () => {
  const invalid = `${staticImports}\nhsonLiveMap.fromHson("+1");`;
  const valid = invalid.replace("+1", "<a/>");
  assert.equal(diagnose(invalid, "typescript", "/workspace/static.ts").length, 1);
  assert.deepEqual(diagnose(valid, "typescript", "/workspace/static.ts"), []);
});

type Listener = (document: DiagnosticDocument) => void;

class FakeHost implements DiagnosticHost {
  documents: DiagnosticDocument[] = [];
  readonly opens: Listener[] = [];
  readonly changes: Listener[] = [];
  readonly closes: Listener[] = [];
  readonly timerCallbacks = new Map<number, () => void>();
  readonly clearedTimers = new Set<number>();
  readonly unexpected: unknown[] = [];
  private nextTimer = 1;

  openDocuments(): readonly DiagnosticDocument[] { return this.documents; }
  onDidOpen(listener: Listener): Disposable { return this.register(this.opens, listener); }
  onDidChange(listener: Listener): Disposable { return this.register(this.changes, listener); }
  onDidClose(listener: Listener): Disposable { return this.register(this.closes, listener); }
  setTimer(callback: () => void): unknown {
    const id = this.nextTimer;
    this.nextTimer += 1;
    this.timerCallbacks.set(id, callback);
    return id;
  }
  clearTimer(timer: unknown): void { this.clearedTimers.add(Number(timer)); }
  reportUnexpected(error: unknown): void { this.unexpected.push(error); }
  emit(listeners: readonly Listener[], document: DiagnosticDocument): void {
    for (const listener of listeners) listener(document);
  }
  runTimer(id: number): void { this.timerCallbacks.get(id)?.(); }
  private register(list: Listener[], listener: Listener): Disposable {
    list.push(listener);
    return { dispose: () => list.splice(list.indexOf(listener), 1) };
  }
}

class FakePublisher implements DiagnosticPublisher {
  readonly published = new Map<string, readonly DocumentDiagnosticSpec[]>();
  readonly deletions: string[] = [];
  set(document: DiagnosticDocument, diagnostics: readonly DocumentDiagnosticSpec[]): void {
    this.published.set(document.uri, diagnostics);
  }
  delete(uri: string): void {
    this.published.delete(uri);
    this.deletions.push(uri);
  }
}

function document(text: string, version: number, uri = "file:///fixture.hson"): DiagnosticDocument {
  return { uri, version, languageId: "hson", fileName: "/fixture.hson", text };
}

const markerDiagnostic = (text: string): readonly DocumentDiagnosticSpec[] => text === "valid"
  ? []
  : [{
      message: text,
      range: { start: 0, end: text.length },
      source: DIAGNOSTIC_SOURCE,
      precision: "fallback",
      related: [],
    }];

check("lifecycle analyzes initially open and newly opened documents", () => {
  const host = new FakeHost();
  const publisher = new FakePublisher();
  const first = document("initial", 1);
  host.documents = [first];
  const controller = start_diagnostics(host, publisher, { produce: (input) => markerDiagnostic(input.text) });
  assert.equal(publisher.published.get(first.uri)?.[0]?.message, "initial");
  const second = document("opened", 1, "file:///opened.hson");
  host.documents.push(second);
  host.emit(host.opens, second);
  assert.equal(publisher.published.get(second.uri)?.[0]?.message, "opened");
  controller.dispose();
});

check("quick changes discard stale versions and the valid edit clears diagnostics", () => {
  const host = new FakeHost();
  const publisher = new FakePublisher();
  const v1 = document("old", 1);
  host.documents = [v1];
  const controller = start_diagnostics(host, publisher, { produce: (input) => markerDiagnostic(input.text) });
  const v2 = document("stale", 2);
  host.documents = [v2];
  host.emit(host.changes, v2);
  const staleTimer = 1;
  const v3 = document("current", 3);
  host.documents = [v3];
  host.emit(host.changes, v3);
  const currentTimer = 2;
  assert.ok(host.clearedTimers.has(staleTimer));
  host.runTimer(staleTimer);
  assert.equal(publisher.published.get(v1.uri)?.[0]?.message, "old");
  host.runTimer(currentTimer);
  assert.equal(publisher.published.get(v1.uri)?.[0]?.message, "current");
  const v4 = document("valid", 4);
  host.documents = [v4];
  host.emit(host.changes, v4);
  host.runTimer(3);
  assert.deepEqual(publisher.published.get(v1.uri), []);
  controller.dispose();
});

check("close cancels pending work and clears published diagnostics", () => {
  const host = new FakeHost();
  const publisher = new FakePublisher();
  const value = document("bad", 1);
  host.documents = [value];
  const controller = start_diagnostics(host, publisher, { produce: (input) => markerDiagnostic(input.text) });
  const changed = document("changed", 2);
  host.documents = [changed];
  host.emit(host.changes, changed);
  host.documents = [];
  host.emit(host.closes, changed);
  assert.ok(host.clearedTimers.has(1));
  assert.equal(publisher.published.has(value.uri), false);
  host.runTimer(1);
  assert.equal(publisher.published.has(value.uri), false);
  controller.dispose();
});

check("unsupported transitions and unexpected adapter errors clear stale diagnostics", () => {
  const host = new FakeHost();
  const publisher = new FakePublisher();
  const value = document("bad", 1);
  host.documents = [value];
  const controller = start_diagnostics(host, publisher, {
    produce(input) {
      if (input.text === "throw") throw new Error("unexpected");
      return markerDiagnostic(input.text);
    },
  });
  const thrown = document("throw", 2);
  host.documents = [thrown];
  host.emit(host.changes, thrown);
  host.runTimer(1);
  assert.equal(publisher.published.has(value.uri), false);
  assert.equal(host.unexpected.length, 1);
  const unsupported = { ...document("ignored", 3), languageId: "plaintext" };
  host.documents = [unsupported];
  host.emit(host.changes, unsupported);
  host.runTimer(2);
  assert.equal(publisher.published.has(value.uri), false);
  controller.dispose();
});

process.stdout.write(`ok - ${checks} focused runtime and lifecycle checks passed\n`);
