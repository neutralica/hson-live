// @hson-live-external-test
import assert from "node:assert/strict";
import { hson, LiveMapSchemaError } from "../src/index.ts";
import type { ElementLiveMap } from "../src/types/livemap.types.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function element(source: string): ElementLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "element") throw new Error(`Expected element, observed ${map.mode}`);
  return map;
}

function schemaError(run: () => unknown): LiveMapSchemaError {
  try {
    run();
  } catch (cause) {
    if (cause instanceof LiveMapSchemaError) return cause;
    throw cause;
  }
  throw new Error("Expected LiveMapSchemaError");
}

const Common = hson.liveMap.schema.define((s) => s.attrs({
  id: s.string,
  title: s.string.optional,
  count: s.number.optional,
  enabled: s.boolean.optional,
  nullable: s.string.nullable.optional,
  selected: s.flag.optional,
}));
const OpenButton = hson.liveMap.schema.define((s) => s.button(Common, s.string));
const ExactButton = hson.liveMap.schema.define((s) => s.button(
  s.attrs.exact({ id: s.string, selected: s.flag.optional }),
  s.string,
));

check("defined attrs schemas are frozen, immutable, and reusable", () => {
  assert.equal(Object.isFrozen(Common), true);
  element(`<button id="a" "A"/>`).schema.use(OpenButton);
  element(`<button id="b" title="B" "B"/>`).schema.use(OpenButton);
});

check("open attrs require declared keys and allow canonical extras", () => {
  element(`<button id="a" data-extra="yes" "A"/>`).schema.use(OpenButton);
  const error = schemaError(() => element(`<button title="missing" "A"/>`).schema.use(OpenButton));
  assert.equal(error.issues[0]?.code, "MISSING_REQUIRED");
  assert.equal(error.issues[0]?.attributeName, "id");
  assert.deepEqual(error.issues[0]?.path, []);
});

check("exact attrs reject extras with machine-readable attributeName", () => {
  const error = schemaError(() => element(`<button id="a" extra="x" "A"/>`).schema.use(ExactButton));
  const issue = error.issues.find((candidate) => candidate.code === "UNKNOWN_KEY");
  assert.equal(issue?.attributeName, "extra");
  assert.deepEqual(issue?.path, []);
});

check("exact empty means exactly no attrs", () => {
  const Empty = hson.liveMap.schema.define((s) => s.div(s.attrs.exact({})));
  element(`<div/>`).schema.use(Empty);
  assert.equal(schemaError(() => element(`<div id="x"/>`).schema.use(Empty)).issues[0]?.attributeName, "id");
});

check("primitive, nullable, literal, pick, constrain, recurse, and unknown attr values validate", () => {
  const Rich = hson.liveMap.schema.define((s) => s.div(s.attrs.exact({
    text: s.string,
    amount: s.number,
    active: s.boolean,
    nil: s.null,
    maybe: s.string.nullable,
    mode: s.literal("a", "b"),
    choice: s.pick(s.string, s.number),
    short: s.string.constrain((value) => value.length < 4),
    tabindex: s.number.constrain("tab index", (value) => Number.isInteger(value) && value >= -1),
    recursive: s.recurse(() => s.string),
    broad: s.unknown,
  })));
  const map = element(`<div/>`);
  map.at([]).attrs.replace({
    text: "x", amount: 2, active: false, nil: null, maybe: null,
    mode: "a", choice: 3, short: "ok", tabindex: 0, recursive: "yes", broad: 9,
  });
  map.schema.use(Rich);
  const invalid = schemaError(() => map.at([]).attrs.set("short", "long"));
  assert.equal(invalid.issues[0]?.code, "INVALID_CONSTRAINT");
  assert.equal(invalid.issues[0]?.attributeName, "short");
  assert.equal(invalid.issues[0]?.expected, "constraint");
  const labeled = schemaError(() => map.at([]).attrs.set("tabindex", -2));
  assert.equal(labeled.issues[0]?.attributeName, "tabindex");
  assert.equal(labeled.issues[0]?.expected, "tab index");
});

check("flag evidence is contextual and distinct from boolean and strings", () => {
  const Flagged = hson.liveMap.schema.define((s) => s.button(s.attrs.exact({
    disabled: s.flag,
    bool: s.boolean,
    word: s.literal("true", "false"),
    text: s.string,
  })));
  const valid = element(`<button disabled/>`);
  valid.at([]).attrs.setMany({ bool: false, word: "true", text: "disabled" });
  valid.schema.use(Flagged);
  const wrong = element(`<button disabled="true"/>`);
  wrong.at([]).attrs.setMany({ bool: false, word: "true", text: "disabled" });
  const error = schemaError(() => wrong.schema.use(Flagged));
  assert.equal(error.issues.some((issue) => issue.attributeName === "disabled" && issue.code === "INVALID_LITERAL"), true);
});

check("optional flags may be absent while required flags may not", () => {
  const Optional = hson.liveMap.schema.define((s) => s.button(s.attrs({ selected: s.flag.optional })));
  element(`<button/>`).schema.use(Optional);
  const Required = hson.liveMap.schema.define((s) => s.button(s.attrs({ selected: s.flag })));
  assert.equal(schemaError(() => element(`<button/>`).schema.use(Required)).issues[0]?.attributeName, "selected");
});

check("style unknown accepts canonical structured style while ordinary unknown remains name-sensitive", () => {
  const Styled = hson.liveMap.schema.define((s) => s.div(s.attrs.exact({ style: s.unknown.optional })));
  const map = element(`<div/>`);
  map.at([]).attrs.set("style", { color: "red", width: { value: 2, unit: "px" } });
  map.schema.use(Styled);
  assert.deepEqual(map.at([]).attrs.get("style"), { color: "red", width: { value: 2, unit: "px" } });
  assert.throws(() => map.at([]).attrs.set("other", { color: "red" }));
});

check("attrs must be first and unique in known, custom, and any tag builders", () => {
  hson.liveMap.schema.define((s) => s.div(Common, s.string));
  hson.liveMap.schema.define((s) => s.tag.foo(Common, s.string));
  hson.liveMap.schema.define((s) => s.tag["my-widget"](Common, s.string));
  hson.liveMap.schema.define((s) => s.tag(Common, s.string));
  assert.throws(
    () => hson.liveMap.schema.define((s) => Reflect.apply(s.div, s, [s.string, Common])),
    /first tag operand/,
  );
  assert.throws(
    () => hson.liveMap.schema.define((s) => Reflect.apply(s.div, s, [Common, Common])),
    /at most once/,
  );
});

check("attrs schemas cannot be children, tuple items, projected values, or root contracts", () => {
  assert.throws(() => hson.liveMap.schema.define((s) => Reflect.apply(s.tuple, s, [Common])), /schema capability/);
  assert.throws(() => hson.liveMap.schema.define((s) => Reflect.apply(s.object, s, [{ attrs: Common }])), /Projected schema composition/);
  assert.throws(() => Reflect.apply(element(`<div/>`).schema.use, undefined, [Common]), /element or fragment root schema/);
});

check("structural projected schemas reject in attr-value positions", () => {
  hson.liveMap.schema.define((s) => {
    for (const value of [s.object({}), s.object.exact({}), s.array(s.string), s.tuple(s.string), s.record(s.string), s.tagged("kind", { a: s.object({}) })]) {
      assert.throws(() => Reflect.apply(s.attrs, s, [{ bad: value }]), /primitive\/unknown attr-value schema/);
    }
    return s.div();
  });
});

check("caller shapes and literal choices are snapshotted", () => {
  const values = ["a", "b"] as ["a", "b"];
  const Attrs = hson.liveMap.schema.define((s) => {
    const shape = { mode: s.literal(...values) };
    const result = s.attrs(shape);
    Object.assign(shape, { extra: s.string });
    return result;
  });
  values[0] = "changed" as "a";
  const Schema = hson.liveMap.schema.define((s) => s.div(Attrs));
  element(`<div mode="a"/>`).schema.use(Schema);
});

check("all attr mutations are governed by final-candidate validation", () => {
  const map = element(`<button id="a" selected "A"/>`).schema.use(ExactButton);
  const startRev = map.rev;
  for (const mutate of [
    () => Reflect.apply(map.at([]).attrs.set, map.at([]).attrs, ["id", 1]),
    () => Reflect.apply(map.at([]).attrs.setMany, map.at([]).attrs, [{ id: 1 }]),
    () => map.at([]).attrs.drop("id"),
    () => map.at([]).attrs.dropMany(["id"]),
    () => map.at([]).attrs.clear(),
    () => Reflect.apply(map.at([]).attrs.replace, map.at([]).attrs, [{ selected: "selected" }]),
  ]) {
    assert.throws(mutate, LiveMapSchemaError);
    assert.equal(map.rev, startRev);
    assert.equal(map.at([]).attrs.get("id"), "a");
  }
});

check("replacement, insertion, and move validate descendant attrs in the complete candidate", () => {
  const A = hson.liveMap.schema.define((s) => s.button(s.attrs.exact({ mode: s.literal("a") })));
  const B = hson.liveMap.schema.define((s) => s.button(s.attrs.exact({ mode: s.literal("b") })));
  const Ordered = hson.liveMap.schema.define((s) => s.main(A, B));
  const map = element(`<main <button mode="a"/> <button mode="b"/>/>`).schema.use(Ordered);
  const before = map.capture();
  assert.throws(() => map.at([0]).replace(element(`<button mode="wrong"/>`).element.node()), LiveMapSchemaError);
  assert.throws(() => map.at([]).move(0, 1), LiveMapSchemaError);
  assert.throws(() => map.at([]).insert(1, element(`<button mode="a"/>`).element.node()), LiveMapSchemaError);
  assert.equal(map.rev, before.rev);
  assert.deepEqual(map.capture().root, before.root);
});

check("install and restore reject invalid attr-bearing captures inertly", () => {
  const Governed = hson.liveMap.schema.define((s) => s.main(s.attrs.exact({ id: s.string })));
  const map = element(`<main id="valid"/>`).schema.use(Governed);
  const invalid = element(`<main/>`).capture();
  const before = map.capture();
  assert.throws(() => map.install(invalid), LiveMapSchemaError);
  assert.throws(() => map.restore(invalid), LiveMapSchemaError);
  assert.equal(map.rev, before.rev);
  assert.deepEqual(map.capture().root, before.root);
});

check("replay validates attr and flag state before publication", () => {
  const Governed = hson.liveMap.schema.define((s) => s.main(s.attrs.exact({ selected: s.flag })));
  const target = element(`<main selected/>`).schema.use(Governed);
  const source = element(`<main selected/>`);
  const invalidCommit = source.at([]).attrs.set("selected", "wrong");
  const before = target.capture();
  assert.throws(() => target.replay(invalidCommit), LiveMapSchemaError);
  assert.equal(target.rev, before.rev);
  assert.deepEqual(target.capture().root, before.root);
});

process.stdout.write(`# ${checks} LiveMap attrs schema checks passed\n`);
emit_hson_live_test_completion("livemap.document-attrs-schema", checks, checks, 0);
