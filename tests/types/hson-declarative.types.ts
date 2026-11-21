import { dispatch_hson_declaration, recognize_hson_declaration } from "../../dist/internal/hson-declarative.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Expect<Value extends true> = Value;

const event = recognize_hson_declaration("<hson:event");
const schema = recognize_hson_declaration("<hson:schema");
const both = {
  "hson:event": () => 1,
  "hson:schema": () => "schema",
};
const partial: Pick<typeof both, "hson:event"> = both;

const automatic = dispatch_hson_declaration(event, both);
const eventOnly = dispatch_hson_declaration(event, { "hson:event": () => 1 }, "hson:event");
const schemaOnly = dispatch_hson_declaration(schema, { "hson:schema": source => source }, "hson:schema");
const selectedFromBoth = dispatch_hson_declaration(schema, both, "hson:schema");
const selectedFromPartial = dispatch_hson_declaration(event, partial, "hson:event");
declare const expectedDomain: "hson:event" | "hson:schema";
const selectedFromEither = dispatch_hson_declaration(event, both, expectedDomain);

type Inference = [
  Expect<Equal<typeof automatic, number | string>>,
  Expect<Equal<typeof eventOnly, number>>,
  Expect<Equal<typeof schemaOnly, string>>,
  Expect<Equal<typeof selectedFromBoth, string>>,
  Expect<Equal<typeof selectedFromPartial, number>>,
  Expect<Equal<typeof selectedFromEither, number | string>>,
];

// @ts-expect-error Automatic dispatch requires both adapters, even when the object has hidden keys.
const result: number = dispatch_hson_declaration(recognize_hson_declaration("<hson:schema"), partial);
result.toFixed();

// @ts-expect-error Automatic dispatch requires the Schema adapter.
dispatch_hson_declaration(event, { "hson:event": () => 1 });
// @ts-expect-error Automatic dispatch requires the Event adapter.
dispatch_hson_declaration(schema, { "hson:schema": () => "schema" });
// @ts-expect-error Supplying undefined still selects automatic dispatch.
dispatch_hson_declaration(event, partial, undefined);
// @ts-expect-error Explicit Schema selection requires the Schema adapter.
dispatch_hson_declaration(schema, partial, "hson:schema");
// @ts-expect-error A variable that can select Schema also requires a Schema adapter.
dispatch_hson_declaration(event, partial, expectedDomain);
// @ts-expect-error An unsupported name cannot be selected explicitly.
dispatch_hson_declaration(event, both, "hson:query");

declare const optionalSchema: { "hson:schema"?: () => string };
// @ts-expect-error The selected adapter must be required.
dispatch_hson_declaration(schema, optionalSchema, "hson:schema");
// @ts-expect-error The automatic result can be a string.
const numberOnly: number = automatic;
// @ts-expect-error Explicit Event selection preserves the numeric result.
const eventText: string = eventOnly;

declare function overloadedAdapter(source: string): number;
declare function overloadedAdapter(source: number): string;
// @ts-expect-error Dispatch passes a string, so the numeric-input overload cannot supply a string result.
const overloadedText: string = dispatch_hson_declaration(event, { "hson:event": overloadedAdapter }, "hson:event");
