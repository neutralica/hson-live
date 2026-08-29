import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import { parse_hson } from "../src/api/transform/parsers/parse-hson.ts";
import { validate_livemap_document_schema_root, type InternalDocumentRootSchema } from "../src/api/livemap/livemap.document.schema.ts";
import { read_graph_backed_schema } from "../src/api/livemap/livemap.schema.ts";
import { encode_canonical_schema_graph_hson } from "../src/internal/canonical-schema/encode-hson.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
const check = (name: string, run: () => void): void => { run(); console.log(`ok ${++checks} - ${name}`); };
const schema = hson.liveMap.schema;

const User = schema.object.exact({
  name: schema.length(schema.string, { minimum: 1, maximum: 20 }),
  age: schema.optional(schema.integer(schema.minimum(schema.number, 0))),
  role: schema.pick("admin", "user"),
});

check("direct data constructor returns complete graph-backed Schema", () => assert.ok(read_graph_backed_schema(User)));
check("direct composed data accepts", () => assert.equal(User.validateRoot({ name: "Ada", age: 37, role: "admin" }).ok, true));
check("direct data Schema attaches to LiveMap", () => assert.deepEqual(hson.liveMap.fromJson({ name: "Ada", role: "admin" }).schema.use(User).snap(), { name: "Ada", role: "admin" }));
check("numeric minimum rejects", () => assert.equal(User.validateRoot({ name: "Ada", age: -1, role: "user" }).issues[0]?.code, "INVALID_CONSTRAINT"));
check("integer rejects fractional value", () => assert.equal(User.validateRoot({ name: "Ada", age: 1.5, role: "user" }).ok, false));
check("optional outside refinement permits absence", () => assert.equal(User.validateRoot({ name: "Ada", role: "user" }).ok, true));

const RequiredPositive = schema.minimum(schema.optional(schema.number), 0);
const RequiredState = schema.object.exact({ value: RequiredPositive });
check("refinement outside optional remains required", () => assert.equal(RequiredState.validateRoot({}).issues[0]?.code, "MISSING_REQUIRED"));
const NullablePositive = schema.nullable(schema.minimum(schema.number, 0));
check("nullable outside refinement admits null", () => assert.equal(NullablePositive.validateRoot(null).ok, true));

const CodePoint = schema.length(schema.string, { minimum: 1, maximum: 1 });
check("ASCII length is one code point", () => assert.equal(CodePoint.validateRoot("a").ok, true));
check("BMP non-ASCII length is one code point", () => assert.equal(CodePoint.validateRoot("é").ok, true));
check("astral length is one code point", () => assert.equal(CodePoint.validateRoot("😀").ok, true));
check("combining sequence is two code points", () => assert.equal(CodePoint.validateRoot("e\u0301").ok, false));
const TwoCharacterLiteral = schema.length(schema.pick("a", "bb"), { minimum: 2, maximum: 2 });
check("string length recognizes literal-string unions", () => assert.equal(TwoCharacterLiteral.validateRoot("bb").ok && !TwoCharacterLiteral.validateRoot("a").ok, true));

const Prefix = schema.pattern(schema.string, { mode: "prefix", pattern: "sys_" });
check("literal prefix accepts", () => assert.equal(Prefix.validateRoot("sys_4").ok, true));
check("literal pattern has no RegExp meaning", () => assert.equal(schema.pattern(schema.string, { mode: "full", pattern: ".*" }).validateRoot("anything").ok, false));
check("identical Schema and candidate produce identical refinement evidence", () => assert.deepEqual(Prefix.validateRoot("user_4"), Prefix.validateRoot("user_4")));
const Bounded = schema.length(schema.array(schema.number), { minimum: 1, maximum: 2 });
check("collection length accepts in range", () => assert.equal(Bounded.validateRoot([1, 2]).ok, true));
check("collection length rejects out of range", () => assert.equal(Bounded.validateRoot([]).ok, false));
const Unique = schema.unique(schema.array(schema.object.exact({ id: schema.number })));
check("canonical array uniqueness rejects structured duplicate", () => assert.equal(Unique.validateRoot([{ id: 1 }, { id: 1 }]).ok, false));

const Page = schema.main(
  schema.attrs.exact({ id: schema.string, hidden: schema.flag.optional }),
  schema.div(schema.a()),
);
check("direct document root owns a verified graph", () => assert.ok(read_graph_backed_schema(Page)));
check("direct document with attrs validates", () => assert.equal(validate_livemap_document_schema_root(Page as InternalDocumentRootSchema, parse_hson('<main id="p" hidden <div <a/>/>/>'), "element").ok, true));
check("exact attrs reject unknown attr", () => assert.equal(validate_livemap_document_schema_root(Page as InternalDocumentRootSchema, parse_hson('<main id="p" other="x" <div <a/>/>/>'), "element").ok, false));

const Fragment = schema.tuple(schema.header(), schema.section(schema.string), schema.footer(schema.empty));
const Repeated = schema.repeat(2, schema.section(schema.string));
check("direct fragment sequence is graph-backed", () => assert.ok(read_graph_backed_schema(Fragment)));
check("direct fragment validates exact sequence", () => assert.equal(validate_livemap_document_schema_root(Fragment as InternalDocumentRootSchema, parse_hson('<header/><section "a"/><footer/>'), "fragment").ok, true));
check("direct counted repeat is graph-backed", () => assert.ok(read_graph_backed_schema(Repeated)));
check("direct counted repeat validates exact count", () => assert.equal(validate_livemap_document_schema_root(Repeated as InternalDocumentRootSchema, parse_hson('<section "a"/><section "b"/>'), "fragment").ok, true));

const PartialUser = schema.partial(User);
const DeepUser = schema.deepPartial(schema.object.exact({ profile: schema.object.exact({ name: schema.string }) }));
check("partial remains a deterministic direct transform", () => assert.equal(PartialUser.validateRoot({}).ok, true));
check("deepPartial remains a deterministic direct transform", () => assert.equal(DeepUser.validateRoot({ profile: {} }).ok, true));

const Equivalent = schema.object.exact({ name: schema.length(schema.string, { minimum: 1, maximum: 20 }), age: schema.optional(schema.integer(schema.minimum(schema.number, 0))), role: schema.pick("admin", "user") });
check("repeated direct construction has identical semantic encoding", () => {
  const left = read_graph_backed_schema(User); const right = read_graph_backed_schema(Equivalent);
  assert.ok(left && right); assert.equal(encode_canonical_schema_graph_hson(left), encode_canonical_schema_graph_hson(right));
});

check("malformed refinement rejects at construction", () => assert.throws(() => schema.length(schema.string, { minimum: 2, maximum: 1 }), /complete canonical graph/));

emit_hson_live_test_completion("canonical-schema-direct-authoring", checks, checks, 0);
