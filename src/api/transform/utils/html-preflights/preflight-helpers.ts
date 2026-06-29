export function should_try_optional_endtags(msg: string): boolean {
  const OPT = /(li|p|td|th|tr|table|thead|tbody|tfoot)\b/i;

  return (
    /Opening and ending tag mismatch/i.test(msg) && OPT.test(msg)
  ) || (
    /Premature end of data in tag/i.test(msg) && OPT.test(msg)
  ) || (
    /expected/i.test(msg) && OPT.test(msg)
  );
}

function extract_mismatched_tag(msg: string): string | undefined {
  const m1 = msg.match(/tag mismatch:\s*([A-Za-z0-9:_-]+)/i);
  if (m1?.[1]) return m1[1].toLowerCase();

  const m2 =  msg.match(/tag mismatch:\s*([A-Za-z0-9:_-]+)/i);
  if (m2?.[1]) return m2[1].toLowerCase();

  return undefined;
}

export function should_try_void_expand(msg: string): boolean {
  return (
    /expected:\s*<\/(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)>/i.test(msg) ||
    /opening and ending tag mismatch/i.test(msg) ||
    /premature end of data in tag/i.test(msg)
  );
}