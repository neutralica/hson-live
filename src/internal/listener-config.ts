import type { InteractionListener } from "../types/interaction.descriptor.types.js";

/** Shared native settings for authored events and Document click registration. */
export const DOCUMENT_CLICK_LISTENER: InteractionListener = Object.freeze({
  event: "click", target: "element", capture: false, once: false, passive: false, missingTarget: "ignore",
  preventDefault: false, stopPropagation: false, stopImmediatePropagation: false,
});
