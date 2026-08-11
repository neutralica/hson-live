import { create_livehost_client } from "./livehost.client.js";
import { create_livehost } from "./livehost.core.js";
import { make_livehost_canonical_stream } from "./livehost.history.js";
import { decode_livehost_message, encode_livehost_message } from "./livehost.protocol.js";
import { make_livehost_recovery_planner } from "./livehost.recovery.js";
import { create_livehost_store } from "./livehost.store.js";
import { make_livehost_sync_manager } from "./livehost.sync.js";

/**
 * Stable LiveHost namespace shared by `hson.liveHost` and the dedicated
 * `hson-live/livehost` entrypoint.
 */
export const hsonLiveHost = Object.freeze({
  create: create_livehost,
  client: create_livehost_client,
  registry: create_livehost_store,
  protocol: Object.freeze({
    decode: decode_livehost_message,
    encode: encode_livehost_message,
  }),
  debug: Object.freeze({
    canonicalStream: make_livehost_canonical_stream,
    recoveryPlanner: make_livehost_recovery_planner,
    syncManager: make_livehost_sync_manager,
  }),
});

/** Backward-compatible alias for the canonical LiveHost facade. */
export const liveHost = hsonLiveHost;
