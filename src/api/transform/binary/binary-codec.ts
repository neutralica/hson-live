import { assert_invariants } from "../../../core/assert-invariants.js";
import {
  ARR_TAG,
  ELEM_TAG,
  II_TAG,
  OBJ_TAG,
  ROOT_TAG,
  STR_TAG,
  VAL_TAG,
} from "../../../core/constants.js";
import { is_typed_css_value } from "../../../core/inline-style.js";
import type { HsonAttrs, HsonMeta, HsonNode } from "../../../core/types.js";
import type { BinaryDecodeOptions } from "../transform.types.js";

const DEFAULT_MAX_BYTES = 1_048_576;
const DEFAULT_MAX_GRAPH_DEPTH = 256;
const DEFAULT_MAX_GRAPH_NODES = 100_000;
const MARKER = [0x48, 0x53, 0x4f, 0x4e] as const;

const ABSENT = 0x00;
const PRESENT = 0x01;
const UNIT_STRING = 0x02;
const ORDINARY = 0x10;
const STR = 0x11;
const VAL = 0x12;
const OBJ = 0x13;
const ARR = 0x14;
const ELEM = 0x15;
const ITEM = 0x16;
const NULL = 0x20;
const FALSE = 0x21;
const TRUE = 0x22;
const NUMBER = 0x23;
const STRING = 0x24;
const TYPED_STYLE = 0x25;
const STYLE_RECORD = 0x26;

type PlainRecord = Readonly<Record<string, unknown>>;
type BinaryStyleValue =
  | string
  | number
  | boolean
  | null
  | Readonly<{ value: string | number; unit?: string }>;

function fail(message: string): never {
  throw new Error(`Binary HSON: ${message}`);
}

function compare_code_units(left: string, right: string): number {
  const count = Math.min(left.length, right.length);
  for (let index = 0; index < count; index++) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function is_plain_record(value: unknown): value is PlainRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

class BinaryWriter {
  private readonly bytes: number[] = [];

  byte(value: number): void {
    this.bytes.push(value);
  }

  u32(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
      fail(`count is outside the u32 range: ${String(value)}`);
    }
    this.bytes.push(
      Math.floor(value / 0x1000000) & 0xff,
      Math.floor(value / 0x10000) & 0xff,
      Math.floor(value / 0x100) & 0xff,
      value & 0xff,
    );
  }

  f64(value: number): void {
    if (!Number.isFinite(value)) fail("number must be finite");
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setFloat64(0, value, false);
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index < bytes.length; index++) this.bytes.push(bytes[index]);
  }

  string(value: string): void {
    this.u32(value.length);
    for (let index = 0; index < value.length; index++) {
      const unit = value.charCodeAt(index);
      this.bytes.push(unit >>> 8, unit & 0xff);
    }
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

function write_primitive(writer: BinaryWriter, value: unknown, allowString: boolean): void {
  if (value === null) return writer.byte(NULL);
  if (value === false) return writer.byte(FALSE);
  if (value === true) return writer.byte(TRUE);
  if (typeof value === "number") {
    writer.byte(NUMBER);
    writer.f64(value);
    return;
  }
  if (allowString && typeof value === "string") {
    writer.byte(STRING);
    writer.string(value);
    return;
  }
  fail("value is outside the approved primitive domain");
}

function write_sorted_record(
  writer: BinaryWriter,
  record: PlainRecord,
  writeValue: (value: unknown, key: string) => void,
): void {
  const keys = Object.keys(record).sort(compare_code_units);
  writer.u32(keys.length);
  for (const key of keys) {
    writer.string(key);
    writeValue(record[key], key);
  }
}

function write_style_record(writer: BinaryWriter, value: unknown): void {
  if (!is_plain_record(value)) fail("structured style must be a plain record");
  writer.byte(STYLE_RECORD);
  write_sorted_record(writer, value, (item) => {
    if (is_typed_css_value(item)) {
      writer.byte(TYPED_STYLE);
      write_primitive(writer, item.value, true);
      if (!Object.hasOwn(item, "unit")) {
        writer.byte(ABSENT);
      } else if (item.unit === undefined) {
        writer.byte(PRESENT);
      } else {
        writer.byte(UNIT_STRING);
        writer.string(item.unit);
      }
      return;
    }
    write_primitive(writer, item, true);
  });
}

function write_fields(writer: BinaryWriter, node: HsonNode): void {
  if (Object.hasOwn(node, "$_attrs")) {
    writer.byte(PRESENT);
    const attrs = node.$_attrs;
    if (!is_plain_record(attrs)) fail("present attrs must be a plain record");
    write_sorted_record(writer, attrs, (value, key) => {
      if (key === "style" && is_plain_record(value)) write_style_record(writer, value);
      else write_primitive(writer, value, true);
    });
  } else {
    writer.byte(ABSENT);
  }

  if (Object.hasOwn(node, "$_meta")) {
    writer.byte(PRESENT);
    const meta = node.$_meta;
    if (!is_plain_record(meta)) fail("present metadata must be a plain record");
    write_sorted_record(writer, meta, (value) => {
      if (typeof value !== "string") fail("metadata values must be strings");
      writer.string(value);
    });
  } else {
    writer.byte(ABSENT);
  }
}

function write_content(writer: BinaryWriter, content: HsonNode["$_content"]): void {
  writer.u32(content.length);
  for (const child of content) {
    if (typeof child !== "object" || child === null) fail("primitive outside a leaf node");
    write_node(writer, child);
  }
}

function write_node(writer: BinaryWriter, node: HsonNode): void {
  switch (node.$_tag) {
    case ROOT_TAG:
      fail("_hson_root is not a detached Binary HSON value");
    case STR_TAG:
      writer.byte(STR);
      write_fields(writer, node);
      if (node.$_content.length !== 1 || typeof node.$_content[0] !== "string") {
        fail("invalid _hson_str payload");
      }
      writer.string(node.$_content[0]);
      return;
    case VAL_TAG:
      writer.byte(VAL);
      write_fields(writer, node);
      if (node.$_content.length !== 1) fail("invalid _hson_val payload");
      write_primitive(writer, node.$_content[0], false);
      return;
    case OBJ_TAG:
      writer.byte(OBJ);
      break;
    case ARR_TAG:
      writer.byte(ARR);
      break;
    case ELEM_TAG:
      writer.byte(ELEM);
      break;
    case II_TAG:
      writer.byte(ITEM);
      break;
    default:
      writer.byte(ORDINARY);
      writer.string(node.$_tag);
  }
  write_fields(writer, node);
  write_content(writer, node.$_content);
}

export function serialize_binary(node: HsonNode): Uint8Array {
  assert_invariants(node, "toBinary");
  if (node.$_tag === ROOT_TAG) fail("_hson_root is not a detached Binary HSON value");
  const writer = new BinaryWriter();
  for (const byte of MARKER) writer.byte(byte);
  write_node(writer, node);
  return writer.finish();
}

type Limits = Readonly<{
  maxBytes: number;
  maxGraphDepth: number;
  maxGraphNodes: number;
}>;

function positive_integer(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0) fail(`${name} must be a positive integer`);
  return result;
}

function decode_limits(options: BinaryDecodeOptions): Limits {
  return {
    maxBytes: positive_integer(options.maxBytes, DEFAULT_MAX_BYTES, "maxBytes"),
    maxGraphDepth: positive_integer(options.maxGraphDepth, DEFAULT_MAX_GRAPH_DEPTH, "maxGraphDepth"),
    maxGraphNodes: positive_integer(options.maxGraphNodes, DEFAULT_MAX_GRAPH_NODES, "maxGraphNodes"),
  };
}

class BinaryReader {
  private offset = 0;
  private graphNodes = 0;

  constructor(
    private readonly input: Uint8Array,
    private readonly limits: Limits,
  ) {}

  remaining(): number {
    return this.input.byteLength - this.offset;
  }

  ensure(count: number, description: string): void {
    if (!Number.isSafeInteger(count) || count < 0 || count > this.remaining()) {
      fail(`truncated or impossible ${description}`);
    }
  }

  byte(description: string): number {
    this.ensure(1, description);
    const value = this.input[this.offset];
    this.offset += 1;
    if (value === undefined) fail(`truncated ${description}`);
    return value;
  }

  u32(description: string): number {
    this.ensure(4, description);
    const view = new DataView(this.input.buffer, this.input.byteOffset + this.offset, 4);
    const value = view.getUint32(0, false);
    this.offset += 4;
    return value;
  }

  f64(): number {
    this.ensure(8, "binary64");
    const view = new DataView(this.input.buffer, this.input.byteOffset + this.offset, 8);
    const value = view.getFloat64(0, false);
    this.offset += 8;
    if (!Number.isFinite(value)) fail("nonfinite binary64 value");
    return value;
  }

  string(): string {
    const count = this.u32("string length");
    if (count > Math.floor(this.remaining() / 2)) fail("string length exceeds remaining bytes");
    let value = "";
    const chunk: number[] = [];
    for (let index = 0; index < count; index++) {
      const high = this.byte("UTF-16 code unit");
      const low = this.byte("UTF-16 code unit");
      chunk.push((high << 8) | low);
      if (chunk.length === 4096) {
        value += String.fromCharCode(...chunk);
        chunk.length = 0;
      }
    }
    if (chunk.length !== 0) value += String.fromCharCode(...chunk);
    return value;
  }

  count(description: string, minimumBytesPerItem: number): number {
    const count = this.u32(`${description} count`);
    if (count > Math.floor(this.remaining() / minimumBytesPerItem)) {
      fail(`${description} count exceeds remaining bytes`);
    }
    return count;
  }

  presence(description: string): boolean {
    const value = this.byte(`${description} presence`);
    if (value === ABSENT) return false;
    if (value === PRESENT) return true;
    return fail(`invalid ${description} presence byte 0x${value.toString(16).padStart(2, "0")}`);
  }

  node(depth: number): HsonNode {
    if (depth > this.limits.maxGraphDepth) fail("maxGraphDepth exceeded");
    this.graphNodes += 1;
    if (this.graphNodes > this.limits.maxGraphNodes) fail("maxGraphNodes exceeded");

    const discriminator = this.byte("node discriminator");
    let tag: string;
    switch (discriminator) {
      case ORDINARY: tag = this.string(); break;
      case STR: tag = STR_TAG; break;
      case VAL: tag = VAL_TAG; break;
      case OBJ: tag = OBJ_TAG; break;
      case ARR: tag = ARR_TAG; break;
      case ELEM: tag = ELEM_TAG; break;
      case ITEM: tag = II_TAG; break;
      default: return fail(`unknown node discriminator 0x${discriminator.toString(16).padStart(2, "0")}`);
    }

    const attrs = this.attrs();
    const meta = this.meta();
    let content: HsonNode["$_content"];
    if (discriminator === STR) {
      content = [this.string()];
    } else if (discriminator === VAL) {
      content = [this.scalar()];
    } else {
      const count = this.count("content", 3);
      if (count > this.limits.maxGraphNodes - this.graphNodes) fail("content count exceeds remaining node budget");
      content = [];
      for (let index = 0; index < count; index++) content.push(this.node(depth + 1));
    }

    const node: HsonNode = { $_tag: tag, $_content: content };
    if (attrs !== undefined) node.$_attrs = attrs;
    if (meta !== undefined) node.$_meta = meta;
    return node;
  }

  private scalar(): boolean | number | null {
    const discriminator = this.byte("scalar discriminator");
    if (discriminator === NULL) return null;
    if (discriminator === FALSE) return false;
    if (discriminator === TRUE) return true;
    if (discriminator === NUMBER) return this.f64();
    return fail(`invalid scalar discriminator 0x${discriminator.toString(16).padStart(2, "0")}`);
  }

  private attr_value(key: string): HsonAttrs[string] {
    const discriminator = this.byte("attribute value discriminator");
    if (discriminator === NULL) return null;
    if (discriminator === FALSE) return false;
    if (discriminator === TRUE) return true;
    if (discriminator === NUMBER) return this.f64();
    if (discriminator === STRING) return this.string();
    if (discriminator === STYLE_RECORD && key === "style") return this.style_record();
    return fail(`invalid attribute value discriminator 0x${discriminator.toString(16).padStart(2, "0")}`);
  }

  private style_value(): BinaryStyleValue {
    const discriminator = this.byte("style value discriminator");
    if (discriminator === NULL) return null;
    if (discriminator === FALSE) return false;
    if (discriminator === TRUE) return true;
    if (discriminator === NUMBER) return this.f64();
    if (discriminator === STRING) return this.string();
    if (discriminator === TYPED_STYLE) {
      const valueDiscriminator = this.byte("typed style scalar discriminator");
      let value: string | number;
      if (valueDiscriminator === NUMBER) value = this.f64();
      else if (valueDiscriminator === STRING) value = this.string();
      else return fail("typed style value must be a string or finite number");
      const unitState = this.byte("typed style unit state");
      if (unitState === ABSENT) return { value };
      if (unitState === PRESENT) return { value, unit: undefined };
      if (unitState === UNIT_STRING) return { value, unit: this.string() };
      return fail(`invalid typed style unit state 0x${unitState.toString(16).padStart(2, "0")}`);
    }
    return fail(`invalid style value discriminator 0x${discriminator.toString(16).padStart(2, "0")}`);
  }

  private record<T>(description: string, minimumBytesPerPair: number, readValue: (key: string) => T): Record<string, T> {
    const count = this.count(description, minimumBytesPerPair);
    const record: Record<string, T> = Object.create(null);
    let previous: string | undefined;
    for (let index = 0; index < count; index++) {
      const key = this.string();
      if (previous !== undefined && compare_code_units(previous, key) >= 0) {
        fail(`${description} keys must be strictly increasing`);
      }
      record[key] = readValue(key);
      previous = key;
    }
    return record;
  }

  private attrs(): HsonAttrs | undefined {
    if (!this.presence("attrs")) return undefined;
    return this.record("attrs", 5, (key) => this.attr_value(key));
  }

  private meta(): HsonMeta | undefined {
    if (!this.presence("metadata")) return undefined;
    return this.record("metadata", 8, () => this.string());
  }

  private style_record(): Record<string, BinaryStyleValue> {
    return this.record("style", 5, () => this.style_value());
  }

  at_end(): boolean {
    return this.offset === this.input.byteLength;
  }
}

function same_bytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function parse_binary(input: Uint8Array, options: BinaryDecodeOptions = {}): HsonNode {
  if (!(input instanceof Uint8Array)) fail("input must be a Uint8Array");
  const limits = decode_limits(options);
  if (input.byteLength > limits.maxBytes) fail("maxBytes exceeded");
  const reader = new BinaryReader(input, limits);
  for (const expected of MARKER) {
    if (reader.byte("marker") !== expected) fail("marker mismatch");
  }
  const node = reader.node(0);
  if (!reader.at_end()) fail("trailing bytes");
  assert_invariants(node, "fromBinary");
  const canonical = serialize_binary(node);
  if (!same_bytes(canonical, input)) fail("accepted bytes are not canonically spelled");
  return node;
}
