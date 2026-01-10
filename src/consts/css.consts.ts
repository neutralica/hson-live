// css-manager.consts.ts

export const CSS_HOST_TAG = "hson-_style";
export const CSS_HOST_ID  = "css-manager";
export const CSS_STYLE_ID = "_hson";

// Fully-qualified selectors (NO string literals elsewhere)
export const CSS_HOST_SELECTOR  =
  `${CSS_HOST_TAG}#${CSS_HOST_ID}`;

export const CSS_STYLE_SELECTOR =
  `${CSS_HOST_SELECTOR} style#${CSS_STYLE_ID}`;