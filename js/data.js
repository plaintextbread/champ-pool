// Data Dragon loader with a localStorage cache. See DESIGN.md ("Data source").
// Icons are NOT downloaded into the repo; they load from the CDN at runtime.

const BASE = "https://ddragon.leagueoflegends.com";
export const CACHE_KEY = "lcp.champions.v1";

export function iconUrl(version, id) {
  return `${BASE}/cdn/${version}/img/champion/${id}.png`;
}

/** Reduce champion.json to what we use, sorted by display name. Throws on an unexpected shape. */
export function parseChampions(json) {
  const entries = json && json.data && typeof json.data === "object" ? Object.values(json.data) : [];
  if (entries.length === 0) throw new Error("Unexpected champion data shape");
  const champions = entries.map((c) => {
    if (!c || !c.id || !c.key || !c.name) throw new Error("Unexpected champion entry");
    return { id: c.id, key: String(c.key), name: c.name, tags: Array.isArray(c.tags) ? c.tags : [] };
  });
  return champions.sort((a, b) => a.name.localeCompare(b.name, "en"));
}

function hydrate(version, champions) {
  return { version, champions, byKey: new Map(champions.map((c) => [c.key, c])) };
}

async function getJSON(fetchFn, url) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Data Dragon request failed (${res.status}): ${url}`);
  return res.json();
}

async function fetchLatest(fetchFn) {
  const versions = await getJSON(fetchFn, `${BASE}/api/versions.json`);
  return fetchVersion(fetchFn, versions[0]);
}

async function fetchVersion(fetchFn, version) {
  const json = await getJSON(fetchFn, `${BASE}/cdn/${version}/data/en_US/champion.json`);
  return hydrate(version, parseChampions(json));
}

function readCache(storage) {
  try {
    const raw = storage && storage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { version, champions } = JSON.parse(raw);
    if (typeof version !== "string" || !Array.isArray(champions) || champions.length === 0) return null;
    return hydrate(version, champions);
  } catch {
    return null;
  }
}

function writeCache(storage, { version, champions }) {
  try {
    storage && storage.setItem(CACHE_KEY, JSON.stringify({ version, champions }));
  } catch {
    /* private mode / quota: the cache is only an optimisation */
  }
}

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolves with `{ version, champions, byKey, refreshing }`.
 *  - Cache hit: resolves immediately; `refreshing` is a promise for the background
 *    version check, and `onRefresh(data)` fires only if a newer version was fetched.
 *  - No cache: waits for the network and rejects on failure (the UI shows an error state).
 */
export async function loadChampions({ fetchFn = globalThis.fetch?.bind(globalThis), storage = defaultStorage(), onRefresh } = {}) {
  const cached = readCache(storage);

  if (!cached) {
    const fresh = await fetchLatest(fetchFn);
    writeCache(storage, fresh);
    return { ...fresh, refreshing: Promise.resolve() };
  }

  const refreshing = (async () => {
    try {
      const versions = await getJSON(fetchFn, `${BASE}/api/versions.json`);
      if (versions[0] === cached.version) return;
      const fresh = await fetchVersion(fetchFn, versions[0]);
      writeCache(storage, fresh);
      if (onRefresh) onRefresh(fresh);
    } catch (err) {
      console.warn("Champion data refresh failed; using cached data.", err);
    }
  })();

  return { ...cached, refreshing };
}
