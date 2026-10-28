import { assert_hson_identifier_name } from "../core/hson-name.js";

/** Ordinary connector coordinates, after existing reference substitution. @internal */
export function part_coordinates(lib: unknown, at: unknown, enclosingLibrary?: unknown):
  | Readonly<{ library: string; member: string; qualified: boolean; issue?: never; field?: never }>
  | Readonly<{ issue: string; field: "lib" | "at"; library?: never; member?: never; qualified?: never }> {
  if (typeof at !== "string") return { field: "at", issue: 'hson-part requires at="member" with lib="library", or at="library/member".' };
  const qualified = at.includes("/");
  if (qualified && lib !== undefined) return { field: "at", issue: 'hson-part cannot combine lib with qualified at="library/member"; remove lib or use an unqualified member.' };
  const segments = qualified ? at.split("/") : [lib === undefined ? enclosingLibrary : lib, at];
  if (qualified && (segments.length !== 2 || segments.some(segment => segment === ""))) {
    return { field: "at", issue: 'Qualified hson-part at requires exactly one "/" between a nonempty Library and Part member.' };
  }
  const [library, member] = segments;
  if (typeof library !== "string" || library.length === 0) return { field: "lib", issue: 'Unqualified hson-part at requires a nonempty lib="library"; alternatively use at="library/member".' };
  if (typeof member !== "string") return { field: "at", issue: "hson-part requires a nonempty Part member." };
  try { assert_hson_identifier_name(library, "Library"); }
  catch (cause) { return { field: qualified ? "at" : "lib", issue: cause instanceof Error ? cause.message : String(cause) }; }
  try { assert_hson_identifier_name(member, "Part"); }
  catch (cause) { return { field: "at", issue: cause instanceof Error ? cause.message : String(cause) }; }
  return { library, member, qualified };
}
