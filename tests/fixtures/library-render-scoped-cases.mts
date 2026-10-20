import assert from "node:assert/strict";
import { hsonLiveMap } from "hson-live/livemap";
import { definition, page, node } from "./locus-scoped-ssr-cases.mts";

/** Public package entrypoints, also executed inside an actual Worker. */
export async function library_render_scoped_cases(check: (name: string, run: () => Promise<void>) => Promise<void>) {
  await check("Library render works before sessions and matches hosted graph/CSS realization", async () => {
    const locus = hsonLiveMap.locus.create(definition);
    try {
      const rendered = new Map<string, string>();
      for (const name of ["page", "flat", "bare"] as const) rendered.set(name, locus.doc.must(name).render());
      assert.equal(rendered.get("bare"), '<main><aside>Bare</aside></main>');
      assert.match(rendered.get("page")!, /border:3px solid black/);
      assert.match(rendered.get("page")!, /padding:7px/);
      assert.match(rendered.get("page")!, /@keyframes pulse/);
      assert.match(rendered.get("flat")!, /color:navy/);
      assert.equal(locus.rev, 0);
      const session = await locus.session.create({ libraries: ["page", "flat", "bare"] });
      for (const [name, html] of rendered) assert.equal(html, session.now({ html: name }).html);
      await locus.stage(w => {
        w.doc.must("page").css.sel("#outside").setProp("background-color", "orange");
        w.doc.must("page").css.sel("#left button").setProp("padding", "11px");
      });
      const styled = locus.doc.must("page").render();
      assert.equal(styled, session.now({ html: "page" }).html);
      assert.match(styled, /background-color:orange/);
      assert.match(styled, /padding:11px/);
      assert.doesNotMatch(styled, /hson:quid|PRIVATE_|hson-part/);
      const cut = session.now({ html: "page" });
      const subjects = cut.libs.libraries.find(e => e.name === "page")!.scopes!.subjects;
      for (const subject of subjects) assert.equal(styled.split(`hson:quad="${subject.name}"`).length, 2);
      await locus.addLibraries({ shared: [{ name: "later", definition: page },
        { name: "one", definition: { document: '<html <head/> <body <hson-part lib="parts" at="leaf"/>/>/>' } }] });
      const later = locus.doc.must("later"), one = locus.doc.must("one");
      if (String(later.mode) !== "document" || one.mode !== "document") throw Error("Expected documents");
      // Dynamic Libraries render before any session selects them.
      const laterHtml = later.render(), oneHtml = one.render();
      await session.update({ libraries: ["page", "later", "one"] });
      assert.equal(laterHtml, session.now({ html: "later" }).html);
      assert.equal(oneHtml, session.now({ html: "one" }).html);
      assert.match(oneHtml, /padding:7px/);
      await locus.stage(w => { w.doc.must("page").at([1,2]).delete(); w.doc.must("page").at([1,1]).delete(); w.doc.must("page").at([1,0]).delete(); });
      const empty = session.now({ html: "page" });
      assert.equal(empty.libs.libraries.find(e => e.name === "page")!.scopes!.occurrences.length, 0);
      assert.equal(locus.doc.must("page").render(), empty.html);
      assert.doesNotMatch(empty.html, /@scope|padding:7px|border:3px/);
      // CSS-free scoped documents need no HTML shell; CSS-bearing ones do.
      await locus.addLibraries({ shared: [{ name: "badShell", definition: { document: '<main <hson-part lib="parts" at="leaf"/>/>' } },
        { name: "badParser", definition: { document: '<p <div/>/>' } }] });
      for (const name of ["badShell", "badParser"]) {
        const library = locus.doc.must(name);
        if (library.mode !== "document") throw Error("Expected document");
        const root = library.root(), css = library.css.snapshot();
        const revision: number = locus.rev;
        assert.throws(() => library.render(), /browser-parser realization/);
        assert.deepEqual(library.root(), root); assert.equal(library.css.snapshot(), css); assert.equal(locus.rev, revision);
      }
      await locus.stage(w => { w.doc.must("page").at([1]).asElement().insert(0, node('<hson-part lib="parts" at="panel" id="returned"/>')); });
      assert.equal(locus.doc.must("page").render(), session.now({ html: "page" }).html);
    } finally { locus.dispose(); }
  });
}
