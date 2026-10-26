import assert from "node:assert/strict";
import { bind_locus_http, continue_hosted_document, hsonLiveMap } from "../../src/index.ts";
import type { EchoFiniteOperationRequest, EchoReplicaTransport } from "../../src/types/echo.transport.types.ts";
import { echo_map_internal, locus_map_internal } from "../../src/internal/governor-maps.ts";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.ts";
import { enumerate_livemap_issued_quids } from "../../src/api/livemap/livemap.identity-epoch.ts";
import { runtime_for_tree } from "../../src/api/livetree/runtime/livetree-runtime.ts";
import { FakeElement, install_fake_document } from "./fake-document.mts";

export function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/** Real public continuation, registry dispatch and production authority queue. */
export async function hosted_css_authority_fixture(writable = true) {
  install_fake_document();
  const locus = hsonLiveMap.locus.create({ page: {
    document: '<html <head/> <body <p @:label/> <span @:other/>/>/>', access: "shared",
  }, privatePage: { document: '<aside @:secret/>', access: "private" },
  unprojected: { document: '<aside @:secret/>', access: "shared" },
  }, { authorizeProjection: () => ({ libraries: ["page"], writableDocuments: writable ? ["page"] : [] }) });
  const session = await locus.session.create({ libraries: ["page"] });
  const binding = bind_locus_http(locus, { endpoint: "/css-authority" });
  const transport = hsonLiveMap.echo.transport.http({ endpoint: "http://css-authority.test/css-authority",
    fetch: (input, init) => binding.handle(new Request(input, init), {}) });
  const actions: EchoFiniteOperationRequest[] = [];
  let loseNextResponse = false;
  let beforeAction = async (_request: EchoFiniteOperationRequest) => {};
  const observed: EchoReplicaTransport = { ...transport, operations: {
    async submit(request, options) {
      if (request.type === "action") { actions.push(request); await beforeAction(request); }
      const result = await transport.operations.submit(request, options);
      if (request.type === "action" && loseNextResponse) {
        loseNextResponse = false;
        return { kind: "uncertain", cause: Error("Lost accepted CSS action response") };
      }
      return result;
    },
  } };
  const root = new FakeElement("html"), head = new FakeElement("head"), body = new FakeElement("body"), label = new FakeElement("p");
  root.appendChild(head); root.appendChild(body); body.appendChild(label);
  body.appendChild(new FakeElement("span"));
  const continuation = await continue_hosted_document({ now: session.now({ html: "page" }), credential: session.credential!,
    transport: observed, root: root as unknown as Element });
  const owner = locus_map_internal(locus), receiver = echo_map_internal(continuation.echo);
  const runtime = runtime_for_tree(continuation.tree);
  const state = () => ({
    owner: owner.capture(), receiver: receiver.capture(), revision: locus.rev,
    ownerIssued: enumerate_livemap_issued_quids(internal_livemap_aggregate_authority(owner).identityEpoch().issued()),
    receiverIssued: enumerate_livemap_issued_quids(internal_livemap_aggregate_authority(receiver).identityEpoch().issued()),
    runtimeIssued: [...runtime.issuedQuids], claims: [...runtime.quidToNode.keys()], pending: [...runtime.pendingQuidClaims.keys()],
  });
  const native = (element: FakeElement = root): unknown => ({ tag: element.localName, attrs: [...element.attrs],
    text: Reflect.get(element, "textContent"), children: element.childNodes.map(child => child instanceof FakeElement ? native(child) : Reflect.get(child, "data")) });
  return { locus, session, transport, continuation, owner, receiver, root, head, label, actions, state, native,
    loseNextActionResponse() { loseNextResponse = true; },
    beforeAction(callback: (request: EchoFiniteOperationRequest) => Promise<void>) { beforeAction = callback; },
    unchanged(before: ReturnType<typeof state>) { assert.deepEqual(state(), before); },
    close() { continuation.dispose(); continuation.echo.dispose(); transport.dispose(); binding.dispose(); locus.dispose(); },
  };
}
