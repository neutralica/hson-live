import "hson-live/scout";

const status = customElements.get("hson-scout") === undefined ? "fail" : "pass";
void fetch(`/__result?scenario=registration&status=${status}&detail=side-effect-only-import`);
