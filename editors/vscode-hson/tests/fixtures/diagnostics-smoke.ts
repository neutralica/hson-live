import { hsonString } from "hson-live";

const valid = hsonString`
  <main
    <h1 "Hello">
  >
`;

const broken = hsonString`
  <<<<<<<<<<<<<<<<<<
`;

const substitution = hsonString`
  <main ${"hello"}>
`;

void valid;
void broken;
void substitution;
