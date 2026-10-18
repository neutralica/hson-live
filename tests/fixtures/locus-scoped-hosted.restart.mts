import assert from "node:assert/strict";
import { hsonLiveMap } from "hson-live/livemap";
import { FileCheckpointAdapter } from "../helpers/file-checkpoint-adapter.mts";
import { definition, document, receiver, caught } from "./locus-scoped-hosted-cases.mts";

const [file, baseline] = process.argv.slice(2);
assert.ok(file && baseline);
const source: { rev: number; css: string; incarnation: string } = JSON.parse(baseline);
const locus = await hsonLiveMap.locus.resume({ ...definition, logicalMapId: "h1-restart", persistence: new FileCheckpointAdapter(file) });
assert.equal(locus.rev, source.rev);
assert.equal(locus.incarnationId, source.incarnation, "durable authority position survives; runtime identities do not");
const a = await receiver(locus, "http", ["page", "data", "later", "flat", "bare"]);
const flat = await receiver(locus, "websocket", ["flat"]);
try {
  assert.equal(document(a.echo).at([]).asElement()!.attrs.get("title"), "durable-tail");
  assert.equal(a.session.now().libs.libraries.find(e => e.name === "page")!.scopes!.occurrences.length, 2);
  assert.equal(a.session.now().libs.libraries.find(e => e.name === "later")!.scopes!.occurrences.length, 4);
  assert.equal(a.session.now().libs.libraries.find(e => e.name === "bare")!.scopes!.occurrences.length, 0);
  assert.equal(a.session.now().libs.libraries.find(e => e.name === "flat")!.scopes, undefined);
  assert.equal(document(a.echo, "flat").at([]).asElement()!.attrs.get("title"), "durable-tail");
  assert.match(document(a.echo, "flat").css.snapshot(), /color:maroon/);
  assert.match(flat.session.now({ html: "flat" }).html, /maroon/);
  assert.match(document(flat.echo, "flat").render(), /<html/);
  assert.throws(() => flat.echo.lib("page"));
  assert.match(document(a.echo).css.snapshot(), /color:teal/);
  for (const match of source.css.matchAll(/hson\\:quid="([^"]+)"/g)) assert.ok(!document(a.echo).css.snapshot().includes(match[1]!));
  assert.throws(() => a.echo.lib("parts"));
  await locus.stage(w => {
    w.lib("page").at([]).asElement().attrs.set("title", "after-restart");
    w.lib("bare").css.sel("main").setProp("color", "blue");
    w.lib("flat").at([]).asElement().attrs.set("title", "after-restart");
  });
  await caught(a.echo, locus); await caught(flat.echo, locus);
  assert.equal(document(a.echo).at([]).asElement()!.attrs.get("title"), "after-restart");
  assert.equal(a.session.now().libs.libraries.find(e => e.name === "bare")!.scopes!.occurrences.length, 0);
  assert.equal(flat.session.now().libs.libraries[0]!.scopes, undefined);
  assert.match(flat.session.now({ html: "flat" }).html, /after-restart/);
} finally { a.dispose(); flat.dispose(); locus.dispose(); }
process.stdout.write("h1-restart-ok\n");
