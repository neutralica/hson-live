import {
  ordered_projected_array, ordered_projected_object, type OrderedProjectedValue,
} from "../../src/core/ordered-projected-value.js";
import {
  application_name as member, expression_group, header, member_map, operation as op, value,
  type SchemaHeader, type SchemaOccurrence,
} from "./structure.js";

export const optional = (name: string, body: SchemaOccurrence) => member(name, body, [header("optional")]);
export const data = (...clauses: SchemaOccurrence[]) => op("data", clauses.length ? expression_group(clauses) : undefined);
export const members = (...fields: SchemaOccurrence[]) => op("members", member_map(fields));
export const object = (...fields: SchemaOccurrence[]) => op("object", member_map(fields));
export const defs = (...definitions: SchemaOccurrence[]) => op("defs", member_map(definitions));
export const ref = (name: string) => op("ref", value(name));
export const exact = (literal: OrderedProjectedValue) => op("exact", value(literal));
export const str = (...rules: SchemaHeader[]) => op("string", undefined, rules);
export const num = (...rules: SchemaHeader[]) => op("number", undefined, rules);
export const array = (item: SchemaOccurrence, ...rules: SchemaHeader[]) => op("array", item, rules);
export const tuple = (...items: SchemaOccurrence[]) => op("tuple", expression_group(items));
export const union = (...branches: SchemaOccurrence[]) => op("union", expression_group(branches));

// These declarations are independent inputs. The frozen 1.0 targets are in corpus-goldens.ts.
const D02 = data(members(
  member("customerId", str(header("prefix", "cus-"), header("minlen", "5"), header("maxlen", "32"))),
  member("displayName", str(header("minlen", "1"), header("maxlen", "80"))),
  member("active", op("boolean")),
  member("loyaltyScore", num()),
  optional("nickname", union(str(), op("null"))),
  optional("phones", array(str())),
  member("address", object(
    member("line1", str()), optional("line2", str()), member("city", str()),
    member("postalCode", str(header("minlen", "3"), header("maxlen", "12"))),
    member("country", str(header("len", "2"), header("alphabet", "ABCDEFGHIJKLMNOPQRSTUVWXYZ"))),
  )),
  member("legacyRecord", op("null")),
  member("integrationPayload", op("any")),
));

const D07 = data(defs(
  member("Timestamp", num(header("int"), header("min", "0"))),
  member("Temperature", union(num(header("min", "-80"), header("max", "80")), op("null"))),
  member("Sample", tuple(ref("Timestamp"), ref("Temperature"))),
), members(
  member("deviceId", str(header("prefix", "env-"))),
  member("location", tuple(num(header("min", "-90"), header("max", "90")), num(header("min", "-180"), header("max", "180")))),
  member("calibration", tuple(num(), num(), num())),
  member("quarterHourReadings", array(ref("Temperature"), header("len", "4"))),
  member("samples", array(ref("Sample"), header("minlen", "1"), header("maxlen", "96"))),
));

const label = () => member("label", str(header("minlen", "1"), header("maxlen", "60")));
const D09 = data(defs(
  member("Entry", union(ref("Link"), ref("Section"))),
  member("Link", object(member("kind", exact("link")), label(), member("href", str(header("prefix", "/"))), optional("newWindow", op("boolean")))),
  member("Section", object(member("kind", exact("section")), label(), member("children", array(ref("Entry"))), optional("collapsed", op("boolean")))),
), members(member("application", exact("workbench")), member("entries", array(ref("Entry")))));

const block = (kind: string, ...fields: SchemaOccurrence[]) =>
  object(member("kind", exact(kind)), ...fields, member("content", str()));
const D10 = data(defs(
  member("Paragraph", block("paragraph")),
  member("Heading", block("heading")),
  member("Code", block("code", optional("language", union(exact("json"), exact("html"), exact("hson"))))),
  member("List", block("list", optional("language", str()))),
  member("Block", union(ref("Paragraph"), ref("Heading"), ref("Code"), ref("List"))),
  member("Column", array(ref("Block"))),
  member("Slide", object(
    member("id", str()), optional("title", str()), optional("subtitle", str()),
    member("column1", ref("Column")), optional("column2", ref("Column")), optional("column3", ref("Column")),
    optional("footer", str()),
  )),
), members(member("slides", array(ref("Slide")))));

const row = (selector: string, ...keys: string[]) => ordered_projected_array([selector, ordered_projected_array(keys)]);
const relation = ordered_projected_object([
  ["by", "position"],
  ["cases", ordered_projected_array([
    row("top-left", "TL"), row("top-right", "TR"), row("bottom-left", "BL"), row("bottom-right", "BR"),
    row("top-half", "TL", "TR"), row("bottom-half", "BL", "BR"), row("left-half", "TL", "BL"),
    row("right-half", "TR", "BR"), row("full", "TL", "TR", "BL", "BR"), row("decorative"),
  ])],
]);
const D11 = data(members(
  member("dashboardId", str()),
  member("widgets", array(object(
    member("position", str()), member("title", str(header("minlen", "1"))), member("payload", op("any")),
  ), header("maxlen", "12"), header("unique", value(relation)))),
));

export const declarations = { D02, D07, D09, D10, D11 };
