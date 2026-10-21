import type { HsonNode, Primitive } from "../core/types.js";
import { STR_TAG } from "../core/constants.js";
import { is_Node } from "../core/node-guards.js";

/** Shared authored Part grammar; parameter resolution remains composition-owned. */
export function part_placeholder_pattern(): RegExp {
  return /%\{([A-Za-z_][A-Za-z0-9_-]*)\}/g;
}

export function part_placeholder_matches(value: string): readonly RegExpMatchArray[] | undefined {
  const pattern = part_placeholder_pattern();
  return value.replace(pattern, "").includes("%{") ? undefined : [...value.matchAll(pattern)];
}

/** Shared placement checks over an already detached, qualified document. */
export function transform_part_parameter_strings(root: HsonNode, substitute: (value: string) => Primitive): void {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.$_tag.includes("%{")) throw new TypeError("Part placeholders cannot occur in tags.");
    if (node.$_meta !== undefined && JSON.stringify(node.$_meta).includes("%{")) throw new TypeError("Part placeholders cannot occur in identity metadata.");
    if (node.$_attrs !== undefined) {
      const attrs: NonNullable<HsonNode["$_attrs"]> = Object.create(null);
      for (const [name, value] of Object.entries(node.$_attrs)) {
        if (name.includes("%{")) throw new TypeError("Part placeholders cannot occur in attribute names.");
        if (/^on/i.test(name) && typeof value === "string" && value.includes("%{")) throw new TypeError("Part placeholders in event-handler attributes are unsupported.");
        if (typeof value === "object" && value !== null && JSON.stringify(value).includes("%{")) throw new TypeError("Part placeholders in structured attributes are unsupported.");
        attrs[name] = typeof value === "string" ? substitute(value) : value;
      }
      node.$_attrs = attrs;
    }
    if (node.$_tag === STR_TAG && typeof node.$_content[0] === "string") {
      const value = substitute(node.$_content[0]);
      // Canonical document text is STR-only; strong scalar types apply to attributes.
      node.$_content = [String(value)];
    } else {
      if (["script", "style"].includes(node.$_tag.toLowerCase()) && JSON.stringify(node.$_content).includes("%{")) throw new TypeError("Part placeholders in script/style content are unsupported.");
      for (const child of node.$_content) if (is_Node(child)) stack.push(child);
    }
  }
}
