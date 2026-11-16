import type { ActionArgsOptions } from "../internal/action-args.js";
import type { LiveMap, LiveMapDocumentLibrary } from "./livemap.types.js";
import type { LocalActionHandler, LocalActionRegistry, LocalActionResult } from "./local-action.types.js";

/** LiveTree supplies the subject type when its declarations are loaded. */
export interface LocalBehaviorSubjectTypes {}

type LocalNativeEvent = typeof globalThis extends { Event: { prototype: infer NativeEvent } } ? NativeEvent : unknown;
type ElementBehaviorSubject = LocalBehaviorSubjectTypes extends { subject: infer Subject } ? Subject : unknown;

/** Event ownership is explicit; direct trigger() supplies only map. */
export type LocalBehaviorContext = Readonly<{ map: LiveMap }> & (
  | Readonly<{ subjectKind?: "element"; subject?: ElementBehaviorSubject; event?: LocalNativeEvent }>
  | Readonly<{ subjectKind: "document"; subject: LiveMapDocumentLibrary; event: LocalNativeEvent }>
);

/** @internal Native context is injected only by canonical activation. */
export type LocalBehaviorEventSource =
  | Readonly<{ subjectKind?: "element"; subject: ElementBehaviorSubject; event: LocalNativeEvent }>
  | Readonly<{ subjectKind: "document"; subject: LiveMapDocumentLibrary; event: LocalNativeEvent }>;

export type InteractionLocalBehavior = LocalActionHandler<LocalBehaviorContext>;
export type LocalBehaviorDefinitionOptions = ActionArgsOptions;
export type LocalBehaviorResult = LocalActionResult;

/** The additive executable registry owned by one LiveMap runtime. */
export type InteractionLocalBehaviors = LocalActionRegistry<LocalBehaviorContext>;
