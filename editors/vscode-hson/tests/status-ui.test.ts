import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { HSON_TOOLTIP_COMMANDS, hson_quick_pick_actions, hson_status_presentation, hson_status_tooltip } from "../src/hson-status.js";
import type { LocalAppAction } from "../src/local-host-presentation.js";

let checks = 0;
function check(name: string, body: () => void): void {
  body();
  process.stdout.write(`ok ${++checks} - ${name}\n`);
}

check("the four normal status combinations keep Schema then LiveHost in fixed slots", () => {
  assert.equal(hson_status_presentation("stopped", "stopped").text, "Hson ◇ ◇");
  assert.equal(hson_status_presentation("watching", "stopped").text, "Hson $(eye) ◇");
  assert.equal(hson_status_presentation("stopped", "running").text, "Hson ◇ $(broadcast)");
  assert.equal(hson_status_presentation("watching", "running").text, "Hson $(eye) $(broadcast)");
});

check("changing one subsystem changes only its status slot", () => {
  const stopped = hson_status_presentation("stopped", "stopped").text.split(" ");
  const schema = hson_status_presentation("watching", "stopped").text.split(" ");
  const liveHost = hson_status_presentation("stopped", "running").text.split(" ");
  assert.equal(schema[2], stopped[2]);
  assert.equal(liveHost[1], stopped[1]);
});

check("transitional states use the closest normal indicator without new icon vocabulary", () => {
  assert.equal(hson_status_presentation("starting", "starting").text, "Hson $(eye) $(broadcast)");
  assert.equal(hson_status_presentation("stale", "stopping").text, "Hson $(eye) $(broadcast)");
  assert.equal(hson_status_presentation("error", "failed").text, "Hson ◇ ◇");
  assert.equal(hson_status_presentation("error", "stopped").error, true);
  assert.equal(hson_status_presentation("stopped", "failed").error, true);
  assert.equal(hson_status_presentation("watching", "running").error, false);
});

check("the tooltip is the concise authority for both lifecycle states", () => {
  assert.equal(
    hson_status_presentation("watching", "running").tooltip,
    "Hson Extension\n\nSchema: watching\nLiveHost: running",
  );
  assert.match(hson_status_presentation("error", "failed").tooltip, /Schema: error\nLiveHost: failed$/);
});

check("clickable tooltip has readable stopped controls and no unavailable actions", () => {
  const stopped = hson_status_tooltip("stopped", "stopped");
  const gap = "\u2003\u2003";
  assert.match(stopped, /^Local App — off\n\n/);
  assert.ok(stopped.includes(`[[Run]](command:hson.startLocalHost)${gap}[[Run + Open]](command:hson.runAndOpenLocalApp)`));
  assert.ok(stopped.includes(`\n\n---\n\nSchema — off\n\n[[Watch]](command:hson.startSchemaWatch)${gap}[[Check]](command:hson.checkSchemas)`));
  assert.match(stopped, /\[\[Run \+ Open\]\]\(command:hson\.runAndOpenLocalApp\)/);
  assert.doesNotMatch(stopped, /command:hson\.openLocalApp|command:hson\.copyLocalAppUrl|command:hson\.stopAll/);
  assert.equal(stopped.split("\n\n---\n\n").length, 2);
});

check("running controls keep the actual URL on its own line and Stop All last", () => {
  const gap = "\u2003\u2003";
  const running = hson_status_tooltip("watching", "running", "http://127.0.0.1:8787/");
  assert.match(running, /^`http:\/\/127\.0\.0\.1:8787\/`\n\n/);
  assert.doesNotMatch(running, /Local App — on/);
  assert.ok(running.includes([
    "[[Open]](command:hson.openLocalApp)", "[[Copy]](command:hson.copyLocalAppUrl)",
    "[[Restart]](command:hson.restartLocalHost)", "[[Stop]](command:hson.stopLocalHost)",
  ].join(gap)));
  assert.ok(running.includes(`\n\n---\n\nSchema — on\n\n[[Stop]](command:hson.stopSchemaWatch)${gap}[[Check]](command:hson.checkSchemas)`));
  assert.ok(running.endsWith("\n\n---\n\n[[Stop All]](command:hson.stopAll)"));
  assert.equal(running.split("\n\n---\n\n").length, 3);
  assert.match(hson_status_tooltip("stopped", "running", "http://127.0.0.1:9000/path"), /^`http:\/\/127\.0\.0\.1:9000\/path`\n\n/);
});

check("transitional tooltip states retain Check and state-appropriate actions", () => {
  const starting = hson_status_tooltip("starting", "starting");
  assert.match(starting, /Local App — starting/);
  assert.match(starting, /command:hson\.stopLocalHost/);
  assert.match(starting, /command:hson\.stopSchemaWatch/);
  assert.match(starting, /command:hson\.checkSchemas/);
  assert.ok(starting.endsWith("[[Stop All]](command:hson.stopAll)"));
  const schemaOnly = hson_status_tooltip("watching", "stopped");
  assert.match(schemaOnly, /Schema — on/);
  assert.ok(schemaOnly.endsWith("[[Stop All]](command:hson.stopAll)"));
  assert.doesNotMatch(hson_status_tooltip("error", "failed"), /command:hson\.stopAll/);
  assert.deepEqual([...HSON_TOOLTIP_COMMANDS].sort(), [...new Set(HSON_TOOLTIP_COMMANDS)].sort());
  assert.ok(HSON_TOOLTIP_COMMANDS.includes("hson.checkSchemas"));
  assert.ok(HSON_TOOLTIP_COMMANDS.every(command => command.startsWith("hson.")));
});

const localActions: readonly LocalAppAction[] = [
  { label: "Open Local App", command: "hson.openLocalApp" },
  { label: "Restart Local App", command: "hson.restartLocalHost" },
  { label: "Stop Local App", command: "hson.stopLocalHost" },
  { label: "Show Local App Output", command: "hson.showLocalHostOutput" },
];

check("the unified picker is ordered Formatting, Schema, LiveHost, Output", () => {
  const actions = hson_quick_pick_actions({ document: true, selection: true }, localActions);
  assert.deepEqual([...new Set(actions.map(action => action.section))], ["Formatting", "Schema", "LiveHost", "Output"]);
  assert.deepEqual(actions.map(action => action.label), [
    "Format Document", "Format Selection",
    "Check Schemas", "Generate Schema Types", "Start Schema Watch", "Stop Schema Watch",
    "Run All", "Open Local App", "Restart Local App", "Stop Local App", "Stop All",
    "Show Schema Output", "Show Local App Output",
  ]);
});

check("Format Selection is selection-sensitive in the unified picker", () => {
  const withoutSelection = hson_quick_pick_actions({ document: true, selection: false }, localActions);
  assert.ok(withoutSelection.some(action => action.command === "hson.formatDocument"));
  assert.ok(!withoutSelection.some(action => action.command === "hson.formatSelection"));
  assert.ok(hson_quick_pick_actions({ document: true, selection: true }, localActions).some(action => action.command === "hson.formatSelection"));
});

check("production creates exactly one status item with one unified click command and no custom foreground", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../src/extension.ts"), "utf8");
  const localHostSource = readFileSync(resolve(__dirname, "../src/local-host-extension.ts"), "utf8");
  const source = extensionSource + localHostSource;
  assert.equal(source.match(/createStatusBarItem\(/g)?.length, 1);
  assert.match(extensionSource, /hsonStatus\.command = "hson\.actions"/);
  assert.match(extensionSource, /registerCommand\("hson\.actions"/);
  assert.match(extensionSource, /showQuickPick\(items/);
  assert.match(extensionSource, /tooltip\.isTrusted = \{ enabledCommands: HSON_TOOLTIP_COMMANDS \}/);
  assert.match(extensionSource, /displayedTooltip !== undefined && displayedTooltip !== tooltipContent\) hsonStatus\.hide\(\)/);
  assert.match(extensionSource, /displayedTooltip = tooltipContent;[\s\S]*hsonStatus\.tooltip = tooltip;[\s\S]*hsonStatus\.show\(\)/);
  assert.match(localHostSource, /clipboard\.writeText\(new URL\(url\)\.href\)/);
  assert.match(localHostSource, /run_and_open\(\(\) => this\.start\(folder\.uri\), \(\) => this\.open\(folder\.uri\)\)/);
  assert.match(extensionSource, /registerCommand\("hson\.stopAll", stopAll\)/);
  assert.doesNotMatch(source, /hsonStatus\.color\s*=/);
  assert.match(source, /statusBarItem\.errorBackground/);
  assert.doesNotMatch(source, /hson\.schemaToolActions|hson\.localHostActions/);
});

check("format-on-save is an editor participant, not another watcher, process, or status slot", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../src/extension.ts"), "utf8");
  assert.match(extensionSource, /onWillSaveTextDocument/);
  assert.equal(extensionSource.match(/structural_formatting_edits\(/g)?.length, 1);
  assert.match(extensionSource, /registerDocumentFormattingEditProvider\(markdownSelector/);
  assert.equal(extensionSource.match(/createFileSystemWatcher\(/g)?.length, 3);
  assert.equal(extensionSource.match(/createStatusBarItem\(/g)?.length, 1);
  assert.doesNotMatch(extensionSource, /format(?:ting)?(?:Watch|Status|Process)/i);
});

check("manifest exposes both format commands in the palette and editor context with selection sensitivity", () => {
  const manifest = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8"));
  const formats = Object.fromEntries(manifest.contributes.commands
    .filter((command: { command: string }) => command.command.startsWith("hson.format"))
    .map((command: { command: string; enablement: string }) => [command.command, command]));
  assert.ok(formats["hson.formatDocument"]);
  assert.match(formats["hson.formatSelection"].enablement, /editorHasSelection/);
  for (const menu of ["commandPalette", "editor/context"]) {
    const commands = manifest.contributes.menus[menu];
    assert.ok(commands.some((entry: { command: string }) => entry.command === "hson.formatDocument"));
    const selection = commands.find((entry: { command: string }) => entry.command === "hson.formatSelection");
    assert.match(selection.when, /editorHasSelection/);
  }
});

process.stdout.write(`ok - ${checks} focused Hson status and command-surface checks passed\n`);
