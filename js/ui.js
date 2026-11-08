// DOM rendering and event wiring. Holds only view state (active target, search, tag filter);
// the pool itself lives in main.js and arrives through setState().
import { ROLES, TIERS, ROLE_LABELS, TIER_LABELS, emptyState, tierOf, isEmpty } from "./state.js";
import { iconUrl } from "./data.js";
import { filterChampions } from "./search.js";

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
}

export function createUI({ onToggle, onRemove, onName, onClear, onExport, onCopyLink }) {
  const $ = (id) => document.getElementById(id);
  const el = {
    board: $("board"),
    grid: $("pool-grid"),
    status: $("pool-status"),
    count: $("pool-count"),
    search: $("search"),
    chips: $("tag-chips"),
    roleSeg: $("role-seg"),
    tierSeg: $("tier-seg"),
    readout: $("target-readout"),
    name: $("player-name"),
    download: $("btn-download"),
    copy: $("btn-copy"),
    clear: $("btn-clear"),
    toast: $("toast"),
  };

  let data = null;
  let state = emptyState();
  let target = { role: "top", tier: "main" };
  let query = "";
  let tag = "All";
  let toastTimer = 0;
  const poolButtons = new Map(); // champion key -> button

  /* ---------- target bar ---------- */

  function setTarget(next) {
    target = { ...target, ...next };
    renderBoard();
    renderTargetBar();
    renderMarkers();
  }

  function buildSegments() {
    el.roleSeg.replaceChildren(
      ...ROLES.map((role) =>
        h("button", { type: "button", dataset: { role } }, ROLE_LABELS[role]),
      ),
    );
    el.tierSeg.replaceChildren(
      ...TIERS.map((tier) =>
        h("button", { type: "button", dataset: { tier } }, TIER_LABELS[tier]),
      ),
    );
    el.roleSeg.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (b) setTarget({ role: b.dataset.role });
    });
    el.tierSeg.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (b) setTarget({ tier: b.dataset.tier });
    });
  }

  function renderTargetBar() {
    for (const b of el.roleSeg.children) b.setAttribute("aria-pressed", String(b.dataset.role === target.role));
    for (const b of el.tierSeg.children) b.setAttribute("aria-pressed", String(b.dataset.tier === target.tier));
    const placed = state.pool[target.role][target.tier].length;
    el.readout.replaceChildren(
      "Adding to ",
      h("strong", {}, `${ROLE_LABELS[target.role]} · ${TIER_LABELS[target.tier]}`),
      ` (${placed} placed)`,
    );
  }

  /* ---------- board ---------- */

  function renderBoard() {
    const focused = document.activeElement && document.activeElement.closest?.(".tier-head");
    const focusKey = focused ? focused.parentElement.dataset : null;

    el.board.replaceChildren(
      ...ROLES.map((role) =>
        h(
          "section",
          { class: "role", "aria-label": ROLE_LABELS[role] },
          h("h2", {}, ROLE_LABELS[role]),
          ...TIERS.map((tier) => renderTier(role, tier)),
        ),
      ),
    );

    if (focusKey) {
      el.board.querySelector(`.tier[data-role="${focusKey.role}"][data-tier="${focusKey.tier}"] .tier-head`)?.focus();
    }
  }

  function renderTier(role, tier) {
    const keys = state.pool[role][tier].filter((k) => !data || data.byKey.has(k));
    const active = role === target.role && tier === target.tier;
    const icons = keys.map((key) => {
      const champ = data && data.byKey.get(key);
      return h(
        "button",
        {
          type: "button",
          class: "icon-btn",
          dataset: { role, key },
          title: champ ? champ.name : key,
          "aria-label": `Remove ${champ ? champ.name : key} from ${ROLE_LABELS[role]} ${TIER_LABELS[tier]}`,
        },
        champ && h("img", { src: iconUrl(data.version, champ.id), alt: "", crossorigin: "anonymous", width: 64, height: 64, decoding: "async" }),
      );
    });
    return h(
      "div",
      { class: `tier${active ? " active" : ""}`, dataset: { role, tier } },
      h(
        "button",
        { type: "button", class: "tier-head", "aria-pressed": String(active), "aria-label": `Add to ${ROLE_LABELS[role]} ${TIER_LABELS[tier]}` },
        h("span", {}, TIER_LABELS[tier]),
        h("span", { class: "tier-count" }, keys.length ? String(keys.length) : ""),
      ),
      h("div", { class: "tier-icons" }, icons.length ? icons : h("span", { class: "tier-empty" }, active ? "Tap champions below" : "Tap to target")),
    );
  }

  el.board.addEventListener("click", (e) => {
    const icon = e.target.closest(".icon-btn");
    if (icon) {
      onRemove(icon.dataset.role, icon.dataset.key);
      return;
    }
    const tierEl = e.target.closest(".tier");
    if (tierEl) setTarget({ role: tierEl.dataset.role, tier: tierEl.dataset.tier });
  });

  /* ---------- picker ---------- */

  function buildPool() {
    poolButtons.clear();
    const buttons = data.champions.map((c) => {
      const badge = h("span", { class: "badge", hidden: true });
      const btn = h(
        "button",
        { type: "button", class: "pool-champ", dataset: { key: c.key }, title: c.name, "aria-label": c.name },
        h("img", { src: iconUrl(data.version, c.id), alt: "", loading: "lazy", crossorigin: "anonymous", width: 64, height: 64, decoding: "async" }),
        badge,
      );
      poolButtons.set(c.key, btn);
      return btn;
    });
    el.grid.replaceChildren(...buttons);

    const tags = [...new Set(data.champions.flatMap((c) => c.tags))].sort();
    el.chips.replaceChildren(
      ...["All", ...tags].map((t) => h("button", { type: "button", class: "chip", dataset: { tag: t } }, t)),
    );
    if (tag !== "All" && !tags.includes(tag)) tag = "All";
  }

  el.grid.addEventListener("click", (e) => {
    const btn = e.target.closest(".pool-champ");
    if (btn) onToggle(target.role, target.tier, btn.dataset.key);
  });

  el.chips.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    tag = chip.dataset.tag;
    applyFilter();
  });

  el.search.addEventListener("input", () => {
    query = el.search.value;
    applyFilter();
  });

  function applyFilter() {
    for (const chip of el.chips.children) chip.setAttribute("aria-pressed", String(chip.dataset.tag === tag));
    if (!data) return;
    const visible = new Set(filterChampions(data.champions, { query, tag }).map((c) => c.key));
    for (const [key, btn] of poolButtons) btn.hidden = !visible.has(key);
    const total = data.champions.length;
    el.count.textContent = visible.size === total ? `${total} champions` : `${visible.size} of ${total}`;
    el.status.textContent = visible.size === 0 ? "No champions match." : "";
  }

  function renderMarkers() {
    for (const [key, btn] of poolButtons) {
      const t = tierOf(state, target.role, key);
      const champ = data.byKey.get(key);
      const badge = btn.querySelector(".badge");
      btn.classList.toggle("placed", t !== null);
      btn.classList.toggle("in-tier", t === target.tier);
      btn.setAttribute("aria-pressed", String(t === target.tier));
      btn.title = t ? `${champ.name} (${TIER_LABELS[t]} ${ROLE_LABELS[target.role]})` : champ.name;
      badge.hidden = t === null;
      badge.textContent = t ? TIER_LABELS[t][0] : "";
    }
  }

  /* ---------- actions ---------- */

  el.name.addEventListener("input", () => onName(el.name.value));
  el.download.addEventListener("click", () => onExport());
  el.copy.addEventListener("click", () => onCopyLink());
  el.clear.addEventListener("click", () => onClear());

  function renderActions() {
    el.download.disabled = isEmpty(state);
    el.clear.disabled = isEmpty(state) && !state.name;
  }

  /* ---------- public API ---------- */

  buildSegments();
  renderTargetBar();
  renderBoard();
  applyFilter();
  renderActions();

  return {
    showLoading() {
      el.status.textContent = "Loading champions…";
    },
    showError(message, retry) {
      el.status.replaceChildren(
        message,
        h("br"),
        h("button", { type: "button", class: "btn" }, "Try again"),
      );
      el.status.querySelector("button").addEventListener("click", retry);
    },
    setData(next) {
      data = next;
      el.status.textContent = "";
      buildPool();
      applyFilter();
      renderBoard();
      renderMarkers();
    },
    setState(next) {
      state = next;
      if (document.activeElement !== el.name) el.name.value = state.name;
      renderBoard();
      renderTargetBar();
      if (data) renderMarkers();
      renderActions();
    },
    toast(message) {
      el.toast.textContent = message;
      el.toast.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.toast.classList.remove("show"), 2400);
    },
  };
}
