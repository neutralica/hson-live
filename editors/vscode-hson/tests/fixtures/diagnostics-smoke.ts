import { Hson, hson } from "hson-live";

const valid = Hson`
  <main
    <h1 "Hello">
  >
`;

const broken = Hson`
  <<<<<<<<<<<<<<<<<<
`;

const substitution = Hson`
  <main ${"hello"}>
`;

void valid;
void broken;
void substitution;
