import { HSON, hson } from "hson-live";

const ordinary = `plain ${value}`;
const other = otherTag`<notHson>`;
const alias = markup`<notHsonEither>`;
const direct = HSON`<main class="card"/>`;
const multiline = HSON`
  <main
    <h1 "Hello"/>
  />
`;
const escaped = HSON`<message "host \` tick"/>`;
const escapedBoundary = HSON`before \` after`;
const substituted = HSON`<value ${fn({ nested: true })}>`;
const facade = api.HSON`<notHson>`;

// Retired aggregate tag must not receive authoring injection.
const retired = hson`<retiredTag>`;
