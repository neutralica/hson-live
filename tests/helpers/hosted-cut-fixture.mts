import { authority_groups_from_catalog_fixture, authority_groups_from_map_fixture } from "./locus-definition-fixture.mts";
import { Hson, hsonLiveMap, encode_ssr_bootstrap, decode_ssr_bootstrap, type HsonSchema } from "../../src/index.ts";

const Page: HsonSchema = Hson.schema`<type "document" tag "main" content <sequence [<tag "p" content "string">]>>`;
const Data: HsonSchema = Hson.schema`<type "data" content <value "string">>`;

/** Identical server-side SSR composition in Node and a Worker isolate. */
export async function hosted_cut_fixture() {
  const map = hsonLiveMap.fromLibraries({
    page: { document: '<main <p "WORKER_PERMITTED_SENTINEL"/>/>', schema: Page },
    data: { data: { value: "WORKER_DATA_SENTINEL" }, schema: Data },
    private: { data: { value: "WORKER_PRIVATE_SENTINEL" }, schema: Data },
  });
  const locus = hsonLiveMap.locus.create({ ...authority_groups_from_map_fixture(map, [{ name: "page", ownership: "shared" }, { name: "data", ownership: "shared" },
      { name: "private", ownership: "private" }]), logicalMapId: "worker-projection-map", incarnationId: "worker-projection-incarnation", authorizeProjection: () => ({ libraries: ["page", "data"] }) });
  const session = await locus.session.create({ libraries: ["data", "page"] });
  const cut = session.now({ html: "page" });
  const encoded = encode_ssr_bootstrap(cut);
  const decoded = decode_ssr_bootstrap(encoded);
  locus.dispose();
  return { cut, encoded, decoded, hasDocument: "document" in globalThis };
}
