import { hson } from "hson-live";

const valid = hson`
  <main
    <h1 "Hello">
  >
`;

const broken = hson`
  <<<<<<<<<<<<<<<<<<
`;

const substitution = hson`
  <main ${"hello"}>
`;

void valid;
void broken;
void substitution;
