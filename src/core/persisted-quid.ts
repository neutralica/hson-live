/**
 * Compatibility surface for existing internal codec and type imports.
 * Canonical HsonNode QUID mechanics live in hson-node-quid.ts.
 */
export {
  encode_persisted_quid,
  is_persisted_quid,
  PERSISTED_QUID_ALPHABET,
  PERSISTED_QUID_LENGTH,
  type PersistedQuid,
} from "./hson-node-quid.js";
