import type { HsonTaggedTemplateSource } from "../embedded-hson/discover-hson-tagged-templates.js";
import { parse_hson_event_tagged_source } from "../embedded-hson/hson-tagged-source-admission.js";
import type { ReuseEventBody } from "../editor-introspection/event-body-cache.js";
import { parse_part_event, type PartEvent } from "../part-events.js";

export type StaticEventParse = Readonly<{ event: PartEvent }> | Readonly<{ error: unknown }>;

export function static_event_parser(reuse?: ReuseEventBody<StaticEventParse>) {
  const parse = (key: string, compute: () => PartEvent): PartEvent => {
    if (reuse === undefined) return compute();
    const result = reuse(key, () => {
      try { return { event: compute() }; }
      catch (error) { return { error }; }
    });
    if ("error" in result) throw result.error;
    return result.event;
  };
  return {
    part: (body: string) => parse("part\0" + body, () => parse_part_event(body)),
    tagged: (source: HsonTaggedTemplateSource, body: string) => parse("tag\0" + body,
      () => parse_hson_event_tagged_source(source, body)),
  };
}
