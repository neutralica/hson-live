/** Failure phase for deterministic SSR bootstrap encoding or decoding. */
export class SsrBootstrapEncodingError extends Error {
  public constructor(
    public readonly phase: "encode" | "decode",
    public readonly code:
      | "SSR_BOOTSTRAP_INPUT_INVALID"
      | "SSR_BOOTSTRAP_TOO_LARGE"
      | "SSR_BOOTSTRAP_MALFORMED"
      | "SSR_BOOTSTRAP_FORMAT_UNSUPPORTED"
      | "SSR_BOOTSTRAP_VERSION_UNSUPPORTED"
      | "SSR_BOOTSTRAP_KIND_UNSUPPORTED"
      | "SSR_BOOTSTRAP_PAYLOAD_INVALID"
      | "SSR_BOOTSTRAP_NON_CANONICAL",
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "SsrBootstrapEncodingError";
  }
}
