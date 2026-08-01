import { _throw_transform_err } from "./errors.js";

declare const HSON_NUMBER_BRAND: unique symbol;

/**
 * A primitive JavaScript number admitted to the universal HSON numeric domain.
 *
 * The brand exists only at compile time. Runtime values remain ordinary
 * numbers, and transport removes this proof until the decoded value is
 * validated again.
 */
export type HsonNumber = number & {
  readonly [HSON_NUMBER_BRAND]: true;
};

export const HSON_NUMBER_TYPE_REQUIRED = "HSON_NUMBER_TYPE_REQUIRED" as const;
export const HSON_NUMBER_NONFINITE = "HSON_NUMBER_NONFINITE" as const;
export const HSON_CALC_FUNCTION_REQUIRED = "HSON_CALC_FUNCTION_REQUIRED" as const;

/** Admit one primitive finite number without coercion or normalization. */
export function hsonNumber(value: unknown): HsonNumber {
  if (typeof value !== "number") {
    _throw_transform_err(
      `HSON numbers must be primitive JavaScript numbers; received ${typeof value}`,
      "hson.transform.number",
      undefined,
      undefined,
      { code: HSON_NUMBER_TYPE_REQUIRED },
    );
  }
  if (!Number.isFinite(value)) {
    _throw_transform_err(
      `invalid HSON number ${String(value)}; numbers must be finite`,
      "hson.transform.number",
      undefined,
      undefined,
      { code: HSON_NUMBER_NONFINITE },
    );
  }

  // This is the sole brand-establishing point, immediately after validation.
  return value as HsonNumber;
}

/** Execute one synchronous calculation and admit only its returned result. */
export function hsonCalc(calculate: () => unknown): HsonNumber;
export function hsonCalc(calculate: unknown): HsonNumber {
  if (typeof calculate !== "function") {
    _throw_transform_err(
      `hson.transform.calc() requires a callable function; received ${typeof calculate}`,
      "hson.transform.calc",
      undefined,
      undefined,
      { code: HSON_CALC_FUNCTION_REQUIRED },
    );
  }

  return hsonNumber(calculate());
}
