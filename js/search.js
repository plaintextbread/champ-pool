// Pure search helpers. No DOM access. Rules are in DESIGN.md ("Search").

/** Lowercase and strip everything except a-z / 0-9, so "Kai'Sa" and "kaisa" compare equal. */
export function normalize(s) {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Substring match of the query against both the display name and the Data Dragon id. */
export function matches(champ, query) {
  const q = normalize(query);
  if (q === "") return true;
  return normalize(champ.name).includes(q) || normalize(champ.id).includes(q);
}

/** Filter by free-text query and class tag ("All"/null = any). Preserves input order. */
export function filterChampions(champs, { query = "", tag = null } = {}) {
  const anyTag = !tag || tag === "All";
  return champs.filter((c) => (anyTag || c.tags.includes(tag)) && matches(c, query));
}
