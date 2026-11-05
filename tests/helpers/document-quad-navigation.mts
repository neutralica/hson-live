/** Shared authored occurrence topology for raw and governed QUAD navigation. */
export const quad_invocation = (name: string, member = "nav") => `<hson-part @:${name} lib="parts" at="${member}"/>`;
export function quad_navigation_definitions(body: string) {
  const part = (document: string) => ({ kind: "document" as const, document });
  return { parts: { parts: {
    leaf: part('<aside hson:part @:root <span @:label "Leaf"/>/>'),
    nav: part('<nav hson:part @:root <div @:wrap <button @:buttonOne "One"/>/> <hson-part @:inner at="leaf"/>/>'),
    outer: part('<section hson:part <hson-part @:nav at="nav"/>/>'),
    anonymous: part('<section hson:part <hson-part at="nav"/>/>'),
    ambiguous: part('<section hson:part <hson-part at="nav"/><hson-part at="nav"/>/>'),
    shadow: part('<section hson:part <button @:buttonOne "Local"/> <hson-part at="nav"/>/>'),
  } }, page: { document: `<main @:page ${body}/>` } };
}
