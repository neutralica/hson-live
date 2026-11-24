import { Hson, type HsonDocument, type HsonSchema } from "hson-live";

type PageGraph = Readonly<{
  $_tag: "_hson_root";
  $_content: readonly [Readonly<{
    $_tag: "main";
    $_content: readonly [Readonly<{ $_tag: "_hson_str"; $_content: readonly [string] }>];
  }>];
}>;
declare const identity: unique symbol;
declare const Page: HsonSchema<PageGraph, "document", typeof identity>;

// @ts-expect-error The native assignment is invalid. The separate Schema diagnostic must publish.
const unproved: HsonDocument<typeof Page> = Hson.document`<main "Ready"/>`;
void unproved;
