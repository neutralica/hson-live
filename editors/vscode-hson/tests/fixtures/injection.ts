import { Hson, hson } from "hson-live";

const ordinary = `plain ${value}`;
const other = otherTag`<notHson>`;
const alias = markup`<notHsonEither>`;
const direct = Hson`<main class="card"/>`;
const multiline = Hson`
  <main
    <h1 "Hello"/>
  />
`;
const escaped = Hson`<message "host \` tick"/>`;
const escapedBoundary = Hson`before \` after`;
const substituted = Hson`<value ${fn({ nested: true })}>`;
const facade = api.Hson`<notHson>`;

// Retired aggregate tag must not receive authoring injection.
const retired = hson`<retiredTag>`;
