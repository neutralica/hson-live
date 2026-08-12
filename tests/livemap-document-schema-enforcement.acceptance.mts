// @hson-live-external-test
import assert from "node:assert/strict";
import { hson, LiveMapSchemaError, validate_document_path } from "../src/index.ts";
import { get_livemap_staged_authority } from "../src/api/livemap/livemap.authority.ts";
import type {
  DocumentLiveMap,
  ElementLiveMap,
  FragmentLiveMap,
  LiveMapCommitObservation,
  LiveMapGraphCommit,
  LiveMapGraphOp,
} from "../src/types/livemap.types.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

const d = hson.liveMap.schema.document;
const target = (...parts: number[]) => Object.freeze({
  kind: "path" as const,
  path: validate_document_path(parts),
});

function element(source: string): ElementLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "element") throw new Error(`Expected element, observed ${map.mode}`);
  return map;
}

function fragment(source: string): FragmentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "fragment") throw new Error(`Expected fragment, observed ${map.mode}`);
  return map;
}

function ordinary(source: string) {
  return element(source).element.node();
}

function assertSchemaError(run: () => unknown): LiveMapSchemaError {
  let observed: unknown;
  try {
    run();
  } catch (error) {
    observed = error;
  }
  assert.equal(observed instanceof LiveMapSchemaError, true);
  return observed as LiveMapSchemaError;
}

function replay(map: DocumentLiveMap, ops: readonly LiveMapGraphOp[]): LiveMapGraphCommit {
  return map.replay(Object.freeze({
    changed: true,
    prevRev: map.rev,
    rev: map.rev + 1,
    ops: Object.freeze([...ops]),
  }));
}

check("schema.get reports ordinary absence before attachment", () => {
  assert.equal(element(`<main/>`).schema.get(), undefined);
  assert.equal(fragment(`"x"`).schema.get(), undefined);
});

check("successful attachment returns the same owner and exact schema object", () => {
  const map = element(`<button "Save"/>`);
  const schema = d.element({ tag: "button", content: d.sequence(d.text) });
  assert.equal(map.schema.use(schema), map);
  assert.equal(map.schema.get(), schema);
});

check("attachment is not a revision or publication transition", () => {
  const map = element(`<main/>`);
  const observations: LiveMapCommitObservation[] = [];
  map.commits.observe((event) => observations.push(event));
  const before = map.capture();
  map.schema.use(d.element({ content: d.sequence() }));
  assert.deepEqual(map.capture(), before);
  assert.equal(map.rev, 0);
  assert.deepEqual(observations, []);
});

check("nonconforming attachment is inert and leaves debug available", () => {
  const map = element(`<main <a/>/>`);
  const before = map.capture();
  assertSchemaError(() => map.schema.use(d.element({ content: d.sequence(d.text) })));
  assert.equal(map.schema.get(), undefined);
  assert.deepEqual(map.capture(), before);
  assert.equal(map.debug.node(["main"]).tag(), "main");
});

check("same schema object reattachment is idempotent", () => {
  const map = element(`<main/>`);
  const schema = d.element({ content: d.sequence() });
  const first = map.schema.use(schema);
  const before = map.capture();
  assert.equal(map.schema.use(schema), first);
  assert.deepEqual(map.capture(), before);
  assert.equal(map.schema.get(), schema);
});

check("different schema object replacement rejects as a contract error", () => {
  const map = element(`<main/>`);
  const first = d.element({ content: d.sequence() });
  const equivalent = d.element({ content: d.sequence() });
  map.schema.use(first);
  assert.throws(
    () => map.schema.use(equivalent),
    (error: unknown) => error instanceof Error
      && !(error instanceof LiveMapSchemaError)
      && /already attached and cannot be replaced/.test(error.message),
  );
  assert.equal(map.schema.get(), first);
});

check("a broad pre-attachment alias remains governed after attachment", () => {
  const broad = element(`<main "x"/>`);
  broad.schema.use(d.element({ content: d.sequence(d.text) }));
  const before = broad.capture();
  assertSchemaError(() => broad.at([0]).replace(ordinary(`<em/>`)));
  assert.deepEqual(broad.capture(), before);
});

check("straightforward schema-aware replacement domains remain runtime-authoritative", () => {
  const map = element(`<main "x"/>`);
  const typed = map.schema.use(d.element({ content: d.sequence(d.text) }));
  const location = typed.at([0]);
  const before: string = location.snap();
  location.replace("y");
  const after: string = location.snap();
  assert.equal(before, "x");
  assert.equal(after, "y");

  const structured = element(`<main <button "before"/>/>`);
  const structuredTyped = structured.schema.use(d.element({
    content: d.sequence(d.element({
      tag: "button",
      content: d.sequence(d.text),
    })),
  }));
  const structuredLocation = structuredTyped.at([0]);
  structuredLocation.replace(ordinary(`<button "after"/>`));
  assert.equal(structuredLocation.snap().$_tag, "button");
  assertSchemaError(() => structuredLocation.replace(ordinary(`<a "wrong"/>`)));
  assert.equal(structuredLocation.snap().$_tag, "button");
});

check("repeated text insertion accepts text and rejects structured aliases", () => {
  const map = fragment(`"first"`);
  const typed = map.schema.use(d.fragment(d.repeat(d.text)));
  typed.at([]).insert(1, "second");
  assert.equal(typed.at([1]).snap(), "second");

  const before = map.capture();
  assertSchemaError(() => map.at([]).insert(2, ordinary(`<em/>`)));
  assert.deepEqual(map.capture(), before);
});

check("closed sequence rejects insertion before publication", () => {
  const map = element(`<main "x"/>`);
  map.schema.use(d.element({ content: d.sequence(d.text) }));
  const before = map.capture();
  assertSchemaError(() => map.at([]).insert(1, "y"));
  assert.deepEqual(map.capture(), before);
});

check("closed sequence rejects deletion before publication", () => {
  const map = element(`<main "x"/>`);
  map.schema.use(d.element({ content: d.sequence(d.text) }));
  const before = map.capture();
  assertSchemaError(() => map.at([0]).delete());
  assert.deepEqual(map.capture(), before);
});

check("closed mixed sequence rejects a schema-invalid move", () => {
  const map = element(`<main "x" <a/>/>`);
  map.schema.use(d.element({ content: d.sequence(d.text, d.element()) }));
  const before = map.capture();
  assertSchemaError(() => map.at([]).move(0, 1));
  assert.deepEqual(map.capture(), before);
});

check("attrs remain open beneath an attached document schema", () => {
  const map = element(`<main "x"/>`);
  map.schema.use(d.element({ tag: "main", content: d.sequence(d.text) }));
  map.at([]).attrs.setMany({ id: "main", hidden: false, count: 2 });
  map.at([]).attrs.drop("count");
  assert.deepEqual(map.at([]).attrs.keys(), ["hidden", "id"]);
});

check("invalid install is inert and publishes nothing", () => {
  const map = element(`<main "x"/>`);
  map.schema.use(d.element({ tag: "main", content: d.sequence(d.text) }));
  const observations: LiveMapCommitObservation[] = [];
  map.commits.observe((event) => observations.push(event));
  const before = map.capture();
  assertSchemaError(() => map.install(element(`<main <em/>/>`).capture()));
  assert.deepEqual(map.capture(), before);
  assert.deepEqual(observations, []);
});

check("conforming install preserves the schema contract", () => {
  const map = element(`<main "x"/>`);
  const schema = d.element({ tag: "main", content: d.sequence(d.text) });
  const typed = map.schema.use(schema);
  const location = typed.at([0]);
  map.install(element(`<main "y"/>`).capture());
  const installed: string = location.snap();
  assert.equal(installed, "y");
  assert.equal(map.schema.get(), schema);
});

check("invalid restore is inert and emits no snapshot", () => {
  const map = element(`<main "x"/>`);
  map.schema.use(d.element({ content: d.sequence(d.text) }));
  const observations: LiveMapCommitObservation[] = [];
  map.commits.observe((event) => observations.push(event));
  const before = map.capture();
  assertSchemaError(() => map.restore(element(`<main <em/>/>`).capture()));
  assert.deepEqual(map.capture(), before);
  assert.deepEqual(observations, []);
});

check("conforming restore preserves the permanent schema", () => {
  const source = element(`<main "restored"/>`);
  source.at([0]).replace("revision-one");
  const map = element(`<main "x"/>`);
  const schema = d.element({ content: d.sequence(d.text) });
  const typed = map.schema.use(schema);
  const location = typed.at([0]);
  map.restore(source.capture());
  const restored: string = location.snap();
  assert.equal(map.rev, 1);
  assert.equal(restored, "revision-one");
  assert.equal(map.schema.get(), schema);
});

check("schema-invalid replay is inert", () => {
  const source = element(`<main "x"/>`);
  const commit = source.at([0]).replace(ordinary(`<em/>`));
  const map = element(`<main "x"/>`);
  map.schema.use(d.element({ content: d.sequence(d.text) }));
  const before = map.capture();
  assertSchemaError(() => map.replay(commit));
  assert.deepEqual(map.capture(), before);
});

check("replay validates the completed atomic candidate", () => {
  const map = fragment(`"x" <a/> <b/>`);
  const typed = map.schema.use(d.fragment(d.sequence(d.text, d.element(), d.element())));
  const elementLocation = typed.at([1]);
  const commit = replay(map, [
    { domain: "graph", op: "move-content", target: target(), from: 0, to: 2 },
    { domain: "graph", op: "move-content", target: target(), from: 2, to: 0 },
    { domain: "graph", op: "set-attr", target: target(1), name: "id", value: "changed" },
  ]);
  const endpoint: ReturnType<typeof elementLocation.snap> = elementLocation.snap();
  assert.equal(commit.changed, true);
  assert.equal(endpoint.$_tag, "a");
  assert.equal(map.at([1]).attrs.get("id"), "changed");
});

check("staged authority rejects a schema-invalid detached candidate", () => {
  const map = element(`<main "x"/>`);
  map.schema.use(d.element({ content: d.sequence(d.text) }));
  const authority = get_livemap_staged_authority(map);
  const before = map.capture();
  assertSchemaError(() => authority.prepare((draft) => draft.at([0]).replace(ordinary(`<em/>`))));
  assert.deepEqual(map.capture(), before);
});

check("staged authority accepts a conforming candidate under the owner schema", () => {
  const map = element(`<main "x"/>`);
  const typed = map.schema.use(d.element({ content: d.sequence(d.text) }));
  const location = typed.at([0]);
  const authority = get_livemap_staged_authority(map);
  const transition = authority.prepare((draft) => draft.at([0]).replace("y"));
  const before: string = location.snap();
  assert.equal(before, "x");
  authority.accept(transition);
  const after: string = location.snap();
  assert.equal(after, "y");
});

check("successful attachment invalidates an already prepared transition", () => {
  const map = element(`<main "x"/>`);
  const authority = get_livemap_staged_authority(map);
  const transition = authority.prepare((draft) => draft.at([0]).replace("y"));
  map.schema.use(d.element({ content: d.sequence(d.text) }));
  assert.throws(() => authority.accept(transition), /stale|invalid/i);
  assert.equal(map.at([0]).snap(), "x");
});

check("successful attachment detaches a leaked root debug reference", () => {
  const map = element(`<main "x"/>`);
  const leaked = map.debug.node(["main"]).must();
  const before = map.root();
  map.schema.use(d.element({ tag: "main", content: d.sequence(d.text) }));
  leaked.$_tag = "detached";
  assert.deepEqual(map.root(), before);
  assert.equal(map.element.node().$_tag, "main");
});

check("successful attachment detaches leaked nested debug references", () => {
  const map = element(`<main <section id="before"/>/>`);
  const leaked = map.debug.node(["main"]).must().$_content[0];
  if (typeof leaked !== "object" || leaked === null) throw new Error("Expected nested carrier");
  map.schema.use(d.element({ content: d.sequence(d.element()) }));
  leaked.$_content.length = 0;
  assert.equal(map.at([0]).attrs.get("id"), "before");
});

check("future debug access rejects after schema attachment", () => {
  const map = element(`<main/>`);
  map.schema.use(d.element());
  assert.throws(() => map.debug.node([]), /unavailable after document schema attachment/);
});

check("debug detachment preserves revision, QUID identity, and interned locations", () => {
  const map = element(`<main @000000001 <button @000000002 "x"/>/>`);
  const location = map.at([0, 0]);
  map.debug.node(["main"]);
  map.schema.use(d.element({
    tag: "main",
    content: d.sequence(d.element({ tag: "button", content: d.sequence(d.text) })),
  }));
  assert.equal(map.rev, 0);
  assert.equal(map.document.byQuid("000000001")?.$_tag, "main");
  assert.equal(map.document.byQuid("000000002")?.$_tag, "button");
  assert.equal(location, map.at([0, 0]));
  location.replace("y");
  assert.equal(location.snap(), "y");
});

process.stdout.write(`# ${checks} LiveMap document schema enforcement checks passed\n`);
emit_hson_live_test_completion("livemap.document-schema-enforcement", checks, checks, 0);
