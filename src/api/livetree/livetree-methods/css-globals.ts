// css-global.ts

export type GlobalCssMap = Map<string, string>;

export function set_global(
  store: GlobalCssMap,
  source: string,
  cssText: string
): void {
  const key = source.trim();
  if (!key) return;

  const text = cssText.trim();
  if (text.length === 0) {
    store.delete(key);
  } else {
    store.set(key, text);
  }
}

export function remove_global(
  store: GlobalCssMap,
  source: string
): void {
  store.delete(source.trim());
}

export function clear_globals(store: GlobalCssMap): void {
  store.clear();
}

export function list_globals(store: GlobalCssMap): readonly string[] {
  return Array.from(store.keys());
}

export function get_global(
  store: GlobalCssMap,
  source: string
): string | undefined {
  return store.get(source);
}

export function render_globals(store: GlobalCssMap): string {
  return Array.from(store.values())
    .map(s => s.trim())
    .filter(Boolean)
    .join("\n\n");
}