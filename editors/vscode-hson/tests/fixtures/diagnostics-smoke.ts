import { HSON, hson } from "hson-live";

const valid = HSON`
  <main
    <h1 "Hello">
  >
`;

const broken = HSON`
  <<<<<<<<<<<<<<<<<<
`;

const substitution = HSON`
  <main ${"hello"}>
`;

void valid;
void broken;
void substitution;
