// Pure state model + share-link hash codec. No DOM access, so `node --test` runs it directly.
// Format and invariants are specified in DESIGN.md ("Data model", "Share-link format").

export const ROLES = ["top", "jungle", "mid", "bot", "support"];
export const TIERS = ["main", "comfortable", "learning"];

export const ROLE_LABELS = { top: "Top", jungle: "Jungle", mid: "Mid", bot: "Bot", support: "Support" };
export const TIER_LABELS = { main: "Main", comfortable: "Comfortable", learning: "Learning" };

const VERSION = "v1";
const MAX_NAME = 40;

export function emptyState() {
  const pool = {};
  for (const role of ROLES) {
    pool[role] = {};
    for (const tier of TIERS) pool[role][tier] = [];
  }
  return { name: "", pool };
}

function clone(state) {
  const pool = {};
  for (const role of ROLES) {
    pool[role] = {};
    for (const tier of TIERS) pool[role][tier] = [...state.pool[role][tier]];
  }
  return { name: state.name, pool };
}

function assertSlot(role, tier) {
  if (!ROLES.includes(role)) throw new Error(`Unknown role: ${role}`);
  if (tier !== undefined && !TIERS.includes(tier)) throw new Error(`Unknown tier: ${tier}`);
}

/** The tier a champion occupies within a role, or null. */
export function tierOf(state, role, key) {
  key = String(key);
  for (const tier of TIERS) {
    if (state.pool[role][tier].includes(key)) return tier;
  }
  return null;
}

export function isEmpty(state) {
  return ROLES.every((role) => TIERS.every((tier) => state.pool[role][tier].length === 0));
}

/**
 * The single mutation entry point for adding. Returns a new state.
 * A champion sits in at most one tier per role: placing it in another tier of
 * the same role moves it. Other roles are untouched (multi-role is allowed).
 */
export function place(state, role, tier, key) {
  assertSlot(role, tier);
  key = String(key);
  const next = clone(state);
  for (const t of TIERS) {
    next.pool[role][t] = next.pool[role][t].filter((k) => k !== key);
  }
  // Re-adding to the tier it already held keeps its original position.
  const existing = state.pool[role][tier];
  if (existing.includes(key)) {
    next.pool[role][tier] = [...existing];
  } else {
    next.pool[role][tier].push(key);
  }
  return next;
}

/** Remove a champion from a role (whichever tier it is in). */
export function remove(state, role, key) {
  assertSlot(role);
  key = String(key);
  const next = clone(state);
  for (const t of TIERS) {
    next.pool[role][t] = next.pool[role][t].filter((k) => k !== key);
  }
  return next;
}

/** Click behaviour: remove if already in that exact tier, otherwise place (moving if needed). */
export function toggle(state, role, tier, key) {
  assertSlot(role, tier);
  return state.pool[role][tier].includes(String(key))
    ? remove(state, role, key)
    : place(state, role, tier, key);
}

/** `#v1;n=<name>;p=<top>/<jungle>/<mid>/<bot>/<support>`, each role `main.comfortable.learning`. */
export function encode(state) {
  const roles = ROLES.map((role) => TIERS.map((tier) => state.pool[role][tier].join(",")).join("."));
  return `#${VERSION};n=${encodeURIComponent(state.name || "")};p=${roles.join("/")}`;
}

function decodeName(raw) {
  let name = "";
  try {
    name = decodeURIComponent(raw);
  } catch {
    console.warn("Share link: ignoring malformed name");
    return "";
  }
  return Array.from(name).slice(0, MAX_NAME).join("");
}

/**
 * Tolerant inverse of encode(). Never throws: a malformed or unknown-version
 * hash yields an empty state. Unknown / non-numeric keys are dropped with a
 * console.warn. `knownKeys` (Set or array of key strings) is optional.
 */
export function decode(hash, knownKeys) {
  const state = emptyState();
  if (typeof hash !== "string") return state;

  const segments = hash.replace(/^#/, "").split(";");
  if (segments[0] !== VERSION) {
    if (hash.replace(/^#/, "") !== "") console.warn(`Share link: unrecognised format "${segments[0]}"`);
    return state;
  }

  const fields = {};
  for (const seg of segments.slice(1)) {
    const eq = seg.indexOf("=");
    if (eq > 0) fields[seg.slice(0, eq)] = seg.slice(eq + 1);
  }

  if (fields.n !== undefined) state.name = decodeName(fields.n);
  if (!fields.p) return state;

  const known = knownKeys ? new Set(Array.from(knownKeys, String)) : null;
  const dropped = [];
  const roleSegments = fields.p.split("/");

  ROLES.forEach((role, i) => {
    const seen = new Set();
    const tierSegments = (roleSegments[i] ?? "").split(".");
    TIERS.forEach((tier, j) => {
      for (const key of (tierSegments[j] ?? "").split(",")) {
        if (key === "") continue;
        if (!/^\d+$/.test(key) || (known && !known.has(key))) {
          dropped.push(key);
          continue;
        }
        if (seen.has(key)) continue; // one tier per role: first occurrence wins
        seen.add(key);
        state.pool[role][tier].push(key);
      }
    });
  });

  if (dropped.length) console.warn(`Share link: dropped unknown champion keys: ${dropped.join(", ")}`);
  return state;
}
