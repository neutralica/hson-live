// livehost.types.ts


// livehost.types.ts

import type { JsonValue, LiveMap, LivePath, LiveMapOp } from "../../types/index.js";

export type LiveHostId = string;
export type LiveHostSessionId = string;
export type LiveHostActionId = string;
export type LiveHostActionName = string;
export type LiveHostSeq = number;

export type LiveHostDisposer = () => void;

export type LiveHostResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: LiveHostError }>;

export type LiveHostError = Readonly<{
  message: string;
  code?: string;
  path?: LivePath;
  cause?: unknown;
}>;

export type LiveHostSocketLike = Readonly<{
  send: (message: string) => void;
  close: (code?: number, reason?: string) => void;
  onMessage: (listener: (message: string) => void) => LiveHostDisposer | void;
  onClose: (listener: () => void) => LiveHostDisposer | void;
}>;

export type LiveHostClientHelloMessage = Readonly<{
  type: "hello";
  clientId?: LiveHostId;
  lastSeq?: LiveHostSeq;
}>;

export type LiveHostClientActionMessage = Readonly<{
  type: "action";
  id: LiveHostActionId;
  name: LiveHostActionName;
  payload?: JsonValue;
}>;

export type LiveHostClientSubscribeMessage = Readonly<{
  type: "subscribe";
  path: LivePath;
}>;

export type LiveHostClientUnsubscribeMessage = Readonly<{
  type: "unsubscribe";
  path: LivePath;
}>;

export type LiveHostClientMessage =
  | LiveHostClientHelloMessage
  | LiveHostClientActionMessage
  | LiveHostClientSubscribeMessage
  | LiveHostClientUnsubscribeMessage;

export type LiveHostServerHelloMessage = Readonly<{
  type: "hello";
  sessionId: LiveHostSessionId;
  seq: LiveHostSeq;
  snapshot: JsonValue | undefined;
}>;

export type LiveHostServerPatchMessage = Readonly<{
  type: "patch";
  seq: LiveHostSeq;
  ops: readonly LiveMapOp[];
}>;

export type LiveHostServerAckMessage = Readonly<{
  type: "ack";
  id: LiveHostActionId;
  ok: true;
  seq: LiveHostSeq;
}>;

export type LiveHostServerErrorMessage = Readonly<{
  type: "error";
  id?: LiveHostActionId;
  ok?: false;
  seq: LiveHostSeq;
  error: LiveHostError;
}>;

export type LiveHostServerMessage =
  | LiveHostServerHelloMessage
  | LiveHostServerPatchMessage
  | LiveHostServerAckMessage
  | LiveHostServerErrorMessage;

export type LiveHostActionContext = Readonly<{
  map: LiveMap<JsonValue | undefined>;
  seq: LiveHostSeq;
}>;

export type LiveHostActionHandler = (
  ctx: LiveHostActionContext,
  payload: JsonValue | undefined,
  message: LiveHostClientActionMessage,
) => void | Promise<void>;

export type LiveHostActions = Readonly<Record<LiveHostActionName, LiveHostActionHandler>>;

export type LiveHostOptions = Readonly<{
  state?: JsonValue;
  actions?: LiveHostActions;
  sessionId?: LiveHostSessionId | (() => LiveHostSessionId);
}>;

export type LiveHost = Readonly<{
  map: LiveMap<JsonValue | undefined>;
  seq: LiveHostSeq;
  dispatch_action: (message: LiveHostClientActionMessage) => Promise<LiveHostServerMessage>;
  connect: (socket: LiveHostSocketLike) => LiveHostDisposer;
}>;