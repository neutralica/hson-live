import type { HsonDataInput, HsonDataValue } from "../api/data/hson-data.js";
import type { ActionArgsOptions } from "../internal/action-args.js";

export type LocalActionHandler<Context> = (
  ctx: Context,
  args: HsonDataValue | undefined,
) => HsonDataInput | void | Promise<HsonDataInput | void>;

export type LocalActionResult =
  | Readonly<{ ok: true; result?: HsonDataValue }>
  | Readonly<{ ok: false; error: Readonly<{ message: string; cause: unknown }> }>;

export type LocalActionRegistry<Context> = Readonly<{
  define: (name: string, handler: LocalActionHandler<Context>, options?: ActionArgsOptions) => void;
  trigger: (name: string, args?: HsonDataInput) => Promise<LocalActionResult>;
}>;
