import { HSON_SYS_PREFIX } from "../../../../core/constants.js";
import type { Position } from "../../token.types.js";
import { _throw_transform_err } from "../sys-utils/throw-transform-err.utils.js";

/**
 * Admit one decoded name that was explicitly authored in HSON source.
 *
 * Parser-synthesized structural names do not cross this boundary. That keeps
 * object-value and array construction free to use canonical VSN tags while
 * making the same spellings unavailable as public source names.
 */
export function assert_authored_hson_source_name(
  name: string,
  pos: Position,
): void {
  if (!name.startsWith(HSON_SYS_PREFIX)) return;

  _throw_transform_err(
    `[authored-reserved-name] authored HSON name "${name}" is reserved for internal structural nodes at ${pos.line}:${pos.col} (index ${pos.index})`,
    "tokenize-hson.authored-name",
    undefined,
    undefined,
    {
      code: "authored-reserved-name",
      stage: "tokenization",
      source: { index: pos.index, line: pos.line, column: pos.col },
    },
  );
}
