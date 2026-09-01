import { hsonLiveTree } from "hson-live/livetree";

void hsonLiveTree.fromTrustedHtml("<main></main>");
void hsonLiveTree.fromJson({ ready: true });
void hsonLiveTree.queryBody();
void hsonLiveTree.create.div();
