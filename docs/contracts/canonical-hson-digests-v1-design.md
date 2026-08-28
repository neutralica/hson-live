# Canonical HSON digests v1 — design checkpoint

Status: byte grammar and implementation plan are complete. Two narrowly scoped
repository mismatches must be corrected before production digest work begins;
their intended outcomes are now settled in “Confirmed prerequisites.” No
production or test behavior is changed by this document.

This design keeps two identities separate:

```text
admitted canonical HSON graph -> canonical graph encoding v1 -> SHA-256
HsonCanonical                -> canonical text encoding v1  -> SHA-256
```

The strict comparator and the certified corpus remain authoritative. A digest
is compact evidence of an already established identity; it is not an equality
algorithm, an admission shortcut, or proof that the implementation is correct.

## 1. Audited identity contract

`canonical_hson_graph_equal()` compares the following observable state:

| Domain | Existing identity rule | v1 treatment |
| --- | --- | --- |
| Node tag | Exact JavaScript string | Node marker followed by a code-unit string |
| Node content | Length and position sensitive | `u32` count followed by values in physical order |
| Object properties | Physical child order is semantic | Encoded in physical content order; never sorted |
| Arrays | Physical item order and canonical `$_meta.index` | Both physical content and index metadata are encoded |
| Strings | Exact JavaScript UTF-16 code units | Length-prefixed UTF-16BE code units |
| Numbers | `Object.is`; non-finite values are outside comparator domain | Finite IEEE-754 binary64 bits, big-endian |
| Booleans/null | Type and value sensitive | Separate one-byte markers |
| `0` / `-0` | Different | Binary64 `0000000000000000` / `8000000000000000` |
| `$_attrs` | Container presence sensitive; keys are an unordered set | Presence byte; keys traversed in comparator-defined canonical key order |
| `$_meta` | Container presence sensitive; keys are an unordered set | Presence byte; keys traversed in comparator-defined canonical key order |
| Style records | Recursive key/value-set comparison | Record marker and canonical key traversal |
| Metadata | `quid` and array `index`; exact string values | Ordinary record encoding; no projection |
| QUIDs | Exact persisted string | Ordinary string value encoding |
| Adjacent strings | Separate content positions | Each `_hson_str` node is independently framed |
| Structural modes | `_hson_obj` and `_hson_elem` tags differ | Exact tags; no detachment or coercion |
| Empty/absent content | `$_content` is mandatory; empty is valid by node role | No presence byte; a zero count means empty |
| Empty/absent metadata | Both are currently admitted and differ | Presence `00` versus presence `01` plus zero pairs |
| Empty/absent attributes | Empty attributes are noncanonical | Absent or present/nonempty only after admission |
| Nested structure | Recursive | Recursive value grammar |
| Shared references | Alias identity is not compared; cycles are rejected by admission | Re-encode each occurrence; no reference IDs |
| Extra node properties | Ignored by the strict comparator | Ignored by v1; only the four canonical fields are encoded |

The encoder must call invariant admission directly on the supplied graph. It
must not call `fromNode()`, because `fromNode()` normalizes attributes, style,
array order, wrappers, and empty optional containers. The encoder does not
mutate, detach, repair, project, coerce, or serialize its input.

An exact corollary is intended after the admission gap below is corrected:

```text
strictly equal admitted graphs => identical v1 bytes => identical digest
strict graph difference         => different v1 bytes
```

The second implication is about bytes, not hashes. Digest inequality is useful
evidence; digest equality is never a replacement for strict comparison where
collision-free proof is required.

## 2. Canonical graph binary grammar v1

All integers are unsigned big-endian. `u32` values are in `0..0xffffffff`.
Encoders reject a string, record, or collection whose count does not fit.

```text
GraphEncodingV1 = GraphHeader Node EOF

GraphHeader = 48 53 4f 4e 00 43 47 00 01
              H  S  O  N NUL C  G NUL v1

Node = 01 String AttrPresence MetaPresence u32(Value count) Value*

AttrPresence = 00
             / 01 RecordBody

MetaPresence = 00
             / 01 RecordBody

Value = 01 NodeBody                 ; node (the leading 01 is the node marker)
      / 02 String                   ; JavaScript string
      / 03 Binary64                 ; finite JavaScript number
      / 04                          ; false
      / 05                          ; true
      / 06                          ; null
      / 07                          ; undefined in an admitted nested record
      / 08 RecordBody               ; plain record

NodeBody = String AttrPresence MetaPresence u32(Value count) Value*

RecordBody = u32(pair count) Pair*
Pair = String Value

String = u32(UTF-16 code-unit count) u16be*
Binary64 = 8 bytes, IEEE-754 binary64, most-significant byte first
```

The value markers are reserved permanently for v1. A v1 decoder must reject
unknown markers, invalid presence bytes, count overruns, non-finite binary64,
duplicate record keys, record keys outside the required order, invalid node
structure, and trailing input. Syntactic decoding alone does not establish a
canonical graph; invariant admission is still required.

`RecordBody` keys are distinct and traversed in ascending JavaScript string
order: lexicographic unsigned UTF-16 code-unit order, with a shorter prefix
before its extension. This is exactly the traversal used by the strict
comparator’s `Object.keys(record).sort()`. It is not sorting node content or
mutating the graph. Some deterministic record sequence is mathematically
required because record insertion order is explicitly ignored by equality.

The `07` marker is required by current admission: a typed style record may own
`unit: undefined`, while a record with no `unit` property is strictly different.
Top-level attribute values of `undefined` are not admitted. No other values,
generic arrays, dates, maps, symbols, functions, bigint values, or prototypes
are part of v1.

## 3. Canonical HSON text byte grammar v1

```text
HsonCanonicalEncodingV1 = HsonCanonicalHeader String EOF

HsonCanonicalHeader = 48 53 4f 4e 00 48 53 00 01
                   H  S  O  N NUL H  S NUL v1
```

`String` is the same `u32` code-unit count plus UTF-16BE representation used by
the graph grammar. There is no BOM, Unicode normalization, newline conversion,
or reserialization. The digest function consumes the exact `HsonCanonical` code
units it receives. Its type is an official-producer contract, not a runtime
security boundary; callers needing runtime source admission start with
`hson.fromHson(candidate).toHson().serialize()`.

UTF-8 is not used because standard UTF-8 encoders replace isolated surrogate
code units. UTF-16BE preserves every JavaScript string exactly. A supplementary
scalar remains its two surrogate code units, and an isolated surrogate remains
one code unit. The length is a code-unit count, not a byte count; its payload is
always exactly twice that many bytes. Empty and adjacent strings are therefore
collision-free without delimiter escaping.

## 4. Number decision

Use `DataView.setFloat64(offset, value, false)` and copy the resulting eight
bytes. This is stable across conforming JavaScript runtimes, preserves the
JSON-compatible finite JavaScript number domain, distinguishes `0` from `-0`,
and avoids decimal formatting. Admission and the encoder both reject `NaN`,
positive infinity, negative infinity, and any numeric spelling whose evaluated
JavaScript value is non-finite (for example `1e309`). No NaN canonicalization
or infinity marker is defined in v1.

## 5. Structural framing and ordering findings

Fields in every node occur in this fixed order: tag, attribute presence/value,
metadata presence/value, content count/content. Collections use counts, not
sentinels or delimiter bytes. One top-level node must consume all bytes.

| Record domain | Admission/equality finding | Stable byte rule |
| --- | --- | --- |
| `$_attrs` | Presence is semantic; key insertion order is ignored | Canonical UTF-16 key traversal |
| `$_meta` | Presence is semantic; key insertion order is ignored | Canonical UTF-16 key traversal |
| Style map | Flat declaration record; insertion order is ignored | Canonical UTF-16 key traversal |
| Typed style value | `value` required, `unit` optional; insertion order ignored | Canonical UTF-16 key traversal, including own `undefined` |
| Nested metadata | Registry currently permits only `quid` or `index` at eligible nodes | Same record grammar; no special sorting or projection |

`canonical_inline_style()` produces sorted copies during permissive
normalization, but direct invariant admission only validates style and does not
require the input record’s enumeration order to be sorted. The byte encoder
therefore cannot use host enumeration order. Object properties, array items,
element content, and adjacent strings always retain physical order.

## 6. Domain separation, versioning, and printable identifiers

SHA-256 covers the complete encoding, including its header. Thus HSON domain,
artifact kind, and encoding version are inside the hashed bytes and repeated in
the printable identifier:

```text
hson:cg:v1:sha256:<64 lowercase hexadecimal digits>
hson:hs:v1:sha256:<64 lowercase hexadecimal digits>
```

`cg` means canonical graph and `hs` means `HsonCanonical` text. The exact
runtime validators are:

```text
^hson:cg:v1:sha256:[0-9a-f]{64}$
^hson:hs:v1:sha256:[0-9a-f]{64}$
```

The hash algorithm is named outside the preimage. It is already fixed by the
digest operation; placing it inside the canonical artifact bytes would
needlessly make the byte encoding algorithm-specific. A future hash algorithm
may hash the same v1 bytes and must use a different printable algorithm field.
A future incompatible byte grammar uses a new encoding version and header.

## 7. Worked byte examples

Detached `-0` graph:

```text
graph header                48534f4e004347000101
string("_hson_val")         00000009005f00680073006f006e005f00760061006c
attrs absent               00
meta absent                00
content count 1            00000001
number marker              03
-0 binary64                8000000000000000
complete bytes             48534f4e00434700010100000009005f00680073006f006e005f00760061006c000000000001038000000000000000
SHA-256                     079e05a05afb447d5fe33cdb9310dd5756bd8bb32f158edd77a6d7dc69301703
identifier                 hson:cg:v1:sha256:079e05a05afb447d5fe33cdb9310dd5756bd8bb32f158edd77a6d7dc69301703
```

Canonical HSON text for `-0`:

```text
text header                 48534f4e0048530001
code-unit count 2          00000002
"-" and "0" UTF-16BE       002d0030
complete bytes             48534f4e004853000100000002002d0030
SHA-256                     37c08e082d2a4a89b5deedf8f42266b10365691a7b03bcf6aba217ccca431055
identifier                 hson:hs:v1:sha256:37c08e082d2a4a89b5deedf8f42266b10365691a7b03bcf6aba217ccca431055
```

## 8. Known-answer vector manifest

The following notation is exact JavaScript object construction, not a parser
shorthand:

```text
N(t,c=[],a=absent,m=absent) = {$_tag:t, [$_attrs:a], [$_meta:m], $_content:c}
S(x)=N("_hson_str",[x])     V(x)=N("_hson_val",[x])
O(...x)=N("_hson_obj",x)    E(...x)=N("_hson_elem",x)
I(i,x)=N("_hson_ii",[x],absent,{index:String(i)})
A(...x)=N("_hson_arr",x.map((v,i)=>I(i,v)))
P(k,x)=N(k,[O(x)])
R()=N("_hson_root",[])
```

An omitted optional field is absent as an own property. `undefined` shown in a
record is an owned property. Graph expressions, bytes, and digests are
hand-reviewable constants; IDs are stable.

```text
ID   GRAPH                                                                                         BYTES (hex)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 SHA-256                                                           RATIONALE
G01  O()                                                                                           48534f4e00434700010100000009005f00680073006f006e005f006f0062006a000000000000                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         5a4d9b487e55b50fbaa8456663e9133411be0ef188faa25adb2275088805d1c8 empty object
G02  A()                                                                                           48534f4e00434700010100000009005f00680073006f006e005f006100720072000000000000                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         de47fa8d861cba3f4432bcf90253bfa6f7a7d4bac8dc4cb6ceca9d442cad9481 empty array
G03  N("div")                                                                                      48534f4e00434700010100000003006400690076000000000000                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 46a675ea19601271e632e8b05c1ae68475525243ec522c64a7a81791d113886b empty element
G04  S("")                                                                                         48534f4e00434700010100000009005f00680073006f006e005f0073007400720000000000010200000000                                                                                                                                                                                                                                                                                                                                                                                                                                                                               73e3165de7cdd69262db7e855606de70431fae89d24b079a7827e6af0e46c32e empty string
G05  S("ASCII")                                                                                    48534f4e00434700010100000009005f00680073006f006e005f007300740072000000000001020000000500410053004300490049                                                                                                                                                                                                                                                                                                                                                                                                                                                           42832591953f5348465c341f4fa813102397cd31467055ed0f3d77b0a0f2e39a ASCII string
G06  S("λ漢")                                                                                      48534f4e00434700010100000009005f00680073006f006e005f007300740072000000000001020000000203bb6f22                                                                                                                                                                                                                                                                                                                                                                                                                                                                     c876d49c576fe6bbaef879b87345a38a8447c10beb3d0413c451ece5d96c99dc BMP Unicode
G07  S("😀")                                                                                       48534f4e00434700010100000009005f00680073006f006e005f0073007400720000000000010200000002d83dde00                                                                                                                                                                                                                                                                                                                                                                                                                                                                     ba87154bbd6c0d2f77f05494fdcff5b84cec4f8f0a3ed39f863104a3ebcb1cdd supplementary Unicode
G08  S("\uD800")                                                                                   48534f4e00434700010100000009005f00680073006f006e005f0073007400720000000000010200000001d800                                                                                                                                                                                                                                                                                                                                                                                                                                                                         bebd8af67c15d6bbb12a9e110f6c819f644edca40875667f3b00e2d28b795120 isolated high surrogate
G09  S("\uDC00")                                                                                   48534f4e00434700010100000009005f00680073006f006e005f0073007400720000000000010200000001dc00                                                                                                                                                                                                                                                                                                                                                                                                                                                                         a4591eda094ef904e1e4ba335f50600ad2f84e2bfde58a389aca7c587830d863 isolated low surrogate
G10  E(S(""),S(""))                                                                                48534f4e0043470001010000000a005f00680073006f006e005f0065006c0065006d0000000000020100000009005f00680073006f006e005f00730074007200000000000102000000000100000009005f00680073006f006e005f0073007400720000000000010200000000                                                                                                                                                                                                                                                                                                                                         f329d5a831c22fa341ef9b72c119bb3782dc17ce8e4a2e47cfb224f3c4242efc adjacent empty strings
G11  V(0)                                                                                          48534f4e00434700010100000009005f00680073006f006e005f00760061006c000000000001030000000000000000                                                                                                                                                                                                                                                                                                                                                                                                                                                                     3257b6a273168bc9747b5e5f8c1853d36175f1c591344dd9de901d6edb1f56d8 positive zero
G12  V(-0)                                                                                         48534f4e00434700010100000009005f00680073006f006e005f00760061006c000000000001038000000000000000                                                                                                                                                                                                                                                                                                                                                                                                                                                                     079e05a05afb447d5fe33cdb9310dd5756bd8bb32f158edd77a6d7dc69301703 negative zero
G13  V(12.5)                                                                                       48534f4e00434700010100000009005f00680073006f006e005f00760061006c000000000001034029000000000000                                                                                                                                                                                                                                                                                                                                                                                                                                                                     8c6517536f5259130de371f5c2f914707d58fd66df63ee2d370918062c0fa5a4 positive finite number
G14  V(-12.5)                                                                                      48534f4e00434700010100000009005f00680073006f006e005f00760061006c00000000000103c029000000000000                                                                                                                                                                                                                                                                                                                                                                                                                                                                     20ecd3ef2b844a440a23cbbd8c8cec8cbc660aa0e82c26cd6606e9ff6b3ac11f negative finite number
G15  V(true)                                                                                       48534f4e00434700010100000009005f00680073006f006e005f00760061006c00000000000105                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     211969a29bfcf70b32bfa4d1d00513c42cb659000bc2333f6dde08f730363443 true
G16  V(false)                                                                                      48534f4e00434700010100000009005f00680073006f006e005f00760061006c00000000000104                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     ca34674153315767cd5042ddce331fab442bea4dfd4db08f7874da60de28eec3 false
G17  V(null)                                                                                       48534f4e00434700010100000009005f00680073006f006e005f00760061006c00000000000106                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     8762968c1d1b5738531bfaa2c97e414040583fbd912b01b2a138bc38e5753ad7 null
G18  O(P("10",S("ten")),P("2",S("two")),P("1",S("one")))                                      48534f4e00434700010100000009005f00680073006f006e005f006f0062006a0000000000030100000002003100300000000000010100000009005f00680073006f006e005f006f0062006a0000000000010100000009005f00680073006f006e005f007300740072000000000001020000000300740065006e010000000100320000000000010100000009005f00680073006f006e005f006f0062006a0000000000010100000009005f00680073006f006e005f007300740072000000000001020000000300740077006f010000000100310000000000010100000009005f00680073006f006e005f006f0062006a0000000000010100000009005f00680073006f006e005f0073007400720000000000010200000003006f006e0065 4f7de0d2f47ed76075e96736a4913fec807d68db169256924c9420678d0d2903 property order 10,2,1
G19  O(P("nested",A(O(P("x",V(1))),S("tail"))))                                                    48534f4e00434700010100000009005f00680073006f006e005f006f0062006a0000000000010100000006006e006500730074006500640000000000010100000009005f00680073006f006e005f006f0062006a0000000000010100000009005f00680073006f006e005f0061007200720000000000020100000008005f00680073006f006e005f00690069000100000001000000050069006e00640065007802000000010030000000010100000009005f00680073006f006e005f006f0062006a000000000001010000000100780000000000010100000009005f00680073006f006e005f006f0062006a0000000000010100000009005f00680073006f006e005f00760061006c000000000001033ff00000000000000100000008005f00680073006f006e005f00690069000100000001000000050069006e00640065007802000000010031000000010100000009005f00680073006f006e005f0073007400720000000000010200000004007400610069006c 810893d9f5ac64ce4ed361e0c286e6fe38eb7cae8e6b00454df451ab89d32a9b nested object and array
G20  N("div",[],{title:"a"})                                                                      48534f4e00434700010100000003006400690076010000000100000005007400690074006c0065020000000100610000000000                                                                                                                                                                                                                                                                                                                                                                                                                                                               0fb1c52f2bdc4a19c9e2db0b05f7de6bfe3a7efac74f3f116cc07c1810b2b9b9 attribute baseline
G21  N("div",[],{title:"b"})                                                                      48534f4e00434700010100000003006400690076010000000100000005007400690074006c0065020000000100620000000000                                                                                                                                                                                                                                                                                                                                                                                                                                                               3ce77e0379f8142920369a4355c2ed9e444894401db1b0c106bead82ac34df7b attribute difference
G22  N("div",[],absent,{quid:"0000000000000001"})                                                 48534f4e004347000101000000030064006900760001000000010000000400710075006900640200000010003000300030003000300030003000300030003000300030003000300030003100000000                                                                                                                                                                                                                                                                                                                                                                                                   f17d21d72bae2a18fe9e0b44bfd8e117170f3f6b0ce191d90383b4b2be13e3a4 QUID baseline
G23  N("div",[],absent,{quid:"0000000000000002"})                                                 48534f4e004347000101000000030064006900760001000000010000000400710075006900640200000010003000300030003000300030003000300030003000300030003000300030003200000000                                                                                                                                                                                                                                                                                                                                                                                                   751c194d21775a7940a8865a3f523e7cacb1775f883ef3543dbda0a972f0ca6b QUID difference
G24  N("div",[],absent,absent)                                                                     48534f4e00434700010100000003006400690076000000000000                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 46a675ea19601271e632e8b05c1ae68475525243ec522c64a7a81791d113886b metadata absent
G25  N("div",[],absent,{})                                                                         48534f4e0043470001010000000300640069007600010000000000000000                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         b5cc39f65809006594ec0bce8b4c2c23bde611c2e0161e3810f1fde34be721de metadata present and empty
G26  N("div",[],{style:{color:"red",width:{value:2,unit:"px"}}})                                 48534f4e00434700010100000003006400690076010000000100000005007300740079006c00650800000002000000050063006f006c006f0072020000000300720065006400000005007700690064007400680800000002000000040075006e006900740200000002007000780000000500760061006c007500650340000000000000000000000000                                                                                                                                                                                                                                                                                             c5707958f012037f9afdb27d84d6d0158e37931b50045fba163d52858ea853a7 structured style
G27  N("div",[],{style:{width:{value:2,unit:undefined}}})                                          48534f4e00434700010100000003006400690076010000000100000005007300740079006c0065080000000100000005007700690064007400680800000002000000040075006e00690074070000000500760061006c007500650340000000000000000000000000                                                                                                                                                                                                                                                                                                                                             e42f4b5e6106ccc0fbf9c188fd4f2fe1126116b0bd12631e585728e32bfc3cf9 owned undefined versus absent
G28  R()                                                                                            48534f4e0043470001010000000a005f00680073006f006e005f0072006f006f0074000000000000                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     a33ab85881feee5bcce3da62a09ca7cde431f083482939608e6edee971113cb8 empty internal root
G29  N("_hson_root",[V(-0)])                                                                       48534f4e0043470001010000000a005f00680073006f006e005f0072006f006f00740000000000010100000009005f00680073006f006e005f00760061006c000000000001038000000000000000                                                                                                                                                                                                                                                                                                                                                                                                     d92143d3277cf09a92fab1066f23ad66b7308195cee899fed0fa4862b24fbc13 root with nested -0
```

Canonical text inputs below are JSON string spellings, so escapes show the
exact code-unit sequence without relying on document rendering.

```text
ID   HSONSTRING (JSON spelling)               BYTES (hex)                                                                                                                     SHA-256                                                           RATIONALE
T01  "<>"                                     48534f4e004853000100000002003c003e                                                                                             c8a2f328ef69b41abc86f691a4a989a3fba53d2ba090011f7003be0ec47886c0 empty object
T02  "«»"                                     48534f4e00485300010000000200ab00bb                                                                                             33557b5a3964a875a59117b34bfbaf61146172ebfee3ea4cea52194c26062f93 empty array
T03  "<div/>"                                 48534f4e004853000100000006003c006400690076002f003e                                                                             3ecdbe975cadef565e35456f4362a8511adcf8acccd591c271348d514f3502ae empty element
T04  "\"\""                                 48534f4e00485300010000000200220022                                                                                             ae483e8b60826e68a25d9e0377dccf58439957af8fbba2343a450b2b3689dd84 empty string
T05  "\"ASCII\""                            48534f4e0048530001000000070022004100530043004900490022                                                                         807290719ece189524d809a677ff40e24a3c219351d292ba3b12f3723a656d1d ASCII
T06  "\"λ漢\""                              48534f4e004853000100000004002203bb6f220022                                                                                     c760fa226aed29eb2e16e6c68c78b002d4db0b752bcc9db969c741e558e6bc55 BMP Unicode
T07  "\"😀\""                               48534f4e0048530001000000040022d83dde000022                                                                                     3a20904fa62623147487f39f2b302b1650a26c198b43d51d0282b09de21db22b supplementary Unicode
T08  "\"\\ud800\""                         48534f4e0048530001000000080022005c007500640038003000300022                                                                     933d1446df892f16748dd49180c8b1613cb505d0ee13c2d8263317d58825e567 canonical high-surrogate escape
T09  "\"\\udc00\""                         48534f4e0048530001000000080022005c007500640063003000300022                                                                     ac7d4de7ae4c3e77d1742a12f6ce775d02f6deb7e87028ff977970ef1d11f6ee canonical low-surrogate escape
T10  "-0"                                     48534f4e004853000100000002002d0030                                                                                             37c08e082d2a4a89b5deedf8f42266b10365691a7b03bcf6aba217ccca431055 negative zero text
T11  "<\n  a 1\n  b 2\n>"                   48534f4e00485300010000000f003c000a00200020006100200031000a00200020006200200032000a003e                                         02cf369480f1f03d379125ee444b72301fe6a6addbb8c784dea67185bf6e5a95 indentation and LF
T12  "<div @0000000000000001/>"               48534f4e004853000100000018003c006400690076002000400030003000300030003000300030003000300030003000300030003000300031002f003e         92aae806e787ffc0f471c74ce50a07e53bcc3a5169273560896460ee097a0b20 QUID spelling
T13  "<span title=\"a\\\"b\"/>"          48534f4e004853000100000014003c007300700061006e0020007400690074006c0065003d00220061005c002200620022002f003e                     418da609b9335d1f385ac4a370c35d0e72150cf8390e7b835344f90e5f668386 quoted escape
```

Vector production must remain independent of production encoder code. Commit a
small standalone reference generator beside the vector fixture, review its
marker table against this document, and verify every digest through both Node
Web Crypto and a second implementation such as OpenSSL. At least the short
worked vectors must also be manually decoded byte by byte. Production tests
consume fixed bytes and digests; they never regenerate expected constants with
the implementation under test.

## 9. SHA-256 runtime strategy

The public digest operations should be asynchronous. Keep the deterministic
byte encoders synchronous, then call:

```text
await globalThis.crypto.subtle.digest("SHA-256", bytes)
```

Supported Node versions (`>=22.12 <25`), current browsers, and Cloudflare
Worker-compatible runtimes expose this API. No hashing dependency is needed.
Do not add a synchronous Node-only API or a pure-JavaScript SHA implementation.
The transform Worker declaration build deliberately excludes DOM types, so the
implementation should use a narrow internal structural type for the required
`crypto.subtle.digest` member and expose only `Promise`, `Uint8Array`, and
branded strings publicly.

A missing compatible Web Crypto implementation must reject deterministically
with a digest-specific operation/code. It must not silently choose another
algorithm. Node, browser, and Worker tests must compare the same bytes, raw
32-byte digest, and formatted identifier.

## 10. Proposed API surface

The smallest coherent public surface belongs in `hson-live/transform`, beside
the aggregate `hson` facade and the transform leaf functions. It need not be added to the
fluent facade or create a general cryptography namespace.

```ts
export type CanonicalHsonGraphDigest = string & { /* private brand */ };
export type CanonicalHsonDigest = string & { /* private brand */ };

export function encode_canonical_hson_graph_v1(graph: HsonNode): Uint8Array;
export function digest_canonical_hson_graph_v1(
  graph: HsonNode,
): Promise<CanonicalHsonGraphDigest>;

export function encode_hson_canonical_v1(value: HsonCanonical): Uint8Array;
export function digest_hson_string_v1(
  value: HsonCanonical,
): Promise<CanonicalHsonDigest>;

export function is_canonical_hson_graph_digest_v1(
  value: unknown,
): value is CanonicalHsonGraphDigest;
export function is_canonical_hson_string_digest_v1(
  value: unknown,
): value is CanonicalHsonDigest;

export const CANONICAL_HSON_GRAPH_ENCODING_VERSION: 1;
export const CANONICAL_HSON_STRING_ENCODING_VERSION: 1;
export const CANONICAL_HSON_DIGEST_ALGORITHM: "SHA-256";
```

The digest functions return the printable identifiers, not mutable raw digest
bytes. Digest formatting remains internal; the two public validators cover
persistence/input validation without providing a misleading “parse and trust”
operation. Brands prevent accidental graph/text digest interchange at compile
time but are not security claims. The graph encoder validates without
normalizing and returns a fresh `Uint8Array`. The HsonCanonical encoder performs no
parse or canonicalization.

These names follow the repository rule for exported functions (`snake_case`),
types (`PascalCase`), and constants (`FORTRAN_CASE`). They also follow the
existing `canonical_hson_graph_*` identity vocabulary.

## 11. HsonCanonical and graph/text relationship

For default, nonprojecting serialization, strictly equal serializable graphs
must produce identical `HsonCanonical` output. The converse is false today:

- `_hson_root` is admitted but cannot serialize as authored HSON;
- absent `$_meta` and present empty `$_meta` are strictly different, but empty
  metadata has no authored spelling;
- array index metadata is structural and not emitted as a separate token;
- some admitted ordinary attribute primitive values are not accepted by the
  HSON serializer;
- `noQuid` deliberately projects graph identity before producing its default
  formatted `HsonCanonical`.

Thus graph equality does not globally imply the existence of an `HsonCanonical`, and
text-digest equality does not imply graph-digest equality. When default
ordinary serialization exists and performs no projection, equal graphs must
produce identical canonical text. `noBreak` output is outside the HsonCanonical
domain regardless of semantic equality.

## 12. Future reported-check decomposition

The implementation should add named launchers/suites with these estimated
reported checks. Counts are contract checks, not hidden atomic assertion totals.

| Suite | Reported checks |
| --- | ---: |
| Graph encoding: markers, lengths, strings, and numbers | 24 |
| Graph encoding: nodes, content, object/array order, framing | 24 |
| Graph encoding: attributes, metadata, style, optional presence | 22 |
| Graph known answers: primitive and Unicode vectors | 20 |
| Graph known answers: structural and identity-difference vectors | 16 |
| HsonCanonical encoding and known-answer digests | 22 |
| Digest identifiers, brands, API types, and runtime rejection | 20 |
| Admission, malformed graphs, overflow, nonfinite, and nonmutation | 22 |
| Node/Web Crypto runtime parity | 18 |
| Browser runtime parity | 18 |
| Worker-compatible runtime parity | 18 |
| Corpus digest properties shard 1 | 24 |
| Corpus digest properties shard 2 | 24 |
| Corpus digest properties shard 3 | 23 |
| Corpus digest properties shard 4 | 23 |
| Corpus digest properties shard 5 | 23 |
| Corpus digest properties shard 6 | 23 |
| Corpus digest properties shard 7 | 23 |
| **Estimated total** | **387** |

The seven corpus shards expose all 163 accepted concrete descriptors as
separately named reported checks (24+24+23+23+23+23+23), in stable case-ID
order. Each checks deterministic bytes/digest, nonmutation, and equality with
the hand-authored expected graph as applicable. Rejected corpus sources remain
owned by their existing rejection suites; the nine graph-ingress rejection
descriptors are cross-checked in the admission suite. This avoids both one
opaque 163-case aggregate and arbitrary assertion inflation.

## 13. Corpus integration plan

Do not add handwritten hashes to all 366 corpus descriptors. Import the
existing materialized manifest read-only and, for each of its 163 accepted
cases, digest the explicit `expectedGraph`. Verify:

1. byte/digest determinism over repeated calls;
2. no mutation;
3. strict-equal detached copies have identical bytes and digests;
4. descriptor-specific strict differences covered by existing paired cases
   produce different bytes;
5. canonical/default `expectedOutputs.hson`, where present and nonprojecting,
   has a deterministic text digest;
6. Node/browser/Worker parity uses the same fixed corpus shard order.

The 42 graph and text known-answer constants above are the cryptographic oracle.
The corpus supplies breadth and correspondence properties, not 366 supposedly
independent hand-authored hashes. No corpus descriptor, review artifact, count,
or fingerprint changes are required merely to add digest tests.

## 14. Cross-runtime validation plan

- Run the same fixed known-answer manifest through Node Web Crypto, browser Web
  Crypto, and the current Worker-compatible entrypoint.
- Compare encoded hex before hashing, raw digest hex after hashing, and final
  printable identifiers.
- Include UTF-16 isolated surrogates, supplementary text, `0`/`-0`, record key
  order, and nested arrays in every runtime.
- Compile the transform subpath under the existing DOM-free Worker TypeScript
  configuration.
- Exercise missing `crypto`, missing `subtle`, and rejected digest promises with
  deterministic operation/code evidence.
- Keep browser and Worker probes specialized; do not simulate either runtime by
  importing `node:crypto` into production code.

## 15. Confirmed prerequisites and current contradictions

### A. `noBreak` is branded as HsonCanonical

Current declarations and implementation type every HSON serialization as
`HsonCanonical`, including:

```ts
hsonTransform.fromNode(node).toHson().noBreak().serialize()
serialize_hson(node, { noBreak: true })
```

The compile fixture explicitly asserts that assignment. This contradicts the
confirmed contract that `noBreak` is valid HSON text but must not be an
`HsonCanonical`.
Affected owners are `transform.types.ts`, `constructor.types.ts`,
`serialize-hson.ts`, both option constructors/finalizers, and their type
fixtures. Before text digest APIs ship, any path with `noBreak: true` must return
plain `string`; default output and default-formatted `noQuid` output may remain
branded. Literal/generic `withOptions` overloads must preserve that distinction.
No branding change is made in this design unit.

### B. Direct invariant admission accepts non-finite ordinary attributes

Exact ingress:

```ts
{
  $_tag: "div",
  $_attrs: { x: Infinity },
  $_content: [],
}
```

Observed results:

```text
assert_invariants(...): accepts
canonical_hson_graph_equal(distinctCloneA, distinctCloneB): throws
  [HSON equality] invalid HSON number Infinity; numbers must be finite
serialize_hson(...): rejects
  operation: serialize_hson.serializeAttribute
  stage: absent
  code: TRANSFORM_ERROR
  source/path/related: absent
```

`NaN` and negative infinity share the admission defect. HSON's numeric value
domain is confirmed to match JSON values: non-finite values are not allowed.
The exact owner is the ordinary-attribute primitive branch in
`assertNewShapeQuick()`, which checks
`typeof value === "number"` without `Number.isFinite(value)`. The strict
comparator and v1 number grammar both require finite values. Production graph
encoding must not begin until invariant admission rejects these values. No
fixture or byte marker is added for them.

The typed-style owned `unit: undefined` distinction is surprising but not a
blocker: admission accepts it, equality observes it, and marker `07` preserves
it. If that state is declared noncanonical before implementation, remove marker
`07` and vector G27 as one narrow spec revision; do not silently collapse it.

There is no unresolved design choice for either mismatch: `noBreak` returns
plain `string`, and all non-finite numeric values reject. No browser/Node/Worker
API incompatibility, serializer nondeterminism, or isolated-surrogate loss was
found. Record canonical traversal is fully determined by the comparator.

## 16. Likely implementation file set

Add:

```text
src/core/canonical-hson-encoding-v1.ts
src/api/transform/canonical-hson-digests.ts
tests/fixtures/canonical-hson-digest-v1-vectors.mts
tests/fixtures/reference/canonical-hson-digest-v1-reference.mjs
tests/canonical-hson-encoding-primitives.acceptance.mts
tests/canonical-hson-encoding-structures.acceptance.mts
tests/canonical-hson-encoding-records.acceptance.mts
tests/canonical-hson-graph-known-answers.acceptance.mts
tests/canonical-hson-string-digest.acceptance.mts
tests/canonical-hson-digest-admission.acceptance.mts
tests/canonical-hson-digest-runtime.acceptance.mts
tests/runtime-probes/canonical-hson-digest-browser.acceptance.mjs
tests/runtime-probes/canonical-hson-digest-worker.acceptance.mjs
tests/canonical-hson-corpus-digest-01.acceptance.mts ... -07.acceptance.mts
```

Change narrowly:

```text
src/core/assert-invariants.ts                    # prerequisite finite-number fix
src/api/transform/transform.types.ts             # noBreak brand correction
src/types/constructor.types.ts                   # noBreak brand correction
src/api/transform/serializers/serialize-hson.ts  # option-sensitive overloads
src/api/transform/constructors/construct-options-3.ts
src/api/transform/constructors/construct-render-4.ts
src/api/transform/index.ts                       # public digest exports
tests/hson-canonical.types.ts
tests/entrypoints/public-entrypoints.ts
tests/entrypoints/transform-worker.ts
src/_tests/test-launchers.ts
package.json
```

The root umbrella export is not required for v1. `hson-live/transform` is the
narrow existing home for `HsonCanonical` and transform leaf functions. No
`hson-demo2` change is expected except optional consumer parity coverage; a
fingerprint-only update is not an independently meaningful demo change.

## 17. Recommended implementation sequence

1. Correct and test non-finite ordinary-attribute invariant admission.
2. Correct option-sensitive HsonCanonical return types and compile fixtures.
3. Freeze the vector manifest after independent OpenSSL review.
4. Implement the synchronous UTF-16BE writer and graph encoder.
5. Add primitive, structure, ordering, presence, nonmutation, and rejection
   suites.
6. Implement the narrow asynchronous Web Crypto SHA-256 adapter.
7. Add branded identifiers and exact runtime validators.
8. Implement HsonCanonical encoding/digest without reparsing.
9. Add Node, browser, and Worker known-answer parity suites.
10. Add the seven corpus-property shards without changing corpus descriptors.
11. Register launchers, update derived fingerprints/counts, and run the full
    hson-live plus hson-demo2 validation.

## 18. Explicit deferrals

Merkle trees, subtree hashes, cached digests, persistence or LiveMap/LiveHost
integration, signatures, MACs, salts, canonical JSON digests, digest-based
equality shortcuts, deterministic operators, and seeded torment remain out of
scope until both whole-artifact v1 digests are implemented and stable.
