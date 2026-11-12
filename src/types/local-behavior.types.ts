import type { HsonDataInput, HsonDataValue } from "../api/data/hson-data.js";
import type { ExecutionInputOptions } from "../internal/execution-input.js";
import type { LiveMap } from "./livemap.types.js";

/** LiveTree supplies the subject type when its declarations are loaded. */
export interface LocalBehaviorSubjectTypes {}

export type LocalBehaviorContext = Readonly<{
  map: LiveMap;
  subject?: LocalBehaviorSubjectTypes extends { subject: infer Subject } ? Subject : unknown;
  // Use the consumer's native Event type when available without requiring an ambient DOM library.
  event?: typeof globalThis extends { Event: { prototype: infer NativeEvent } } ? NativeEvent : unknown;
}>;

export type LocalBehaviorMessage = Readonly<{
  name: string;
  /** Identifies this invocation within the operating LiveMap runtime. */
  id: string;
}>;

export type InteractionLocalBehavior = (
  ctx: LocalBehaviorContext,
  input: HsonDataValue | undefined,
  message: LocalBehaviorMessage,
) => HsonDataInput | void | Promise<HsonDataInput | void>;

export type LocalBehaviorDefinitionOptions = ExecutionInputOptions;

export type LocalBehaviorResult =
  | Readonly<{ ok: true; result?: HsonDataValue }>
  | Readonly<{ ok: false; error: Readonly<{ message: string; cause: unknown }> }>;

/** The additive executable registry owned by one LiveMap runtime. */
export type InteractionLocalBehaviors = Readonly<{
  define: (name: string, handler: InteractionLocalBehavior, options?: LocalBehaviorDefinitionOptions) => void;
  trigger: (name: string, input?: HsonDataInput) => Promise<LocalBehaviorResult>;
}>;
