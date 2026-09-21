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
  command: "hson.startLocalHost" | "hson.runAndOpenLocalApp" | "hson.stopLocalHost" | "hson.restartLocalHost" | "hson.openLocalApp" | "hson.copyLocalAppUrl" | "hson.showLocalHostOutput";
}>;

const RUN_ACTION: LocalAppAction = Object.freeze({ label: "Run Local App", command: "hson.startLocalHost" });
const RUN_OPEN_ACTION: LocalAppAction = Object.freeze({ label: "Run & Open Local App", command: "hson.runAndOpenLocalApp" });
const STOP_ACTION: LocalAppAction = Object.freeze({ label: "Stop Local App", command: "hson.stopLocalHost" });
const RESTART_ACTION: LocalAppAction = Object.freeze({ label: "Restart Local App", command: "hson.restartLocalHost" });
const OPEN_ACTION: LocalAppAction = Object.freeze({ label: "Open Local App", command: "hson.openLocalApp" });
const COPY_ACTION: LocalAppAction = Object.freeze({ label: "Copy Local App URL", command: "hson.copyLocalAppUrl" });
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

export function local_app_quick_pick_actions(
  projects: readonly LocalHostProjectPresentation[],
): readonly LocalAppAction[] {
  const actions: LocalAppAction[] = [];
  if (projects.some(project => project.configured && (project.snapshot.state === "stopped" || project.snapshot.state === "failed"))) actions.push(RUN_OPEN_ACTION, RUN_ACTION);
  if (projects.some(project => project.snapshot.state === "running" && project.snapshot.httpUrl !== undefined)) actions.push(OPEN_ACTION, COPY_ACTION);
  if (projects.some(project => project.snapshot.state === "running")) actions.push(RESTART_ACTION);
  if (projects.some(project => project.snapshot.state === "starting" || project.snapshot.state === "running")) actions.push(STOP_ACTION);
  actions.push(OUTPUT_ACTION);
  return Object.freeze(actions);
}
