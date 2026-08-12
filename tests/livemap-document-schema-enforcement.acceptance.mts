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
  run(); checks += 1; process.stdout.write(`ok ${checks} - ${name}\n`);
}
const target = (...parts: number[]) => Object.freeze({ kind: "path" as const, path: validate_document_path(parts) });

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
function ordinary(source: string) { return element(source).element.node(); }
function assertSchemaError(run: () => unknown): LiveMapSchemaError {
  let observed: unknown;
  try { run(); } catch (error) { observed = error; }
  assert.equal(observed instanceof LiveMapSchemaError, true);
  return observed as LiveMapSchemaError;
}
function replay(map: DocumentLiveMap, ops: readonly LiveMapGraphOp[]): LiveMapGraphCommit {
  return map.replay(Object.freeze({ changed: true, prevRev: map.rev, rev: map.rev + 1, ops: Object.freeze([...ops]) }));
}

const EmptyElement = hson.liveMap.schema.define((s) => s.tag(s.tuple()));
const TextElement = hson.liveMap.schema.define((s) => s.tag(s.string));
const MainText = hson.liveMap.schema.define((s) => s.main(s.string));
const ButtonText = hson.liveMap.schema.define((s) => s.button(s.string));
const OneButton = hson.liveMap.schema.define((s) => s.tag(ButtonText));
const RepeatText = hson.liveMap.schema.define((s) => s.repeat(s.string));
const TextThenElement = hson.liveMap.schema.define((s) => s.tag(s.string, s.tag()));
const TextTwoElements = hson.liveMap.schema.define((s) => s.tuple(s.string, s.tag(), s.tag()));

check("schema.get reports absence before attachment", () => {
  assert.equal(element(`<main/>`).schema.get(), undefined);
  assert.equal(fragment(`"x"`).schema.get(), undefined);
});
check("attachment returns the same owner and exact schema identity", () => {
  const map = element(`<main "Save"/>`);
  assert.equal(map.schema.use(MainText), map);
  assert.equal(map.schema.get(), MainText);
});
check("attachment changes neither revision nor publication", () => {
  const map = element(`<main/>`); const observations: LiveMapCommitObservation[] = [];
  map.commits.observe((event) => observations.push(event)); const before = map.capture();
  map.schema.use(EmptyElement);
  assert.deepEqual(map.capture(), before); assert.equal(map.rev, 0); assert.deepEqual(observations, []);
});
check("invalid attachment is inert", () => {
  const map = element(`<main <a/>/>`); const before = map.capture();
  assertSchemaError(() => map.schema.use(TextElement));
  assert.equal(map.schema.get(), undefined); assert.deepEqual(map.capture(), before);
});
check("same-object reattachment is idempotent", () => {
  const map = element(`<main/>`); const first = map.schema.use(EmptyElement); const before = map.capture();
  assert.equal(map.schema.use(EmptyElement), first); assert.deepEqual(map.capture(), before);
});
check("equivalent distinct defined schemas cannot replace a document contract", () => {
  const map = element(`<main/>`); const equivalent = hson.liveMap.schema.define((s) => s.tag(s.tuple()));
  map.schema.use(EmptyElement);
  assert.throws(() => map.schema.use(equivalent), /already attached and cannot be replaced/);
  assert.equal(map.schema.get(), EmptyElement);
});
check("pre-attachment aliases remain governed", () => {
  const map = element(`<main "x"/>`); map.schema.use(TextElement); const before = map.capture();
  assertSchemaError(() => map.at([0]).replace(ordinary(`<em/>`))); assert.deepEqual(map.capture(), before);
});
check("schema-aware text replacement remains exact", () => {
  const typed = element(`<main "x"/>`).schema.use(TextElement); const location = typed.at([0]);
  const before: string = location.snap(); location.replace("y"); const after: string = location.snap();
  assert.equal(before, "x"); assert.equal(after, "y");
});
check("schema-aware element replacement preserves exact nested tags", () => {
  const typed = element(`<main <button "before"/>/>`).schema.use(OneButton); const location = typed.at([0]);
  location.replace(ordinary(`<button "after"/>`)); assert.equal(location.snap().$_tag, "button");
  assertSchemaError(() => location.replace(ordinary(`<a "wrong"/>`)));
});
check("repeated insertion accepts strings and rejects elements", () => {
  const map = fragment(`"first"`); const typed = map.schema.use(RepeatText);
  typed.at([]).insert(1, "second"); assert.equal(typed.at([1]).snap(), "second");
  const before = map.capture(); assertSchemaError(() => map.at([]).insert(2, ordinary(`<em/>`))); assert.deepEqual(map.capture(), before);
});
check("closed layout rejects insertion", () => {
  const map = element(`<main "x"/>`); map.schema.use(TextElement); const before = map.capture();
  assertSchemaError(() => map.at([]).insert(1, "y")); assert.deepEqual(map.capture(), before);
});
check("closed layout rejects deletion", () => {
  const map = element(`<main "x"/>`); map.schema.use(TextElement); const before = map.capture();
  assertSchemaError(() => map.at([0]).delete()); assert.deepEqual(map.capture(), before);
});
check("closed mixed layout rejects invalid movement", () => {
  const map = element(`<main "x" <a/>/>`); map.schema.use(TextThenElement); const before = map.capture();
  assertSchemaError(() => map.at([]).move(0, 1)); assert.deepEqual(map.capture(), before);
});
check("attributes remain open", () => {
  const map = element(`<main "x"/>`); map.schema.use(MainText);
  map.at([]).attrs.setMany({ id: "main", hidden: false, count: 2 }); map.at([]).attrs.drop("count");
  assert.deepEqual(map.at([]).attrs.keys(), ["hidden", "id"]);
});
check("invalid install is atomic", () => {
  const map = element(`<main "x"/>`); map.schema.use(MainText); const events: LiveMapCommitObservation[] = [];
  map.commits.observe((event) => events.push(event)); const before = map.capture();
  assertSchemaError(() => map.install(element(`<main <em/>/>`).capture()));
  assert.deepEqual(map.capture(), before); assert.deepEqual(events, []);
});
check("conforming install preserves schema identity and typed locations", () => {
  const map = element(`<main "x"/>`); const typed = map.schema.use(MainText); const location = typed.at([0]);
  map.install(element(`<main "y"/>`).capture()); const installed: string = location.snap();
  assert.equal(installed, "y"); assert.equal(map.schema.get(), MainText);
});
check("invalid restore is atomic", () => {
  const map = element(`<main "x"/>`); map.schema.use(TextElement); const before = map.capture();
  assertSchemaError(() => map.restore(element(`<main <em/>/>`).capture())); assert.deepEqual(map.capture(), before);
});
check("conforming restore preserves schema identity", () => {
  const source = element(`<main "restored"/>`); source.at([0]).replace("revision-one");
  const map = element(`<main "x"/>`); const typed = map.schema.use(TextElement); const location = typed.at([0]);
  map.restore(source.capture()); const restored: string = location.snap();
  assert.equal(map.rev, 1); assert.equal(restored, "revision-one"); assert.equal(map.schema.get(), TextElement);
});
check("schema-invalid replay is atomic", () => {
  const source = element(`<main "x"/>`); const commit = source.at([0]).replace(ordinary(`<em/>`));
  const map = element(`<main "x"/>`); map.schema.use(TextElement); const before = map.capture();
  assertSchemaError(() => map.replay(commit)); assert.deepEqual(map.capture(), before);
});
check("replay validates the completed atomic candidate", () => {
  const map = fragment(`"x" <a/> <b/>`); const typed = map.schema.use(TextTwoElements); const location = typed.at([1]);
  const commit = replay(map, [
    { domain: "graph", op: "move-content", target: target(), from: 0, to: 2 },
    { domain: "graph", op: "move-content", target: target(), from: 2, to: 0 },
    { domain: "graph", op: "set-attr", target: target(1), name: "id", value: "changed" },
  ]);
  assert.equal(commit.changed, true); assert.equal(location.snap().$_tag, "a"); assert.equal(map.at([1]).attrs.get("id"), "changed");
});
check("staged authority rejects invalid candidates", () => {
  const map = element(`<main "x"/>`); map.schema.use(TextElement); const before = map.capture();
  assertSchemaError(() => get_livemap_staged_authority(map).prepare((draft) => draft.at([0]).replace(ordinary(`<em/>`))));
  assert.deepEqual(map.capture(), before);
});
check("staged authority accepts conforming candidates", () => {
  const typed = element(`<main "x"/>`).schema.use(TextElement); const location = typed.at([0]);
  const authority = get_livemap_staged_authority(typed); const transition = authority.prepare((draft) => draft.at([0]).replace("y"));
  authority.accept(transition); const after: string = location.snap(); assert.equal(after, "y");
});
check("schema attachment invalidates prepared transitions", () => {
  const map = element(`<main "x"/>`); const authority = get_livemap_staged_authority(map);
  const transition = authority.prepare((draft) => draft.at([0]).replace("y")); map.schema.use(TextElement);
  assert.throws(() => authority.accept(transition), /stale|invalid/i); assert.equal(map.at([0]).snap(), "x");
});
check("attachment detaches leaked debug references", () => {
  const map = element(`<main "x"/>`); const leaked = map.debug.node(["main"]).must(); const before = map.root();
  map.schema.use(MainText); leaked.$_tag = "detached"; assert.deepEqual(map.root(), before);
});
check("future debug access rejects after document schema attachment", () => {
  const map = element(`<main/>`); map.schema.use(EmptyElement);
  assert.throws(() => map.debug.node([]), /unavailable after document schema attachment/);
});

process.stdout.write(`# ${checks} unified LiveMap document enforcement checks passed\n`);
emit_hson_live_test_completion("livemap.document-schema-enforcement", checks, checks, 0);
