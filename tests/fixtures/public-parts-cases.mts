import assert from "node:assert/strict";
import { Hson, ANY_DATA, ANY_DOCUMENT } from "hson-live/hson";
import { hsonLiveMap, type LiveMapPartCollection, type LiveMapDefinitions } from "hson-live/livemap";
import { hsonTransform } from "hson-live/transform";
import type { LocusAuthorityLibraryDefinition } from "hson-live/locus";

// Deck-shaped authored definitions: no internal factory or validation marker.
export const deckParts = {
  header: { kind: "document", document: Hson.document`<header <h1 "%{title}"/>/>`, css: "h1{color:purple}" },
  para: { kind: "document", document: Hson.document`<p "%{text}"/>` },
  code: { kind: "document", document: Hson.document`<pre <code "%{source}"/>/>`, css: "pre{white-space:pre-wrap}" },
  nav: { kind: "document", document: Hson.document`<nav <a href="%{href}" "%{label}"/>/>`, css: "" },
  list: { kind: "document", document: Hson.document`<ul <li "%{item}"/>/>` },
} satisfies LiveMapPartCollection;
const deck = Hson.document`<main
  <hson-part lib="parts" at="header" title="Deck title"/>
  <hson-part lib="parts" at="para" text="Deck paragraph"/>
  <hson-part lib="parts" at="code" source="const x = 1;"/>
  <hson-part lib="parts" at="nav" href="/next" label="Next"/>
  <hson-part lib="parts" at="list" item="One item"/>
/>`;
const plain = '<main <hson-part lib="parts" at="para" text="Dynamic paragraph"/>/>';
function assertDeck(page: { root(): unknown; css: { snapshot(): string } }) {
  const graph = JSON.stringify(page.root());
  for (const value of ["header", "Deck title", "Deck paragraph", "const x = 1;", "/next", "Next", "One item"]) assert.ok(graph.includes(value), value);
  assert.doesNotMatch(graph, /hson-part|%\{/);
  assert.match(page.css.snapshot(), /color:purple/);
  assert.match(page.css.snapshot(), /white-space:pre-wrap/);
}

// This runtime-only adapter accepts proposals solely through the existing never boundary.
function writePartMember<TResult>(
  part: { set: (value: never) => TResult; replace: (value: never) => TResult },
  method: "set" | "replace", value: never,
): TResult {
  return method === "set" ? part.set(value) : part.replace(value);
}

export async function public_parts_cases(check: (name: string, run: () => void | Promise<void>) => Promise<void>) {
  await check("public widened Parts access rejects supplemental Schema without publication", () => {
    const map = hsonLiveMap.fromLibraries({ parts: { parts: { p: { kind: "document", document: "<p/>" } } }, ordinary: { data: 1 } });
    const name: string = "parts", selected = map.parts.must(name), before = map.capture(), schema = selected.schema.get();
    let observations = 0; const stop = map.commits.observe(() => observations++);
    try {
      for (const supplemental of [ANY_DATA, Hson.schema`<type "data" content <p <content <kind "string" document "string">>>>`]) {
        assert.throws(() => Reflect.get(selected.schema, "use")(supplemental), /Part collections do not support supplemental Schema/);
        assert.deepEqual(map.capture(), before); assert.equal(selected.schema.get(), schema); assert.equal(observations, 0);
      }
      map.parts.must("parts").at(["p"]).replace({ kind: "document", document: "<aside/>" });
      assert.equal(map.parts.must("parts").at(["p", "document"]).snap(), "<aside/>");
      assert.equal(map.data.must("ordinary").snap(), 1);
    } finally { stop(); }
  });

  for (const dynamic of [false, true]) await check(`public LiveMap ${dynamic ? "dynamic" : "initial"} Deck composition`, () => {
    // Consumer deliberately precedes its collection in the same batch.
    const definitions = { page: { document: deck }, parts: { parts: deckParts } };
    const map = dynamic ? hsonLiveMap.create() : hsonLiveMap.fromLibraries(definitions);
    if (dynamic) map.addLibraries(definitions);
    const page = map.doc.must("page"), parts = map.parts.must("parts");
    if (page.mode !== "document" || String(parts.mode) === "document") throw Error("Wrong Library family");
    assert.equal(parts.mode, "data-object");
    assertDeck(page);
    assert.deepEqual(parts.snap(), deckParts);
    assert.throws(() => page.render(), /browser-parser realization/);
    if (!dynamic) {
      assert.throws(() => map.capture(), /Echo\/checkpoint|scoped/i);
    }
  });

  for (const ownership of ["private", "shared"] as const) {
    for (const destination of ownership === "private" ? ["private", "shared"] as const : ["shared"] as const) {
      for (const admission of ["initial", "dynamic", "same-batch"] as const) {
        await check(`public Locus ${ownership} Parts to ${destination} document via ${admission}`, async () => {
          const collection = { name: "parts", definition: { parts: deckParts } };
          // Hosted incremental styled topology retains its existing correspondence guard.
          const page = { name: "page", definition: { document: admission === "initial" ? deck : plain } };
          const groups: { private: LocusAuthorityLibraryDefinition[]; shared: LocusAuthorityLibraryDefinition[] } = { private: [], shared: [] };
          if (admission !== "same-batch") groups[ownership].push(collection);
          if (admission === "initial") groups[destination].unshift(page);
          const locus = hsonLiveMap.locus.create({ ...groups, authorizeProjection: () => ({ libraries: ["parts", "page"] }) });
          try {
            if (admission !== "initial") {
              const additions: typeof groups = { private: [], shared: [] };
              additions[destination].push(page);
              if (admission === "same-batch") additions[ownership].push(collection);
              await locus.addLibraries(additions);
            }
            const selected = locus.doc.must("page"), parts = locus.parts.must("parts");
            if (selected.mode !== "document" || String(parts.mode) === "document") throw Error("Wrong Library family");
            assert.equal(parts.mode, "data-object"); assert.deepEqual(parts.snap(), deckParts);
            if (admission === "initial") assertDeck(selected);
            else assert.match(JSON.stringify(selected.root()), /Dynamic paragraph/);
            if (admission === "initial") {
              assert.throws(() => selected.render(), /browser-parser realization/);
              if (destination === "shared") {
                const hosted = await locus.session.create({ libraries: ["page"] });
                const snapshot = hosted.now().libs;
                const projected = snapshot.libraries.find(entry => entry.name === "page")!;
                assert.equal(projected.scopes!.occurrences.length, 5);
                assert.match(JSON.stringify(projected.css), /purple/);
                assert.doesNotMatch(JSON.stringify(projected.root), /hson-part|%\{/);
                if (ownership === "private") assert.ok(!snapshot.libraries.some(entry => entry.name === "parts"));
                assert.throws(() => hosted.now({ html: "page" }), /browser-parser realization/);
              }
            }
            // Project definitions independently; private definitions must remain private.
            const session = await locus.session.create({ libraries: ["parts"] });
            const names = session.now().libs.libraries.map(entry => entry.name);
            assert.deepEqual(names, ownership === "shared" ? ["parts"] : []);
            if (ownership === "private") assert.doesNotMatch(JSON.stringify(session.now()), /Deck title|%\{title\}|color:purple/);
          } finally { locus.dispose(); }
        });
      }
    }
  }

  await check("public admission rejects malformed collections and mixed families atomically", async () => {
    const map = hsonLiveMap.fromLibraries({ state: { data: 1 } });
    const locus = hsonLiveMap.locus.create({ shared: [{ name: "state", definition: { data: 1 } }] });
    let mapEvents = 0, locusEvents = 0;
    map.commits.observe(() => mapEvents++); locus.commits.observe(() => locusEvents++);
    const bad: unknown[] = [null, [], 1, "{}", { x: null }, { x: { kind: "data", document: "<p/>" } },
      { x: { kind: "document", document: 1 } }, { x: { kind: "document", document: "<p" } },
      { x: { kind: "document", document: "<p/><p/>" } }, { x: { kind: "document", document: "<p/>", css: 1 } },
      { x: { kind: "document", document: "<p/>", css: undefined } },
      { x: { kind: "document", document: "<p/>", schema: {} } },
      { good: deckParts.para, late: { kind: "document", document: "<p" } }];
    try {
      for (const parts of bad) {
        const invalid = { parts };
        // Deliberately exercise runtime admission of untyped external input.
        assert.throws(() => hsonLiveMap.fromLibraries({ invalid } as LiveMapDefinitions));
        assert.throws(() => hsonLiveMap.locus.create({ private: [{ name: "invalid", definition: invalid }] } as never));
        const before = map.capture(), revision = locus.rev;
        assert.throws(() => map.addLibraries({ earlier: { data: 2 }, invalid } as LiveMapDefinitions));
        await assert.rejects(locus.addLibraries({ shared: [{ name: "earlier", definition: { data: 2 } },
          { name: "invalid", definition: invalid }] } as never));
        assert.deepEqual(map.capture(), before); assert.equal(locus.rev, revision);
        assert.throws(() => locus.data.must("earlier")); assert.throws(() => locus.data.must("invalid"));
      }
      for (const invalid of [{ parts: deckParts, data: {} }, { parts: deckParts, document: "<p/>" }, { parts: deckParts, schema: ANY_DOCUMENT }]) {
        assert.throws(() => map.addLibraries({ invalid } as never));
      }
      assert.equal(mapEvents, 0); assert.equal(locusEvents, 0);
    } finally { locus.dispose(); }
  });

  await check("public Parts reject supplemental Schemas at every admission surface atomically", async () => {
    const custom = Hson.schema`<type "data" content <para <content <kind "string" document "string">>>>`;
    const map = hsonLiveMap.fromLibraries({ state: { data: 1 } });
    const locus = hsonLiveMap.locus.create({ shared: [{ name: "state", definition: { data: 1 } }] });
    let mapEvents = 0, locusEvents = 0;
    map.commits.observe(() => mapEvents++); locus.commits.observe(() => locusEvents++);
    const message = /Parts Library definitions do not support a supplemental Schema/;
    try {
      for (const schema of [ANY_DATA, ANY_DOCUMENT, custom, undefined, null, {}]) {
        // Includes the formerly accepted ANY_DATA and compatible custom Schema.
        const definition = { parts: { para: deckParts.para }, schema };
        assert.throws(() => hsonLiveMap.fromLibraries({ parts: definition } as never), message);
        for (const ownership of ["private", "shared"] as const) {
          assert.throws(() => hsonLiveMap.locus.create({ [ownership]: [{ name: "parts", definition }] } as never), message);
          const before = map.capture(), revision = locus.rev;
          assert.throws(() => map.addLibraries({ earlier: { data: 2 }, parts: definition } as never), message);
          await assert.rejects(locus.addLibraries({ [ownership]: [
            { name: "earlier", definition: { data: 2 } }, { name: "parts", definition },
          ] } as never), message);
          assert.deepEqual(map.capture(), before); assert.equal(locus.rev, revision);
          assert.throws(() => locus.data.must("earlier")); assert.throws(() => locus.parts.must("parts"));
        }
      }
      // Hidden, inherited, and getter-introduced fields cannot bypass capture.
      const hidden = Object.defineProperty({ parts: deckParts }, "schema", { value: ANY_DATA });
      const inherited = Object.assign(Object.create({ schema: ANY_DATA }), { parts: deckParts });
      const injected = { get parts() {
        Object.defineProperty(this, "schema", { value: ANY_DATA, configurable: true });
        return deckParts;
      } };
      for (const definition of [hidden, inherited, injected]) {
        assert.throws(() => map.addLibraries({ parts: definition }), message);
      }
      assert.equal(mapEvents, 0); assert.equal(locusEvents, 0);
    } finally { locus.dispose(); }
  });

  await check("public Parts reject original own Schema evidence before and after capture", async () => {
    const message = /Parts Library definitions do not support a supplemental Schema/;
    const concealSchema: ProxyHandler<object> = {
      has: (target, key) => key === "schema" ? false : Reflect.has(target, key),
    };
    const map = hsonLiveMap.fromLibraries({ state: { data: { count: 1 }, schema: ANY_DATA } });
    const locus = hsonLiveMap.locus.create({ shared: [{ name: "state", definition: { data: { count: 1 }, schema: ANY_DATA } }] });
    const before = map.capture(), revision = locus.rev, state = locus.data.must("state").snap();
    let mapEvents = 0, locusEvents = 0;
    const stopMap = map.commits.observe(() => mapEvents++), stopLocus = locus.commits.observe(() => locusEvents++);
    try {
      for (const schema of [undefined, ANY_DATA]) {
        const definitions = [
          // Exact reviewer reproducer: own inspection sees what the has trap conceals.
          () => new Proxy(Object.defineProperty({ parts: {} }, "schema", { value: schema, configurable: true }), concealSchema),
          () => Object.defineProperty({ parts: {} }, "schema", { value: schema, configurable: true }),
          () => ({ parts: {}, schema }),
          () => new Proxy({ parts: {}, schema }, concealSchema),
          () => Object.assign(Object.create({ schema }), { parts: {} }),
          // The original gains a non-enumerable field after Object.assign selected its keys.
          () => new Proxy({ get parts() {
            Object.defineProperty(this, "schema", { value: schema, configurable: true });
            return {};
          } }, concealSchema),
          // Reject evidence already present before a getter could erase it during capture.
          () => new Proxy(Object.defineProperty({ get parts() {
            return assert.fail("A forbidden original Schema must reject before reading Parts.");
          } }, "schema", { value: schema, configurable: true }), concealSchema),
        ];
        for (const definition of definitions) {
          assert.throws(() => hsonLiveMap.fromLibraries({ parts: definition() } as never), message);
          assert.throws(() => map.addLibraries({ earlier: { data: 2 }, parts: definition() } as never), message);
          assert.deepEqual(map.capture(), before); assert.equal(mapEvents, 0);
          for (const ownership of ["private", "shared"] as const) {
            assert.throws(() => hsonLiveMap.locus.create({ [ownership]: [{ name: "parts", definition: definition() }] } as never), message);
            await assert.rejects(locus.addLibraries({ [ownership]: [
              { name: "earlier", definition: { data: 2 } }, { name: "parts", definition: definition() },
            ] } as never), message);
            assert.equal(locus.rev, revision); assert.deepEqual(locus.data.must("state").snap(), state);
            assert.throws(() => locus.data.must("earlier")); assert.throws(() => locus.parts.must("parts"));
            assert.equal(locusEvents, 0);
          }
          assert.throws(() => hsonLiveMap.locus.create({ local: [{ name: "parts", initializer: definition() }] } as never), message);
        }
      }
      // Rejected prefixes reserve no names and do not poison subsequent preparation.
      map.addLibraries({ earlier: { data: 2 }, parts: { parts: {} }, page: { document: "<main/>", schema: ANY_DOCUMENT } });
      await locus.addLibraries({ private: [
        { name: "earlier", definition: { data: 2 } }, { name: "parts", definition: { parts: {} } },
        { name: "page", definition: { document: "<main/>", schema: ANY_DOCUMENT } },
      ] });
      const parts = map.parts.must("parts"), authorityParts = locus.parts.must("parts");
      if (String(parts.mode) === "document" || String(authorityParts.mode) === "document") throw Error("Expected data Libraries");
      assert.deepEqual(parts.snap(), {}); assert.deepEqual(authorityParts.snap(), {});
      assert.equal(map.data.must("state").schema.get(), ANY_DATA);
      assert.equal(map.doc.must("page").schema.get(), ANY_DOCUMENT);
      assert.equal(locus.data.must("state").schema.get(), ANY_DATA);
      assert.equal(locus.doc.must("page").schema.get(), ANY_DOCUMENT);
      assert.equal(mapEvents, 1); assert.equal(locusEvents, 1);
      const valid = hsonLiveMap.locus.create({ local: [{ name: "parts", initializer: { parts: {} } }] });
      valid.dispose();
    } finally { stopMap(); stopLocus(); locus.dispose(); }
  });

  for (const boundary of ["schema getter", "Parts ownKeys"] as const) {
    for (const schema of [undefined, ANY_DATA]) {
      for (const route of ["LiveMap", "private Locus", "shared Locus"] as const) {
        for (const dynamic of [false, true]) {
          await check(`public Parts capture closure: ${boundary}, schema ${schema === undefined ? "undefined" : "ANY_DATA"}, ${dynamic ? "dynamic" : "initial"} ${route}`, async () => {
            let injected = 0;
            const target: Record<string, unknown> = { parts: { para: deckParts.para } };
            const inject = () => {
              injected++;
              Object.defineProperty(target, "schema", { value: schema, configurable: true });
            };
            const definition = new Proxy(target, {
              has: (target, key) => key === "schema" ? false : Reflect.has(target, key),
              get(target, key, receiver) {
                if (boundary === "schema getter" && key === "schema") { inject(); return undefined; }
                return Reflect.get(target, key, receiver);
              },
            });
            if (boundary === "Parts ownKeys") target.parts = new Proxy({ para: deckParts.para }, {
              ownKeys(target) { inject(); return Reflect.ownKeys(target); },
            });
            const message = /Parts Library definitions do not support a supplemental Schema/;
            const legitimate = { earlier: { data: 2, schema: ANY_DATA }, parts: { parts: { para: deckParts.para } },
              page: { document: "<main/>", schema: ANY_DOCUMENT } };
            if (route === "LiveMap") {
              const map = hsonLiveMap.fromLibraries({ state: { data: { count: 1 } } });
              const before = map.capture(), revision = map.rev;
              let commits = 0, watches = 0;
              const stop = map.commits.observe(() => commits++), unwatch = map.data.must("state").at([]).watch(() => watches++);
              try {
                const invalid = { earlier: legitimate.earlier, page: legitimate.page, parts: definition };
                if (dynamic) assert.throws(() => map.addLibraries(invalid as never), message);
                else assert.throws(() => hsonLiveMap.fromLibraries(invalid as never), message);
                assert.ok(injected > 0, "The late caller-controlled capture boundary must run.");
                assert.deepEqual(map.capture(), before); assert.equal(map.rev, revision);
                assert.equal(commits, 0); assert.equal(watches, 0);
                for (const name of ["earlier", "parts", "page"]) assert.throws(() => map.data.must(name));
                const admitted = dynamic ? (map.addLibraries(legitimate), map) : hsonLiveMap.fromLibraries(legitimate);
                const parts = admitted.parts.must("parts");
                if (String(parts.mode) === "document") throw Error("Expected data Library");
                assert.deepEqual(parts.snap(), { para: deckParts.para });
                assert.equal(admitted.data.must("earlier").schema.get(), ANY_DATA);
                assert.equal(admitted.doc.must("page").schema.get(), ANY_DOCUMENT);
                assert.equal(commits, dynamic ? 1 : 0); assert.equal(watches, 0);
              } finally { stop(); unwatch(); }
            } else {
              const ownership = route === "private Locus" ? "private" : "shared";
              const locus = hsonLiveMap.locus.create({ shared: [{ name: "state", definition: { data: { count: 1 } } }] });
              // Inspect this valid authority through the same public runtime that created it.
              const before = locus.cut().libs, revision = locus.rev;
              const state = locus.data.must("state");
              if (!("snap" in state)) throw Error("Expected data Library");
              let commits = 0, watches = 0;
              const stop = locus.commits.observe(() => commits++), unwatch = state.at([]).watch(() => watches++);
              try {
                const invalid = { [ownership]: [{ name: "earlier", definition: legitimate.earlier },
                  { name: "page", definition: legitimate.page }, { name: "parts", definition }] };
                if (dynamic) await assert.rejects(locus.addLibraries(invalid as never), message);
                else assert.throws(() => hsonLiveMap.locus.create(invalid as never), message);
                assert.ok(injected > 0, "The late caller-controlled capture boundary must run.");
                assert.deepEqual(locus.cut().libs, before); assert.equal(locus.rev, revision);
                assert.equal(commits, 0); assert.equal(watches, 0);
                for (const name of ["earlier", "parts", "page"]) assert.throws(() => locus.data.must(name));
                const valid = { [ownership]: Object.entries(legitimate).map(([name, definition]) => ({ name, definition })) };
                const admitted = dynamic ? (await locus.addLibraries(valid), locus) : hsonLiveMap.locus.create(valid);
                try {
                  const parts = admitted.parts.must("parts");
                  if (String(parts.mode) === "document") throw Error("Expected data Library");
                  assert.deepEqual(parts.snap(), { para: deckParts.para });
                  assert.equal(admitted.data.must("earlier").schema.get(), ANY_DATA);
                  assert.equal(admitted.doc.must("page").schema.get(), ANY_DOCUMENT);
                  assert.equal(commits, dynamic ? 1 : 0); assert.equal(watches, 0);
                } finally { if (!dynamic) admitted.dispose(); }
              } finally { stop(); unwatch(); locus.dispose(); }
            }
          });
        }
      }
    }
  }

  await check("public Parts final validation closes original definition access", async () => {
    for (const dynamic of [false, true]) for (const route of ["LiveMap", "private", "shared"] as const) {
      let captured = false, closed = false;
      const accessible = () => assert.equal(closed, false, "Original definition accessed after final validation.");
      const definition = new Proxy({ parts: new Proxy({ para: deckParts.para }, {
        ownKeys(target) { captured = true; return Reflect.ownKeys(target); },
      }) }, {
        get(target, key, receiver) { accessible(); return Reflect.get(target, key, receiver); },
        getOwnPropertyDescriptor(target, key) { accessible(); return Reflect.getOwnPropertyDescriptor(target, key); },
        ownKeys(target) { accessible(); return Reflect.ownKeys(target); },
        getPrototypeOf(target) { accessible(); return Reflect.getPrototypeOf(target); },
        has(target, key) {
          accessible();
          const present = Reflect.has(target, key);
          if (captured && key === "schema") closed = true;
          return present;
        },
      });
      if (route === "LiveMap") {
        const map = dynamic ? hsonLiveMap.create() : hsonLiveMap.fromLibraries({ parts: definition });
        if (dynamic) map.addLibraries({ parts: definition });
        const parts = map.parts.must("parts");
        if (String(parts.mode) === "document") throw Error("Expected data Library");
        assert.deepEqual(parts.snap(), { para: deckParts.para });
      } else {
        const additions = { [route]: [{ name: "parts", definition }] };
        const locus = hsonLiveMap.locus.create(dynamic ? {} : additions);
        try {
          if (dynamic) await locus.addLibraries(additions);
          const parts = locus.parts.must("parts");
          if (String(parts.mode) === "document") throw Error("Expected data Library");
          assert.deepEqual(parts.snap(), { para: deckParts.para });
        } finally { locus.dispose(); }
      }
      assert.equal(closed, true, "Final validation must follow complete Parts capture.");
    }
  });

  await check("public Parts presence rejection preserves a completed reentrant edit", () => {
    const map = hsonLiveMap.fromLibraries({ state: { data: { count: 1 } } });
    let captured: ReturnType<typeof map.capture> | undefined, observations = 0;
    const stop = map.commits.observe(() => observations++);
    const definition = new Proxy({ get parts() {
      map.data.must("state").at(["count"]).set(2);
      captured = map.capture();
      Object.defineProperty(this, "schema", { value: undefined, configurable: true });
      return {};
    } }, { has: (target, key) => key === "schema" ? false : Reflect.has(target, key) });
    try {
      assert.throws(() => map.addLibraries({ earlier: { data: 2 }, parts: definition }), /Parts Library definitions do not support a supplemental Schema/);
      assert.ok(captured !== undefined); assert.deepEqual(map.capture(), captured); assert.equal(observations, 1);
      map.data.must("state").at(["count"]).set(3);
      map.addLibraries({ earlier: { data: 2 }, parts: { parts: {} } });
      assert.equal(map.data.must("state").at(["count"]).snap(), 3);
      const parts = map.parts.must("parts");
      if (String(parts.mode) === "document") throw Error("Expected data Library");
      assert.deepEqual(parts.snap(), {}); assert.equal(observations, 3);
    } finally { stop(); }
  });

  for (const route of ["LiveMap direct", "LiveMap staged", "Locus direct", "Locus staged"] as const) {
    await check(`public intrinsic Part writes: ${route}`, async () => {
      const map = hsonLiveMap.fromLibraries({ parts: { parts: {} } });
      const locus = hsonLiveMap.locus.create({ private: [{ name: "parts", definition: { parts: {} } }] });
      const governed = route.startsWith("Locus");
      const selected = governed ? locus.parts.must("parts") : map.parts.must("parts");
      let changes = 0;
      const stop = selected.at([]).watch(() => changes++);
      // Unknown values intentionally cross the typed proposal boundary to test runtime enforcement.
      const replace = async (value: unknown) => {
        if (route === "LiveMap direct") map.parts.must("parts").at([]).replace(value as never);
        else if (route === "LiveMap staged") map.batch(writer => { writer.parts.must("parts").at([]).replace(value as never); });
        else if (route === "Locus direct") await locus.parts.must("parts").at([]).replace(value as never);
        else await locus.stage(writer => { writer.parts.must("parts").at([]).replace(value as never); });
      };
      const member = async (method: "set" | "replace", value: unknown) => {
        if (route === "LiveMap direct") writePartMember(map.parts.must("parts").at(["para"]), method, value as never);
        else if (route === "LiveMap staged") map.batch(writer => { writePartMember(writer.parts.must("parts").at(["para"]), method, value as never); });
        else if (route === "Locus direct") await writePartMember(locus.parts.must("parts").at(["para"]), method, value as never);
        else await locus.stage(writer => { writePartMember(writer.parts.must("parts").at(["para"]), method, value as never); });
      };
      const unchanged = async (run: () => Promise<void>) => {
        const before = selected.snap(), revision = selected.rev, observed = changes;
        await assert.rejects(run());
        assert.deepEqual(selected.snap(), before); assert.equal(selected.rev, revision); assert.equal(changes, observed);
      };
      const invalidMembers = [
        { ...deckParts.para, schema: {} }, { ...deckParts.para, schema: undefined },
        { ...deckParts.para, kind: "data" }, { ...deckParts.para, document: 1 },
        { ...deckParts.para, css: 1 }, { ...deckParts.para, css: undefined },
        { ...deckParts.para, extra: "unsupported" }, { ...deckParts.para, document: "<p" },
        { ...deckParts.para, document: "<p/><p/>" },
      ];
      try {
        await replace({ para: deckParts.para });
        await replace({}); assert.deepEqual(selected.snap(), {});
        await replace(deckParts); assert.deepEqual(selected.snap(), deckParts);
        for (const value of [null, 1, "text", [], [deckParts.para]]) await unchanged(() => replace(value));
        for (const invalid of invalidMembers) {
          const extraMember = { ...deckParts, extra: invalid };
          await unchanged(() => replace(extraMember));
          for (const method of ["set", "replace"] as const) await unchanged(() => member(method, invalid));
        }
        await member("replace", { kind: "document", document: '<p "replaced"/>' });
        assert.deepEqual(selected.at(["para"]).snap(), { kind: "document", document: '<p "replaced"/>' });
        await member("set", { css: "p{color:blue}" });
        assert.deepEqual(selected.at(["para"]).snap(), { kind: "document", document: '<p "replaced"/>', css: "p{color:blue}" });
        await member("set", deckParts.para);
        assert.equal(selected.at(["para", "document"]).snap(), deckParts.para.document);
        assert.ok(changes > 0);
        if (route === "LiveMap staged") await unchanged(async () => {
          map.batch(writer => {
            writer.parts.must("parts").at(["para", "document"]).set('<p "valid prefix"/>');
            writer.parts.must("parts").at(["para", "kind"]).set("data" as never);
          });
        });
        if (route === "Locus staged") await unchanged(async () => {
          await locus.stage(writer => {
            writer.parts.must("parts").at(["para", "document"]).set('<p "valid prefix"/>');
            writer.parts.must("parts").at(["para", "kind"]).set("data" as never);
          });
        });
      } finally { stop(); locus.dispose(); }
    });
  }

  await check("ordinary data Libraries retain custom Schema admission and mutation", async () => {
    const schema = Hson.schema`<type "data" content <para <content <kind "string" document "string">>>>`;
    const definition = { data: { para: deckParts.para }, schema };
    const map = hsonLiveMap.fromLibraries({ data: definition });
    const locus = hsonLiveMap.locus.create({ private: [{ name: "data", definition }] });
    try {
      assert.equal(map.data.must("data").schema.get(), schema);
      assert.throws(() => hsonLiveMap.fromLibraries({ data: { data: deckParts, schema } }));
      assert.throws(() => map.data.must("data").at([]).replace({} as never));
      assert.throws(() => map.batch(writer => { writer.data.must("data").at(["para", "document"]).set(1 as never); }));
      const revision = locus.rev;
      await assert.rejects(locus.data.must("data").at([]).replace({} as never));
      await assert.rejects(locus.stage(writer => { writer.data.must("data").at(["para", "document"]).set(1 as never); }));
      assert.equal(locus.rev, revision);
      map.data.must("data").at(["para", "kind"]).set("ordinary");
      map.batch(writer => { writer.data.must("data").at(["para", "document"]).set("not a document"); });
      await locus.data.must("data").at(["para", "kind"]).set("ordinary");
      await locus.stage(writer => { writer.data.must("data").at(["para", "document"]).set("not a document"); });
      assert.deepEqual(locus.data.must("data").snap(), map.data.must("data").snap());
    } finally { locus.dispose(); }
  });

  await check("CSS-free Deck composition uses private Parts and scalar parameters", () => {
    const parts = Object.fromEntries(Object.entries(deckParts).map(([name, part]) => [name, { kind: part.kind, document: part.document }]));
    const locus = hsonLiveMap.locus.create({ private: [{ name: "parts", definition: { parts } }],
      shared: [{ name: "page", definition: { document: deck } }] });
    try {
      const page = locus.doc.must("page");
      for (const value of ["Deck title", "Deck paragraph", "const x = 1;", "/next", "Next", "One item"]) {
        assert.ok(JSON.stringify(page.root()).includes(value), value);
      }
      assert.doesNotMatch(JSON.stringify(page.root()), /hson-part|%\{/);
      assert.equal(page.css.snapshot(), "");
    } finally { locus.dispose(); }
  });

  await check("public Parts capture configuration once and detach definitions", () => {
    for (const dynamic of [false, true]) {
      let reads = 0;
      const parts: { para: { kind: "document"; document: string } } = { para: { ...deckParts.para } };
      const definition = { get parts() { reads++; return parts; } };
      const map = dynamic ? hsonLiveMap.create() : hsonLiveMap.fromLibraries({ parts: definition });
      if (dynamic) map.addLibraries({ parts: definition });
      assert.equal(reads, 1);
      parts.para.document = '<p "caller mutation"/>';
      const selected = map.parts.must("parts");
      if (String(selected.mode) === "document") throw Error("Expected data");
      assert.deepEqual(selected.snap(), { para: deckParts.para });
    }
  });

  await check("public dynamic Locus delivers scoped subject CSS while CSS fragments still require a document shell", async () => {
    const parts = { styled: { kind: "document" as const, document: '<p @:label/>', css: '[hson\\:quad="label"]{color:red}' } };
    const locus = hsonLiveMap.locus.create({ private: [{ name: "parts", definition: { parts } }], authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }) });
    try {
      const revision = locus.rev;
      await locus.addLibraries({ shared: [{ name: "page", definition: {
        document: '<main <hson-part lib="parts" at="styled"/>/>',
      } }] });
      assert.equal(locus.rev, revision + 1);
      const session = await locus.session.create({ libraries: ["page"] });
      const snapshot = session.now().libs;
      assert.deepEqual(snapshot.libraries.map(entry => entry.name), ["page"]);
      assert.equal(snapshot.libraries[0]!.scopes!.occurrences.length, 1);
      assert.match(JSON.stringify(snapshot.libraries[0]!.css), /red/);
      assert.doesNotMatch(JSON.stringify(snapshot), /"name":"parts"|hson-part/);
      assert.throws(() => session.now({ html: "page" }), /browser-parser realization/);
    } finally { locus.dispose(); }
  });

  await check("public resolver distinguishes ineligible Libraries, missing collections, and missing members", async () => {
    const cases = [
      { definitions: { parts: { data: deckParts } }, message: /Library "parts" is not a governed Part collection/ },
      { definitions: {}, message: /Unknown Part collection "parts"/ },
      { definitions: { parts: { parts: {} } }, message: /Unknown Part member.*parts.*para/ },
    ];
    for (const { definitions, message } of cases) {
      assert.throws(() => hsonLiveMap.fromLibraries({ ...definitions, page: { document: plain } } as LiveMapDefinitions), message);
      const map = hsonLiveMap.fromLibraries(definitions as LiveMapDefinitions);
      const before = map.capture();
      assert.throws(() => map.addLibraries({ page: { document: plain } }), message);
      assert.deepEqual(map.capture(), before);
      // Exercise the mutation resolver separately from authored admission.
      map.addLibraries({ page: { document: '<main/>' } });
      const page = map.doc.must("page");
      if (page.mode !== "document") throw Error("Expected document");
      const connector = hsonTransform.fromHson('<hson-part lib="parts" at="para" text="text"/>').toNode().$_content[0];
      assert.ok(typeof connector === "object" && connector !== null);
      assert.throws(() => page.document.content.insert({ kind: "path", path: [] }, 0, connector), message);
      const locus = hsonLiveMap.locus.create({ shared: Object.entries(definitions).map(([name, definition]) => ({ name, definition })) });
      try { await assert.rejects(locus.addLibraries({ shared: [{ name: "page", definition: { document: plain } }] }), message); }
      finally { locus.dispose(); }
    }
  });
}
