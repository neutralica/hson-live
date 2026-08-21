import { create_locus_client } from "./locus.client.js";
import { create_locus } from "./locus.core.js";
import { make_locus_canonical_stream } from "./locus.history.js";
import { decode_locus_message, encode_locus_message } from "./locus.protocol.js";
import { make_locus_recovery_planner } from "./locus.recovery.js";
import { make_locus_sync_manager } from "./locus.sync.js";

/** Stable one-map namespace shared by `hson.locus` and `hson-live/locus`. */
export const hsonLocus = Object.freeze({
  create: create_locus,
  client: create_locus_client,
  protocol: Object.freeze({
    decode: decode_locus_message,
    encode: encode_locus_message,
  }),
  debug: Object.freeze({
    canonicalStream: make_locus_canonical_stream,
    recoveryPlanner: make_locus_recovery_planner,
    syncManager: make_locus_sync_manager,
  }),
});
