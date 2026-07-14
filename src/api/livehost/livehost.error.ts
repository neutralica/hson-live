export class LiveHostDisconnectedError extends Error {
  readonly code = "LIVEHOST_DISCONNECTED" as const;

  constructor() {
    super("LiveHost client disconnected before the action completed.");
    this.name = "LiveHostDisconnectedError";
  }
}

export class LiveHostDuplicateActionIdError extends Error {
  readonly code = "LIVEHOST_DUPLICATE_ACTION_ID" as const;
  readonly actionId: string;

  constructor(actionId: string) {
    super(`LiveHost action ID is already pending: ${actionId}`);
    this.name = "LiveHostDuplicateActionIdError";
    this.actionId = actionId;
  }
}
