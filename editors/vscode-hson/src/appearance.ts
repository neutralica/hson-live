/** Owner-editable appearance catalog. Regenerate with:
 * npm --prefix editors/vscode-hson run themes:generate
 *
 * Examples use literal highlight text; occurrence is one-based when repeated.
 * Inherits paths within syntax.hson may be shortened (e.g. attribute.name).
 * Inheritance transfers only house styling, with per-property child overrides.
 * Intensity blends foreground toward ui.editor["editor.background"] at build time.
 * General syntax and UI are emitted only into the optional House themes.
 *
 * Incoming parameters and local roots have independent classifications.
 * Local roots retain a shared fallback without declaration-origin resolution.
 * quoteClose shares quoteOpen's semantic classification, and identity's colon
 * shares punctuation.colon. Keep each pair's effective styles equal;
 * generation rejects divergence rather than promising unavailable distinctions.
 * Iteration classification and native bracket behavior are deliberately unchanged.
 */

const _faded = {dark: { foreground: "#898a8b"}, light:{foreground: "#687482"} };
const _outgoing = { dark: "#b685af", light: "#405F83" };
const _each = { dark: "#9d8452", light: "#7A602B" }
const _local ={  dark: { foreground: "#d99db5" },light: { foreground: "#28313D" }}
const _placeholder = {  dark: { foreground:"#8daa9c" },light: { foreground: "#6c7d75" }}


export const HSON_APPEARANCE = {
  syntax: {
    hson: {
      element: {
        name: {
          label: "Element name",
          examples: [
            { code: "<section/>", highlight: "section" },
            { code: "<'custom name'/>", highlight: "custom name" }
          ],
          house: {
            dark: { foreground: "#c6caca" },
            light: { foreground: "#245C70" }
          }
        }
      },
      attribute: {
        name: {
          label: "Attribute name",
          examples: [
            { code: '<button class="primary"/>', highlight: "class" }
          ],
          house: {
            dark: { foreground: "#84a9d6" },
            light: { foreground: "#465467" }
          }
        },
        qualifier: {
          label: "Attribute qualifier",
          examples: [
            { code: "<button hson:part/>", highlight: "hson" },
            { code: "<section meta:blocks=^{blocks}/>", highlight: "meta" }
          ],
          // inherits: "attribute.name",
          house: _faded,
        }
      },
      flag: {
        name: {
          label: "Flag",
          examples: [
            { code: "<button disabled/>", highlight: "disabled" }
          ],
          house: {
            dark: { foreground: "#6891c2" },
            light: { foreground: "#576983" }
          }
        }
      },
      part: {
        systemAttribute: {
          name: {
            label: "Part system attribute name",
            examples: [
              { code: '<hson-part lib="components" at="foo"/>', highlight: "lib" },
              { code: '<hson-part lib="components" at="foo"/>', highlight: "at" },
              { code: '<hson-part at=^{each.kind}/>', highlight: "at" },
              { code: '<hson-part at="components/%{member}"/>', highlight: "at" }
            ],
            inherits: "attribute.name",
            house: {
              dark: { foreground: "#a99abd" },
              light: { foreground: "#6F4F8F" }
            }
          }
        },
        selector: {
          library: {
            label: "Part selector Library",
            examples: [
              { code: '<hson-part lib="components" at="foo"/>', highlight: "components" },
              { code: '<hson-part at="components/foo"/>', highlight: "components" },
              { code: '<hson-part lib=components at=foo/>', highlight: "components" }
            ],
            inherits: "value.string",
            house: {
              dark: { foreground: "#8daa9c" },
              light: { foreground: "#536E61" }
            }
          },
          member: {
            label: "Part selector member",
            examples: [
              { code: '<hson-part at="foo"/>', highlight: "foo" },
              { code: '<hson-part at="components/foo"/>', highlight: "foo" },
              { code: '<hson-part at=foo/>', highlight: "foo" },
              { code: '<hson-part at=components/foo/>', highlight: "foo" }
            ],
            inherits: "value.string"
          },
          separator: {
            label: "Part selector separator",
            examples: [
              { code: '<hson-part at="components/foo"/>', highlight: "/", occurrence: 1 },
              { code: '<hson-part at=components/foo/>', highlight: "/", occurrence: 1 }
            ],
            inherits: "punctuation.assignment"
          }
        },
        declaration: {
          label: "Part declaration",
          examples: [
            { code: "<section hson:part/>", highlight: "part" }
          ],
          inherits: "part.directive",
        },
        directive: {
          label: "Part directive",
          examples: [
            { code: "<section part:optional/>", highlight: "optional" }
          ],
          house: {
            dark: { foreground: "#9989b6" },
            light: { foreground: "#6F4F8F" }
          }
        },
        receivingArgument: {
          label: "Receiving argument",
          examples: [
            { code: "<section data:slide=%{currentSlide}/>", highlight: "slide", occurrence: 1 }
          ],
          house:_local
        },
        receivingKind: {
          label: "Receiving argument kind",
          examples: [
            { code: "<section data:slide=%{currentSlide}/>", highlight: "data" }
          ],
          inherits: "attribute.qualifier"
        },
        sendingArgument: {
          label: "Sending argument",
          examples: [
            { code: "<hson-part slide:data=^{currentSlide}/>", highlight: "slide", occurrence: 1 }
          ],
          house: {
            dark: { foreground: _outgoing.dark },
            light: { foreground: _outgoing.light }
          }
        }
      },
      iteration: {
        name: {
          label: "Iteration binding",
          examples: [
            { code: "<section for:row=^{rows}/>", highlight: "row", occurrence: 1 },
            { code: "<section per:item=^{items}/>", highlight: "item", occurrence: 1 }
          ],
          house: {
            dark: { foreground: _each.dark },
            light: { foreground: _each.light }
          }
        }
      },
      reference: {
        incoming: {
          content: {
            label: "Incoming placeholder name",
            examples: [{ code: '<p "%{slide}"/>', highlight: "slide" }],
            // inherits: "reference.local.content",
            house: _placeholder,
          },
          marker: {
            label: "Incoming reference marker",
            examples: [
              { code: "<p \"%{slide}\"/>", highlight: "%" }
            ],
            house: {
              dark: { foreground: "#eee7d8", intensity: 0.75 },
              light: { foreground: "#3D434B", intensity: 0.75 }
            }
          }
        },
        local: {
          content: {
            label: "Local reference root (unresolved or shared binding fallback)",
            examples: [
              { code: "<p \"^{slide.title}\"/>", highlight: "slide" }
            ],
            house: {
              dark: { foreground: "#d99db5" },
              light: { foreground: "#28313D" }
            }
          },

          marker: {
            label: "Local reference marker",
            examples: [
              { code: "<p \"^{slide.title}\"/>", highlight: "^" }
            ],
            house: {
              dark: { foreground: "#eee7d8", intensity: 0.75 },
              light: { foreground: "#3D434B", intensity: 0.75 }
            }
          }
        },
        member: {
          label: "Local reference member",
          examples: [
            { code: "<p \"^{slide.title}\"/>", highlight: "title" }
          ],
          // inherits: "reference.local.content",
          house: {
            dark: { foreground: "#eee7d8", intensity: 0.7 },
            light: { foreground: "#3D434B", intensity: 0.7 }
          }
        },
        separator: {
          label: "Reference member separator",
          examples: [
            { code: "<p \"^{slide.title}\"/>", highlight: "." }
          ],
          inherits: "reference.local.content"
        },
        selectorOpen: {
          label: "Reference selector opening bracket",
          examples: [
            { code: "<p \"^{slides[0]}\"/>", highlight: "[" }
          ],
          inherits: "reference.local.content"
        },
        selectorClose: {
          label: "Reference selector closing bracket",
          examples: [
            { code: "<p \"^{slides[0]}\"/>", highlight: "]" }
          ],
          inherits: "reference.local.content"
        }
      },
      value: {
        string: {
          label: "String content",
          examples: [
            { code: "<button class=\"primary\"/>", highlight: "primary" },
            { code: '<div lib="components" at="foo"/>', highlight: "components" },
            { code: '<hson-part at="components/%{member}"/>', highlight: "components/" }
          ],
          house: {
            dark: { foreground: "#abb0b0" },
            light: { foreground: "#435B35" }
          }
        },
        number: {
          label: "Number",
          examples: [
            { code: "<count 42>", highlight: "42" },
            { code: "<amount -1.5>", highlight: "-1.5" }
          ],
          house: {
            dark: { foreground: "#D8B78F" },
            light: { foreground: "#76552E" }
          }
        },
        primitive: {
          label: "Boolean or null",
          examples: [
            { code: "<enabled true>", highlight: "true" },
            { code: "<empty null>", highlight: "null" }
          ],
          house: {
            dark: { foreground: "#B8B5DD" },
            light: { foreground: "#5B5486" }
          }
        }
      },
      identity: {
        quid: {
          label: "Runtime QUID",
          examples: [
            { code: "<p @012345678/>", highlight: "012345678" }
          ],
          inherits: "identity.quad"
        },
        quad: {
          label: "Authored QUAD",
          examples: [
            { code: "<section @:deck/>", highlight: "deck" }
          ],
          house: {
            dark: { foreground: "#C4ADE2" },
            light: { foreground: "#70518F" }
          }
        },
        punctuation: {
          marker: {
            label: "Identity marker",
            examples: [
              { code: "<section @:deck/>", highlight: "@" },
              { code: "<p @012345678/>", highlight: "@" }
            ],
            inherits: "identity.quad",
            house: {
              dark: { foreground: "#C4ADE2", intensity: 0.7 },
              light: { foreground: "#70518F", intensity: 0.7 }
            }
          },
          colon: {
            label: "Identity colon",
            examples: [
              { code: "<section @:deck/>", highlight: ":" }
            ],
            inherits: "punctuation.colon"
          }
        }
      },
      punctuation: {
        // Syntax colors apply where bracket colorization does not supersede them.
        // With bracket colorization enabled, visible delimiters may use VS Code's
        // bracket highlight palette; TS/TSX Hson depth decorations reproduce it.
        // Tune those colors in ui.editor["editorBracketHighlight.foregroundN"].
        colon: {
          label: "Attribute colon",
          examples: [
            { code: "<section data:slide=%{slide}/>", highlight: ":" }
          ],
          house: {
            dark: { foreground: "#74a5bd", intensity: 0.85 },
            light: { foreground: "#354967", intensity: 0.85 }
          }
        },
        assignment: {
          label: "Attribute assignment",
          examples: [
            { code: "<button class=\"primary\"/>", highlight: "=" }
          ],
          house: {
            dark: { foreground: "#baa9c1", intensity: 0.85 },
            light: { foreground: "#344154", intensity: 0.85 }
          }
        },
        interpolation: {
          label: "JavaScript interpolation marker",
          examples: [
            { code: "<p ${title}/>", highlight: "$" }
          ],
          inherits: "punctuation.assignment",
          house: {
            dark: { foreground: "#5994cc" },
            light: { foreground: "#2766a0" }
          }
        },
        tagOpen: {
          label: "Opening tag delimiter",
          examples: [
            { code: "<section/>", highlight: "<" }
          ],
          house: {
            dark: { foreground: "#7f718b" },
            light: { foreground: "#5B6573" }
          }
        },
        tagClose: {
          label: "Closing tag delimiter",
          examples: [
            { code: "<section/>", highlight: ">" }
          ],
          inherits: "punctuation.tagOpen"
        },
        selfClosingSlash: {
          label: "Self-closing slash",
          examples: [
            { code: "<section/>", highlight: "/" }
          ],
          inherits: "punctuation.tagOpen"
        },
        arrayOpen: {
          label: "Opening array delimiter",
          examples: [
            { code: "<items [1, 2]>", highlight: "[" }
          ],
          inherits: "punctuation.tagOpen"
        },
        arrayClose: {
          label: "Closing array delimiter",
          examples: [
            { code: "<items [1, 2]>", highlight: "]" }
          ],
          inherits: "punctuation.tagOpen"
        },
        sequenceSeparator: {
          label: "Sequence separator",
          examples: [
            { code: "<items [1, 2]>", highlight: "," }
          ],
          inherits: "punctuation.tagOpen"
        },
        referenceOpen: {
          label: "Opening reference or interpolation brace",
          examples: [
            { code: "<p \"%{title}\"/>", highlight: "{" }
          ],
          inherits: "punctuation.tagOpen"
        },
        referenceClose: {
          label: "Closing reference or interpolation brace",
          examples: [
            { code: "<p \"%{title}\"/>", highlight: "}" }
          ],
          inherits: "punctuation.tagOpen"
        },
        quoteOpen: {
          label: "Opening quote",
          examples: [
            { code: "<p \"Hello\"/>", highlight: "\"", occurrence: 1 }
          ],
          house: {
            dark: { foreground: "#BDD0AB", intensity: 0.6 },
            light: { foreground: "#101820", intensity: 0.6 }
          }
        },
        quoteClose: {
          label: "Closing quote",
          examples: [
            { code: "<p \"Hello\"/>", highlight: "\"", occurrence: 2 }
          ],
          inherits: "punctuation.quoteOpen"
        }
      },
      comment: {
        line: {
          label: "Line comment and marker",
          examples: [
            { code: "// A note", highlight: "A note" },
            { code: "// A note", highlight: "//" }
          ],
          house: {
            dark: { foreground: "#939DAA" },
            light: { foreground: "#606B78" }
          }
        }
      },
      escape: {
        character: {
          label: "String escape",
          examples: [
            { code: "<p \"line\\nbreak\"/>", highlight: "\\n" }
          ],
          house: {
            dark: { foreground: "#D4BA86" },
            light: { foreground: "#7A602B" }
          }
        }
      },
      invalid: {
        character: {
          label: "Invalid escape",
          examples: [
            { code: "<p \"bad\\qescape\"/>", highlight: "\\q" }
          ],
          house: {
            dark: { foreground: "#F08B94" },
            light: { foreground: "#A52A3A" }
          }
        }
      }
    },
    general: {
      comment: {
        label: "Comment",
        inherits: "syntax.hson.comment.line"
      },
      string: {
        label: "String",
        inherits: "syntax.hson.value.string"
      },
      number: {
        label: "Number",
        inherits: "syntax.hson.value.number"
      },
      keyword: {
        label: "Keyword",
        inherits: "syntax.hson.value.primitive"
      },
      type: {
        label: "Type",
        inherits: "syntax.hson.element.name"
      },
      function: {
        label: "Function",
        inherits: "syntax.hson.part.sendingArgument"
      },
      variable: {
        label: "Variable",
        inherits: "syntax.hson.attribute.name"
      },
      punctuation: {
        label: "Punctuation",
        inherits: "syntax.hson.punctuation.tagOpen"
      },
      escape: {
        label: "Escape",
        inherits: "syntax.hson.escape.character"
      },
      invalid: {
        label: "Invalid",
        inherits: "syntax.hson.invalid.character"
      }
    }
  },
  ui: {
    palette: {
      background: {
        house: {
          dark: { foreground: "#0f141a" },
          light: { foreground: "#FAF9F6" }
        }
      },
      foreground: {
        house: {
          dark: { foreground: "#D8DEE8" },
          light: { foreground: "#28313D" }
        }
      },
      surface: {
        house: {
          dark: { foreground: "#1B222C" },
          light: { foreground: "#F0EFEB" }
        }
      },
      border: {
        house: {
          dark: { foreground: "#34404E" },
          light: { foreground: "#D2D6DB" }
        }
      },
      selection: {
        house: {
          dark: { foreground: "#30485E" },
          light: { foreground: "#D8E5EF" }
        }
      },
      accent: {
        house: {
          dark: { foreground: "#8CC7D9" },
          light: { foreground: "#245C70" }
        }
      }
    },
    editor: {
      "editor.background": {
        inherits: "ui.palette.background"
      },
      "editor.foreground": {
        inherits: "ui.palette.foreground"
      },
      "editor.selectionBackground": {
        inherits: "ui.palette.selection"
      },
      "editor.lineHighlightBackground": {
        inherits: "ui.palette.surface"
      },
      "editorCursor.foreground": {
        inherits: "ui.palette.accent"
      },
      "editorLineNumber.foreground": {
        inherits: "syntax.hson.comment.line"
      },
      "editorLineNumber.activeForeground": {
        inherits: "ui.palette.foreground"
      },
      "editorGroupHeader.tabsBackground": {
        inherits: "ui.palette.surface"
      },
      "editorBracketHighlight.foreground1": {
        inherits: "syntax.hson.punctuation.tagOpen"
      },
      "editorBracketHighlight.foreground2": {
        inherits: "syntax.hson.part.receivingArgument"
      },
      "editorBracketHighlight.foreground3": {
        inherits: "syntax.hson.part.directive"
      },
      "editorBracketHighlight.foreground4": {
        inherits: "syntax.hson.punctuation.tagOpen"
      },
      "editorBracketHighlight.foreground5": {
        inherits: "syntax.hson.part.receivingArgument"
      },
      "editorBracketHighlight.foreground6": {
        inherits: "syntax.hson.part.directive"
      }
    },
    workbench: {
      foreground: {
        inherits: "ui.palette.foreground"
      },
      focusBorder: {
        inherits: "ui.palette.accent"
      },
      "sideBar.background": {
        inherits: "ui.palette.surface"
      },
      "sideBar.foreground": {
        inherits: "ui.palette.foreground"
      },
      "sideBar.border": {
        inherits: "ui.palette.border"
      },
      "activityBar.background": {
        inherits: "ui.palette.surface"
      },
      "activityBar.foreground": {
        inherits: "ui.palette.foreground"
      },
      "statusBar.background": {
        inherits: "ui.palette.surface"
      },
      "statusBar.foreground": {
        inherits: "ui.palette.foreground"
      },
      "titleBar.activeBackground": {
        inherits: "ui.palette.surface"
      },
      "titleBar.activeForeground": {
        inherits: "ui.palette.foreground"
      },
      "tab.activeBackground": {
        inherits: "ui.palette.background"
      },
      "tab.activeForeground": {
        inherits: "ui.palette.foreground"
      },
      "tab.inactiveBackground": {
        inherits: "ui.palette.surface"
      },
      "panel.background": {
        inherits: "ui.palette.surface"
      },
      "panel.border": {
        inherits: "ui.palette.border"
      },
      "input.background": {
        inherits: "ui.palette.background"
      },
      "input.foreground": {
        inherits: "ui.palette.foreground"
      },
      "input.border": {
        inherits: "ui.palette.border"
      },
      "list.activeSelectionBackground": {
        inherits: "ui.palette.selection"
      },
      "list.activeSelectionForeground": {
        inherits: "ui.palette.foreground"
      }
    }
  },
  branding: {
    palette: {
      blue: "#00adf6",
      yellow: "#c9d100",
      pink: "#ff4a8c",
      green: "#39a500"
    },
    library: {
      enabled: true,
      opacity: 1,
      letters: {
        h: "blue",
        s: "yellow",
        o: "pink",
        n: "green"
      },
      separator: {
        color: "#7247d4"
      }
    },
    authoring: {
      opacity: 0.7,
      letters: {
        H: "blue",
        s: "yellow",
        o: "pink",
        n: "green"
      }
    }
  }
} as const;

// Compatibility exports; runtime consumers import the internal modules directly.
export { hsonTokenDefinitions, hsonTokenModifierDefinitions, hsonTokenScopes, hsonModifiersForScopes, hsonTypeForScope, type HsonTokenType } from "./appearance-internals.js";
export { hsonIdentityMarkers, HSON_LIBRARY_SEPARATOR_COLOR_ID, type AppearanceColorKey } from "./appearance-branding.generated.js";
