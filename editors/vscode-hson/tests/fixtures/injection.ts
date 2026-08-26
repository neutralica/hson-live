import { hson } from "hson-live";

const ordinary = `plain ${value}`;
const other = otherTag`<notHson>`;
const alias = markup`<notHsonEither>`;
const direct = hson`<main class="card"/>`;
const multiline = hson`
  <main
    <h1 "Hello"/>
  />
`;
const escaped = hson`<message "host \` tick"/>`;
const escapedBoundary = hson`before \` after`;
const substituted = hson`<value ${fn({ nested: true })}>`;
const facade = api.hson`<notHson>`;
