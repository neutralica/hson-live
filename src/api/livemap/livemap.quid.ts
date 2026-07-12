// livemap-quid.ts

/**
 * Experimental identity helpers for LiveMap values.
 *
 * LiveMap QUIDs are operational metadata, not user JSON. They are intended for
 * stable internal references such as subscriptions, patches, schema/proxy error
 * paths, inspector handles, and eventual shared-state addressing.
 *
 * Unlike LiveTree, these helpers do not write identity into a serialized HTML
 * attribute. If LiveMap later exposes identity in raw/export/debug modes, that
 * should be an explicit serializer option rather than the default JSON surface.
 */

export type LiveMapQuid = string;

export type LiveMapQuidOwner = object;

export type LiveMapQuidRef = Readonly<{
    quid: LiveMapQuid;
    owner: LiveMapQuidOwner;
}>;

const LIVEMAP_QUID_PREFIX = "lmq";
const LIVEMAP_QUID_RANDOM_BYTES = 8;

const QUID_TO_OWNER = new Map<LiveMapQuid, LiveMapQuidOwner>();
const OWNER_TO_QUID = new WeakMap<LiveMapQuidOwner, LiveMapQuid>();

function make_random_hex(bytes: number): string {
    const cryptoObject = globalThis.crypto;
    const buffer = new Uint8Array(bytes);
    cryptoObject.getRandomValues(buffer);
    return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function mint_livemap_quid(): LiveMapQuid {
    let quid = `${LIVEMAP_QUID_PREFIX}-${make_random_hex(LIVEMAP_QUID_RANDOM_BYTES)}`;
    while (QUID_TO_OWNER.has(quid)) quid = `${LIVEMAP_QUID_PREFIX}-${make_random_hex(LIVEMAP_QUID_RANDOM_BYTES)}`;
    return quid;
}

function assert_livemap_quid_available(quid: LiveMapQuid, owner: LiveMapQuidOwner): void {
    const registered = QUID_TO_OWNER.get(quid);
    if (!registered || registered === owner) return;
    throw new Error(`Duplicate LiveMap QUID "${quid}" is already registered to another owner.`);
}

/** Returns the claimed QUID for an owner, if one has already been claimed. */
export function get_livemap_quid(owner: LiveMapQuidOwner): LiveMapQuid | undefined {
    return OWNER_TO_QUID.get(owner);
}

/** Returns the current owner for a QUID, if it is registered. */
export function get_livemap_owner(quid: LiveMapQuid): LiveMapQuidOwner | undefined {
    return QUID_TO_OWNER.get(quid);
}

/**
 * Claims a QUID for an object owner.
 *
 * If the owner already has a QUID, that existing identity is returned. If a
 * persisted/imported QUID is supplied, it is accepted only when not claimed by a
 * different owner.
 */
export function ensure_livemap_quid(owner: LiveMapQuidOwner, quid?: LiveMapQuid): LiveMapQuid {
    const existing = OWNER_TO_QUID.get(owner);
    if (existing) return existing;

    const nextQuid = quid ?? mint_livemap_quid();
    assert_livemap_quid_available(nextQuid, owner);

    QUID_TO_OWNER.set(nextQuid, owner);
    OWNER_TO_QUID.set(owner, nextQuid);
    return nextQuid;
}

/**
 * Reindexes an owner from already-known identity metadata.
 *
 * This is intended for clone/import/rebuild flows that intentionally preserve
 * identity. It must not overwrite another live owner.
 */
export function reindex_livemap_quid(owner: LiveMapQuidOwner, quid: LiveMapQuid): void {
    assert_livemap_quid_available(quid, owner);
    QUID_TO_OWNER.set(quid, owner);
    OWNER_TO_QUID.set(owner, quid);
}

/**
 * Drops identity ownership for an object owner.
 *
 * This is an explicit dispose/reset operation, not a normal mutation or path
 * deletion operation. Removing a value from a LiveMap path should not by itself
 * imply that the object can no longer be reused elsewhere.
 */
export function drop_livemap_quid(owner: LiveMapQuidOwner): void {
    const quid = OWNER_TO_QUID.get(owner);
    if (!quid) return;

    if (QUID_TO_OWNER.get(quid) === owner) QUID_TO_OWNER.delete(quid);
    OWNER_TO_QUID.delete(owner);
}

/**
 * Remints identity for an owner and returns the new QUID.
 *
 * Useful for rehydration/import cases where source identity must be stripped so
 * the new owner becomes independent from the source graph.
 */
export function remint_livemap_quid(owner: LiveMapQuidOwner): LiveMapQuid {
    drop_livemap_quid(owner);
    return ensure_livemap_quid(owner);
}

/** Debug-only registry snapshot. Do not use for runtime behavior. */
export function debug_livemap_quids(): readonly LiveMapQuidRef[] {
    return Array.from(QUID_TO_OWNER.entries(), ([quid, owner]) => ({ quid, owner }));
}