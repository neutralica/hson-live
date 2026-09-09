import { hsonLiveTree, type ListenerSub } from "hson-live/livetree";

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
