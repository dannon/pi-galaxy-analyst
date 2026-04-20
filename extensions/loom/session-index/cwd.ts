/**
 * Pi.dev encodes each working directory as "--<path-with-slashes-as-dashes>--"
 * and uses that as the per-cwd session directory name under ~/.pi/agent/sessions/.
 *
 * Lossy by design -- a cwd with a literal hyphen collides with one where a
 * slash sat in the same position. This matches Pi's own on-disk encoding
 * (see Pi's SessionManager.getDefaultSessionDir). Do not add escaping; the
 * indexer needs to reproduce the exact directory name Pi writes.
 */
export function encodeCwd(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

export function decodeCwd(encoded: string): string | null {
  if (!encoded.startsWith("--") || !encoded.endsWith("--")) return null;
  const inner = encoded.slice(2, -2);
  return "/" + inner.replace(/-/g, "/");
}
