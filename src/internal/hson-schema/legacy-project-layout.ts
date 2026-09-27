import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { assert_no_symlinks } from "./compiler-project.js";

export const LEGACY_SCHEMA_LAYOUT_REQUIRED = "Legacy Hson compiler-project layout detected. Run `hson-schema migrate` to preview cleanup, then `hson-schema migrate --write` to apply it. Regenerate current state afterward.";

/** Recognition only: ownership and selector decoding belong to explicit migration. */
export function has_legacy_schema_project_layout(project: string): boolean {
  project = resolve(project);
  const root = join(dirname(project), ".hson", "compiler-input", basename(project));
  const selector = join(root, "tsconfig.json"), revisions = join(root, "revisions");
  assert_no_symlinks(dirname(project), root);
  if (lstatSync(selector, { throwIfNoEntry: false })?.isSymbolicLink()) return true;
  if (existsSync(selector) && lstatSync(selector).isFile()
    && readFileSync(selector, "utf8").includes('"hson-schema-compiler-selector-v1"')) return true;
  // lstat observes dangling links too; recognition must never follow an old revision link.
  const state = lstatSync(revisions, { throwIfNoEntry: false });
  if (state === undefined) return false;
  if (!state.isDirectory()) return true;
  return readdirSync(revisions, { withFileTypes: true }).some(entry => {
    if (!entry.name.startsWith("revision-")) return false;
    if (!entry.isDirectory()) return true;
    const directory = join(revisions, entry.name);
    return ["manifest.json", "tsconfig.json"].some(name =>
      lstatSync(join(directory, name), { throwIfNoEntry: false }) !== undefined);
  });
}
