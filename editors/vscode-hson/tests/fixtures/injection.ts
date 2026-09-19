import { Hson, hson } from "hson-live";

const ordinary = `plain ${value}`;
const other = otherTag`<notHson>`;
const alias = markup`<notHsonEither>`;
const direct = Hson.canonical`<main class="card"/>`;
const multiline = Hson.canonical`
  <main
    <h1 "Hello"/>
  />
`;
const escaped = Hson.canonical`<message "host \` tick"/>`;
const escapedBoundary = Hson.canonical`before \` after`;
const substituted = Hson.canonical`<value ${fn({ nested: true })}>`;
const facade = api.Hson.canonical`<notHson>`;

// Retired aggregate tag must not receive authoring injection.
const retired = hson`<retiredTag>`;
