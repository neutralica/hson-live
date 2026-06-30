// errors.ts

export function _throw_transform_err(
  message: string,
  functionName: string,
  ctx?: string
): never {
  const ctxLine = ctx ? `\n  :: ${ctx}` : "";
  const errorMessage = `[ERR: transform = ${functionName}()]:\n  -> ${message}${ctxLine}`;
  throw new Error(errorMessage);
}
