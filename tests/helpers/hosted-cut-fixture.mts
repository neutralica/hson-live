import { Hson, hsonLiveMap, hsonLocus, encode_ssr_bootstrap, decode_ssr_bootstrap, type HsonSchema } from "../../src/index.ts";
import type { LocusSocketLike } from "../../src/types/locus.types.ts";

const Page: HsonSchema = Hson.schema`<type "document" tag "main" content <sequence [<tag "p" content "string">]>>`;
const Data: HsonSchema = Hson.schema`<type "data" content <value "string">>`;

/** Identical server-side SSR composition in Node and a Worker isolate. */
export function hosted_cut_fixture() {
  const map = hsonLiveMap.fromLibraries({
    page: { document: '<main <p "WORKER_PERMITTED_SENTINEL"/>/>', schema: Page },
    data: { data: { value: "WORKER_DATA_SENTINEL" }, schema: Data },
    private: { data: { value: "WORKER_PRIVATE_SENTINEL" }, schema: Data },
  });
  const locus = hsonLocus.create({ map, logicalMapId: "worker-projection-map", incarnationId: "worker-projection-incarnation",
    exposure: [{ library: "page", exposure: "client-public" }, { library: "data", exposure: "client-public" },
      { library: "private", exposure: "server-private" }],
    authorizeProjection: () => ({ libraries: ["page", "data"] }),
  });
  let receive: ((raw: string) => void) | undefined;
  let sessionId: string | undefined;
  const socket: LocusSocketLike = {
    send(raw) { const message = JSON.parse(raw); if (message.type === "session-created") sessionId = message.sessionId; },
    close() {}, onMessage(listener) { receive = listener; return () => { receive = undefined; }; },
    onClose() { return () => {}; },
  };
  const disconnect = locus.connect(socket);
  receive?.(JSON.stringify({ type: "session-create", id: "worker-ssr",
    projection: { libraries: ["data"], htmlDocument: "page" } }));
  if (sessionId === undefined) throw new Error("Worker SSR session was not created.");
  const cut = locus.cut(sessionId);
  const encoded = encode_ssr_bootstrap(cut.data);
  const decoded = decode_ssr_bootstrap(encoded);
  disconnect();
  locus.dispose();
  return { cut, encoded, decoded, hasDocument: "document" in globalThis };
}
