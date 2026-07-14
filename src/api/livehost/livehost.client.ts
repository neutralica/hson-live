// livehost.client.ts

import { hson } from "../../hson.js";
import {
  LiveHostDisconnectedError,
  LiveHostDuplicateActionIdError,
} from "./livehost.error.js";
import type { JsonValue, LiveMap } from "../../types/index.js";
import type {
  LiveHostActionId,
  LiveHostActionPayloads,
  LiveHostClient,
  LiveHostClientActionMessage,
  LiveHostClientActionResult,
  LiveHostClientMessage,
  LiveHostClientOptions,
  LiveHostDisposer,
  LiveHostEventListener,
  LiveHostId,
  LiveHostSeq,
  LiveHostServerMessage,
} from "../../types/livehost.types.js";
import { decode_livehost_server_message } from "./livehost.protocol.js";

let nextClientId = 0;
let nextActionId = 0;

function make_client_id(): LiveHostId {
  nextClientId += 1;
  return `lhc-${nextClientId}`;
}

function make_action_id(): LiveHostActionId {
  nextActionId += 1;
  return `lha-${nextActionId}`;
}

function decode_server_message(message: string): LiveHostServerMessage | undefined {
  const decoded = decode_livehost_server_message(message);
  return decoded.ok ? decoded.value : undefined;
}

function encode_client_message<TActions extends LiveHostActionPayloads>(message: LiveHostClientMessage<TActions>): string {
  return JSON.stringify(message);
}

type PendingAction = Readonly<{
  resolve: (result: LiveHostClientActionResult) => void;
  reject: (error: LiveHostDisconnectedError) => void;
}>;

function reject_pending_actions(
  pendingActions: Map<LiveHostActionId, PendingAction>,
  error: LiveHostDisconnectedError,
): void {
  const actions = [...pendingActions.values()];
  pendingActions.clear();
  for (const action of actions) action.reject(error);
}

export function create_livehost_client<
  TState extends JsonValue | undefined = JsonValue | undefined,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
>(options: LiveHostClientOptions<TState>): LiveHostClient<TState, TActions> {
  const clientId = options.clientId ?? make_client_id();
  const makeActionId = options.actionId ?? make_action_id;
  const map: LiveMap<TState> = options.map ?? hson.liveMap.fromJson({}) as unknown as LiveMap<TState>;
  const pendingActions = new Map<LiveHostActionId, PendingAction>();
  const eventListeners = new Set<LiveHostEventListener>();
  const disposers: LiveHostDisposer[] = [];
  let seq: LiveHostSeq = 0;
  let isConnected = false;

  function send(message: LiveHostClientMessage<TActions>): void {
    options.socket.send(encode_client_message(message));
  }

  function handle_server_message(message: LiveHostServerMessage): void {
    if (message.type === "event") {
      for (const listener of [...eventListeners]) listener(message);
      return;
    }
    if (message.type === "hello") {
      seq = message.seq;
      map.replace(message.snapshot as never);
      return;
    }

    if (message.type === "sync") {
      seq = message.seq;
      map.set(message.path, message.value as never);
      return;
    }

    if (message.type === "patch") {
      seq = message.seq;
      return;
    }

    if (message.type === "ack" || message.type === "error") {
      seq = message.seq;
      if (!message.id) return;

      const action = pendingActions.get(message.id);
      if (!action) return;

      pendingActions.delete(message.id);
      action.resolve(message);
    }
  }

  function connect(): LiveHostDisposer {
    if (isConnected) return disconnect;
    isConnected = true;

    const stopMessage = options.socket.onMessage((message) => {
      const decoded = decode_server_message(message);
      if (decoded) handle_server_message(decoded);
    });
    if (stopMessage) disposers.push(stopMessage);

    const stopClose = options.socket.onClose(() => {
      disconnect();
    });
    if (stopClose) disposers.push(stopClose);

    send({ type: "hello", clientId, lastSeq: seq });
    return disconnect;
  }

  function disconnect(): void {
    isConnected = false;
    while (disposers.length) disposers.pop()?.();
    reject_pending_actions(pendingActions, new LiveHostDisconnectedError());
  }

  function subscribe(path: readonly (string | number)[]): void {
    send({ type: "subscribe", path: [...path] });
  }

  function unsubscribe(path: readonly (string | number)[]): void {
    send({ type: "unsubscribe", path: [...path] });
  }

  function on_event(listener: LiveHostEventListener): LiveHostDisposer {
    eventListeners.add(listener);
    return () => {
      eventListeners.delete(listener);
    };
  }

  function action<TName extends keyof TActions & string>(
    name: TName,
    ...args: undefined extends TActions[TName]
      ? [payload?: TActions[TName]]
      : [payload: TActions[TName]]
  ): Promise<LiveHostClientActionResult> {
    if (!isConnected) return Promise.reject(new LiveHostDisconnectedError());

    const id = makeActionId();
    if (pendingActions.has(id)) return Promise.reject(new LiveHostDuplicateActionIdError(id));

    const payload = args[0];
    const message = {
      type: "action",
      id,
      name,
      ...(payload !== undefined ? { payload } : {}),
    } as LiveHostClientActionMessage<TActions>;

    const result = new Promise<LiveHostClientActionResult>((resolve, reject) => {
      pendingActions.set(id, { resolve, reject });
    });

    send(message);
    return result;
  }

  return Object.freeze({
    map,
    get seq() {
      return seq;
    },
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    on_event,
    action,
  });
}
