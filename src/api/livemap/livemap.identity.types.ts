import type { HsonNode, JsonValue } from "../../core/types.js";
import type {
  LiveMapDocumentCommitTarget,
  LiveMapDocumentPath,
  LivePath,
} from "../../types/livemap.types.js";

/** Package-internal continuity handle for one document node identity. */
export type LiveMapDocumentIdentityHandle = Readonly<{
  readonly active: boolean;
  path: () => LiveMapDocumentPath | undefined;
  snap: () => HsonNode | undefined;
  dispose: () => void;
}>;

/** Package-internal continuity handle for one projected data container. */
export type LiveMapProjectedIdentityHandle<TValue extends JsonValue = JsonValue> = Readonly<{
  readonly active: boolean;
  path: () => LivePath | undefined;
  snap: () => TValue | undefined;
  dispose: () => void;
}>;

/** Package-internal projected target used only for identity registration. */
export type LiveMapProjectedIdentityCommitTarget = Readonly<{
  kind: "path";
  path: LivePath;
  projected: true;
}>;

/** Package-internal identity-registration operation used by continuity authorities. */
export type LiveMapGraphEnsureQuidOp<
  TTarget extends LiveMapDocumentCommitTarget | LiveMapProjectedIdentityCommitTarget = LiveMapDocumentCommitTarget,
> = Readonly<{
  domain: "graph";
  op: "ensure-quid";
  target: TTarget;
  quid: string;
}>;

/** Package-internal data-container identity-registration operation. */
export type LiveMapProjectedGraphEnsureQuidOp = LiveMapGraphEnsureQuidOp<LiveMapProjectedIdentityCommitTarget>;
