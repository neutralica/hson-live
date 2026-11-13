import assert from "node:assert/strict";
import { add_interaction, replace_interaction, remove_interaction, activate_interactions, bind_locus_http, continue_hosted_document, hsonLiveMap, hsonMirror,
  type InteractionDescriptor, type InteractionFailure } from "../src/index.ts";
import { echo_map_internal, locus_map_internal } from "../src/internal/governor-maps.ts";
import { FakeElement, install_fake_document } from "./helpers/fake-document.mts";
import { node } from "./fixtures/locus-scoped-ssr-cases.mts";
import type { EchoReplicaTransport } from "../src/types/echo.transport.types.ts";

install_fake_document();
const listener = Object.freeze({ event: "click", target: "element", capture: false, once: false,
  passive: false, missingTarget: "throw", preventDefault: false, stopPropagation: false,
  stopImmediatePropagation: false } as const);
const subject = (library: string, index: number) => ({ library, path: [0, 0, 1, 0, index] });
const browser = (id: string, library: string, index: number): InteractionDescriptor => ({
  id, subject: subject(library, index), listener, kind: "browser", key: id, args: null,
});
function nativePage(count: number) {
  const root = new FakeElement("html"), head = new FakeElement("head"), body = new FakeElement("body");
  root.appendChild(head); root.appendChild(body);
  const buttons = Array.from({ length: count }, () => new FakeElement("button"));
  for (const button of buttons) body.appendChild(button);
  return { root, body, buttons };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail("Hosted interaction update did not settle");
}
const part = '<hson-part lib="parts" at="button"/>';
const scopedPage = `<html <head/> <body ${part} ${part}/>/>`;

// A non-activated control proves adoption is independently valid. The other
// selections exercise a scoped page and a flat page beside unrelated scopes.
for (const selected of ["control", "page", "flat"] as const) {
  const descriptors: readonly InteractionDescriptor[] = [browser("left", "page", 0), browser("right", "page", 1),
    browser("flat-click", "flat", 0), browser("other-click", "other", 0), browser("hidden-click", "hidden", 0),
    { id: "save", subject: subject("page", 1), listener, kind: "locus", key: "save", payload: { value: 7 } }];
  const actions: unknown[] = [];
  const locus = hsonLiveMap.locus.create({
    parts: { access: "private", parts: { button: { kind: "document", document: '<button hson:part @:root/>' } } },
    page: { access: "shared", document: scopedPage },
    other: { access: "shared", document: `<html <head/> <body ${part}/>/>` },
    flat: { access: "shared", document: '<html <head/> <body <button/>/>/>' },
    hidden: { access: "private", document: scopedPage },
    data: { access: "shared", json: { count: 0 } },
  }, { interactions: descriptors, authorizeProjection: ({ requested }) => requested,
    authorizeAction: ({ action }) => action === "save",
    actions: { save: (_context, payload) => { actions.push(payload); } } });
  const binding = bind_locus_http(locus, { endpoint: "/scoped-interactions" });
  const transport = hsonLiveMap.echo.transport.http({ endpoint: "http://scoped.test/scoped-interactions",
    fetch: (input, init) => binding.handle(new Request(input, init), {}) });
  let loseActionReply = false, uncertainSubmissions = 0;
  const testedTransport: EchoReplicaTransport = { ...transport, operations: { async submit(request, options) {
    const result = await transport.operations.submit(request, options);
    if (loseActionReply && request.type === "action") {
      uncertainSubmissions++;
      return { kind: "uncertain" };
    }
    return result;
  } } };
  const document = selected === "flat" ? "flat" : "page";
  const { root, body, buttons } = nativePage(document === "flat" ? 1 : 2);
  const calls: string[] = [], failures: InteractionFailure[] = [];
  try {
    const session = await locus.session.create({ libraries: ["page", "other", "flat", "data"], systemFeatures: ["interactions"] });
    const now = session.now({ html: document });
    assert.doesNotMatch(JSON.stringify(now), /hidden-click/, "projection omits unauthorized descriptors");
    assert.throws(() => locus_map_internal(locus).capture(), /scoped/i);
    const continuation = await continue_hosted_document({ now, document, credential: session.credential!,
      root: root as unknown as Element, transport: testedTransport,
      ...(selected === "control" ? {} : { interactions: {
        registerActions(actions) {
          for (const id of ["left", "right", "flat-click", "other-click"]) actions.define(id, () => { calls.push(id); });
        },
        onFailure: failure => { failures.push(failure); },
      } }) });
    try {
      const map = echo_map_internal(continuation.echo);
      assert.throws(() => map.capture(), /scoped/i, "activation must not relax portable capture");
      assert.throws(() => continuation.echo.parts.must("parts"));
      assert.throws(() => continuation.echo.doc.must("hidden"));
      assert.equal(continuation.mirror.status, "active");
      assert.equal(continuation.tree.dom.el(), root as unknown as Element);
      if (selected === "control") {
        for (const button of buttons) button.dispatchEvent(new Event("click"));
        assert.deepEqual(calls, []);
        console.log("PASS hosted scoped adoption without activation");
        continue;
      }
      for (const document of [undefined, "missing", "data", "parts", "hidden"]) {
        assert.throws(() => activate_interactions({ map, tree: continuation.tree, document }), /selected document Library/);
      }
      for (const button of buttons) button.dispatchEvent(new Event("click"));
      assert.deepEqual(calls, selected === "page" ? ["left", "right"] : ["flat-click"]);
      if (selected === "page") {
        for (let i = 0; i < 50 && actions.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(actions.length, 1, "scoped Locus descriptor dispatches through hosted activation");
        loseActionReply = true;
        buttons[1].dispatchEvent(new Event("click"));
        await until(() => failures.some(failure => failure.phase === "locus-invocation"));
        assert.equal(actions.length, 2, "a lost reply can follow actual execution");
        assert.equal(uncertainSubmissions, 1, "activation must not retry an uncertain action");
        const cause = failures.find(failure => failure.phase === "locus-invocation")?.cause;
        assert.ok(cause instanceof Error && "delivery" in cause);
        assert.equal(cause.delivery, "uncertain");
        assert.deepEqual(calls, ["left", "right", "right"], "local listeners remain independent of dispatch uncertainty");
        loseActionReply = false; failures.length = 0; calls.length = 2;
        // Reorder the occurrences, then verify their original DOM subjects
        // still invoke their own canonical descriptors at their maintained paths.
        await locus.stage(stage => {
          stage.doc.must("page").at([1]).asElement().move(0, 1);
          add_interaction(stage, browser("temporary", "page", 0));
          replace_interaction(stage, browser("flat-click", "flat", 0));
          remove_interaction(stage, "temporary");
        });
        await until(() => continuation.echo.sync.appliedRev === locus.rev);
        assert.equal(body.childNodes[0], buttons[1]); assert.equal(body.childNodes[1], buttons[0]);
        buttons[0].dispatchEvent(new Event("click")); buttons[1].dispatchEvent(new Event("click"));
        assert.deepEqual(calls, ["left", "right", "left", "right"]);
        await locus.doc.must("page").at([1, 0]).replace(node(part));
        await until(() => continuation.echo.sync.appliedRev === locus.rev);
        const replacement = body.childNodes[0]; assert.ok(replacement instanceof FakeElement);
        assert.notEqual(replacement, buttons[1]);
        buttons[1].dispatchEvent(new Event("click")); replacement.dispatchEvent(new Event("click"));
        buttons[0].dispatchEvent(new Event("click"));
        assert.deepEqual(calls, ["left", "right", "left", "right", "left"]);
        assert.equal(buttons[1].listeners.size, 0, "replacement retires the old subject's listeners");
        await locus.doc.must("page").at([1, 1]).delete();
        await until(() => continuation.echo.sync.appliedRev === locus.rev);
        buttons[0].dispatchEvent(new Event("click"));
        assert.equal(buttons[0].listeners.size, 0, "deletion retires the remaining original subject");
        assert.deepEqual(calls, ["left", "right", "left", "right", "left"]);
      }
      assert.deepEqual(failures.filter(failure => failure.descriptor.subject.library === document), []);
      const beforeDispose = calls.length;
      continuation.dispose();
      for (const button of buttons) button.dispatchEvent(new Event("click"));
      assert.equal(calls.length, beforeDispose);
    } finally { continuation.dispose(); continuation.echo.dispose(); }
  } finally { transport.dispose(); binding.dispose(); locus.dispose(); }
  console.log(`PASS hosted scoped canonical activation: ${selected}`);
}

// Implicit selection still works when the sole public Document is scoped.
{
  const locus = hsonLiveMap.locus.create({ parts: { access: "private", parts: {
    button: { kind: "document", document: '<button hson:part/>' },
  } }, page: { access: "shared", document: scopedPage } }, { interactions: [browser("left", "page", 0)] });
  const map = locus_map_internal(locus);
  const mirror = hsonMirror(map.doc.must("page"));
  map.actions.define("left", () => {});
  const dispose = activate_interactions({ map, tree: mirror.tree });
  dispose(); mirror.dispose(); locus.dispose();
  console.log("PASS sole scoped Document implicit selection");
}
