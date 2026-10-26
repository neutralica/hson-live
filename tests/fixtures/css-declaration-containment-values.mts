/** Authored component values shared by Node, Worker and native-browser regressions. */
export const CSS_DECLARATION_ESCAPES = [
  'none; } .escape {',
  'none; } .escape { color: rgb(1, 2, 3); } /*',
  'none } .escape {',
  'none; color: green',
  'none; } .escape {} :scope {',
  'none; } @media screen { .escape {',
  'none; } @media screen {} :scope {',
  'none; } @layer escape { .escape {} :scope {',
  'none/**/;/**/}/**/.escape/**/{',
  'none; } .escape { /* balanced comment */',
  String.raw`none\; } .escape {`,
  String.raw`"safe; } .quoted {" } .escape {`,
  'future([safe; {tokens}]); } .escape {',
  'future([safe; {tokens}]) } .escape {',
  'future({nested;token}); color: red',
  'future([mismatch)]',
  'future(',
  '"unterminated',
  '/* unterminated',
  'url(unfinished',
  'trailing\\',
  // Chrome and CSSTree disagree about escaped URL-function tokenization.
  ...['u\\72l', '\\75rl', '\\000075rl', 'u\\000072l', 'ur\\6c', 'u\\72 l', 'U\\52 L'].flatMap(name => [
    `${name}(x"); } .escape { /*"*/)`,
    `${name}(x"); color: red; /*"*/)`,
    `${name}(x"); } @media all { .escape { /*"*/)`,
  ]),
  'url(x"); } .escape { /*"*/)',
  'url("closed" extra)',
  'url("closed"/* trailing comment */)',
  'url(/* comment */"text")',
  'url("unterminated)',
  'url(unquoted"bad)',
  'url(unquoted\\)',
  'url(unquoted whitespace extra)',
  'before/* unfinished',
  '"escaped final quote\\"',
  "'escaped final quote\\'",
  'bad\\\nname',
  'control\u0000value',
  'control\u000bvalue',
  'control\u007fvalue',
] as const;

export const CSS_CONTAINED_VALUES = [
  ['content', '"quoted ; { } [ ] ( )"'],
  ['content', String.raw`'escaped quote \' ; } still quoted'`],
  ['--tokens', 'url("data:text/plain,;{}")'],
  ['--tokens', String.raw`escaped\;\{\}`],
  ['--tokens', String.raw`\3b \7b \7d `],
  ['--tokens', '/* ; } */ future-color-token /* { ; */'],
  ['--tokens', 'future([a b] nested(fn(1, 2)))'],
  ['--tokens', String.raw`\75nicode \; \{ \} \( \) \[ \]`],
  ['--tokens', String.raw`\00003b\00007b\00007d`],
  ['--tokens', String.raw`foo\ `],
  ['--tokens', 'url( \"image.png\" )'],
  ['content', '"continued\\\nstring ; }"'],
  ['width', 'calc(100% - min(2rem, var(--offset, 1px)))'],
  ['color', 'color-mix(in oklab, red 20%, blue)'],
  ['color', 'future-color-token'],
  ['animation-duration', 'future-duration-token'],
  ['animation-timing-function', 'future-easing(1)'],
] as const;

/** Deliberate compatibility limits, separate from malicious/malformed inputs. */
export const CSS_CONTAINMENT_UNSUPPORTED = [
  '{ color: red; nested: [fn(";}")]; }',
  'future([a;b] { c:d; })',
  '[a;b { c:d; }]',
  'url(data:text/plain,a;b{c})',
  'url(image.png)',
  'url()',
  String.raw`u\72l("image.png")`,
  String.raw`c\61lc(1px + 2px)`,
] as const;

/** Final stylesheet rendering must preserve these authored content expressions. */
export const CSS_CONTENT_VALUES = [
  '"ordinary ; { } text"',
  'var(--message)',
  'attr(data-label)',
  'counter(item)',
  'counters(item, ".")',
  '"prefix " attr(data-label)',
  '/* first line\nsecond ; { } line */ var(--message)',
  'var(\n--message\n)',
  '"continued\\\r\ntext"',
  'future-content-token',
] as const;

/** The URL itself is one component, in addition to its enclosing components. */
export const CSS_URL_DEPTH_CASES = [127, 128, 129].flatMap(depth =>
  [['(', ')'], ['[', ']'], ['future(', ')']].map(([open, close]) => ({
    depth, value: open.repeat(depth - 1) + 'url("depth")' + close.repeat(depth - 1),
  })));
