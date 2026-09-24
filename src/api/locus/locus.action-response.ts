import type {
  LocusActionDelivery,
  LocusActionTerminalOutcome,
  LocusClientActionResult,
} from "../../types/locus.protocol.types.js";

/** Shared terminal action response construction for the registry Locus. */
export function make_locus_action_response(
  id: string, outcome: LocusActionTerminalOutcome, requestId?: string,
  delivery?: LocusActionDelivery, attemptId?: string,
): LocusClientActionResult {
  if (outcome.state === "succeeded") {
    return {
      type: "ack", id, ok: true, seq: outcome.seq, completionRev: outcome.completionRev,
      ...(requestId ? { requestId } : {}), ...(attemptId ? { attemptId } : {}),
      ...(delivery ? { delivery } : {}), ...(outcome.result !== undefined ? { result: outcome.result } : {}),
    };
  }
  return {
    type: "error", id, ok: false, seq: outcome.seq, completionRev: outcome.completionRev,
    ...(requestId ? { requestId } : {}), ...(attemptId ? { attemptId } : {}),
    ...(delivery ? { delivery } : {}), error: outcome.error,
  };
}
