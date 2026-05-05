import { _throw_transform_err } from "../sys-utils/throw-transform-err.utils.js";

export function assert_user_key_allowed(key: string, where: string): void {
  if (key.startsWith("_-")) {
    _throw_transform_err(
      `reserved HSON prefix "_-" is not allowed in user tag/key: "${key}"`,
      where
    );
  }
}