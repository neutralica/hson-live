export type DevelopmentService = Readonly<{ name: string; start(): Promise<boolean> }>;

export async function run_development_services(services: readonly DevelopmentService[]): Promise<readonly string[]> {
  const failures: string[] = [];
  for (const service of services) {
    try { if (!await service.start()) failures.push(service.name); }
    catch { failures.push(service.name); }
  }
  return Object.freeze(failures);
}

export async function run_and_open(start: () => Promise<boolean>, open: () => Promise<void>): Promise<boolean> {
  if (!await start()) return false;
  await open();
  return true;
}

export async function build_then_restart(
  build: () => Promise<void>,
  current: () => boolean,
  restart: () => Promise<void>,
): Promise<boolean> {
  await build();
  if (!current()) return false;
  await restart();
  return true;
}
