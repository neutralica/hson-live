import type { LocusConnectionContext, LocusDisposer } from "../../types/locus.types.js";
import { locus_client_error_message } from "./locus.client-error.js";
import { LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT } from "./locus.aggregate.protocol.js";
import { decode_request, encode_downstream_message } from "./locus.websocket-codec.internal.js";
import { attach_locus_semantic_transport_internal, locus_publication_byte_limit_internal } from "./locus.transport.internal.js";
import { HOSTED_MAX_SNAPSHOT_BYTES } from "../livemap/livemap.hosted.js";
import type { LocusFiniteOperationRequest } from "./locus.transport.internal.js";

/** Physical server-side WebSocket interface; it is not the Locus semantic attachment. */
export type LocusWebSocketLike = Readonly<{
  send(message: string): void;
  close(code?: number, reason?: string): void;
  onMessage(listener: (message: string) => void): LocusDisposer | void;
  onClose(listener: () => void): LocusDisposer | void;
}>;

/** Bind one physical WebSocket to one logical Locus attachment. */
export function bind_locus_websocket(
  locus: object, socket: LocusWebSocketLike, context?: LocusConnectionContext,
): LocusDisposer {
  const limit = locus_publication_byte_limit_internal(locus);
  let stopMessage: LocusDisposer | void;
  let stopClose: LocusDisposer | void;
  let stopSync: LocusDisposer | undefined;
  let closed = false;
  const stopListeners = (): void => { stopMessage?.(); stopClose?.(); };
  const send = (message: unknown, bound = limit): void => {
    if (closed) return;
    try { socket.send(encode_downstream_message(message, bound)); }
    catch { close(); }
  };
  const attachment = attach_locus_semantic_transport_internal(locus, {
    notice: (event) => send(event),
    ...(context === undefined ? {} : { connection: context }),
    onClose: stopListeners,
  });
  const close = (): void => {
    if (closed) return;
    closed = true;
    stopSync?.();
    attachment.close();
    stopListeners();
  };
  try {
    stopMessage = socket.onMessage((raw) => {
      if (closed) return;
      let request: ReturnType<typeof decode_request>;
      try { request = decode_request(raw, limit); }
      catch (cause) {
        socket.send(JSON.stringify(Object.freeze({
          type: "error", format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
          code: "LOCUS_PROTOCOL_INVALID",
          message: locus_client_error_message(cause, "Malformed hosted protocol message."),
        })));
        return;
      }
      if (request.type === "recover") {
        stopSync?.();
        stopSync = attachment.synchronization.open(request, (output) => send(output,
          output.type === "recovery-snapshot" || (output.type === "projection-change" && output.reconciliation !== undefined)
            ? HOSTED_MAX_SNAPSHOT_BYTES : limit), (cause) => {
          if (cause === undefined || closed) return;
          socket.close(1011, "Locus synchronization failed.");
          close();
        });
      } else {
        void attachment.operations.submit(request as LocusFiniteOperationRequest).then((outcome) => send(outcome), () => close());
      }
    });
    stopClose = socket.onClose(close);
  } catch (cause) { close(); throw cause; }
  return close;
}
