// key-prefix-guard.ts

import { _throw_transform_err } from "../sys-utils/throw-transform-err.utils.js";
import { is_valid_hson_data_name } from "../../../../core/hson-name.js";

export function assert_user_key_allowed(key: string, where: string): void {
  if (!is_valid_hson_data_name(key)) {
    _throw_transform_err(
      `reserved Hson prefix in user tag/key: ${JSON.stringify(key)}`,
      where
    );
  }
}
