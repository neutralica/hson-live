import type { HsonDataInput, HsonDataValue } from "../api/data/hson-data.js";
import type { ExecutionInputOptions } from "../internal/execution-input.js";

export type LocalActionMessage = Readonly<{
  name: string;
  /** Identifies one invocation within its action registry. */
  id: string;
}>;

export type LocalActionHandler<Context> = (
  ctx: Context,
  input: HsonDataValue | undefined,
  message: LocalActionMessage,
) => HsonDataInput | void | Promise<HsonDataInput | void>;

export type LocalActionResult =
  | Readonly<{ ok: true; result?: HsonDataValue }>
  | Readonly<{ ok: false; error: Readonly<{ message: string; cause: unknown }> }>;

export type LocalActionRegistry<Context> = Readonly<{
  define: (name: string, handler: LocalActionHandler<Context>, options?: ExecutionInputOptions) => void;
  trigger: (name: string, input?: HsonDataInput) => Promise<LocalActionResult>;
}>;
