// factories.ts

import { has_own_entries } from "./node-storage.js";
import type { HsonNode } from "./types.js";

export const CREATE_NODE = (partial: Partial<HsonNode> = {}): HsonNode => {
  const $_tag = partial.$_tag ?? "";
  const $_content = partial.$_content ?? [];
  const attrs = partial.$_attrs;
  const meta = partial.$_meta;

  if (has_own_entries(attrs) && has_own_entries(meta)) {
    return { $_tag, $_content, $_attrs: attrs, $_meta: meta };
  }
  if (has_own_entries(attrs)) return { $_tag, $_content, $_attrs: attrs };
  if (has_own_entries(meta)) return { $_tag, $_content, $_meta: meta };
  return { $_tag, $_content };
};
