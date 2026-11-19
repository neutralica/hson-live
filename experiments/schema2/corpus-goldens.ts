// Frozen Schema 1.0 sources, candidates and expectations from the feasibility corpus.
export type CorpusGolden = Readonly<{
  id: "D02" | "D07" | "D09" | "D10" | "D11";
  digest: string;
  schema: string;
  valid: string;
  invalid: string;
  expected: Readonly<Record<string, unknown>>;
  mutations: readonly Readonly<{
    label: string; from: string; to: string; accept: boolean; expected?: Readonly<Record<string, unknown>>;
  }>[];
}>;

export const corpus: readonly CorpusGolden[] = [
  {
    id: "D02",
    digest: "d0d04880a4a8953655cd6bcd875cc10eb4eff7b3c0ee81752349937e44563bc8",
    schema: `<
  type "data"
  content <
    customerId <string <prefix "cus-" minlen 5 maxlen 32>>
    displayName <string <minlen 1 maxlen 80>>
    active "boolean"
    loyaltyScore "number"
    nickname <optional <union ["string", "null"]>>
    phones <optional <array "string">>
    address <content <
      line1 "string"
      line2 <optional "string">
      city "string"
      postalCode <string <minlen 3 maxlen 12>>
      country <string <len 2 alphabet "ABCDEFGHIJKLMNOPQRSTUVWXYZ">>
    >>
    legacyRecord "null"
    integrationPayload "any"
  >
>`,
    valid: `<
  customerId "cus-2048"
  displayName "Mina Patel"
  active true
  loyaltyScore 42.5
  nickname null
  phones []
  address <line1 "18 Cedar Lane" line2 "" city "Bristol" postalCode "BS1 4ST" country "GB">
  legacyRecord null
  integrationPayload <crm "north" tags ["wholesale", "returning"]>
>`,
    invalid: `<
  customerId "cus-2048"
  displayName "Mina Patel"
  active true
  loyaltyScore 42.5
  nickname null
  phones []
  address <line1 "18 Cedar Lane" line2 "" city "Bristol" postalCode "BS1 4ST" country "GB" deliveryZone "west">
  legacyRecord null
  integrationPayload <crm "north" tags ["wholesale", "returning"]>
>`,
    expected: { code: "UNKNOWN_KEY", path: ["address","deliveryZone"] },
    mutations: [
      { label: "optional fields absent", accept: true,
        from: "  nickname null\n  phones []\n", to: "" },
      { label: "present-empty nickname", accept: true,
        from: "nickname null", to: "nickname \"\"" },
      { label: "null is not an array", accept: false,
        from: "phones []", to: "phones null", expected: { code: "TYPE_MISMATCH", path: ["phones"] } },
      { label: "required null marker missing", accept: false,
        from: "  legacyRecord null\n", to: "", expected: { code: "MISSING_REQUIRED", path: ["legacyRecord"] } },
      { label: "any accepts an array", accept: true,
        from: "<crm \"north\" tags [\"wholesale\", \"returning\"]>", to: "[1, null, <source \"crm\">]" },
      { label: "any member remains required", accept: false,
        from: "  integrationPayload <crm \"north\" tags [\"wholesale\", \"returning\"]>\n", to: "", expected: { code: "MISSING_REQUIRED", path: ["integrationPayload"] } },
    ],
  },
  {
    id: "D07",
    digest: "eaca843e431a89d8ac2300af308117d5d9df1c17a3395869cc1d71a1d8eea989",
    schema: `<
  type "data"
  defs <
    Timestamp <number <int true min 0>>
    Temperature <union [<number <min -80 max 80>>, "null"]>
    Sample <tuple [<ref "Timestamp">, <ref "Temperature">]>
  >
  content <
    deviceId <string <prefix "env-">>
    location <tuple [<number <min -90 max 90>>, <number <min -180 max 180>>]>
    calibration <tuple ["number", "number", "number"]>
    quarterHourReadings <array <content <ref "Temperature"> len 4>>
    samples <array <content <ref "Sample"> minlen 1 maxlen 96>>
  >
>`,
    valid: `<
  deviceId "env-roof-7"
  location [43.0731, -89.4012]
  calibration [1.002, -0.14, 0]
  quarterHourReadings [18.2, 18.4, null, 18.7]
  samples [[1794920400000, 18.2], [1794921300000, null]]
>`,
    invalid: `<
  deviceId "env-roof-7"
  location [43.0731, -89.4012]
  calibration [1.002, -0.14, 0]
  quarterHourReadings [18.2, 18.4, null]
  samples [[1794920400000, 18.2], [1794921300000, null]]
>`,
    expected: { code: "INVALID_CONSTRAINT", path: ["quarterHourReadings"], expected: "len" },
    mutations: [
      { label: "tuple rejects extra coordinate", accept: false,
        from: "location [43.0731, -89.4012]", to: "location [43.0731, -89.4012, 260]", expected: { code: "TUPLE_INDEX_OUT_OF_RANGE", path: ["location",2] } },
      { label: "timestamp remains integral through a ref", accept: false,
        from: "1794920400000, 18.2", to: "1794920400000.5, 18.2", expected: { expected: "int", path: ["samples",0,0] } },
    ],
  },
  {
    id: "D09",
    digest: "e9930f350aa76c47494204251ace75c47fa0cfed806037c1c8dc5770286739e3",
    schema: `<
  type "data"
  defs <
    Entry <union [<ref "Link">, <ref "Section">]>
    Link <content <
      kind <exact "link">
      label <string <minlen 1 maxlen 60>>
      href <string <prefix "/">>
      newWindow <optional "boolean">
    >>
    Section <content <
      kind <exact "section">
      label <string <minlen 1 maxlen 60>>
      children <array <ref "Entry">>
      collapsed <optional "boolean">
    >>
  >
  content <
    application <exact "workbench">
    entries <array <ref "Entry">>
  >
>`,
    valid: `<
  application "workbench"
  entries [
    <kind "link" label "Overview" href "/overview">,
    <kind "section" label "Projects" children [
      <kind "link" label "Active" href "/projects/active">,
      <kind "section" label "Archive" children [] collapsed true>
    ]>
  ]
>`,
    invalid: `<
  application "workbench"
  entries [
    <kind "link" label "Overview" href "/overview">,
    <kind "section" label "Projects" children [
      <kind "link" label "Active" href "/projects/active">,
      <kind "section" label "Archive" collapsed true>
    ]>
  ]
>`,
    expected: { code: "MISSING_REQUIRED", path: ["entries",1,"children",1,"children"] },
    mutations: [
      { label: "empty top-level navigation", accept: true,
        from: "<kind \"link\" label \"Overview\" href \"/overview\">,\n    <kind \"section\" label \"Projects\" children [\n      <kind \"link\" label \"Active\" href \"/projects/active\">,\n      <kind \"section\" label \"Archive\" children [] collapsed true>\n    ]>", to: "" },
    ],
  },
  {
    id: "D10",
    digest: "1f159e4889ec0b26a8e075c4a6bcd810591c19c029c840effd661de273613646",
    schema: `<
  type "data"
  defs <
    Paragraph <content <kind <exact "paragraph"> content "string">>
    Heading <content <kind <exact "heading"> content "string">>
    Code <content <
      kind <exact "code">
      language <optional <union [<exact "json">, <exact "html">, <exact "hson">]>>
      content "string"
    >>
    List <content <
      kind <exact "list">
      language <optional "string">
      content "string"
    >>
    Block <union [<ref "Paragraph">, <ref "Heading">, <ref "Code">, <ref "List">]>
    Column <array <ref "Block">>
    Slide <content <
      id "string"
      title <optional "string">
      subtitle <optional "string">
      column1 <ref "Column">
      column2 <optional <ref "Column">>
      column3 <optional <ref "Column">>
      footer <optional "string">
    >>
  >
  content <slides <array <ref "Slide">>>
>`,
    valid: `<slides [
  <id "intro" title "Quarterly release" subtitle "Platform team"
   column1 [<kind "heading" content "What shipped">, <kind "paragraph" content "Faster imports and clearer diagnostics.">]
   column2 [<kind "list" content "Import preview; schema hints; audit history">]
   footer "November 2026">,
  <id "example" title "A small record"
   column1 [<kind "code" language "hson" content "<ready true>">]
   column2 []>
]>`,
    invalid: `<slides [
  <id "intro" title "Quarterly release" subtitle "Platform team"
   column1 [<kind "heading" content "What shipped">, <kind "paragraph" content "Faster imports and clearer diagnostics.">]
   column2 [<kind "list" content "Import preview; schema hints; audit history">]
   footer "November 2026">,
  <id "example" title "A small record"
   column1 [<kind "code" language "typescript" content "<ready true>">]
   column2 []>
]>`,
    expected: { code: "TYPE_MISMATCH", path: ["slides",1,"column1",0,"language"] },
    mutations: [
      { label: "optional code language absent", accept: true,
        from: "language \"hson\" ", to: "" },
      { label: "optional empty column absent", accept: true,
        from: "\n   column2 []", to: "" },
      { label: "required column absent", accept: false,
        from: "   column1 [<kind \"code\" language \"hson\" content \"<ready true>\">]\n", to: "", expected: { code: "MISSING_REQUIRED", path: ["slides",1,"column1"] } },
    ],
  },
  {
    id: "D11",
    digest: "642c34fc4d194751c28f29d66c1784834052b1edd1143e7bc6cde40bfc1cb113",
    schema: `<
  type "data"
  content <
    dashboardId "string"
    widgets <array <
      content <content <
        position "string"
        title <string <minlen 1>>
        payload "any"
      >>
      maxlen 12
      unique <
        by "position"
        cases [
          ["top-left", ["TL"]],
          ["top-right", ["TR"]],
          ["bottom-left", ["BL"]],
          ["bottom-right", ["BR"]],
          ["top-half", ["TL", "TR"]],
          ["bottom-half", ["BL", "BR"]],
          ["left-half", ["TL", "BL"]],
          ["right-half", ["TR", "BR"]],
          ["full", ["TL", "TR", "BL", "BR"]],
          ["decorative", []]
        ]
      >
    >>
  >
>`,
    valid: `<
  dashboardId "ops-overview"
  widgets [
    <position "top-half" title "Request rate" payload <metric "requests" windowMinutes 15>>,
    <position "bottom-left" title "Queue depth" payload <metric "queue">>,
    <position "bottom-right" title "Recent deploy" payload "release-81">,
    <position "decorative" title "Grid guide" payload null>,
    <position "decorative" title "Watermark" payload <text "Internal">>
  ]
>`,
    invalid: `<
  dashboardId "ops-overview"
  widgets [
    <position "top-half" title "Request rate" payload <metric "requests" windowMinutes 15>>,
    <position "top-right" title "Queue depth" payload <metric "queue">>,
    <position "bottom-right" title "Recent deploy" payload "release-81">,
    <position "decorative" title "Grid guide" payload null>,
    <position "decorative" title "Watermark" payload <text "Internal">>
  ]
>`,
    expected: { code: "INVALID_CONSTRAINT", path: ["widgets",1,"position"], relatedPath: ["widgets",0,"position"], conflictingKey: "TR" },
    mutations: [
      { label: "unknown selector", accept: false,
        from: "position \"bottom-left\"", to: "position \"floating\"", expected: { code: "INVALID_CONSTRAINT", path: ["widgets",1,"position"] } },
      { label: "duplicate occupied selector", accept: false,
        from: "position \"bottom-left\"", to: "position \"top-half\"", expected: { conflictingKey: "TL" } },
      { label: "missing selector", accept: false,
        from: "position \"bottom-left\" ", to: "", expected: { code: "MISSING_REQUIRED", path: ["widgets",1,"position"] } },
    ],
  },
];
