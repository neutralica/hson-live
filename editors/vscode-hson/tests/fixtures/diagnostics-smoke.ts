import { Hson, hson } from "hson-live";

const valid = Hson.canonical`
  <main
    <h1 "Hello">
  >
`;

const broken = Hson.canonical`
  <<<<<<<<<<<<<<<<<<
`;

const substitution = Hson.canonical`
  <main ${"hello"}>
`;

void valid;
void broken;
void substitution;
