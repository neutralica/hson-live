import { flat_correspondence_cases } from "./flat-correspondence-cases.mts";
import { flat_transaction_cases } from "./flat-transaction-cases.mts";
import assert from "node:assert/strict";
import { hsonLiveMap, bind_locus_http, continue_hosted_document } from "../../src/index.ts";
import { FakeElement, FakeText, install_fake_document } from "../helpers/fake-document.mts";
import { get_node_for_el } from "../../src/api/livetree/utils/node-map-helpers.ts";
import { set_hosted_startup_fault_hook_for_tests } from "../../src/api/continuation/continue-hosted-document.ts";
import { echo_receiving_document_handoff_internal } from "../../src/api/echo/echo.replica-preparation.ts";
import type { EchoReplicaTransport } from "../../src/types/echo.transport.types.ts";
import { node } from "./locus-scoped-ssr-cases.mts";

export async function hosted_h3b_cases(check: (name: string, run: () => Promise<void>) => Promise<void>) {
  await flat_correspondence_cases(check);
  await flat_transaction_cases(check);
  install_fake_document();
  for (const failure of ["none", "recovered", "publish", "cleanup"] as const) {
    await check(`scoped continuation, introduced identities and ${failure} startup rollback`, async () => {
      const locus = hsonLiveMap.locus.create({ "parts": { parts: { item: { kind: "document", document: '<b hson:part @:root <span @:label "Original"/>/>' } }, access: "private" }, "page": { document: '<main @:root <hson-part @:left lib="parts" at="item"/> <hson-part @:right lib="parts" at="item"/>/>', access: "shared" }, "flat": { document: '<main <i/>/>', access: "shared" } }, { authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }) });
      const session = await locus.session.create({ libraries: ["page", "flat"] });
      const now = session.now({ html: "page" });
      const root = new FakeElement("main"), left = new FakeElement("b"), right = new FakeElement("b");
      const label = new FakeElement("span"), rightLabel = new FakeElement("span");
      const text = new FakeText("Original"), rightText = new FakeText("Original");
      label.appendChild(text); rightLabel.appendChild(rightText); left.appendChild(label); right.appendChild(rightLabel);
      root.appendChild(left); root.appendChild(right);
      const binding = bind_locus_http(locus, { endpoint: "/h3b" });
      const http = hsonLiveMap.echo.transport.http({ endpoint: "http://h3b.test/h3b",
        fetch: (input, init) => binding.handle(new Request(input, init), {}) });
      let subscriptions = 0, inject = failure !== "none", replaySeen = false;
      const transport: EchoReplicaTransport = { operations: http.operations, attachment: http.attachment,
        synchronization: { async open(request, observer, options) {
          subscriptions++; let active = true;
          const finish = () => { if (active) { active = false; subscriptions--; } };
          const subscription = await http.synchronization.open(request, {
            onOutput: observer.onOutput, onEnd(end) { finish(); observer.onEnd(end); },
          }, options);
          return { cancel() { finish(); subscription.cancel();
            if (inject && failure === "cleanup") throw Error("Injected cleanup failure"); } };
        } } };
      const options = { now, credential: session.credential!, root: root as unknown as Element, transport };
      try {
        await locus.stage(w => {
          w.doc.must("page").at([0]).asElement().attrs.set("title", "recovered");
          w.doc.must("page").at([0,0,0]).replace("Changed");
          w.doc.must("page").at([1]).delete();
          w.doc.must("page").at([]).asElement().insert(1, node('<hson-part lib="parts" at="item"/>'));
        });
        set_hosted_startup_fault_hook_for_tests((point, echo) => {
          if (point === "recovered") {
            const current = root.childNodes[0]; assert.ok(current instanceof FakeElement);
            assert.equal(current.getAttribute("title"), "recovered");
            const span = current.childNodes[0]; assert.ok(span instanceof FakeElement);
            const value = span.childNodes[0]; assert.ok(value instanceof FakeText);
            assert.equal(value.data, "Changed"); assert.equal(right.parentNode, undefined);
            assert.equal(echo.rev, locus.rev); replaySeen = true;
          }
          if (inject && (point === failure || failure === "cleanup" && point === "recovered")) throw Error("Injected late startup failure");
        });
        if (inject) {
          await assert.rejects(continue_hosted_document(options));
          assert.equal(replaySeen, true);
          assert.equal(left.getAttribute("title"), null); assert.equal(text.data, "Original");
          assert.equal(root.childNodes.length, 2); assert.equal(root.childNodes[0], left); assert.equal(root.childNodes[1], right);
          for (const element of [root,left,right,label,rightLabel]) {
            assert.equal(element.hasAttribute("hson:quid"), false);
            assert.equal(get_node_for_el(element as unknown as Element), undefined);
          }
          assert.equal(subscriptions, 0); inject = false;
        }
        set_hosted_startup_fault_hook_for_tests(undefined);
        const continuation = await continue_hosted_document(options);
        assert.equal(continuation.tree.dom.el(), root as unknown as Element);
        assert.equal(continuation.mirror.status, "active");
        assert.equal(continuation.echo.rev, locus.rev);
        assert.throws(() => echo_receiving_document_handoff_internal(continuation.echo).prepare("page"), /expired|changed during capture/);
        assert.equal(continuation.map.q("left")?.active, true);
        assert.equal(continuation.map.q("right"), undefined);
        const inserted = root.childNodes[1]; assert.ok(inserted instanceof FakeElement);
        assert.ok(inserted.getAttribute("hson:quid"));
        assert.equal(continuation.tree.find.byQuid(inserted.getAttribute("hson:quid")!)?.dom.el(), inserted as unknown as Element);
        continuation.dispose(); continuation.echo.dispose(); assert.equal(subscriptions, 0);
        // A selected flat document remains flat in a projection also containing scoped state.
        const flat = new FakeElement("main"), child = new FakeElement("i"); flat.appendChild(child);
        const flatSession = await locus.session.create({ libraries: ["page", "flat"] });
        const other = await continue_hosted_document({ ...options, now: flatSession.now({ html: "flat" }),
          credential: flatSession.credential!, root: flat as unknown as Element });
        assert.equal(other.tree.dom.el(), flat as unknown as Element);
        assert.equal(other.mirror.status, "active"); other.dispose(); other.echo.dispose();
      } finally { set_hosted_startup_fault_hook_for_tests(undefined); http.dispose(); binding.dispose(); locus.dispose(); }
    });
  }
}
