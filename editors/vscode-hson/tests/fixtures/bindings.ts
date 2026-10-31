export const canonical = `<div class="column" hson:part part:optional
  data:blocks=%{someBlocks}
  <hson-part
    for:each=^{blocks}
    at=^{each.kind}
    block:data=^{each}
  />
/>`;
