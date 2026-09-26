import { ANY_DOCUMENT, Hson, hsonLiveMap, type HsonDocument, type HsonSchema } from "../src/index.ts";
import type { HsonNode } from "../src/core/types.ts";
import type { LiveMapDocumentLibrary } from "../src/types/livemap.types.ts";
import type { Evidence as PageEvidence } from "./fixtures/hson-schema-document/producer.PageSchema.hson-schema.generated.ts";
import type { Evidence as AnyDocumentEvidence } from "./fixtures/hson-schema-document/producer.AnyDocumentSchema.hson-schema.generated.ts";
import type { Evidence as MainDocumentEvidence } from "./fixtures/hson-schema-document/producer.MainDocumentSchema.hson-schema.generated.ts";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type BroadEndpoint = HsonNode | string | undefined;

function makeDoc(): HsonDocument {
  return Hson.document`<main <hr/> <p "x"/> />`;
}

const shell = (insert: HsonDocument) => Hson.document`
  <html <head/> <body ${insert} /> />
`;

declare const PageSchema: HsonSchema<PageEvidence["value"], "document">;
declare const AnyGeneratedSchema: HsonSchema<AnyDocumentEvidence["value"], "document">;
declare const MainGeneratedSchema: HsonSchema<MainDocumentEvidence["value"], "document">;

// Preserve element information for ordinary arrays as well as broad HsonNode arrays.
type TextNode = Readonly<{ $_tag: "_hson_str"; $_content: readonly [string] }>;
type TextArrayRoot = Readonly<{
  $_tag: "_hson_root";
  $_content: readonly [Readonly<{ $_tag: "main"; $_content: readonly TextNode[] }>];
}>;
declare const textArray: LiveMapDocumentLibrary<TextArrayRoot, "page">;

if (false) {
  const doc = Hson.document`<main <hr/> <p "x"/> />`;
  const annotated: HsonDocument = doc;
  const map = hsonLiveMap.fromLibraries({
    direct: { document: doc },
    annotated: { document: annotated },
    returned: { document: makeDoc() },
    home: { document: shell(Hson.document`<section "slide00"/>`) },
    explicit: { document: doc, schema: ANY_DOCUMENT },
  });

  const direct = map.lib("direct");
  const root = direct.at([]).snap();
  type Root = Expect<Equal<typeof root, HsonNode>>;
  const child = direct.at([0]).snap();
  type Child = Expect<Equal<typeof child, BroadEndpoint>>;
  direct.at([1]);
  const annotatedChild = map.lib("annotated").at([0]).snap();
  type AnnotatedChild = Expect<Equal<typeof annotatedChild, BroadEndpoint>>;
  const returnedChild = map.lib("returned").at([0]).snap();
  type ReturnedChild = Expect<Equal<typeof returnedChild, BroadEndpoint>>;
  const explicitChild = map.lib("explicit").at([0]).snap();
  type ExplicitChild = Expect<Equal<typeof explicitChild, BroadEndpoint>>;

  const home = map.lib("home");
  home.at([0]);
  const body = home.at([1]);
  const nested = home.at([1, 0]).snap();
  type Nested = Expect<Equal<typeof nested, BroadEndpoint>>;
  const relative = body.at([0]).snap();
  type Relative = Expect<Equal<typeof relative, BroadEndpoint>>;
  const fromRoot = home.at([]).at([1, 0]).snap();
  type FromRoot = Expect<Equal<typeof fromRoot, BroadEndpoint>>;
  const missing = home.at([999]).snap();
  type Missing = Expect<Equal<typeof missing, BroadEndpoint>>;
  const deeperMissing = home.at([999]).at([0]).snap();
  type DeeperMissing = Expect<Equal<typeof deeperMissing, BroadEndpoint>>;
  // @ts-expect-error Broad paths do not guarantee presence.
  const guaranteed: HsonNode | string = missing;

  const path: readonly number[] = [1, 0];
  const dynamic = home.at(path).snap();
  type Dynamic = Expect<Equal<typeof dynamic, BroadEndpoint>>;
  const relativeDynamic = body.at(path).snap();
  type RelativeDynamic = Expect<Equal<typeof relativeDynamic, BroadEndpoint>>;
  const proxy = home.proxy([1, 0]).$_.snap();
  type Proxy = Expect<Equal<typeof proxy, BroadEndpoint>>;
  const proxyRoot = home.proxy().$_.snap();
  type ProxyRoot = Expect<Equal<typeof proxyRoot, HsonNode>>;
  const proxyRelative = home.proxy().$_.at([1]).at([0]).snap();
  type ProxyRelative = Expect<Equal<typeof proxyRelative, BroadEndpoint>>;
  const proxyDynamic = home.proxy(path).$_.snap();
  type ProxyDynamic = Expect<Equal<typeof proxyDynamic, BroadEndpoint>>;
  map.lib("explicit").at([]).at([0]);
  map.lib("explicit").proxy([0]).$_.at([0]);

  // @ts-expect-error Document paths must be arrays.
  home.at(0);
  // @ts-expect-error Relative document paths must be arrays.
  body.at(0);
  // @ts-expect-error Proxy document paths must be arrays.
  home.proxy(0);
  // @ts-expect-error Document paths use numeric coordinates.
  home.at(["body"]);

  const precise = hsonLiveMap.fromLibraries({
    page: { document: '<main id="hero" <section "body"/>/>', schema: PageSchema },
  }).lib("page");
  const preciseRoot = precise.at([]).snap();
  type PreciseRoot = Expect<Equal<typeof preciseRoot, HsonNode>>;
  const section = precise.at([0]);
  const sectionValue = section.snap();
  type Section = Expect<Equal<typeof sectionValue, HsonNode>>;
  const text = precise.at([0, 0]).snap();
  type Text = Expect<Equal<typeof text, string>>;
  const relativeText = section.at([0]).snap();
  type RelativeText = Expect<Equal<typeof relativeText, string>>;
  const proxyText = precise.proxy([0, 0]).$_.snap();
  type ProxyText = Expect<Equal<typeof proxyText, string>>;
  const preciseDynamic = precise.at(path).snap();
  type PreciseDynamic = Expect<Equal<typeof preciseDynamic, BroadEndpoint>>;
  // @ts-expect-error The root has exactly one child.
  precise.at([1]);
  // @ts-expect-error The section has exactly one text child.
  precise.at([0, 1]);
  // @ts-expect-error Text cannot be traversed.
  precise.at([0, 0, 0]);
  // @ts-expect-error Relative traversal retains tuple bounds.
  section.at([1]);
  // @ts-expect-error Relative traversal cannot descend through text.
  section.at([0]).at([0]);
  // @ts-expect-error Proxy traversal retains tuple bounds.
  precise.proxy([1]);
  // @ts-expect-error Proxy locations cannot descend through text.
  precise.proxy([0, 0]).$_.at([0]);

  const generated = hsonLiveMap.fromLibraries({
    any: { document: doc, schema: AnyGeneratedSchema },
    main: { document: doc, schema: MainGeneratedSchema },
  });
  const arrayChild = generated.lib("any").at([0]).snap();
  type ArrayChild = Expect<Equal<typeof arrayChild, BroadEndpoint>>;
  const arrayNested = generated.lib("any").at([0, 0]).snap();
  type ArrayNested = Expect<Equal<typeof arrayNested, BroadEndpoint>>;
  const contentChild = generated.lib("main").at([999]).snap();
  type ContentChild = Expect<Equal<typeof contentChild, BroadEndpoint>>;
  const contentNested = generated.lib("main").at([0]).at([0]).snap();
  type ContentNested = Expect<Equal<typeof contentNested, BroadEndpoint>>;
  const contentProxy = generated.lib("main").proxy([0]).$_.snap();
  type ContentProxy = Expect<Equal<typeof contentProxy, BroadEndpoint>>;

  const arrayText = textArray.at([999]).snap();
  type ArrayText = Expect<Equal<typeof arrayText, string | undefined>>;
  const relativeArrayText = textArray.at([]).at([0]).snap();
  type RelativeArrayText = Expect<Equal<typeof relativeArrayText, string | undefined>>;
  const proxyArrayText = textArray.proxy([0]).$_.snap();
  type ProxyArrayText = Expect<Equal<typeof proxyArrayText, string | undefined>>;
  // @ts-expect-error Unknown array length does not allow descending through text.
  textArray.at([0, 0]);
  // @ts-expect-error Relative traversal retains the array element type.
  textArray.at([0]).at([0]);
}
