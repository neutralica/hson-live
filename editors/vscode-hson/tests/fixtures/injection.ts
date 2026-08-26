import { hsonString } from "hson-live";

const ordinary = `plain ${value}`;
const other = otherTag`<notHson>`;
const alias = markup`<notHsonEither>`;
const direct = hsonString`<main class="card"/>`;
const multiline = hsonString`
  <main
    <h1 "Hello"/>
  />
`;
const escaped = hsonString`<message "host \` tick"/>`;
const escapedBoundary = hsonString`before \` after`;
const substituted = hsonString`<value ${fn({ nested: true })}>`;
const facade = api.hsonString`<notHson>`;
