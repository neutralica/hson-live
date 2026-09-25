import type { CssPseudoKey } from "../../core/style.types.js";

/** Shared selector suffix for runtime and portable global pseudo rules. */
export function pseudo_to_suffix(p: CssPseudoKey): string {
  switch (p) {
    case "_hover": return ":hover";
    case "_active": return ":active";
    case "_focus": return ":focus";
    case "_focusWithin": return ":focus-within";
    case "_focusVisible": return ":focus-visible";
    case "_visited": return ":visited";
    case "_disabled": return ":disabled";
    case "_checked": return ":checked";
    case "__before": return "::before";
    case "__after": return "::after";
  }
}
