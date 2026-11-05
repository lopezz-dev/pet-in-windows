// Procedural pixel art. Instead of fixed bitmaps, every pet is rasterized from
// a few rules (rounded body, outline, 3-tone light from the top-left, belly,
// shine), so ANY colour works, and squash & stretch is just a different size.
// Faces, legs, antennae, helmet and tools are placed on top, pixel by pixel.

export interface Palette {
  outline: string;
  shadow: string;
  base: string;
  light: string;
  belly: string;
  shine: string;
  cheek: string;
}

// --- colour helpers ----------------------------------------------------------
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));

function hexToHsl(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  const n = parseInt(m.length === 3 ? [...m].map((c) => c + c).join("") : m, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

const hsl = (h: number, s: number, l: number) =>
  `hsl(${((h % 360) + 360) % 360} ${Math.round(clamp(s) * 100)}% ${Math.round(clamp(l) * 100)}%)`;

const paletteCache = new Map<string, Palette>();
export function makePalette(hex: string): Palette {
  const hit = paletteCache.get(hex);
  if (hit) return hit;
  const [h, s, l] = hexToHsl(hex);
  // Hue-shifted ramps (shadows cooler/redder, lights warmer) read more "pixel art"
  // than plain darker/lighter versions of the same hue.
  const p: Palette = {
    outline: hsl(h - 15, s * 0.7 + 0.1, Math.min(0.2, l * 0.32)),
    shadow: hsl(h - 10, s * 0.95, l - 0.13),
    base: hsl(h, s, l),
    light: hsl(h + 8, s * 0.95, l + 0.09),
    belly: hsl(h + 14, s * 0.65, l + 0.19),
    shine: hsl(h + 20, s * 0.35, Math.min(0.96, l + 0.32)),
    cheek: hsl(352, 0.8, 0.74),
  };
  paletteCache.set(hex, p);
  return p;
}

// --- generic blob rasterizer --------------------------------------------------
type Shade = (nx: number, ny: number, edge: boolean) => string | null;

function rasterBlob(w: number, h: number, power: number, shade: Shade) {
  const inside = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const nx = (x + 0.5 - w / 2) / (w / 2);
    const ny = (y + 0.5 - h / 2) / (h / 2);
    return Math.abs(nx) ** power + Math.abs(ny) ** power <= 1;
  };
  const px: { x: number; y: number; c: string }[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      const c = shade((x + 0.5 - w / 2) / (w / 2), (y + 0.5 - h / 2) / (h / 2), edge);
      if (c) px.push({ x, y, c });
    }
  }
  return { px, inside };
}

const spriteCache = new Map<string, HTMLCanvasElement>();
function cached(key: string, w: number, h: number, paint: (c: CanvasRenderingContext2D) => void) {
  let cv = spriteCache.get(key);
  if (!cv) {
    cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    paint(cv.getContext("2d")!);
    spriteCache.set(key, cv);
    if (spriteCache.size > 400) spriteCache.delete(spriteCache.keys().next().value!);
  }
  return cv;
}

/** The body: rounded "squircle" with outline, light ramp, belly and shine. */
function bodySprite(p: Palette, w: number, h: number) {
  return cached(`body|${p.base}|${w}|${h}`, w, h, (c) => {
    const { px, inside } = rasterBlob(w, h, 2.6, (nx, ny, edge) => {
      if (edge) return p.outline;
      if (nx * 0.45 + ny * 0.9 > 0.6) return p.shadow;
      const belly = ny > 0.15 && ny < 0.72 && Math.abs(nx) < 0.5 - (ny - 0.15) * 0.35;
      if (belly) return p.belly;
      if (-nx * 0.5 - ny * 0.85 > 0.42) return p.light;
      return p.base;
    });
    for (const q of px) {
      c.fillStyle = q.c;
      c.fillRect(q.x, q.y, 1, 1);
    }
    // Specular shine: a tiny L near the top-left.
    const sx = Math.round(w * 0.22);
    const sy = Math.round(h * 0.2);
    c.fillStyle = p.shine;
    for (const [x, y] of [[sx, sy], [sx + 1, sy], [sx, sy + 1]]) {
      if (inside(x, y) && inside(x - 1, y) && inside(x, y - 1)) c.fillRect(x, y, 1, 1);
    }
  });
}

/** Generic outlined blob, used for clouds, signs and rocks. */
export function drawBlob(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  sc: number,
  fill: string,
  outline: string,
  shadow?: string,
) {
  const cv = cached(`blob|${w}|${h}|${fill}|${outline}|${shadow}`, w, h, (c) => {
    const { px } = rasterBlob(w, h, 2.2, (nx, ny, edge) =>
      edge ? outline : shadow && nx * 0.3 + ny * 0.9 > 0.55 ? shadow : fill,
    );
    for (const q of px) {
      c.fillStyle = q.c;
      c.fillRect(q.x, q.y, 1, 1);
    }
  });
  ctx.drawImage(cv, Math.round(x), Math.round(y), w * sc, h * sc);
}

// --- tiny fixed glyphs ----------------------------------------------------------
const INK = "#16121c";
const WHITE = "#ffffff";

export const GLYPH_Z = ["KKKKK", "KWWWK", "KKWKK", "KWKKK", "KWWWK", "KKKKK"];
export const GLYPH_BANG = ["KKK", "KWK", "KWK", "KWK", "KKK", "KWK", "KKK"];
export const GLYPH_STAR = ["..Y..", ".YWY.", "YWWWY", ".YWY.", "..Y.."];
export const GLYPH_HEART = [".R.R.", "RWRRR", "RRRRR", ".RRR.", "..R.."];

const GLYPH_COLORS: Record<string, string> = { K: INK, W: WHITE, Y: "#ffd84a", R: "#ff5d73" };

export function drawGlyph(ctx: CanvasRenderingContext2D, g: string[], x: number, y: number, sc: number, colors = GLYPH_COLORS) {
  for (let r = 0; r < g.length; r++)
    for (let c = 0; c < g[r].length; c++) {
      const ch = g[r][c];
      if (ch === ".") continue;
      ctx.fillStyle = colors[ch] ?? ch;
      ctx.fillRect(Math.round(x + c * sc), Math.round(y + r * sc), sc, sc);
    }
}

// --- the pet ------------------------------------------------------------------
export type Pose = "stand" | "walk" | "sleep" | "jump" | "land" | "mine";
export type Eyes = "open" | "blink" | "closed" | "happy" | "wide";
export type Mouth = "smile" | "open" | "o" | "flat";

export interface Look {
  palette: Palette;
  scale: number;
  dir: 1 | -1;
  pose: Pose;
  eyes: Eyes;
  mouth: Mouth;
  walkPhase: number; // 0..3
  breathe: boolean; // 1px "inhale"
  bulb: string; // antenna / helmet lamp colour
  bulbOn: boolean;
  hat: boolean;
  swing: number; // pickaxe phase 0..3 (3 = strike)
  lift: number; // px above the ground (hops), in screen px
}

const HAT = { base: "#f2c230", dark: "#c98f17", light: "#fff3b0", outline: "#4a3208" };
const TOOL = { wood: "#9b6532", woodDark: "#6b4220", steel: "#cfd6df", steelDark: "#6e7785", steelLight: "#f4f8fc" };

/** Body size for each pose (sprite pixels). */
function bodySize(L: Look): [number, number] {
  switch (L.pose) {
    case "sleep":
      return [23, L.breathe ? 11 : 10];
    case "jump":
      return [18, 15];
    case "land":
      return [23, 11];
    default:
      return [20, L.breathe ? 12 : 13];
  }
}

/** Draws the pet standing on `groundY`, centred on `cx`. Returns its screen box. */
export function drawPet(ctx: CanvasRenderingContext2D, cx: number, groundY: number, L: Look) {
  const sc = L.scale;
  const p = L.palette;
  const [W, H] = bodySize(L);
  const legsH = L.pose === "sleep" ? 0 : 2;
  const left = Math.round(cx - (W * sc) / 2);
  const top = Math.round(groundY - (H + legsH) * sc - L.lift);

  ctx.save();
  if (L.dir < 0) {
    // Mirror around the body's centre: the light flips too, like most sprite games.
    ctx.translate(left * 2 + W * sc, 0);
    ctx.scale(-1, 1);
  }
  const P = (x: number, y: number, c: string, w = 1, h = 1) => {
    ctx.fillStyle = c;
    ctx.fillRect(left + x * sc, top + y * sc, w * sc, h * sc);
  };

  // Legs (behind the body's bottom outline).
  if (legsH) {
    const xs = [0.15, 0.34, 0.56, 0.75].map((f) => Math.round(W * f));
    xs.forEach((lx, i) => {
      const lifted = L.pose === "walk" && ((L.walkPhase === 1 && i % 2 === 0) || (L.walkPhase === 3 && i % 2 === 1));
      const splay = L.pose === "land" ? (i < 2 ? -1 : 1) : 0;
      const x = lx + splay + (lifted ? 1 : 0);
      if (lifted) {
        P(x, H - 1, p.shadow, 2, 1);
        P(x, H, p.outline, 2, 1);
      } else {
        P(x, H - 1, p.shadow, 2, 1);
        P(x, H, p.shadow, 2, 1);
        P(x, H + 1, p.outline, 2, 1);
        P(x + 1, H + 1, p.outline, 1, 1);
      }
    });
  }

  // Body
  ctx.drawImage(bodySprite(p, W, H), left, top, W * sc, H * sc);

  // Face (always drawn "facing right"; the mirror handles left).
  const ey = Math.round(H * 0.3);
  const ex = [Math.round(W * 0.33) + 1, Math.round(W * 0.62) + 1];
  for (const x of ex) {
    switch (L.eyes) {
      case "open":
        P(x, ey, INK, 2, 3);
        P(x + 1, ey, WHITE);
        break;
      case "wide":
        P(x, ey - 1, INK, 2, 4);
        P(x + 1, ey - 1, WHITE);
        P(x, ey + 1, WHITE);
        break;
      case "blink":
        P(x, ey + 2, INK, 2, 1);
        break;
      case "closed":
        P(x - 1, ey + 1, INK);
        P(x, ey + 2, INK, 2, 1);
        P(x + 2, ey + 1, INK);
        break;
      case "happy":
        P(x - 1, ey + 2, INK);
        P(x, ey + 1, INK, 2, 1);
        P(x + 2, ey + 2, INK);
        break;
    }
  }
  P(ex[0] - 2, ey + 3, p.cheek, 2, 1);
  P(ex[1] + 2, ey + 3, p.cheek, 2, 1);
  const mx = Math.round((ex[0] + ex[1]) / 2) + 1;
  const my = ey + 3;
  switch (L.mouth) {
    case "smile":
      P(mx - 1, my, INK);
      P(mx, my + 1, INK);
      P(mx + 1, my, INK);
      break;
    case "open":
      P(mx - 1, my, INK, 3, 1);
      P(mx - 1, my + 1, INK);
      P(mx, my + 1, "#e35d6a");
      P(mx + 1, my + 1, INK);
      P(mx - 1, my + 2, INK, 3, 1);
      break;
    case "o":
      P(mx, my, INK, 2, 2);
      break;
    case "flat":
      P(mx - 1, my + 1, INK, 3, 1);
      break;
  }

  // Head gear: miner helmet (with lamp) or antennae (with bulbs).
  const glow = L.bulbOn ? L.bulb : p.shadow;
  if (L.hat) {
    const x0 = Math.round(W * 0.18);
    const n = W - 2 * x0;
    P(x0 + 2, -3, HAT.outline, n - 4, 1);
    P(x0 + 1, -2, HAT.outline);
    P(x0 + 2, -2, HAT.base, n - 4, 1);
    P(x0 + n - 2, -2, HAT.outline);
    P(x0, -1, HAT.outline);
    P(x0 + 1, -1, HAT.base, n - 2, 1);
    P(x0 + n - 1, -1, HAT.outline);
    P(x0 + 3, -2, HAT.light, 2, 1);
    P(x0 + 2, -1, HAT.light);
    // brim
    P(x0 - 2, 0, HAT.outline);
    P(x0 - 1, 0, HAT.dark, n + 2, 1);
    P(x0 + n + 1, 0, HAT.outline);
    P(x0 - 2, 1, HAT.outline, n + 4, 1);
    // lamp
    const lx = x0 + n - 5;
    P(lx - 1, -2, HAT.outline, 4, 1);
    P(lx - 1, -1, HAT.outline);
    P(lx, -1, glow, 2, 1);
    P(lx + 2, -1, HAT.outline);
    if (L.bulbOn) P(lx, -1, WHITE);
  } else {
    const ax = [Math.round(W * 0.3), Math.round(W * 0.64)];
    for (const [i, a] of ax.entries()) {
      if (L.pose === "sleep") {
        // Drooping antennae.
        P(a, -1, p.outline, 2, 1);
        P(a + 2, -2, p.outline, 1, 1);
        P(a + 2, -1, glow);
        continue;
      }
      const sway = L.pose === "walk" ? ((L.walkPhase + i) % 4 < 2 ? 0 : 1) : 0;
      P(a, -1, p.outline);
      P(a + sway, -2, p.outline);
      // bulb: 2x2 with a 1px ring
      const bx = a + sway;
      P(bx, -5, p.outline, 2, 1);
      P(bx - 1, -4, p.outline, 1, 2);
      P(bx + 2, -4, p.outline, 1, 2);
      P(bx, -4, glow, 2, 2);
      if (L.bulbOn) P(bx, -4, WHITE);
    }
  }

  // Pickaxe while mining: a short arm and a tool that rotates around the grip.
  if (L.pose === "mine") {
    const ay = Math.round(H * 0.55);
    P(W - 1, ay, p.base, 1, 2);
    P(W, ay, p.outline, 1, 2);
    const angle = [2.2, 1.5, 0.6, -0.55][L.swing % 4];
    const dx = Math.cos(angle);
    const dy = -Math.sin(angle);
    const gx = W + 0.5;
    const gy = ay + 0.5;
    for (let i = 0; i <= 7; i++) {
      P(Math.floor(gx + dx * i), Math.floor(gy + dy * i), i % 3 === 0 ? TOOL.woodDark : TOOL.wood);
    }
    const hx = gx + dx * 8;
    const hy = gy + dy * 8;
    for (let j = -3; j <= 3; j++) {
      const back = Math.abs(j) === 3 ? -1 : 0; // curved head
      const c = Math.abs(j) === 3 ? TOOL.steelDark : j === -1 ? TOOL.steelLight : TOOL.steel;
      P(Math.floor(hx - dy * j + dx * back), Math.floor(hy + dx * j + dy * back), c);
    }
  }

  ctx.restore();
  return { x: left, y: top - 5 * sc, w: W * sc, h: (H + legsH + 5) * sc, headY: top };
}

/** Thought cloud with "..." that fills up, trailing bubbles from the head. */
export function drawThought(ctx: CanvasRenderingContext2D, x: number, headY: number, dir: 1 | -1, sc: number, t: number) {
  const s2 = Math.max(1, sc - 1);
  const cx = x + dir * 4 * sc;
  drawBlob(ctx, cx - s2, headY - 9 * s2, 3, 3, s2, WHITE, INK);
  drawBlob(ctx, cx + dir * 3 * s2 - 2 * s2, headY - 14 * s2, 4, 4, s2, WHITE, INK);
  const cloudX = cx + dir * 6 * s2 - 9 * s2;
  const cloudY = headY - 24 * s2;
  drawBlob(ctx, cloudX, cloudY, 18, 10, s2, WHITE, INK, "#dcd6ee");
  const n = Math.floor(t * 3) % 4;
  ctx.fillStyle = INK;
  for (let i = 0; i < n; i++) ctx.fillRect(Math.round(cloudX + (4 + i * 4) * s2), Math.round(cloudY + 4 * s2), 2 * s2, 2 * s2);
}

/** Red "!" sign bobbing above the head. */
export function drawAlert(ctx: CanvasRenderingContext2D, x: number, headY: number, sc: number, now: number) {
  const bob = Math.floor(now / 250) % 2 ? 0 : sc;
  const sx = x - 4 * sc;
  const sy = headY - 18 * sc - bob;
  drawBlob(ctx, sx, sy, 9, 11, sc, "#ff4d5e", INK, "#c92a43");
  drawGlyph(ctx, GLYPH_BANG, sx + 3 * sc, sy + 2 * sc, sc);
}

/** A little rock to mine, with a crack that grows. */
export function drawRock(ctx: CanvasRenderingContext2D, cx: number, groundY: number, sc: number, crack: number) {
  const w = 8;
  const h = 5;
  const x = cx - (w * sc) / 2;
  const y = groundY - h * sc;
  drawBlob(ctx, x, y, w, h, sc, "#8a8c99", "#2e2f38", "#666876");
  ctx.fillStyle = "#b9bbc7";
  ctx.fillRect(Math.round(x + 2 * sc), Math.round(y + sc), 2 * sc, sc);
  ctx.fillStyle = "#2e2f38";
  for (let i = 0; i < crack; i++) ctx.fillRect(Math.round(x + (4 + (i % 2)) * sc), Math.round(y + (1 + i) * sc), sc, sc);
}
