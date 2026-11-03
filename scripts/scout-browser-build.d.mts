import type { BuildResult } from "esbuild";
export function build_scout_browser(): Promise<{
  bootstrap: BuildResult<{ metafile: true; write: false }>;
  runtime: BuildResult<{ metafile: true; write: false }>;
}>;
