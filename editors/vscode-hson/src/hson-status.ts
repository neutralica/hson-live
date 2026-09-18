import type { LocalHostState } from "./local-host-controller.js";
import type { LocalAppAction } from "./local-host-presentation.js";

export type SchemaToolState = "stopped" | "starting" | "watching" | "stale" | "error";

export type HsonStatusPresentation = Readonly<{
  text: string;
  tooltip: string;
  error: boolean;
}>;

export type HsonActionSection = "Formatting" | "Schema" | "LiveHost" | "Output";

export type HsonAction = Readonly<{
  section: HsonActionSection;
  label: string;
  command: string;
}>;

export type HsonFormattingAvailability = Readonly<{
  document: boolean;
  selection: boolean;
}>;

const schema_indicator = (state: SchemaToolState): "$(eye)" | "◇" =>
  state === "starting" || state === "watching" || state === "stale" ? "$(eye)" : "◇";

const local_host_indicator = (state: LocalHostState): "$(broadcast)" | "◇" =>
  state === "starting" || state === "running" || state === "stopping" ? "$(broadcast)" : "◇";

export function hson_status_presentation(
  schema: SchemaToolState,
  localHost: LocalHostState,
): HsonStatusPresentation {
  return Object.freeze({
    text: `Hson ${schema_indicator(schema)} ${local_host_indicator(localHost)}`,
    tooltip: `Hson Extension\n\nSchema: ${schema}\nLiveHost: ${localHost}`,
    error: schema === "error" || localHost === "failed",
  });
}

export function hson_quick_pick_actions(
  formatting: HsonFormattingAvailability,
  localHostActions: readonly LocalAppAction[],
): readonly HsonAction[] {
  const actions: HsonAction[] = [];
  if (formatting.document) actions.push({ section: "Formatting", label: "Format Document", command: "hson.formatDocument" });
  if (formatting.selection) actions.push({ section: "Formatting", label: "Format Selection", command: "hson.formatSelection" });
  actions.push(
    { section: "Schema", label: "Check Schemas", command: "hson.checkSchemas" },
    { section: "Schema", label: "Generate Schema Types", command: "hson.generateSchemaTypes" },
    { section: "Schema", label: "Start Schema Watch", command: "hson.startSchemaWatch" },
    { section: "Schema", label: "Stop Schema Watch", command: "hson.stopSchemaWatch" },
  );
  for (const action of localHostActions) {
    if (action.command === "hson.showLocalHostOutput") continue;
    actions.push({ section: "LiveHost", label: action.label, command: action.command });
  }
  actions.push(
    { section: "Output", label: "Show Schema Output", command: "hson.showSchemaOutput" },
    { section: "Output", label: "Show Local App Output", command: "hson.showLocalHostOutput" },
  );
  return Object.freeze(actions.map(action => Object.freeze(action)));
}
