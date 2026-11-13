import { hsonLiveMap } from "hson-live/livemap";
import { Hson, type HsonDataValue } from "hson-live/hson";
import { hsonLiveTree, type LiveTree, type ListenerSub, type ListenerBuilder, type TreeSelector,
  type LiveTreeActionContext, type LiveTreeActionHandler, type LiveTreeActions,
  type LocalActionMessage, type LocalActionResult } from "hson-live/livetree";

void hsonLiveTree.fromTrustedHtml("<main></main>");
void hsonLiveTree.fromJson({ ready: true });
void hsonLiveTree.queryBody();
void hsonLiveTree.create.div();

declare const listenerSub: ListenerSub;
listenerSub.off();
// @ts-expect-error ListenerSub exposes only its disposer.
listenerSub.count;
// @ts-expect-error ListenerSub exposes only its disposer.
listenerSub.ok;

declare const selection: TreeSelector;
selection.listen satisfies ListenerBuilder;
const configured: ListenerBuilder = selection.listen.document.capture().once().passive()
  .strict("ignore").preventDefault().stopProp().stopImmediateProp().stopAll().clearStops();
const click: ListenerSub = configured.element.onClick(event => { event satisfies MouseEvent; });
click.off() satisfies void;
selection.listen.toWindow().on("keydown", event => { event satisfies KeyboardEvent; }).off();
selection.listen.toDocument().onInput(event => { event satisfies InputEvent; }).off();
selection.listen.onCustom<CustomEvent<number>>("custom", event => { event.detail satisfies number; }).off();
selection.listen.onCustomDetail<{ ready: boolean }>("detail", event => { event.detail.ready satisfies boolean; }).off();
// @ts-expect-error Registration returns only a subscription, not another builder.
click.once();
// @ts-expect-error Known DOM event names remain checked.
selection.listen.on("invented-event", () => {});
// @ts-expect-error Convenience handlers retain their event types.
selection.listen.onClick((event: KeyboardEvent) => {});

hsonLiveMap.create().actions.define("click", (ctx, input, message) => {
  ctx.event satisfies Event | undefined;
  ctx.subject satisfies LiveTree | undefined;
  ctx.event?.preventDefault();
  if (ctx.event instanceof MouseEvent) ctx.event.clientX satisfies number;
  // @ts-expect-error Mouse coordinates require narrowing the native event.
  ctx.event?.clientX;
  ctx.subject?.dom.el() satisfies Element | undefined;
  message.id satisfies string;
  return input;
});

const tree = hsonLiveTree.fromHson("<button/>");
const actions: LiveTreeActions = tree.actions;
const inputSchema = Hson.schema`<type "data" content <open "boolean">>`;
const toggle: LiveTreeActionHandler = async (ctx, input, message) => {
  ctx satisfies LiveTreeActionContext;
  ctx.tree satisfies LiveTree;
  ctx.subject satisfies LiveTree | undefined;
  ctx.event satisfies Event | undefined;
  input satisfies HsonDataValue | undefined;
  message satisfies LocalActionMessage;
  return input;
};
actions.define("PANEL_TOGGLE", toggle, { input: { required: true, schema: inputSchema } });
const result: Promise<LocalActionResult> = actions.trigger("PANEL_TOGGLE", { open: true });
void result;
const authored: ListenerSub = tree.listen.event("<hson:event on:click local:PANEL_TOGGLE input:data={<open true>} <> >");
authored.off() satisfies void;
// @ts-expect-error A declaration requires Hson source text.
tree.listen.event(() => {});
// @ts-expect-error Public trigger does not accept a native event as input.
actions.trigger("PANEL_TOGGLE", new MouseEvent("click"));
// @ts-expect-error Registrations are additive.
actions.unregister("PANEL_TOGGLE");
