export const canonical = `<div class="column" hson:part part:optional
  blocks:data=%{someBlocks}
  <hson-part
    for:each=^{blocks}
    at=^{each.kind}
    data:block=^{each}
  />
/>`;
