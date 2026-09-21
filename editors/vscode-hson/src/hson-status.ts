import type { LocalHostState } from "./local-host-controller.js";
import type { LocalAppAction } from "./local-host-presentation.js";

export type SchemaToolState = "stopped" | "starting" | "watching" | "stale" | "error";

export type HsonStatusPresentation = Readonly<{
  text: string;
  tooltip: string;
  error: boolean;
}>;

export const HSON_TOOLTIP_COMMANDS = Object.freeze([
  "hson.startLocalHost", "hson.runAndOpenLocalApp", "hson.copyLocalAppUrl", "hson.openLocalApp",
  "hson.restartLocalHost", "hson.stopLocalHost", "hson.startSchemaWatch", "hson.stopSchemaWatch", "hson.checkSchemas", "hson.stopAll",
]);

export function hson_status_tooltip(schema: SchemaToolState, localHost: LocalHostState, localUrl?: string): string {
  const link = (label: string, command: string): string => `[[${label}]](command:${command})`;
  // Unicode em spaces survive Markdown whitespace collapsing without enabling HTML.
  const actions = (...items: readonly string[]): string => items.join("\u2003\u2003");
  const app = localHost === "running" && localUrl !== undefined
    ? `\`${localUrl}\`\n\n${actions(link("Open", "hson.openLocalApp"), link("Copy", "hson.copyLocalAppUrl"), link("Restart", "hson.restartLocalHost"), link("Stop", "hson.stopLocalHost"))}`
    : localHost === "starting" || localHost === "stopping"
      ? `Local App — ${localHost}\n\n${link("Stop", "hson.stopLocalHost")}`
      : localHost === "running"
        ? `Local App — on\n\n${actions(link("Restart", "hson.restartLocalHost"), link("Stop", "hson.stopLocalHost"))}`
        : `Local App — ${localHost === "stopped" ? "off" : localHost}\n\n${actions(link("Run", "hson.startLocalHost"), link("Run + Open", "hson.runAndOpenLocalApp"))}`;
  const schemaAction = schema === "watching" || schema === "starting" || schema === "stale"
    ? link("Stop", "hson.stopSchemaWatch") : link("Watch", "hson.startSchemaWatch");
  const schemaLabel = schema === "stopped" ? "off" : schema === "watching" ? "on" : schema;
  const stopAll = localHost === "running" || localHost === "starting" || schema === "watching" || schema === "starting" || schema === "stale"
    ? `\n\n---\n\n${link("Stop All", "hson.stopAll")}` : "";
  return `${app}\n\n---\n\nSchema — ${schemaLabel}\n\n${actions(schemaAction, link("Check", "hson.checkSchemas"))}${stopAll}`;
}

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
  localUrl?: string,
): HsonStatusPresentation {
  return Object.freeze({
    text: `Hson ${schema_indicator(schema)} ${local_host_indicator(localHost)}`,
    tooltip: `Hson Extension\n\nSchema: ${schema}\nLiveHost: ${localHost}${localHost === "running" && localUrl !== undefined ? `\n${localUrl}` : ""}`,
    error: schema === "error" || localHost === "failed",
  });
}

export function hson_quick_pick_actions(
  formatting: HsonFormattingAvailability,
  localHostActions: readonly LocalAppAction[],
  schema: SchemaToolState = "stopped",
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
  actions.push({ section: "LiveHost", label: "Run All", command: "hson.runAll" });
  for (const action of localHostActions) {
    if (action.command === "hson.showLocalHostOutput") continue;
    actions.push({ section: "LiveHost", label: action.label, command: action.command });
  }
  if (localHostActions.some(action => action.command === "hson.stopLocalHost") || schema === "watching" || schema === "starting" || schema === "stale") {
    actions.push({ section: "LiveHost", label: "Stop All", command: "hson.stopAll" });
  }
  actions.push(
    { section: "Output", label: "Show Schema Output", command: "hson.showSchemaOutput" },
    { section: "Output", label: "Show Local App Output", command: "hson.showLocalHostOutput" },
  );
  return Object.freeze(actions.map(action => Object.freeze(action)));
}
