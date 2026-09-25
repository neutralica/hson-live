/** Normalize the shared runtime and document-wide custom-property spelling. */
export function normalize_css_var_name(name: string): `--${string}` | undefined {
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("--")) return trimmed.length > 2 ? trimmed as `--${string}` : undefined;
  const bare = trimmed.startsWith("-") ? trimmed.replace(/^-+/, "") : trimmed;
  return bare ? `--${bare}` : undefined;
}
