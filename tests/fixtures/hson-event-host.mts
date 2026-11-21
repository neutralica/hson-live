import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Use the real authoring declarations without depending on a generated dist. */
export function hson_event_host_fixture(repository: string): string {
  const directory = mkdtempSync(join(tmpdir(), "hson-event-host-"));
  process.once("exit", () => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, "package.json"), '{"type":"module"}');
  writeFileSync(join(directory, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    module: "NodeNext",
    paths: { "hson-live": [join(repository, "src/index.ts")], "hson-live/hson": [join(repository, "src/hson-authoring.ts")] },
  } }));
  return directory;
}
