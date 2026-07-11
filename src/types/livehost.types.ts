// livehost.types.ts

import type { JsonValue, LiveMap, LivePath, LiveMapOp } from "./index.js";

export type LiveHostId = string;
export type LiveHostStoreId = string;
export type LiveHostSessionId = string;
export type LiveHostActionId = string;
export type LiveHostActionName = string;
export type LiveHostSeq = number;

export type LiveHostDisposer = () => void;
export type LiveHostSchemaIssue = string;

export type LiveHostResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: LiveHostError }>;

export type LiveHostError = Readonly<{
  message: string;
  code?: string;
  path?: LivePath;
  cause?: unknown;
}>;

export type LiveHostValidator<TValue> = (value: unknown) => value is TValue;

export type LiveHostSchemaResult<TValue> =
  | Readonly<{ ok: true; value: TValue }>
  | Readonly<{ ok: false; issues: readonly LiveHostSchemaIssue[] }>;

export type LiveHostSchemaDecoder<TValue> = (value: unknown) => LiveHostSchemaResult<TValue>;

export type LiveHostActionPayloads = Readonly<Record<string, JsonValue | undefined>>;

export type LiveHostActionSchema<TPayload extends JsonValue | undefined = JsonValue | undefined> = Readonly<{
  payload?: LiveHostValidator<TPayload> | LiveHostSchemaDecoder<TPayload>;
}>;

export type LiveHostSchema<
  TState extends JsonValue | undefined = JsonValue | undefined,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = Readonly<{
  state?: LiveHostValidator<TState> | LiveHostSchemaDecoder<TState>;
  actions?: Readonly<{
    [TName in keyof TActions & string]?: LiveHostActionSchema<TActions[TName]>;
  }>;
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
  hostId?: LiveHostStoreId;
  lastSeq?: LiveHostSeq;
}>;

export type LiveHostClientActionMessageFor<
  TActions extends LiveHostActionPayloads,
  TName extends keyof TActions & string,
> = undefined extends TActions[TName]
  ? Readonly<{
    type: "action";
    id: LiveHostActionId;
    name: TName;
    payload?: TActions[TName];
  }>
  : Readonly<{
    type: "action";
    id: LiveHostActionId;
    name: TName;
    payload: TActions[TName];
  }>;

export type LiveHostClientActionMessage<
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = {
  [TName in keyof TActions & string]: LiveHostClientActionMessageFor<TActions, TName>;
}[keyof TActions & string];

export type LiveHostClientSubscribeMessage = Readonly<{
  type: "subscribe";
  path: LivePath;
}>;

export type LiveHostClientUnsubscribeMessage = Readonly<{
  type: "unsubscribe";
  path: LivePath;
}>;

export type LiveHostClientMessage<
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> =
  | LiveHostClientHelloMessage
  | LiveHostClientActionMessage<TActions>
  | LiveHostClientSubscribeMessage
  | LiveHostClientUnsubscribeMessage;

export type LiveHostServerHelloMessage<TState extends JsonValue | undefined = JsonValue | undefined> = Readonly<{
  type: "hello";
  sessionId: LiveHostSessionId;
  seq: LiveHostSeq;
  snapshot: TState;
}>;

export type LiveHostServerPatchMessage = Readonly<{
  type: "patch";
  seq: LiveHostSeq;
  ops: readonly LiveMapOp[];
}>;

export type LiveHostServerSyncMessage<TValue extends JsonValue | undefined = JsonValue | undefined> = Readonly<{
  type: "sync";
  seq: LiveHostSeq;
  path: LivePath;
  value: TValue;
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

export type LiveHostServerMessage<TState extends JsonValue | undefined = JsonValue | undefined> =
  | LiveHostServerHelloMessage<TState>
  | LiveHostServerPatchMessage
  | LiveHostServerSyncMessage
  | LiveHostServerAckMessage
  | LiveHostServerErrorMessage;

export type LiveHostActionContext<TState extends JsonValue | undefined = JsonValue | undefined> = Readonly<{
  map: LiveMap<TState>;
  seq: LiveHostSeq;
}>;

export type LiveHostActionHandler<
  TPayload extends JsonValue | undefined = JsonValue | undefined,
  TState extends JsonValue | undefined = JsonValue | undefined,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = (
  ctx: LiveHostActionContext<TState>,
  payload: TPayload,
  message: LiveHostClientActionMessage<TActions>,
) => void | Promise<void>;

export type LiveHostActions<
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
  TState extends JsonValue | undefined = JsonValue | undefined,
> = Readonly<{
  [TName in keyof TActions & string]: LiveHostActionHandler<TActions[TName], TState, TActions>;
}>;

export type LiveHostOptions<
  TState extends JsonValue | undefined = JsonValue | undefined,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = Readonly<{
  state?: TState;
  actions?: Partial<LiveHostActions<TActions, TState>>;
  schema?: LiveHostSchema<TState, TActions>;
  sessionId?: LiveHostSessionId | (() => LiveHostSessionId);
}>;

export type LiveHostClientActionResult = LiveHostServerAckMessage | LiveHostServerErrorMessage;

export type LiveHostClientActionFn<
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = <TName extends keyof TActions & string>(
  name: TName,
  ...args: undefined extends TActions[TName]
    ? [payload?: TActions[TName]]
    : [payload: TActions[TName]]
) => Promise<LiveHostClientActionResult>;

export type LiveHostClientOptions<
  TState extends JsonValue | undefined = JsonValue | undefined,
> = Readonly<{
  socket: LiveHostSocketLike;
  map?: LiveMap<TState>;
  clientId?: LiveHostId;
  actionId?: () => LiveHostActionId;
}>;

export type LiveHostClient<
  TState extends JsonValue | undefined = JsonValue | undefined,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = Readonly<{
  map: LiveMap<TState>;
  seq: LiveHostSeq;
  connect: () => LiveHostDisposer;
  disconnect: () => void;
  subscribe: (path: LivePath) => void;
  unsubscribe: (path: LivePath) => void;
  action: LiveHostClientActionFn<TActions>;
}>;

export type LiveHost<
  TState extends JsonValue | undefined = JsonValue | undefined,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = Readonly<{
  map: LiveMap<TState>;
  seq: LiveHostSeq;
  schema?: LiveHostSchema<TState, TActions>;
  dispatch_action: (message: LiveHostClientActionMessage<TActions>) => Promise<LiveHostServerMessage<TState>>;
  connect: (socket: LiveHostSocketLike) => LiveHostDisposer;
}>;

export type LiveHostStoreEntry<
  TState extends JsonValue | undefined = JsonValue | undefined,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = Readonly<{
  id: LiveHostStoreId;
  host: LiveHost<TState, TActions>;
}>;

export type LiveHostStoreCreateOptions<
  TState extends JsonValue | undefined = JsonValue | undefined,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = LiveHostOptions<TState, TActions>;

export type LiveHostStore = Readonly<{
  has: (id: LiveHostStoreId) => boolean;
  get: (id: LiveHostStoreId) => LiveHost | undefined;
  create: <
    TState extends JsonValue | undefined = JsonValue | undefined,
    TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
  >(id: LiveHostStoreId, options?: LiveHostStoreCreateOptions<TState, TActions>) => LiveHostResult<LiveHost<TState, TActions>>;
  set: <
    TState extends JsonValue | undefined = JsonValue | undefined,
    TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
  >(id: LiveHostStoreId, host: LiveHost<TState, TActions>) => LiveHostResult<LiveHost<TState, TActions>>;
  delete: (id: LiveHostStoreId) => boolean;
  list: () => readonly LiveHostStoreEntry[];
  connect: (id: LiveHostStoreId, socket: LiveHostSocketLike) => LiveHostResult<LiveHostDisposer>;
}>;