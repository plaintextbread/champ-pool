// Canvas renderer for the shareable PNG. Drawn by our own code (no html2canvas) so the
// output is the same in every browser. Layout and palette follow DESIGN.md ("Export graphic").
import { ROLES, TIERS, ROLE_LABELS, TIER_LABELS } from "./state.js";
import { iconUrl } from "./data.js";
import { SITE_URL } from "./config.js";
import { DISCLAIMER } from "./legal.js";

const W = 1200;
const SCALE = 2;
const MARGIN = 40; // slate surround
const CARD_W = W - MARGIN * 2;
const PAD = 64; // card edge -> content
const CONTENT_X = MARGIN + PAD;
const CONTENT_W = CARD_W - PAD * 2;
const LABEL_W = 200;
const ICON = 64;
const GAP = 6;
const PER_ROW = Math.floor((CONTENT_W - LABEL_W + GAP) / (ICON + GAP));

const C = {
  slate: "#2b2f36",
  parchment: "#efe3c4",
  parchmentLight: "#f6edd5",
  parchmentDark: "#d9c590",
  edge: "#b8945a",
  ink: "#1f2a44",
  accent: "#c4471f",
  frame: "#2a2118",
  muted: "#5d5846",
};

const HEAD = '"Alegreya SC", "Palatino Linotype", Georgia, serif';
const BODY = '"Alegreya", Georgia, "Times New Roman", serif';

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function wrap(ctx, text, maxWidth) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const test = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Which role/tier sections have content, with champions resolved against the loaded data. */
function sections(state, byKey) {
  const out = [];
  for (const role of ROLES) {
    const tiers = [];
    for (const tier of TIERS) {
      const champs = state.pool[role][tier].map((k) => byKey.get(k)).filter(Boolean);
      if (champs.length) tiers.push({ tier, champs });
    }
    if (tiers.length) out.push({ role, tiers });
  }
  return out;
}

async function loadIcons(version, secs) {
  const ids = [...new Set(secs.flatMap((s) => s.tiers.flatMap((t) => t.champs.map((c) => c.id))))];
  const images = new Map();
  const failed = [];
  await Promise.all(
    ids.map(async (id) => {
      const img = new Image();
      img.crossOrigin = "anonymous"; // the CDN sends ACAO:*; without this the canvas would be tainted
      img.src = iconUrl(version, id);
      try {
        await img.decode();
        images.set(id, img);
      } catch {
        failed.push(id);
      }
    }),
  );
  if (failed.length) throw new Error(`Couldn't load ${failed.length} champion icon(s): ${failed.join(", ")}`);
  return images;
}

async function loadFonts(texts) {
  if (!document.fonts) return;
  const specs = [
    [`900 64px "Alegreya SC"`, texts.title],
    [`800 46px "Alegreya SC"`, texts.name],
    [`800 34px "Alegreya SC"`, texts.roles],
    [`700 22px "Alegreya SC"`, texts.tiers],
    [`500 14px "Alegreya"`, texts.footer],
    [`700 16px "Alegreya"`, texts.footer],
  ];
  // Pass the text so the right unicode-range subset is fetched, then wait for the whole set.
  await Promise.all(specs.map(([font, text]) => document.fonts.load(font, text || "A")));
  await document.fonts.ready;
}

function tornPath(ctx, x, y, w, h, rand) {
  const step = 12;
  const jitter = 3;
  let off = 0;
  const wobble = () => {
    off = off * 0.55 + (rand() - 0.5) * 2 * jitter;
    return off;
  };
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let px = x + step; px < x + w; px += step) ctx.lineTo(px, y + wobble());
  ctx.lineTo(x + w, y);
  for (let py = y + step; py < y + h; py += step) ctx.lineTo(x + w + wobble(), py);
  ctx.lineTo(x + w, y + h);
  for (let px = x + w - step; px > x; px -= step) ctx.lineTo(px, y + h + wobble());
  ctx.lineTo(x, y + h);
  for (let py = y + h - step; py > y; py -= step) ctx.lineTo(x + wobble(), py);
  ctx.closePath();
}

function fitFont(ctx, weight, family, text, maxPx, maxWidth) {
  let px = maxPx;
  ctx.font = `${weight} ${px}px ${family}`;
  while (px > 18 && ctx.measureText(text).width > maxWidth) {
    px -= 2;
    ctx.font = `${weight} ${px}px ${family}`;
  }
  return px;
}

/**
 * Render the pool to a canvas (1200 logical px wide, drawn at 2x). Resolves to the canvas.
 * Throws if there is nothing to draw or an icon/font can't be loaded.
 */
export async function renderPoolImage(state, data, { siteUrl = SITE_URL, disclaimer = DISCLAIMER } = {}) {
  const secs = sections(state, data.byKey);
  if (secs.length === 0) throw new Error("Nothing to export yet.");

  const name = (state.name || "").trim();
  const footerText = [siteUrl, disclaimer].filter(Boolean).join(" ");
  await loadFonts({
    title: "CHAMPION POOL",
    name,
    roles: secs.map((s) => ROLE_LABELS[s.role]).join(""),
    tiers: secs.flatMap((s) => s.tiers.map((t) => TIER_LABELS[t.tier])).join(""),
    footer: footerText,
  });
  const icons = await loadIcons(data.version, secs);

  // ---- measure (a throwaway context just for text metrics) ----
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = `500 14px ${BODY}`;
  const footerLines = disclaimer ? wrap(measure, disclaimer, CONTENT_W) : [];
  const urlH = siteUrl ? 24 : 0;

  const TITLE_H = name ? 132 : 84;
  const ROLE_H = 56;
  const ROW_H = ICON + GAP;
  const TIER_GAP = 14;
  const ROLE_GAP = 26;
  let contentH = TITLE_H + 30;
  for (const s of secs) {
    contentH += ROLE_H;
    for (const t of s.tiers) contentH += Math.ceil(t.champs.length / PER_ROW) * ROW_H - GAP + TIER_GAP;
    contentH += ROLE_GAP;
  }
  const footerH = footerLines.length || siteUrl ? 28 + urlH + footerLines.length * 20 : 0;
  const cardH = PAD + contentH + footerH + PAD - 20;
  const H = cardH + MARGIN * 2;

  // ---- draw ----
  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // slate surround
  ctx.fillStyle = C.slate;
  ctx.fillRect(0, 0, W, H);
  const sg = ctx.createRadialGradient(W * 0.2, 0, 0, W * 0.2, 0, Math.max(W, H));
  sg.addColorStop(0, "rgba(255,255,255,0.08)");
  sg.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = sg;
  ctx.fillRect(0, 0, W, H);

  // parchment card with procedurally torn edge
  const rand = mulberry32(1337);
  ctx.save();
  tornPath(ctx, MARGIN, MARGIN, CARD_W, cardH, rand);
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = C.parchment;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.clip();
  const pg = ctx.createRadialGradient(W / 2, MARGIN + cardH * 0.4, 0, W / 2, MARGIN + cardH * 0.4, Math.max(CARD_W, cardH) * 0.75);
  pg.addColorStop(0, C.parchmentLight);
  pg.addColorStop(0.6, C.parchment);
  pg.addColorStop(1, C.parchmentDark);
  ctx.fillStyle = pg;
  ctx.fillRect(MARGIN - 10, MARGIN - 10, CARD_W + 20, cardH + 20);
  // burnt edge (clipped, so only the inner half shows)
  tornPath(ctx, MARGIN, MARGIN, CARD_W, cardH, mulberry32(1337));
  ctx.strokeStyle = "rgba(120,80,30,0.45)";
  ctx.lineWidth = 22;
  ctx.stroke();
  ctx.restore();
  tornPath(ctx, MARGIN, MARGIN, CARD_W, cardH, mulberry32(1337));
  ctx.strokeStyle = C.edge;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // double inner border
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(MARGIN + 22, MARGIN + 22, CARD_W - 44, cardH - 44);
  ctx.lineWidth = 1;
  ctx.strokeRect(MARGIN + 29, MARGIN + 29, CARD_W - 58, cardH - 58);

  // heading
  let y = MARGIN + PAD;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = C.ink;
  ctx.font = `900 64px ${HEAD}`;
  ctx.fillText("CHAMPION POOL", W / 2, y + 50);
  if (name) {
    ctx.fillStyle = C.accent;
    fitFont(ctx, 800, HEAD, name, 46, CONTENT_W);
    ctx.fillText(name, W / 2, y + 108);
  }
  y += TITLE_H;
  // divider with a centre diamond
  ctx.strokeStyle = C.edge;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(CONTENT_X, y);
  ctx.lineTo(W / 2 - 14, y);
  ctx.moveTo(W / 2 + 14, y);
  ctx.lineTo(CONTENT_X + CONTENT_W, y);
  ctx.stroke();
  ctx.fillStyle = C.accent;
  ctx.beginPath();
  ctx.moveTo(W / 2, y - 7);
  ctx.lineTo(W / 2 + 7, y);
  ctx.lineTo(W / 2, y + 7);
  ctx.lineTo(W / 2 - 7, y);
  ctx.closePath();
  ctx.fill();
  y += 30;

  // roles
  ctx.textAlign = "left";
  for (const s of secs) {
    ctx.fillStyle = C.ink;
    ctx.font = `800 34px ${HEAD}`;
    const label = ROLE_LABELS[s.role].toUpperCase();
    ctx.fillText(label, CONTENT_X, y + 36);
    const lw = ctx.measureText(label).width;
    ctx.strokeStyle = C.edge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(CONTENT_X + lw + 16, y + 26);
    ctx.lineTo(CONTENT_X + CONTENT_W, y + 26);
    ctx.stroke();
    y += ROLE_H;

    for (const t of s.tiers) {
      ctx.fillStyle = C.ink;
      ctx.font = `700 22px ${HEAD}`;
      ctx.fillText(TIER_LABELS[t.tier].toUpperCase(), CONTENT_X, y + ICON / 2 + 8);
      t.champs.forEach((champ, i) => {
        const col = i % PER_ROW;
        const row = Math.floor(i / PER_ROW);
        const ix = CONTENT_X + LABEL_W + col * (ICON + GAP);
        const iy = y + row * ROW_H;
        ctx.drawImage(icons.get(champ.id), ix, iy, ICON, ICON);
        ctx.strokeStyle = C.frame;
        ctx.lineWidth = 2;
        ctx.strokeRect(ix - 1, iy - 1, ICON + 2, ICON + 2);
      });
      y += Math.ceil(t.champs.length / PER_ROW) * ROW_H - GAP + TIER_GAP;
    }
    y += ROLE_GAP;
  }

  // footer
  if (footerLines.length || siteUrl) {
    ctx.strokeStyle = C.edge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(CONTENT_X, y - 8);
    ctx.lineTo(CONTENT_X + CONTENT_W, y - 8);
    ctx.stroke();
    ctx.textAlign = "center";
    if (siteUrl) {
      ctx.fillStyle = C.ink;
      ctx.font = `700 16px ${BODY}`;
      ctx.fillText(siteUrl, W / 2, y + 16);
    }
    ctx.fillStyle = C.muted;
    ctx.font = `500 14px ${BODY}`;
    footerLines.forEach((line, i) => ctx.fillText(line, W / 2, y + 16 + urlH + i * 20));
  }

  return canvas;
}

export async function downloadPoolImage(state, data, opts) {
  const canvas = await renderPoolImage(state, data, opts);
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Image encoding failed"))), "image/png"),
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "champion-pool.png";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
