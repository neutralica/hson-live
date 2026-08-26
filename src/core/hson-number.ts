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
function admitHsonNumber(value: unknown, operation: string): HsonNumber {
  if (typeof value !== "number") {
    _throw_transform_err(
      `HSON numbers must be primitive JavaScript numbers; received ${typeof value}`,
      operation,
      undefined,
      undefined,
      { code: HSON_NUMBER_TYPE_REQUIRED },
    );
  }
  if (!Number.isFinite(value)) {
    _throw_transform_err(
      `invalid HSON number ${String(value)}; numbers must be finite`,
      operation,
      undefined,
      undefined,
      { code: HSON_NUMBER_NONFINITE },
    );
  }
  return value as HsonNumber;
}

/** Admit one primitive finite number without coercion or normalization. */
export function admit_hson_number(value: unknown): HsonNumber {
  return admitHsonNumber(value, "hson.number-admission");
}

/** Admit a finite number, or execute one synchronous calculation and admit its result. */
export function hsonCalc(value: number | (() => number)): HsonNumber;
export function hsonCalc(value: unknown): HsonNumber {
  const calculated: unknown = typeof value === "function" ? value() : value;
  return admitHsonNumber(calculated, "hson.transform.calc");
}
