/** Internal participant in one synchronous map-local identity transaction. */
export type LiveMapRuntimeIdentityReservation = Readonly<{
  apply: () => unknown;
  rollback: () => void;
  release: () => void;
}>;

export type LiveMapRuntimeIdentityParticipant = Readonly<{
  preflight: () => LiveMapRuntimeIdentityReservation;
  realize: () => void;
  rollbackRealization: () => void;
}>;
