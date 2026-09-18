import type { LocalHostSnapshot, LocalHostState } from "./local-host-controller.js";

export type LocalHostProjectPresentation = Readonly<{
  projectId: string;
  name: string;
  detail: string;
  configured: boolean;
  snapshot: LocalHostSnapshot;
}>;

export type LocalHostCommandAvailability = Readonly<{
  canStart: boolean;
  canStop: boolean;
  canRestart: boolean;
  canOpen: boolean;
}>;

export type LocalAppAction = Readonly<{
  label: string;
  command: "hson.startLocalHost" | "hson.stopLocalHost" | "hson.restartLocalHost" | "hson.openLocalApp" | "hson.showLocalHostOutput";
}>;

export type LocalAppStatusPresentation = Readonly<{
  text: string;
  tooltip: string;
}>;

const RUN_ACTION: LocalAppAction = Object.freeze({ label: "Run Local App", command: "hson.startLocalHost" });
const STOP_ACTION: LocalAppAction = Object.freeze({ label: "Stop Local App", command: "hson.stopLocalHost" });
const RESTART_ACTION: LocalAppAction = Object.freeze({ label: "Restart Local App", command: "hson.restartLocalHost" });
const OPEN_ACTION: LocalAppAction = Object.freeze({ label: "Open Local App", command: "hson.openLocalApp" });
const OUTPUT_ACTION: LocalAppAction = Object.freeze({ label: "Show Local App Output", command: "hson.showLocalHostOutput" });

export function local_host_command_availability(
  projects: readonly LocalHostProjectPresentation[],
): LocalHostCommandAvailability {
  const states = (expected: readonly LocalHostState[]): boolean => projects.some(project => expected.includes(project.snapshot.state));
  return Object.freeze({
    canStart: projects.some(project => project.configured && (project.snapshot.state === "stopped" || project.snapshot.state === "failed")),
    canStop: states(["starting", "running", "failed"]),
    canRestart: states(["starting", "running", "failed"]),
    canOpen: projects.some(project => project.snapshot.state === "running" && project.snapshot.httpUrl !== undefined),
  });
}

export function local_host_project_description(project: LocalHostProjectPresentation): string {
  return `${project.name} — ${project.detail}`;
}

export function local_app_quick_pick_actions(
  projects: readonly LocalHostProjectPresentation[],
): readonly LocalAppAction[] {
  const actions: LocalAppAction[] = [];
  if (projects.some(project => project.snapshot.state === "running" && project.snapshot.httpUrl !== undefined)) actions.push(OPEN_ACTION);
  if (projects.some(project => project.configured && (project.snapshot.state === "stopped" || project.snapshot.state === "failed"))) actions.push(RUN_ACTION);
  if (projects.some(project => project.snapshot.state === "running")) actions.push(RESTART_ACTION);
  if (projects.some(project => project.snapshot.state === "starting" || project.snapshot.state === "running")) actions.push(STOP_ACTION);
  actions.push(OUTPUT_ACTION);
  return Object.freeze(actions);
}

export function local_app_status_presentation(
  snapshot: LocalHostSnapshot | undefined,
  project: LocalHostProjectPresentation | undefined,
): LocalAppStatusPresentation {
  const state: LocalHostState = snapshot?.state ?? "stopped";
  const suffix = state === "stopped" || project === undefined ? "" : ` · ${project.name}`;
  const text = state === "running" ? `$(radio-tower) Hson: App Running${suffix}`
    : state === "starting" ? `$(loading~spin) Hson: App Starting${suffix}`
    : state === "stopping" ? `$(loading~spin) Hson: App Stopping${suffix}`
    : state === "failed" ? `$(error) Hson: App Failed${suffix}`
    : "$(debug-stop) Hson: App Stopped";
  const identity = project === undefined ? "" : `${local_host_project_description(project)}\n`;
  const tooltip = state === "running" ? `${identity}Hson local app: ${snapshot?.httpUrl}`
    : state === "failed" ? `${identity}Hson local app failed: ${snapshot?.failure ?? "See output."}`
    : `${identity}Hson local app is ${state}.`;
  return Object.freeze({ text, tooltip });
}
