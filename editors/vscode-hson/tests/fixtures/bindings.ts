export const canonical = `<div class="column" hson:part part:optional
  data:blocks=%{someBlocks}
  <hson-part
    for:each=^{blocks}
    at=^{each.kind}
    block:data=^{each}
  />
/>`;

export const iteratorColumn = `<div @:column hson:part part:optional
  data:blocks=%{blocks}
  class="column"
  <hson-part
    for:each=^{blocks}
    at=^{each.kind}
    block:data=^{each}
  />
/>`;

export const ordinarySibling = '<aside data:x="%{ordinary}" title="^{x}"/>';
export const invalidSibling = '<aside hson:part="invalid" title="quoted />"/>';
export const malformedQuotedSibling = '<aside title="a\nb"/>';
export const escapedControlSibling = '<aside title="a\nb' + '\\' + '\nc"/>';
export const receivingPart = '<main hson:part data:x=%{x} <p title=^{x}/>/>';
export const invalidOperandDocument = "<aside a=^{bad'/> " + receivingPart + " '/>" + receivingPart;
export const malformedContentDocument = '"a' + '\\' + '\n' + 'b"' + receivingPart;
export function conflictingPart(reversed = false): string {
  const attrs = reversed ? ['doc:x=%{b}', 'data:x=%{a}'] : ['data:x=%{a}', 'doc:x=%{b}'];
  return ['<section hson:part', ...attrs.map(attr => '  ' + attr), '  <p title=^{x}/>', '/>'].join('\n');
}
