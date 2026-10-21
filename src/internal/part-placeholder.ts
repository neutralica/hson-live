/** Shared authored Part grammar; parameter resolution remains composition-owned. */
export function part_placeholder_pattern(): RegExp {
  return /%\{([A-Za-z_][A-Za-z0-9_-]*)\}/g;
}

export function part_placeholder_matches(value: string): readonly RegExpMatchArray[] | undefined {
  const pattern = part_placeholder_pattern();
  return value.replace(pattern, "").includes("%{") ? undefined : [...value.matchAll(pattern)];
}
