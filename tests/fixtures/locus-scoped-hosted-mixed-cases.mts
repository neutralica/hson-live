import assert from "node:assert/strict";
import { hsonLiveMap } from "hson-live/livemap";
import { definition, page, document, receiver, caught, until, node } from "./locus-scoped-hosted-cases.mts";

type Receiver = Awaited<ReturnType<typeof receiver>>;
function classification(all: Receiver, flat: Receiver, occurrences: number) {
  const libraries = all.session.now().libs.libraries;
  assert.equal(libraries.find(entry => entry.name === "flat")!.scopes, undefined);
  assert.equal(libraries.find(entry => entry.name === "page")!.scopes!.occurrences.length, occurrences);
  assert.equal(flat.session.now().libs.libraries[0]!.scopes, undefined);
  assert.match(flat.session.now({ html: "flat" }).html, /<html/);
  assert.match(document(all.echo, "flat").render(), /<html/);
  assert.match(document(flat.echo, "flat").render(), /<html/);
  assert.deepEqual(document(all.echo, "flat").root(), document(flat.echo, "flat").root());
  if (document(all.echo).css.snapshot() === "") assert.equal(document(all.echo).render(), all.session.now({ html: "page" }).html);
  else assert.throws(() => document(all.echo).render(), /browser-parser realization/);
  assert.throws(() => all.echo.parts.must("parts"));
  assert.throws(() => flat.echo.doc.must("page"));
  for (const raw of all.frames) {
    const frame = JSON.parse(raw);
    if (frame.type !== "commit") continue;
    for (const operation of frame.commit.commit.operations) {
      if (operation.library === "flat") {
        assert.ok(operation.domain === "graph" || operation.domain === "css");
        assert.doesNotMatch(JSON.stringify(operation), /"scopes"|"occurrences"|"effect"/);
      }
    }
  }
}

export async function hosted_mixed_cases(check: (name: string, run: () => Promise<void>) => Promise<void>) {
  for (const kind of ["http", "websocket"] as const) {
    await check(`${kind}: atomic mixed graph attributes and CSS preserve flat provenance in either order`, async () => {
      const locus = hsonLiveMap.locus.create(definition[0], definition[1]);
      const all = await receiver(locus, kind, ["page", "flat", "data"]);
      const flat = await receiver(locus, kind, ["flat"]);
      let observations = 0;
      const stop = all.echo.commits.observe(() => observations++);
      try {
        classification(all, flat, 4);
        const left = document(all.echo).q("left")!, right = document(all.echo).q("right")!;
        for (const reverse of [false, true]) for (const round of [0, 1]) {
          for (const mode of ["attributes", "css", "graph"] as const) {
            const title = `${reverse}-${round}-${mode}`, rev = locus.rev;
            await locus.stage(w => {
              const scopedWrite = () => {
                if (mode === "attributes") w.doc.must("page").at([]).asElement().attrs.set("title", title);
                else if (mode === "css") w.doc.must("page").css.sel("main").setProp("color", round ? "blue" : "green");
                else {
                  w.doc.must("page").at([]).asElement().insert(0, node("<aside/>"));
                  w.doc.must("page").at([0]).asElement().attrs.set("title", title);
                }
              };
              const flatWrite = () => {
                if (mode === "attributes") w.doc.must("flat").at([]).asElement().attrs.set("title", title);
                else if (mode === "css") w.doc.must("flat").css.sel("body").setProp("color", round ? "navy" : "teal");
                else {
                  w.doc.must("flat").at([1]).asElement().insert(0, node("<p/>"));
                  w.doc.must("flat").at([1, 0]).asElement().attrs.set("title", title);
                }
              };
              if (reverse) { flatWrite(); scopedWrite(); } else { scopedWrite(); flatWrite(); }
            });
            assert.equal(locus.rev, rev + 1);
            await caught(all.echo, locus); await caught(flat.echo, locus);
            classification(all, flat, 4);
            assert.equal(left.active, true); assert.equal(right.active, true);
            assert.equal(observations, locus.rev);
            if (mode === "graph") {
              assert.equal(document(all.echo).at([0]).asElement()!.attrs.get("title"), title);
              assert.equal(document(flat.echo, "flat").at([1, 0]).asElement()!.attrs.get("title"), title);
            }
          }
          const rev = locus.rev, seen = observations;
          await locus.stage(w => {
            w.doc.must("flat").css.sel("body").setProp("color", round ? "navy" : "teal");
            w.doc.must("page").at([]).asElement().flags.clear("hidden");
            w.doc.must("page").css.sel("main").setProp("color", round ? "blue" : "green");
            w.doc.must("flat").at([]).asElement().flags.clear("hidden");
          });
          assert.equal(locus.rev, rev); assert.equal(observations, seen); classification(all, flat, 4);
        }
        const before = { state: all.session.now(), flat: flat.session.now(), css: document(all.echo).css.snapshot(), observations };
        await assert.rejects(locus.stage(w => {
          w.doc.must("flat").css.clearAll();
          w.doc.must("page").at([0]).replace(node('<hson-part lib="parts" at="panel"/>'));
          w.doc.must("page").css.clearAll();
          w.doc.must("flat").at([99]).asElement().attrs.set("bad", true);
        }));
        assert.deepEqual({ state: all.session.now(), flat: flat.session.now(), css: document(all.echo).css.snapshot(), observations }, before);
        assert.equal(left.active, true); assert.equal(right.active, true);
        await assert.rejects(document(all.echo).at([]).asElement()!.attrs.set("title", "unauthorized"));
        classification(all, flat, 4);
      } finally { stop(); all.dispose(); flat.dispose(); locus.dispose(); }
    });

    await check(`${kind}: scoped-empty provenance and candidate-relative promotion survive replay and fresh receiving`, async () => {
      const locus = hsonLiveMap.locus.create(definition[0], definition[1]);
      const all = await receiver(locus, kind, ["page", "flat"]), flat = await receiver(locus, kind, ["flat"]);
      try {
        const left = document(all.echo).q("left")!, right = document(all.echo).q("right")!;
        const oldCss = document(all.echo).css.snapshot();
        await locus.stage(w => {
          w.doc.must("page").at([1]).delete();
          w.doc.must("page").at([0]).delete();
          w.doc.must("flat").css.sel("body").setProp("color", "red");
        });
        await caught(all.echo, locus); await caught(flat.echo, locus); classification(all, flat, 0);
        assert.equal(left.active, false); assert.equal(right.active, false);
        assert.doesNotMatch(document(all.echo).css.snapshot(), /padding:3px|margin:7px/);
        assert.notEqual(document(all.echo).css.snapshot(), oldCss);
        await locus.stage(w => {
          w.doc.must("flat").at([]).asElement().attrs.set("title", "still-flat");
          w.doc.must("page").at([]).asElement().attrs.set("title", "still-scoped-empty");
        });
        await caught(all.echo, locus); await caught(flat.echo, locus); classification(all, flat, 0);
        await locus.admit({ "later": { ...page, access: "shared" }, "promote": { document: '<main @:promote <i @:gone/>/>', access: "shared" } });
        await caught(all.echo, locus);
        await all.session.update({ libraries: ["page", "flat", "later", "promote"] });
        await until(() => { try { return !!document(all.echo, "promote").q("gone"); } catch { return false; } });
        const gone = document(all.echo, "promote").q("gone")!;
        assert.equal(all.session.now().libs.libraries.find(entry => entry.name === "promote")!.scopes, undefined);
        await locus.stage(w => {
          const promote = w.doc.must("promote");
          if (promote.mode !== "document") throw Error("Expected document");
          promote.css.sel("main").setProp("color", "purple");
          promote.at([0]).delete();
          promote.at([]).asElement().insert(0, node('<hson-part lib="parts" at="panel"/>'));
          promote.at([0]).asElement().attrs.set("title", "candidate-relative");
          w.doc.must("page").at([]).asElement().insert(0, node('<hson-part lib="parts" at="panel"/>'));
          w.doc.must("flat").at([]).asElement().attrs.set("title", "promotion");
          promote.css.sel("main").setProp("color", "purple");
        });
        await caught(all.echo, locus); await caught(flat.echo, locus); classification(all, flat, 2);
        assert.equal(gone.active, false); assert.equal(document(all.echo, "promote").q("gone"), undefined);
        assert.equal(all.session.now().libs.libraries.find(entry => entry.name === "promote")!.scopes!.occurrences.length, 2);
        assert.match(document(all.echo, "promote").css.snapshot(), /color:purple/);
        assert.match(document(all.echo, "promote").css.snapshot(), /padding:3px/);
        assert.equal(document(all.echo, "promote").at([0]).asElement()!.attrs.get("title"), "candidate-relative");
        assert.throws(() => flat.echo.parts.must("later")); assert.throws(() => flat.echo.doc.must("promote"));
        all.echo.disconnect(); await new Promise<void>(resolve => setImmediate(resolve));
        await locus.stage(w => {
          w.doc.must("flat").at([]).asElement().attrs.set("title", "missed-mixed");
          w.doc.must("page").at([0]).replace(node('<hson-part lib="parts" at="panel"/>'));
        });
        all.echo.connect(); await caught(all.echo, locus); await caught(flat.echo, locus);
        assert.equal(all.echo.sync.strategy, "replay"); classification(all, flat, 2);
        const fresh = await receiver(locus, kind, ["page", "flat", "promote"]);
        try {
          classification(fresh, flat, 2);
          assert.deepEqual(document(fresh.echo).root(), document(all.echo).root());
          assert.equal(fresh.session.now().libs.libraries.find(entry => entry.name === "promote")!.scopes!.occurrences.length, 2);
        } finally { fresh.dispose(); }
      } finally { all.dispose(); flat.dispose(); locus.dispose(); }
    });

    await check(`${kind}: ordinary flat effects cannot downgrade active or empty scoped receiving provenance`, async () => {
      for (const empty of [false, true]) {
        const locus = hsonLiveMap.locus.create(definition[0], definition[1]);
        const all = await receiver(locus, kind, ["page", "flat"]), flat = await receiver(locus, kind, ["flat"]);
        try {
          if (empty) {
            await locus.stage(w => { w.doc.must("page").at([1]).delete(); w.doc.must("page").at([0]).delete(); });
            await caught(all.echo, locus); await caught(flat.echo, locus);
          }
          const before = { page: document(all.echo).root(), flat: document(all.echo, "flat").root(),
            css: document(all.echo).css.snapshot(), rev: all.echo.sync.appliedRev };
          let observations = 0;
          const stop = all.echo.commits.observe(() => observations++);
          all.control.transform = raw => {
            const frame = JSON.parse(raw);
            if (frame.type === "commit") {
              const operations = frame.commit.commit.operations;
              const ordinary = operations.find((op: { library: string }) => op.library === "flat");
              frame.commit.commit.operations = operations.map((op: { library: string }) =>
                op.library === "page" ? { ...ordinary, library: "page" } : op);
            }
            return [JSON.stringify(frame)];
          };
          await locus.stage(w => {
            w.doc.must("flat").at([]).asElement().attrs.set("title", "accepted");
            w.doc.must("page").at([]).asElement().attrs.set("title", "accepted");
          });
          await until(() => all.echo.sync.status === "failed");
          assert.deepEqual({ page: document(all.echo).root(), flat: document(all.echo, "flat").root(),
            css: document(all.echo).css.snapshot(), rev: all.echo.sync.appliedRev }, before);
          assert.equal(observations, 0); stop(); delete all.control.transform;
          all.echo.disconnect(); await new Promise<void>(resolve => setImmediate(resolve)); all.echo.connect();
          await caught(all.echo, locus); await caught(flat.echo, locus); classification(all, flat, empty ? 0 : 4);
        } finally { all.dispose(); flat.dispose(); locus.dispose(); }
      }
    });
  }
}
