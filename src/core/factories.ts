import type { HsonNode } from "./types.js";

export const CREATE_NODE = (partial: Partial<HsonNode> = {}): HsonNode => ({
  $_tag: partial.$_tag ?? "",
  $_content: partial.$_content ?? [],
  $_attrs: partial.$_attrs ?? {},
  $_meta: partial.$_meta ?? {},
});
