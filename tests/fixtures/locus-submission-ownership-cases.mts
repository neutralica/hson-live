import assert from "node:assert/strict";
import { ANY_DATA, Hson, hsonLiveMap, LiveMapDocumentMutationError, TransformError } from "../../src/index.js";
import type { HsonNode } from "../../src/core/types.js";
import type { LiveMapCssOp, LiveMapDocumentRequestTarget } from "../../src/types/livemap.types.js";
import { locus_map_internal } from "../../src/internal/governor-maps.js";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.js";
import { enumerate_livemap_issued_quids } from "../../src/api/livemap/livemap.identity-epoch.js";
import { admit_projected_value } from "../../src/core/projected-value-admission.js";
import { ordered_projected_object } from "../../src/core/ordered-projected-value.js";
import { hson_data_from_value, hson_data_value, HsonDataValue } from "../../src/api/data/hson-data.js";
import { projected_value_to_hson_node } from "../../src/core/projected-value-graph.js";
import { validate_hson_schema_data, validate_hson_schema_graph } from "../../src/internal/schema-hson-validation/validate-canonical-hson.js";
import { HsonSchema, compiled_hson_schema_of, hson_schema_digest } from "../../src/api/schema/hson-schema.js";
import { compile_hson_schema } from "../../src/internal/hson-schema/compiler.js";
import { generate_hson_schema_types } from "../../src/internal/hson-schema/generate-types.js";
import { capture_document_css_command } from "../../src/internal/document-css-commands.js";
import { capture_document_content } from "../../src/api/livemap/livemap.document.mutation.js";
import { create_locus_hosted_aggregate_internal } from "../../src/api/locus/locus.aggregate.js";
import { MemoryCheckpointAdapter } from "../helpers/memory-checkpoint-adapter.mts";

type Check = (name: string, run: () => void | Promise<void>) => Promise<void>;
const create = (withDocument = true) => hsonLiveMap.locus.create({
  state: { data: { value: {}, items: [{}] } },
  ...(withDocument ? { page: { document: '<main @:main <p @:first title="old" <i/>/> <p @:second title="other"/>/>' } } : {}),
});
type Locus = ReturnType<typeof create>;
const target = (index = 0): LiveMapDocumentRequestTarget => ({ kind: "path", path: [0, 0, 1, 0, 0, 0, index] });
const first = (locus: Locus) => locus.doc.must("page").at([1, 0, 0]).asElement()!;
const location = (locus: Locus, route: "root" | "nested" | "derived") => route === "root"
  ? locus.data.must("state").at([]) : route === "nested" ? locus.data.must("state").at(["value"])
  : locus.data.must("state").at([]).asObject()!.at(["value"]).present()!.asObject()!;
function state(locus: Locus) {
  const map = locus_map_internal(locus), authority = internal_livemap_aggregate_authority(map);
  return { capture: map.capture(), issued: enumerate_livemap_issued_quids(authority.identityEpoch().issued()) };
}
function input() {
  const nested = { "10": Number.MAX_VALUE, "2": Number.MIN_VALUE, negatives: [-Number.MAX_VALUE, -Number.MIN_VALUE] };
  const source = { "10": -0, "2": new Proxy(nested, { ownKeys: () => ["10", "2", "negatives"] }) };
  const revocable = Proxy.revocable(source, { ownKeys: () => ["10", "2"], get() { throw Error("Getter must not run"); } });
  return { source, nested, ...revocable };
}
async function rejected(run: () => Promise<unknown>): Promise<void> {
  let pending: Promise<unknown> | undefined;
  assert.doesNotThrow(() => { pending = run(); });
  assert.ok(pending instanceof Promise);
  await assert.rejects(pending);
}
async function document_rejected(run: () => Promise<unknown>, expected: Readonly<{
  code: LiveMapDocumentMutationError["code"]; operation: LiveMapDocumentMutationError["operation"]; reason: string;
}>): Promise<LiveMapDocumentMutationError> {
  let pending: Promise<unknown> | undefined;
  let failure: LiveMapDocumentMutationError | undefined;
  assert.doesNotThrow(() => { pending = run(); });
  assert.ok(pending instanceof Promise);
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof LiveMapDocumentMutationError);
    assert.equal(error.name, "LiveMapDocumentMutationError");
    assert.equal(error.code, expected.code); assert.equal(error.operation, expected.operation);
    assert.equal(error.reason, expected.reason);
    assert.equal(error.message, `Invalid LiveMap document ${expected.operation}: ${expected.reason}`);
    failure = error; return true;
  });
  assert.ok(failure); return failure;
}
function observe_document_failure(locus: Locus) {
  const page = locus.doc.must("page");
  let publications = 0, observations = 0;
  const stops = [locus.commits.observe(() => { publications++; }), page.commits.observe(() => { publications++; }),
    page.watch(() => { observations++; }), first(locus).watch(() => { observations++; })];
  const before = state(locus), rev = locus.rev, initialObservations = observations;
  return {
    unchanged() {
      assert.deepEqual(state(locus), before); assert.equal(locus.rev, rev); assert.equal(page.rev, rev);
      assert.equal(publications, 0); assert.equal(observations, initialObservations);
    },
    stop() { for (const stop of stops) stop(); },
  };
}
function invalid_values(): unknown[] {
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  const owned = ordered_projected_object([["value", 1]]);
  return [NaN, Infinity, -Infinity, undefined, new Date(), new (class Unsupported {})(), cyclic, [, 1],
    Object.defineProperty({}, "value", { enumerable: true, get() { throw Error("Getter must not run"); } }),
    Object.assign({}, owned), Object.create(HsonDataValue.prototype), { "$_meta": "000009001" }, { "_hson_obj": 1 }];
}

export async function locus_submission_ownership_cases(check: Check): Promise<void> {
  for (const route of ["root", "nested", "derived"] as const) for (const method of ["set", "replace"] as const) {
    await check(`${route} ${method} captures exact Data on an idle queue before mutation and revocation`, async () => {
      const locus = create(false);
      try {
        const selected = location(locus, route), value = input();
        const expected = hson_data_from_value(admit_projected_value(value.proxy));
        const commits: number[] = []; const stop = locus.commits.observe(commit => commits.push(commit.rev));
        const pending = selected[method](value.proxy);
        assert.equal(locus.rev, 0);
        value.source["10"] = 9; value.nested["10"] = 8; value.revoke();
        await pending;
        assert.equal(locus.rev, 1); assert.deepEqual(commits, [1]);
        const actual = selected.hson()!;
        if (route === "root" && method === "set") {
          assert.deepEqual(selected.asObject()!.object.keys(), ["value", "items", "10", "2"]);
          assert.equal(selected.at(["2"]).hson(), expected.entries()![1]![1].toHson());
        } else assert.equal(actual, expected.toHson());
        assert.ok(Object.is(Hson.data.fromSource(selected.at(["10"]).hson()!).materialize(), -0));
        stop();
      } finally { locus.dispose(); }
    });
    await check(`${route} ${method} rejects invalid input asynchronously without revision or identity changes`, async () => {
      const locus = create(false);
      try {
        const selected = location(locus, route), before = state(locus);
        let commits = 0; const stop = locus.commits.observe(() => { commits++; });
        for (const value of invalid_values()) await rejected(() => Reflect.apply(selected[method], selected, [value]));
        assert.deepEqual(state(locus), before); assert.equal(commits, 0); stop();
      } finally { locus.dispose(); }
    });
  }

  for (const route of ["location", "request", "quad"] as const) {
    await check(`${route} attribute capture preserves Document errors, causes and failure atomicity`, async () => {
      const locus = create();
      try {
        const page = locus.doc.must("page"), attrs = route === "quad" ? page.q("first")!.attrs : first(locus).attrs;
        const observed = observe_document_failure(locus);
        let hooks = 0;
        const reflectionFailure = new Error("attribute reflection failed");
        const malformed: readonly Readonly<{ value: unknown; storageFailure: boolean; cause?: Error }>[] = [
          { value: { title: {} }, storageFailure: false },
          { value: Object.defineProperty({}, "title", { enumerable: true, get() { hooks++; return "bad"; } }), storageFailure: true },
          { value: new Date(0), storageFailure: true },
          { value: { toJSON() { hooks++; return {}; } }, storageFailure: true },
          { value: { title: { valueOf() { hooks++; return 1; }, toString() { hooks++; return "bad"; } } }, storageFailure: true },
          { value: new Proxy({ title: "bad" }, { ownKeys() { throw reflectionFailure; } }), storageFailure: true, cause: reflectionFailure },
        ];
        for (const method of ["replace", "setMany"] as const) for (const input of malformed) {
          const failure = await document_rejected(() => route === "request"
            ? Reflect.apply(page.document.attrs[method], undefined, [target(), input.value])
            : Reflect.apply(attrs[method], undefined, [input.value]), {
            code: "INVALID_DOCUMENT_ATTRIBUTE_VALUE", operation: "replace-attrs",
            reason: `${method === "replace" ? "attrs" : "values"} must be a canonical ordinary-attribute bag with valid, unprotected names`,
          });
          if (input.storageFailure) assert.ok(failure.cause instanceof Error);
          else assert.equal(failure.cause, undefined);
          if (input.cause !== undefined) assert.equal(failure.cause, input.cause);
          assert.equal(hooks, 0); observed.unchanged();
        }
        // Name validation remains outside the attribute-bag storage mapper.
        await document_rejected(() => attrs.set("bad name", "bad"), {
          code: "INVALID_DOCUMENT_ATTRIBUTE_NAME", operation: "set-attr", reason: "attribute name is not a canonical bare Hson name",
        });
        observed.unchanged(); observed.stop();
      } finally { locus.dispose(); }
    });

    await check(`${route} insert and replace capture retain content operation diagnostics and portable errors`, async () => {
      const locus = create();
      try {
        const page = locus.doc.must("page"), subject = route === "quad" ? page.q("first")! : first(locus);
        const observed = observe_document_failure(locus);
        let hooks = 0;
        const malformed = [
          { $_tag: "b", $_content: [,] },
          Object.defineProperty({ $_content: [] }, "$_tag", { enumerable: true, get() { hooks++; return "b"; } }),
          { $_tag: "b", $_content: [], toJSON() { hooks++; return {}; } },
          { $_tag: { toString() { hooks++; return "b"; }, valueOf() { hooks++; return 1; } }, $_content: [] },
        ];
        for (const method of ["insert", "replace"] as const) {
          const operation = method === "insert" ? "insert-content" : "replace-content";
          const write = (value: unknown): Promise<void> => route === "request"
            ? Reflect.apply(page.document.content[method], undefined, [{ kind: "path", path: [...target().path, 0] }, 0, value])
            : method === "insert" ? Reflect.apply(subject.insert, undefined, [0, value])
            : Reflect.apply(subject.at([0]).replace, undefined, [value]);
          for (const value of malformed) {
            const failure = await document_rejected(() => write(value), {
              code: "INVALID_DOCUMENT_REPLACEMENT", operation, reason: "replacement node storage is not exact",
            });
            assert.ok(failure.cause instanceof TransformError);
            assert.equal(failure.cause.operation, `LiveMap.${operation}`);
            assert.equal(failure.cause.stage, "source-admission"); assert.ok(failure.cause.path?.startsWith("$"));
            assert.equal(hooks, 0); observed.unchanged();
          }
          await document_rejected(() => write(undefined), {
            code: "INVALID_DOCUMENT_REPLACEMENT", operation, reason: "replacement must be one canonical Hson node or primitive",
          });
          let pending: Promise<void> | undefined;
          assert.doesNotThrow(() => { pending = write({ $_tag: "b", $_meta: { quid: "000009001" }, $_content: [] }); });
          assert.ok(pending instanceof Promise);
          await assert.rejects(pending, (error: unknown) => {
            assert.ok(error instanceof TransformError); assert.equal(error.code, "PORTABLE_RUNTIME_QUID_FORBIDDEN");
            assert.equal(error.operation, `LiveMap.${operation}`); return true;
          });
          observed.unchanged();
        }
        observed.stop();
      } finally { locus.dispose(); }
    });

    await check(`${route} Document attributes own replacements, setMany, structured values and removal names`, async () => {
      const locus = create();
      try {
        const page = locus.doc.must("page");
        const attrs = route === "quad" ? page.q("first")!.attrs : first(locus).attrs;
        for (const method of ["replace", "setMany"] as const) {
          const values = Proxy.revocable({ title: "submitted", style: { width: { value: 2, unit: "px" } } }, {});
          const request = Proxy.revocable(target(), {});
          const pending = route === "request" ? page.document.attrs[method](request.proxy, values.proxy) : attrs[method](values.proxy);
          values.revoke(); request.revoke(); await pending;
          assert.equal(first(locus).attrs.get("title"), "submitted");
          assert.deepEqual(first(locus).attrs.get("style"), { width: { value: 2, unit: "px" } });
        }
        const style = { color: "red" };
        const pending = route === "request" ? page.document.attrs.set(target(), "style", style) : attrs.set("style", style);
        style.color = "blue"; await pending;
        assert.deepEqual(first(locus).attrs.get("style"), { color: "red" });
        const names = ["title"];
        const removal = route === "request" ? page.document.attrs.dropMany(target(), names) : attrs.dropMany(names);
        names[0] = "style"; await removal;
        assert.equal(first(locus).attrs.get("title"), undefined); assert.ok(first(locus).attrs.has("style"));
      } finally { locus.dispose(); }
    });
    await check(`${route} Document content owns raw nodes before caller revocation`, async () => {
      const locus = create();
      try {
        const page = locus.doc.must("page");
        const content = Proxy.revocable<HsonNode>({ $_tag: "span", $_attrs: { title: "submitted" }, $_content: [] }, {});
        const pending = route === "request" ? page.document.content.insert({ kind: "path", path: [...target().path, 0] }, 0, content.proxy)
          : route === "quad" ? page.q("first")!.insert(0, content.proxy) : first(locus).insert(0, content.proxy);
        content.revoke(); await pending;
        assert.equal(page.at([1, 0, 0, 0]).asElement()!.attrs.get("title"), "submitted");
        const replacement = Proxy.revocable<HsonNode>({ $_tag: "em", $_content: [] }, {});
        const replace = route === "request" ? page.document.content.replace({ kind: "path", path: [...target().path, 0] }, 0, replacement.proxy)
          : route === "quad" ? page.q("first")!.at([0]).replace(replacement.proxy) : page.at([1, 0, 0, 0]).replace(replacement.proxy);
        replacement.revoke(); await replace;
        assert.match(page.at([1, 0, 0, 0]).hson()!, /<em/);
      } finally { locus.dispose(); }
    });
  }

  await check("staged attribute capture maps storage failures without publishing earlier staged writes", async () => {
    const locus = create();
    try {
      const observed = observe_document_failure(locus);
      let hooks = 0;
      const malformed = [new Date(0), Object.defineProperty({}, "title", {
        enumerable: true, get() { hooks++; return "bad"; },
      })];
      for (const value of malformed) {
        let called = false;
        const failure = await document_rejected(() => {
          const pending = locus.stage(writer => {
            called = true;
            writer.data.must("state").at(["value"]).replace({ shouldNotCommit: true });
            Reflect.apply(writer.doc.must("page").at([1, 0, 0]).asElement().attrs.setMany, undefined, [value]);
          });
          assert.equal(called, false); return pending;
        }, {
          code: "INVALID_DOCUMENT_ATTRIBUTE_VALUE", operation: "replace-attrs",
          reason: "values must be a canonical ordinary-attribute bag with valid, unprotected names",
        });
        assert.equal(called, true); assert.ok(failure.cause instanceof TypeError);
        assert.equal(hooks, 0); observed.unchanged();
      }
      observed.stop();
    } finally { locus.dispose(); }
  });

  await check("mutable request paths are owned while their endpoints resolve against queued state", async () => {
    const locus = create();
    try {
      const page = locus.doc.must("page"), request = { kind: "path" as const, path: [...target().path] };
      const prior = page.at([1, 0]).asElement()!.move(0, 1);
      const pending = page.document.attrs.setMany(request, { title: "current endpoint" });
      request.path[request.path.length - 1] = 1;
      await prior; await pending;
      assert.equal(page.q("second")!.attrs.get("title"), "current endpoint");
      assert.equal(page.q("first")!.attrs.get("title"), "old");
    } finally { locus.dispose(); }
  });

  await check("QUAD writes resolve moved identities and reject retired or disposed lifetimes at execution", async () => {
    const locus = create();
    try {
      const page = locus.doc.must("page"), subject = page.q("first")!;
      const prior = page.at([1, 0]).asElement()!.move(0, 1);
      const values = { title: "follows identity" }, pending = subject.attrs.setMany(values);
      values.title = "late"; await prior; await pending;
      assert.deepEqual(subject.path(), [1, 0, 1]); assert.equal(subject.attrs.get("title"), "follows identity");
      const deletion = subject.delete(), rejectedWrite = subject.attrs.setMany({ title: "retired" });
      await deletion; const before = state(locus); await assert.rejects(rejectedWrite);
      assert.deepEqual(state(locus), before);
      const other = page.q("second")!;
      const disposedWrite = other.attrs.setMany({ title: "disposed" }); other.dispose();
      const beforeDisposed = state(locus); await assert.rejects(disposedWrite); assert.deepEqual(state(locus), beforeDisposed);
    } finally { locus.dispose(); }
  });

  await check("Document invalid arguments reject without getters, publication or identity claims", async () => {
    const locus = create();
    try {
      const page = locus.doc.must("page"), attrs = first(locus).attrs, before = state(locus);
      let getterCalls = 0;
      const accessor = Object.defineProperty({}, "title", { enumerable: true, get() { getterCalls++; return "bad"; } });
      for (const run of [() => attrs.replace(accessor), () => attrs.setMany(accessor),
        () => page.document.attrs.set(Object.defineProperty({}, "kind", { enumerable: true, get() { getterCalls++; return "path"; } }) as LiveMapDocumentRequestTarget, "title", "bad"),
        () => first(locus).insert(0, { $_tag: "b", $_meta: { quid: "000009001" }, $_content: [] }),
        () => Reflect.apply(first(locus).insert, undefined, [0, { $_tag: "b", $_content: [,] }]),
        () => attrs.set("style", { width: { value: Infinity, unit: "px" } }),
      ]) await rejected(run);
      assert.equal(getterCalls, 0); assert.deepEqual(state(locus), before);
    } finally { locus.dispose(); }
  });

  await check("CSS commands and canonical operations own structured arguments without changing current-state planning", async () => {
    const locus = create();
    try {
      const css = locus.doc.must("page").css;
      const declarations = Proxy.revocable({ color: "red", width: { value: 2, unit: "px" } }, {});
      const pending = css.sel("main").setMany(declarations.proxy); declarations.revoke(); await pending;
      assert.match(css.snapshot(), /color:red/); assert.match(css.snapshot(), /width:2px/);
      const property = Proxy.revocable({ name: "--tone", syn: "<color>", inh: false, init: "red" } as const, {});
      const register = css.atProperty.register(property.proxy); property.revoke(); await register;
      const steps = { from: { opacity: "0" }, to: { opacity: "1" } };
      const animate = css.keyframes.set({ name: "fade", steps }); steps.to.opacity = "0.5"; await animate;
      assert.match(css.snapshot(), /opacity:\s*1/);
      const op: LiveMapCssOp = { domain: "css", kind: "rule", ruleKey: "manual", scopes: [],
        rule: { ruleKey: "manual", selector: "p", scopes: [], declarations: [["color", "green"]] } };
      const proxied = Proxy.revocable(op, {}), manual = css(proxied.proxy); proxied.revoke(); await manual;
      assert.match(css.snapshot(), /color:green/);
      const remove = css.sel("main").setMany({ color: undefined }); await remove;
      assert.doesNotMatch(css.snapshot(), /color:red/);
      const before = state(locus);
      let gets = 0;
      await rejected(() => css.sel("main").setMany(Object.defineProperty({}, "color", { enumerable: true, get() { gets++; return "blue"; } })));
      assert.equal(gets, 0); assert.deepEqual(state(locus), before);
      const captured = capture_document_css_command({ route: [], method: "register", namespace: "atProperty", args: [{ name: "--other", syn: "<color>", inh: false, init: "red" }] });
      assert.ok(Object.isFrozen(captured)); assert.ok(Object.isFrozen(captured.args)); assert.ok(Object.isFrozen(captured.args[0]));
      const content = capture_document_content({ $_tag: "b", $_content: [] }, "replace-content");
      assert.ok(Object.isFrozen(content)); assert.ok(typeof content === "object" && content !== null && Object.isFrozen(content.$_content));
    } finally { locus.dispose(); }
  });

  await check("explicit stage callbacks stay deferred; queue order and closed authority stay authoritative", async () => {
    const locus = create();
    try {
      const value = { n: 1 }; let called = false;
      const callback = locus.stage(writer => { called = true; writer.data.must("state").at(["value"]).replace(value); });
      assert.equal(called, false); value.n = 2; await callback;
      assert.deepEqual(locus.data.must("state").snap(["value"]), { n: 2 });
      const pending = locus.data.must("state").at(["value"]).replace({ n: 3 });
      const map = locus_map_internal(locus), before = map.capture(); locus.dispose();
      await assert.rejects(pending); assert.deepEqual(map.capture(), before);
    } finally { locus.dispose(); }
  });

  await check("Schema failures remain atomic and durable replay retains captured values", async () => {
    const schema = Hson.schema`<type "data" content <n "number">>`;
    const definitions = { state: { data: { n: 0 }, schema } };
    const storage = new MemoryCheckpointAdapter(), options = { logicalMapId: "d4b-ownership", persistence: storage };
    const locus = await hsonLiveMap.locus.resume(definitions, options);
    const selected = locus.data.must("state").at([]);
    const invalid = { n: "bad" }; const failure = Reflect.apply(selected.replace, selected, [invalid]); invalid.n = "still bad";
    const before = locus_map_internal(locus).capture(); await assert.rejects(failure);
    assert.deepEqual(locus_map_internal(locus).capture(), before); assert.equal(storage.appendCalls.length, 0);
    const value = { n: -0 }; const pending = selected.replace(value); value.n = 7; await pending;
    assert.equal(locus.rev, 1); assert.equal(storage.appendCalls.length, 1); locus.dispose();
    const resumed = await hsonLiveMap.locus.resume(definitions, options);
    try { assert.equal(resumed.rev, 1); assert.ok(Object.is(resumed.data.must("state").snap(["n"]), -0)); }
    finally { resumed.dispose(); }
  });

  await check("internal aggregate Library submission owns sources and CSS; action values capture before deferred handlers", async () => {
    const map = hsonLiveMap.fromLibraries({ initial: { data: 0 } });
    let called = false;
    const aggregate = create_locus_hosted_aggregate_internal({ map, actions: { capture: (_context, payload) => {
      called = true; return payload?.materialize();
    } } });
    try {
      const value = Proxy.revocable({ n: -0 }, {});
      const css = { page: { rules: [], properties: [], keyframes: [], order: [{ kind: "text" as const, text: "p{color:red}" }] } };
      const adding = aggregate.add_libraries_internal({ added: { data: value.proxy }, page: { document: "<p/>" } }, undefined, undefined, css);
      value.revoke(); css.page.order[0]!.text = "p{color:blue}"; await adding;
      assert.ok(Object.is(map.data.must("added").snap(["n"]), -0)); assert.equal(map.doc.must("page").css.snapshot(), "p{color:red}");
      const payload = Proxy.revocable({ count: 1 }, {}), dispatched = aggregate.dispatch_action("capture", payload.proxy);
      assert.equal(called, false); payload.revoke(); assert.deepEqual(await dispatched, { count: 1 });
      const before = map.capture(); await rejected(() => Reflect.apply(aggregate.add_libraries_internal, aggregate, [{ bad: { data: new Date() } }]));
      assert.deepEqual(map.capture(), before);
    } finally { aggregate.dispose(); }
  });

  await check("scoped Part QUAD convenience writes capture values while retaining occurrence authority", async () => {
    const locus = hsonLiveMap.locus.create({
      parts: { parts: { panel: { kind: "document", document: '<section hson:part @:root <span @:label/>/>' } } },
      page: { document: '<html <head/> <body <hson-part @:left lib="parts" at="panel"/> <hson-part @:right lib="parts" at="panel"/>/>/>' },
    });
    try {
      const page = locus.doc.must("page"), left = page.q("left")!, right = page.q("right")!;
      const values = Proxy.revocable({ title: "submitted" }, {}), pending = left.attrs.setMany(values.proxy);
      values.revoke(); await pending;
      assert.equal(left.attrs.get("title"), "submitted"); assert.equal(right.attrs.get("title"), undefined);
      const content = Proxy.revocable<HsonNode>({ $_tag: "em", $_content: [] }, {}), inserted = left.insert(1, content.proxy);
      content.revoke(); await inserted;
      assert.match(left.at([1]).hson()!, /<em/);
    } finally { locus.dispose(); }
  });

  await check("Parts convenience writes capture normalized CSS while preserving authored transport", async () => {
    const locus = hsonLiveMap.locus.create({ parts: { parts: { card: { kind: "document", document: '<div hson:part/>' } } } });
    try {
      const value = { kind: "document", document: '<section hson:part/>', css: { color: "red", width: undefined } };
      const pending = Reflect.apply(locus.parts.must("parts").at([]).set, undefined, [{ added: value }]);
      value.css.color = "blue"; value.document = '<aside hson:part/>'; await pending;
      const part = locus.parts.must("parts").at(["added"]); assert.ok(part);
      assert.match(part.write(), /hson-part/);
      assert.match(locus.parts.must("parts").at(["added"]).hson()!, /red/);
    } finally { locus.dispose(); }
  });

  await check("direct ordered Schema evaluation matches graph diagnostics, qualification and certification identity", () => {
    const schema = Hson.schema`<type "data" content <'10' <exact -0> '2' "number" note <optional "string">>>`;
    const good = ordered_projected_object([["10", -0], ["2", Number.MAX_VALUE]]);
    const exact = hson_data_from_value(good), identity = hson_schema_digest(schema);
    assert.strictEqual(schema.certify(exact), exact); assert.equal(hson_data_value(exact), good);
    assert.equal(hson_schema_digest(schema), identity);
    for (const candidate of [good, ordered_projected_object([["10", 0], ["2", "wrong"]])]) {
      const result = (run: () => void) => { try { run(); return undefined; } catch (error) { return error; } };
      const direct = result(() => validate_hson_schema_data(schema, candidate));
      const graph = result(() => validate_hson_schema_graph(schema, projected_value_to_hson_node(candidate)));
      assert.deepEqual(direct, graph);
    }
    assert.throws(() => validate_hson_schema_data(ANY_DATA, ordered_projected_object([["$_meta", "000009001"]])));
    assert.throws(() => Reflect.apply(validate_hson_schema_data, undefined, [ANY_DATA, Object.assign({}, good)]));
  });

  await check("compiler bootstrap retains ordered definitions, source ranges, unions, optionals and generated types", () => {
    const source = `<type "data" defs <Choice <union ["number", "boolean"]>> content <'10' <ref "Choice"> '2' <optional "string">>>`;
    const compiled = compile_hson_schema(source); assert.ok(compiled.ok);
    assert.equal(compiled.value.semantic.kind, "object");
    if (compiled.value.semantic.kind !== "object") throw Error("Expected object schema");
    assert.deepEqual(compiled.value.semantic.members.map(member => member.name), ["10", "2"]);
    assert.equal(compiled.value.semantic.members[1]!.optional, true);
    assert.equal(source.slice(compiled.value.symbols.definitions[0]!.declarationRange.start, compiled.value.symbols.definitions[0]!.declarationRange.end).includes("Choice"), true);
    const generated = generate_hson_schema_types("Ordered", compiled.value.semantic, compiled.value.definitions);
    assert.match(generated.declarations, /number/); assert.match(generated.declarations, /boolean/); assert.match(generated.declarations, /string/);
    assert.ok(generated.declarations.indexOf('"10"') < generated.declarations.indexOf('"2"'));
    const schema = HsonSchema.fromHson(source);
    assert.deepEqual(compiled_hson_schema_of(schema).graph, compiled.value.graph);
    const invalid = compile_hson_schema('<type "data" content <value <union ["number", "number"]>>>');
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.ok(invalid.issues.some(issue => issue.range !== undefined));
  });
}
