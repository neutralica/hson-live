import { is_persisted_quid } from "../../core/hson-node-quid.js";

/** Immutable issued-QUID state for one exact LiveMap owner epoch. */
export type LiveMapIssuedQuidLedger = Readonly<{
  size: number;
  has: (quid: string) => boolean;
}>;

export type LiveMapIdentityEpochController = Readonly<{
  owner: object;
  current: () => number;
  issued: () => LiveMapIssuedQuidLedger;
  install: (ledger: LiveMapIssuedQuidLedger) => void;
  replace: (activeQuids: Iterable<string>) => void;
}>;

export type LiveMapIdentityEpochAccounting = Readonly<{
  epoch: number;
  issued: number;
}>;

export class LiveMapIdentityEpochError extends Error {
  constructor(
    readonly code: "SAME_EPOCH_QUID_REUSE" | "IDENTITY_EPOCH_INVARIANT",
    message: string,
  ) {
    super(message);
    this.name = "LiveMapIdentityEpochError";
  }
}

const entriesForLedger = new WeakMap<LiveMapIssuedQuidLedger, ReadonlySet<string>>();
const controllerForOwner = new WeakMap<object, LiveMapIdentityEpochController>();

/** Seed a newly created owner epoch from its already validated active claims. */
export function make_livemap_identity_epoch(
  activeQuids: Iterable<string>,
): LiveMapIdentityEpochController {
  const owner = Object.freeze({});
  let epoch = 0;
  let issued = make_livemap_issued_quid_ledger(activeQuids);
  const controller: LiveMapIdentityEpochController = Object.freeze({
    owner,
    current: () => epoch,
    issued: () => issued,
    install: (candidate) => {
      assert_monotonic_ledger(issued, candidate);
      issued = candidate;
    },
    replace: (nextActiveQuids) => {
      const nextEpoch = epoch + 1;
      if (!Number.isSafeInteger(nextEpoch)) {
        throw new Error("LiveMap identity epoch exhausted its local safe-integer counter.");
      }
      const nextIssued = make_livemap_issued_quid_ledger(nextActiveQuids);
      epoch = nextEpoch;
      issued = nextIssued;
    },
  });
  return controller;
}

/** Build one immutable ledger without retaining graph nodes or handles. */
export function make_livemap_issued_quid_ledger(
  quids: Iterable<string>,
): LiveMapIssuedQuidLedger {
  const entries = new Set<string>();
  for (const quid of quids) {
    if (!is_persisted_quid(quid)) {
      throw new LiveMapIdentityEpochError(
        "IDENTITY_EPOCH_INVARIANT",
        "LiveMap issued-QUID state contains a malformed QUID.",
      );
    }
    entries.add(quid);
  }
  const ledger: LiveMapIssuedQuidLedger = Object.freeze({
    size: entries.size,
    has: (quid) => entries.has(quid),
  });
  entriesForLedger.set(ledger, entries);
  return ledger;
}

/**
 * Stage ordinary same-epoch identity state.
 *
 * An already-issued QUID may remain active or move while it is active. Once it
 * leaves the active set, reintroduction is reuse and rejects. New claims extend
 * the immutable ledger; retirement never removes from it.
 */
export function stage_livemap_identity_epoch(
  current: LiveMapIssuedQuidLedger,
  beforeActiveQuids: Iterable<string>,
  afterActiveQuids: Iterable<string>,
): LiveMapIssuedQuidLedger {
  const before = validated_quid_set(beforeActiveQuids);
  const after = validated_quid_set(afterActiveQuids);
  for (const quid of before) {
    if (!current.has(quid)) {
      throw new LiveMapIdentityEpochError(
        "IDENTITY_EPOCH_INVARIANT",
        "An active LiveMap QUID is absent from its owner epoch's issued ledger.",
      );
    }
  }

  const next = new Set(require_ledger_entries(current));
  for (const quid of after) {
    if (current.has(quid) && !before.has(quid)) {
      throw new LiveMapIdentityEpochError(
        "SAME_EPOCH_QUID_REUSE",
        "A retired LiveMap QUID cannot identify another lifetime in the same owner epoch.",
      );
    }
    next.add(quid);
  }
  return make_livemap_issued_quid_ledger(next);
}

/** Exact same-epoch restore retains the monotonic ledger and restores only issued claims. */
export function retain_livemap_identity_epoch(
  current: LiveMapIssuedQuidLedger,
  restoredActiveQuids: Iterable<string>,
): LiveMapIssuedQuidLedger {
  for (const quid of validated_quid_set(restoredActiveQuids)) {
    if (!current.has(quid)) {
      throw new LiveMapIdentityEpochError(
        "IDENTITY_EPOCH_INVARIANT",
        "Same-epoch restoration contains a QUID absent from the living issued ledger.",
      );
    }
  }
  return current;
}

/** Attach internal accounting to a public owner without widening its API. */
export function register_livemap_identity_epoch_owner(
  owner: object,
  controller: LiveMapIdentityEpochController,
): void {
  controllerForOwner.set(owner, controller);
}

/** Narrow deterministic accounting for authoritative Unit 12P tests. */
export function livemap_identity_epoch_accounting(
  owner: object,
): LiveMapIdentityEpochAccounting {
  const controller = controllerForOwner.get(owner);
  if (controller === undefined) {
    throw new LiveMapIdentityEpochError(
      "IDENTITY_EPOCH_INVARIANT",
      "LiveMap owner has no registered identity epoch.",
    );
  }
  return Object.freeze({
    epoch: controller.current(),
    issued: controller.issued().size,
  });
}

function validated_quid_set(quids: Iterable<string>): ReadonlySet<string> {
  const entries = new Set<string>();
  for (const quid of quids) {
    if (!is_persisted_quid(quid)) {
      throw new LiveMapIdentityEpochError(
        "IDENTITY_EPOCH_INVARIANT",
        "LiveMap active identity state contains a malformed QUID.",
      );
    }
    entries.add(quid);
  }
  return entries;
}

function require_ledger_entries(ledger: LiveMapIssuedQuidLedger): ReadonlySet<string> {
  const entries = entriesForLedger.get(ledger);
  if (entries !== undefined) return entries;
  throw new LiveMapIdentityEpochError(
    "IDENTITY_EPOCH_INVARIANT",
    "LiveMap issued-QUID ledger is not owned by this implementation.",
  );
}

function assert_monotonic_ledger(
  current: LiveMapIssuedQuidLedger,
  candidate: LiveMapIssuedQuidLedger,
): void {
  const candidateEntries = require_ledger_entries(candidate);
  for (const quid of require_ledger_entries(current)) {
    if (!candidateEntries.has(quid)) {
      throw new LiveMapIdentityEpochError(
        "IDENTITY_EPOCH_INVARIANT",
        "LiveMap issued-QUID ledger cannot shrink within one owner epoch.",
      );
    }
  }
}
