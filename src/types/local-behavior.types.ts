import type { ActionArgsOptions } from "../internal/action-args.js";
import type { LiveMap } from "./livemap.types.js";
import type { LocalActionHandler, LocalActionRegistry, LocalActionResult } from "./local-action.types.js";

/** LiveTree supplies the subject type when its declarations are loaded. */
export interface LocalBehaviorSubjectTypes {}

export type LocalBehaviorContext = Readonly<{
  map: LiveMap;
  subject?: LocalBehaviorSubjectTypes extends { subject: infer Subject } ? Subject : unknown;
  // Use the consumer's native Event type when available without requiring an ambient DOM library.
  event?: typeof globalThis extends { Event: { prototype: infer NativeEvent } } ? NativeEvent : unknown;
}>;

export type InteractionLocalBehavior = LocalActionHandler<LocalBehaviorContext>;
export type LocalBehaviorDefinitionOptions = ActionArgsOptions;
export type LocalBehaviorResult = LocalActionResult;

/** The additive executable registry owned by one LiveMap runtime. */
export type InteractionLocalBehaviors = LocalActionRegistry<LocalBehaviorContext>;
