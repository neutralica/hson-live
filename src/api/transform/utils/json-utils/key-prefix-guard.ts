// key-prefix-guard.ts

import { _throw_transform_err } from "../sys-utils/throw-transform-err.utils.js";
import { HSON_SYS_PREFIX } from "../../../../core/constants.js";

export function assert_user_key_allowed(key: string, where: string): void {
  if (key.startsWith(HSON_SYS_PREFIX)) {
    _throw_transform_err(
      `reserved HSON prefix "${HSON_SYS_PREFIX}" is not allowed in user tag/key: "${key}"`,
      where
    );
  }
}
