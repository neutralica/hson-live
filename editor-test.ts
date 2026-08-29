import { Hson } from "hson-live/hson"
import { Hson as markup } from "hson-live/hson"

// ------------------------------------------------------------
// 1. VALID DIRECT TEMPLATE
//
// Should get:
// - Hson syntax coloring
// - NO Hson diagnostic
// ------------------------------------------------------------

const valid = Hson`
  <main
    id="application"

    <header
      <h1 "Hello, Hson">
      <p "This is valid authored Hson.">
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
// - Hson syntax coloring
// - authoritative Hson error squiggle
// ------------------------------------------------------------

const broken = Hson`
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
// - BUT still an Hson diagnostic
//
// TextMate only recognizes the literal spelling "Hson".
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
// Should NOT receive an Hson semantic diagnostic,
// because this local parameter shadows the imported binding.
// ------------------------------------------------------------

function shadowTest(Hson: (strings: TemplateStringsArray) => string) {
  return Hson`
    this is not being treated as Hson by semantic discovery
  `;
}


// ------------------------------------------------------------
// 5. ORDINARY TEMPLATE
//
// Should remain ordinary TypeScript.
// ------------------------------------------------------------

const ordinary = `
  <main
    this merely looks vaguely Hson-ish
  >
`;


// ------------------------------------------------------------
// 6. SUBSTITUTION
//
// Current policy:
// - host `${...}` expression stays TypeScript
// - extension recognizes this as an Hson-tagged template
// - interpolated templates receive no speculative Schema diagnostics
//
// Runtime primitive substitutions are supported; editor substitution capture
// remains deferred.
// ------------------------------------------------------------

const title = "Dynamic title";

const interpolated = Hson`
  <main
    h1 ${title} asdfa 
`;


// ------------------------------------------------------------
// 7. ESCAPES / QUOTED NAMES
//
// Should exercise Hson-specific lexical coloring.
// ------------------------------------------------------------

const lexical = Hson`
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
