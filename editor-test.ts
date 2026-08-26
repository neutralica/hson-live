import {hson} from "./src/hson.js"
import {hson as markup} from "./src/hson.js"

// ------------------------------------------------------------
// 1. VALID DIRECT TEMPLATE
//
// Should get:
// - HSON syntax coloring
// - NO HSON diagnostic
// ------------------------------------------------------------

const valid = hson`
  <main
    id="application"

    <header
      <h1 "Hello, HSON">
      <p "This is valid authored HSON.">
    >

    <section
      enabled
      count=42
      negative=-0
      truth=true
      nothing=null

      <ul
        <li "one"
        li "two"
        li "three">
      >
    >
  >
`;


// ------------------------------------------------------------
// 2. INVALID DIRECT TEMPLATE
//
// Should get:
// - HSON syntax coloring
// - authoritative HSON error squiggle
// ------------------------------------------------------------

const broken = hson`
  <main
    <section
      <h2 "Something is wrong"
    >
  >
`;


// ------------------------------------------------------------
// 3. IMPORT ALIAS
//
// Important distinction:
//
// Should get:
// - probably ordinary TypeScript template-string coloring
// - BUT still an HSON diagnostic
//
// TextMate only recognizes the literal spelling "hson".
// Pass 2 semantic discovery knows `markup` is the real import.
// ------------------------------------------------------------

const aliasedBroken = markup`
  <article
    <p "Alias diagnostics still work"
  >
`;


// ------------------------------------------------------------
// 4. SAME NAME, WRONG BINDING
//
// Should NOT receive an HSON semantic diagnostic,
// because this local parameter shadows the imported binding.
// ------------------------------------------------------------

function shadowTest(hson: (strings: TemplateStringsArray) => string) {
  return hson`
    this is not being treated as HSON by semantic discovery
  `;
}


// ------------------------------------------------------------
// 5. ORDINARY TEMPLATE
//
// Should remain ordinary TypeScript.
// ------------------------------------------------------------

const ordinary = `
  <main
    this merely looks vaguely HSON-ish
  >
`;


// ------------------------------------------------------------
// 6. SUBSTITUTION
//
// Current policy:
// - host `${...}` expression stays TypeScript
// - extension recognizes this as an HSON-tagged template
// - exact substitution receives an unsupported-substitution error
//
// This is deliberately temporary until whole-value interpolation
// semantics are implemented.
// ------------------------------------------------------------

const title = "Dynamic title";

const interpolated = hson`
  <main
    h1 ${title} asdfa 
`;


// ------------------------------------------------------------
// 7. ESCAPES / QUOTED NAMES
//
// Should exercise HSON-specific lexical coloring.
// ------------------------------------------------------------

const lexical = hson`
  <main
    'quoted name'="value"
    apostrophe='can\'t'
    newline="one\ntwo"
    unicode="\u0060"
    <p "slash text // inside a string">
  >
`;

void valid;
void broken;
void aliasedBroken;
void ordinary;
void interpolated;
void lexical;
