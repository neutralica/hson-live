import { hsonLiveTree, type ListenerSub, type ListenerBuilder, type TreeSelector } from "hson-live/livetree";

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
