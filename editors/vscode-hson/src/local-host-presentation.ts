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
