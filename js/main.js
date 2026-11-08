// Boot: load champion data, restore the pool (URL hash wins, else the last session), wire the UI.
import { loadChampions } from "./data.js";
import { emptyState, decode, encode, isEmpty, toggle, remove } from "./state.js";
import { createUI } from "./ui.js";
import { DISCLAIMER } from "./legal.js";

document.getElementById("legal").textContent = DISCLAIMER;

const STORE_KEY = "lcp.state.v1";

let state = emptyState();
let data = null;
let exporting = false;

const ui = createUI({
  onToggle(role, tier, key) {
    commit(toggle(state, role, tier, key));
  },
  onRemove(role, key) {
    commit(remove(state, role, key));
  },
  onName(name) {
    commit({ ...state, name });
  },
  onClear() {
    if (isEmpty(state) && !state.name) return;
    if (confirm("Clear the whole pool, including the name?")) commit(emptyState());
  },
  async onExport() {
    if (exporting) return;
    exporting = true;
    ui.toast("Building image…");
    try {
      const { downloadPoolImage } = await import("./export.js");
      await downloadPoolImage(state, data);
      ui.toast("Image downloaded");
    } catch (err) {
      console.error(err);
      ui.toast("Couldn't build the image — check your connection and try again.");
    } finally {
      exporting = false;
    }
  },
  async onCopyLink() {
    persist(); // make sure location.href reflects the latest state
    try {
      await navigator.clipboard.writeText(location.href);
      ui.toast("Share link copied");
    } catch {
      window.prompt("Copy this link:", location.href);
    }
  },
});

/** Every state change goes through here: re-render, then mirror to the URL hash and localStorage. */
function commit(next) {
  state = next;
  ui.setState(state);
  persist();
}

/** Mirror state to the hash (replaceState: no history entries) and to localStorage. */
function persist() {
  const hash = encode(state);
  try {
    history.replaceState(null, "", isEmpty(state) && !state.name ? location.pathname + location.search : hash);
  } catch {
    /* sandboxed contexts can refuse replaceState */
  }
  try {
    localStorage.setItem(STORE_KEY, hash);
  } catch {
    /* private mode */
  }
}

/** A versioned hash, when present, wins over the stored session. */
function restore() {
  const known = data.byKey.keys();
  if (/^#v\d/.test(location.hash)) return decode(location.hash, known);
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) return decode(saved, known);
  } catch {
    /* ignore */
  }
  return emptyState();
}

window.addEventListener("hashchange", () => {
  if (!data || !/^#v\d/.test(location.hash) || location.hash === encode(state)) return;
  commit(decode(location.hash, data.byKey.keys()));
});

async function boot() {
  ui.showLoading();
  try {
    data = await loadChampions({
      onRefresh(fresh) {
        data = fresh;
        ui.setData(fresh);
        ui.setState(state);
      },
    });
  } catch (err) {
    console.error(err);
    ui.showError("Couldn't load champion data — check your connection and try again.", boot);
    return;
  }
  ui.setData(data);
  commit(restore());
}

boot();
