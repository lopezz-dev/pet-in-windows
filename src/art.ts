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

type InsideFn = (x: number, y: number, nx: number, ny: number) => boolean;

function rasterBlob(w: number, h: number, shape: number | InsideFn, shade: Shade) {
  const inside = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const nx = (x + 0.5 - w / 2) / (w / 2);
    const ny = (y + 0.5 - h / 2) / (h / 2);
    if (typeof shape === "function") return shape(x, y, nx, ny);
    return Math.abs(nx) ** shape + Math.abs(ny) ** shape <= 1;
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

export type BodyShape = "squircle" | "dome" | "ghost";

/** Body silhouettes. `wave` animates the ghost's hem. */
function shapeFn(shape: BodyShape, w: number, h: number, wave: number): number | InsideFn {
  switch (shape) {
    case "squircle":
      return 2.6;
    case "dome": // slime: round top, wide flat bottom
      return (_x, _y, nx, ny) => (ny < 0 ? nx * nx + ny * ny <= 1 : Math.abs(nx) ** 5 + Math.abs(ny) ** 6 <= 1);
    case "ghost": // round head, straight sides, wavy hem
      return (x, y, nx, ny) => {
        if (ny < -0.1) return nx * nx + ((ny + 0.1) / 0.9) ** 2 <= 1;
        if (Math.abs(nx) > 0.97) return false;
        return !(y >= h - 2 && (x + wave) % 4 >= (y === h - 1 ? 2 : 3));
      };
  }
}

/** The body: outline, light ramp, belly and shine on top of a silhouette. */
function bodySprite(p: Palette, w: number, h: number, shape: BodyShape = "squircle", wave = 0) {
  return cached(`body|${p.base}|${w}|${h}|${shape}|${wave}`, w, h, (c) => {
    const { px, inside } = rasterBlob(w, h, shapeFn(shape, w, h, wave), (nx, ny, edge) => {
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

// --- themes -------------------------------------------------------------------
// Every theme is original art built from the same rules. To add one: append a
// ThemeDef here and handle its `head` (and optionally tool/target) below.

export type ThemeId = "classic" | "cat" | "slime" | "ghost" | "knight" | "wizard";
export type Tool = "pickaxe" | "sword" | "wand";

export interface ThemeDef {
  id: ThemeId;
  name: string;
  desc: string;
  shape: BodyShape;
  legs: boolean;
  /** Wears the miner helmet while working (if enabled in settings). */
  minerHat: boolean;
  tool: Tool;
  /** Body colour is washed towards white (ghosts). */
  pale?: boolean;
}

export const THEMES: ThemeDef[] = [
  { id: "classic", name: "Bichito", desc: "El original: antenas con bombilla", shape: "squircle", legs: true, minerHat: true, tool: "pickaxe" },
  { id: "cat", name: "Gatete", desc: "Orejas, bigotes, cola y cascabel", shape: "squircle", legs: true, minerHat: true, tool: "pickaxe" },
  { id: "slime", name: "Slime", desc: "Gelatina que rebota, con núcleo brillante", shape: "dome", legs: false, minerHat: true, tool: "pickaxe" },
  { id: "ghost", name: "Fantasmita", desc: "Flota y lleva un fuego fatuo", shape: "ghost", legs: false, minerHat: false, tool: "wand", pale: true },
  { id: "knight", name: "Caballero", desc: "Yelmo con penacho y espada de entrenamiento", shape: "squircle", legs: true, minerHat: false, tool: "sword" },
  { id: "wizard", name: "Mago", desc: "Sombrero puntiagudo y varita", shape: "squircle", legs: true, minerHat: false, tool: "wand" },
];
export const themeOf = (id: string) => THEMES.find((t) => t.id === id) ?? THEMES[0];

function mixHex(a: string, b: string, k: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - k) + ((pb >> s) & 255) * k);
  return "#" + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0");
}

/** Palette for a theme (ghosts are paler). */
export function themePalette(theme: ThemeDef, hex: string) {
  return makePalette(theme.pale ? mixHex(hex, "#ffffff", 0.55) : hex);
}

// --- the pet ------------------------------------------------------------------
export type Pose = "stand" | "walk" | "sleep" | "jump" | "land" | "mine";
export type Eyes = "open" | "blink" | "closed" | "happy" | "wide";
export type Mouth = "smile" | "open" | "o" | "flat";

export interface Look {
  theme: ThemeDef;
  palette: Palette;
  scale: number;
  dir: 1 | -1;
  pose: Pose;
  eyes: Eyes;
  mouth: Mouth;
  walkPhase: number; // 0..3
  breathe: boolean; // 1px "inhale"
  bulb: string; // status colour (bulbs, plume, lamp, bell, core…)
  bulbOn: boolean;
  hat: boolean; // miner helmet
  swing: number; // tool phase 0..3 (3 = strike)
  lift: number; // px above the ground (hops), in screen px
  frame: number; // free-running counter for idle animation (tails, hems…)
}

const HAT = { base: "#f2c230", dark: "#c98f17", light: "#fff3b0", outline: "#4a3208" };
const TOOL = { wood: "#9b6532", woodDark: "#6b4220", steel: "#cfd6df", steelDark: "#6e7785", steelLight: "#f4f8fc", gold: "#f2c230" };
const STEEL = { base: "#c3cad4", light: "#eef2f6", dark: "#7d8794", outline: "#2b2f38" };
const ROBE = { base: "#4b3a8c", light: "#6a58b8", outline: "#1b1238", band: "#f2c230" };

/** Body size for each pose and theme (sprite pixels). */
function bodySize(L: Look): [number, number] {
  const shape = L.theme.shape;
  if (shape === "dome") {
    // Slimes squish instead of walking.
    if (L.pose === "sleep") return [25, 9];
    if (L.pose === "jump") return [19, 14];
    if (L.pose === "land") return [26, 9];
    if (L.pose === "walk") return L.walkPhase % 2 ? [24, 10] : [21, 13];
    return [22, L.breathe ? 11 : 12];
  }
  if (shape === "ghost") {
    if (L.pose === "sleep") return [20, 13];
    return [18, L.breathe ? 15 : 16];
  }
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
  const th = L.theme;
  const [W, H] = bodySize(L);
  const legsH = th.legs && L.pose !== "sleep" ? 2 : 0;
  const float = th.shape === "ghost" ? (Math.floor(L.frame / 12) % 2 ? 3 : 2) : 0;
  const left = Math.round(cx - (W * sc) / 2);
  const top = Math.round(groundY - (H + legsH + float) * sc - L.lift);

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
  const glow = L.bulbOn ? L.bulb : p.shadow;

  // Cat tail (behind the body, on the back side).
  if (th.id === "cat") {
    const sway = Math.floor(L.frame / 10) % 4;
    for (let i = 0; i < 6; i++) {
      const tx = -1 - Math.floor(i / 2) + (i > 3 && sway < 2 ? 1 : 0);
      const ty = H - 4 - i;
      P(tx - 1, ty, p.outline);
      P(tx, ty, i > 4 ? p.light : p.base);
    }
    P(-3 + (sway < 2 ? 1 : 0), H - 11, p.outline, 2, 1);
  }

  // Legs (behind the body's bottom outline).
  if (legsH) {
    const boot = th.id === "knight" ? STEEL.dark : th.id === "wizard" ? ROBE.outline : p.outline;
    const xs = [0.15, 0.34, 0.56, 0.75].map((f) => Math.round(W * f));
    xs.forEach((lx, i) => {
      const lifted = L.pose === "walk" && ((L.walkPhase === 1 && i % 2 === 0) || (L.walkPhase === 3 && i % 2 === 1));
      const splay = L.pose === "land" ? (i < 2 ? -1 : 1) : 0;
      const x = lx + splay + (lifted ? 1 : 0);
      if (lifted) {
        P(x, H - 1, p.shadow, 2, 1);
        P(x, H, boot, 2, 1);
      } else {
        P(x, H - 1, p.shadow, 2, 1);
        P(x, H, p.shadow, 2, 1);
        P(x, H + 1, boot, 2, 1);
        P(x + 1, H + 1, boot, 1, 1);
      }
    });
  }

  // Body
  const wave = th.shape === "ghost" ? Math.floor(L.frame / 8) % 4 : 0;
  if (th.shape === "ghost") ctx.globalAlpha *= 0.94;
  ctx.drawImage(bodySprite(p, W, H, th.shape, wave), left, top, W * sc, H * sc);
  if (th.shape === "ghost") ctx.globalAlpha /= 0.94;

  // Face (always drawn "facing right"; the mirror handles left).
  const ey = th.shape === "ghost" ? Math.round(H * 0.32) : th.shape === "dome" ? Math.round(H * 0.38) : Math.round(H * 0.3);
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
      if (th.id === "cat") {
        // ":3"
        P(mx - 1, my, INK);
        P(mx, my + 1, INK);
        P(mx + 1, my, INK);
        P(mx + 2, my + 1, INK);
        P(mx + 3, my, INK);
      } else {
        P(mx - 1, my, INK);
        P(mx, my + 1, INK);
        P(mx + 1, my, INK);
      }
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

  // --- Head gear: miner helmet replaces it while working, if the theme allows.
  if (L.hat && th.minerHat) drawMinerHat(P, W, glow, L.bulbOn);
  else {
    switch (th.id) {
      case "classic":
        drawAntennae(P, L, W, p, glow);
        break;
      case "cat":
        drawCat(P, L, W, H, p, my, glow);
        break;
      case "slime": {
        // Glowing core + extra shine.
        const cxp = Math.round(W * 0.5) - 1;
        const cyp = Math.round(H * 0.72);
        P(cxp, cyp, glow, 2, 2);
        if (L.bulbOn) P(cxp, cyp, WHITE);
        P(Math.round(W * 0.7), Math.round(H * 0.18), p.shine, 2, 1);
        break;
      }
      case "ghost": {
        // Will-o'-wisp floating above the head.
        const fx = Math.round(W / 2) - 1;
        const flick = Math.floor(L.frame / 6) % 2;
        P(fx, -2, glow, 2, 1);
        P(fx + flick, -3, glow, 1, 1);
        P(fx, -3, L.bulbOn ? WHITE : glow, 1, 1);
        P(fx + 1 - flick, -4, glow, 1, 1);
        break;
      }
      case "knight":
        drawKnightHelm(P, W, ey, mx, L.bulb, L.bulbOn);
        break;
      case "wizard":
        drawWizardHat(P, W, glow, L.bulbOn);
        break;
    }
  }

  // Tool while working: a short arm and a tool that rotates around the grip.
  if (L.pose === "mine") drawTool(P, th.tool, W, H, p, L.swing);

  ctx.restore();
  const extra = th.id === "wizard" ? 11 : 5;
  return { x: left, y: top - extra * sc, w: W * sc, h: (H + legsH + float + extra) * sc, headY: top };
}

type Px = (x: number, y: number, c: string, w?: number, h?: number) => void;

function drawMinerHat(P: Px, W: number, glow: string, on: boolean) {
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
  P(x0 - 2, 0, HAT.outline);
  P(x0 - 1, 0, HAT.dark, n + 2, 1);
  P(x0 + n + 1, 0, HAT.outline);
  P(x0 - 2, 1, HAT.outline, n + 4, 1);
  const lx = x0 + n - 5;
  P(lx - 1, -2, HAT.outline, 4, 1);
  P(lx - 1, -1, HAT.outline);
  P(lx, -1, glow, 2, 1);
  P(lx + 2, -1, HAT.outline);
  if (on) P(lx, -1, WHITE);
}

function drawAntennae(P: Px, L: Look, W: number, p: Palette, glow: string) {
  const ax = [Math.round(W * 0.3), Math.round(W * 0.64)];
  for (const [i, a] of ax.entries()) {
    if (L.pose === "sleep") {
      P(a, -1, p.outline, 2, 1);
      P(a + 2, -2, p.outline, 1, 1);
      P(a + 2, -1, glow);
      continue;
    }
    const sway = L.pose === "walk" ? ((L.walkPhase + i) % 4 < 2 ? 0 : 1) : 0;
    P(a, -1, p.outline);
    P(a + sway, -2, p.outline);
    const bx = a + sway;
    P(bx, -5, p.outline, 2, 1);
    P(bx - 1, -4, p.outline, 1, 2);
    P(bx + 2, -4, p.outline, 1, 2);
    P(bx, -4, glow, 2, 2);
    if (L.bulbOn) P(bx, -4, WHITE);
  }
}

function drawCat(P: Px, L: Look, W: number, H: number, p: Palette, my: number, glow: string) {
  // Ears (twitch now and then).
  const twitch = L.frame % 90 < 6 ? 1 : 0;
  for (const e of [Math.round(W * 0.14), W - Math.round(W * 0.14) - 5]) {
    const back = e < W / 2;
    const tip = back ? 0 : twitch;
    P(e, 0, p.outline);
    P(e + 1, 0, p.base);
    P(e + 2, 0, p.cheek);
    P(e + 3, 0, p.base);
    P(e + 4, 0, p.outline);
    P(e, -1, p.outline);
    P(e + 1, -1, p.base);
    P(e + 2, -1, p.cheek);
    P(e + 3, -1, p.outline);
    P(e + 1 + tip, -2, p.outline, 2, 1);
    P(e + 1 + tip, -3, p.outline);
  }
  // Whiskers on the face side.
  P(W - 1, my - 1, p.outline, 2, 1);
  P(W - 1, my + 1, p.outline, 2, 1);
  // Collar + bell (status colour).
  P(Math.round(W * 0.3), H - 4, "#c0303c", Math.round(W * 0.42), 1);
  const bx = Math.round(W * 0.5) - 1;
  P(bx - 1, H - 3, p.outline, 4, 1);
  P(bx, H - 3, glow, 2, 1);
  if (L.bulbOn) P(bx, H - 3, WHITE);
}

function drawKnightHelm(P: Px, W: number, ey: number, mx: number, plume: string, on: boolean) {
  // Steel cap down to just above the eyes, with a rim and a nasal guard.
  P(5, -2, STEEL.outline, W - 10, 1);
  P(3, -1, STEEL.outline, 2, 1);
  P(5, -1, STEEL.base, W - 10, 1);
  P(W - 5, -1, STEEL.outline, 2, 1);
  for (let y = 0; y < ey - 1; y++) {
    P(1, y, STEEL.outline);
    P(2, y, STEEL.light, 2, 1);
    P(4, y, STEEL.base, W - 8, 1);
    P(W - 4, y, STEEL.dark, 2, 1);
    P(W - 2, y, STEEL.outline);
  }
  P(1, ey - 1, STEEL.outline, W - 2, 1);
  P(mx - 1, ey - 1, STEEL.dark, 1, 3);
  P(6, 0, STEEL.light, 3, 1); // glint
  // Rivets
  P(4, ey - 2, STEEL.dark);
  P(W - 6, ey - 2, STEEL.dark);
  // Plume (status colour), sweeping back.
  const c = plume;
  P(Math.round(W / 2) - 1, -3, c, 3, 1);
  P(Math.round(W / 2) - 3, -4, c, 4, 1);
  P(Math.round(W / 2) - 5, -5, c, 4, 1);
  P(Math.round(W / 2) - 6, -6, c, 3, 1);
  P(Math.round(W / 2) - 6, -4, STEEL.outline);
  if (on) P(Math.round(W / 2) - 2, -4, WHITE, 2, 1);
}

function drawWizardHat(P: Px, W: number, glow: string, on: boolean) {
  // Brim
  P(-1, 0, ROBE.outline, W + 2, 1);
  P(0, -1, ROBE.outline);
  P(1, -1, ROBE.base, W - 2, 1);
  P(W - 1, -1, ROBE.outline);
  // Cone, bending backwards at the tip.
  for (let k = 0; k < 9; k++) {
    const y = -2 - k;
    const width = Math.max(1, Math.round((W - 8) * (1 - k / 9)));
    const bend = k > 5 ? -(k - 5) : 0;
    const x0 = Math.round(W / 2 - width / 2) + bend;
    P(x0 - 1, y, ROBE.outline);
    P(x0, y, ROBE.light);
    if (width > 1) P(x0 + 1, y, ROBE.base, width - 1, 1);
    P(x0 + width, y, ROBE.outline);
    if (k === 0) P(x0, y, ROBE.band, width, 1);
  }
  P(Math.round(W / 2), -5, "#ffd84a"); // star
  P(Math.round(W / 2) - 1, -6, "#fff3b0");
  // Pompom (status colour) at the tip.
  const tx = Math.round(W / 2) - 4;
  P(tx - 1, -12, ROBE.outline, 2, 1);
  P(tx - 2, -11, glow, 2, 1);
  if (on) P(tx - 2, -11, WHITE);
}

function drawTool(P: Px, tool: Tool, W: number, H: number, p: Palette, swing: number) {
  const ay = Math.round(H * 0.55);
  P(W - 1, ay, p.base, 1, 2);
  P(W, ay, p.outline, 1, 2);
  const angle = [2.2, 1.5, 0.6, -0.55][swing % 4];
  const dx = Math.cos(angle);
  const dy = -Math.sin(angle);
  const gx = W + 0.5;
  const gy = ay + 0.5;
  const at = (i: number, j = 0) => [Math.floor(gx + dx * i - dy * j), Math.floor(gy + dy * i + dx * j)] as const;

  if (tool === "pickaxe") {
    for (let i = 0; i <= 7; i++) P(...at(i), i % 3 === 0 ? TOOL.woodDark : TOOL.wood);
    for (let j = -3; j <= 3; j++) {
      const back = Math.abs(j) === 3 ? -1 : 0;
      const c = Math.abs(j) === 3 ? TOOL.steelDark : j === -1 ? TOOL.steelLight : TOOL.steel;
      P(...at(8 + back, j), c);
    }
  } else if (tool === "sword") {
    P(...at(0), TOOL.woodDark);
    P(...at(1), TOOL.wood);
    for (let j = -2; j <= 2; j++) P(...at(2, j), TOOL.gold);
    for (let i = 3; i <= 10; i++) {
      P(...at(i), i === 10 ? TOOL.steelDark : TOOL.steelLight);
      P(...at(i, 1), TOOL.steel);
    }
  } else {
    for (let i = 0; i <= 5; i++) P(...at(i), i < 2 ? TOOL.woodDark : TOOL.wood);
    const [sx, sy] = at(7);
    P(sx, sy, "#ffd84a");
    P(sx - 1, sy, "#ffd84a");
    P(sx + 1, sy, "#ffd84a");
    P(sx, sy - 1, "#ffd84a");
    P(sx, sy + 1, "#ffd84a");
    P(sx, sy, WHITE);
  }
}

/** What the pet works on: rock (pickaxe), training dummy (sword), nothing (wand). */
export function drawTarget(ctx: CanvasRenderingContext2D, tool: Tool, cx: number, groundY: number, sc: number, hits: number) {
  if (tool === "pickaxe") return drawRock(ctx, cx, groundY, sc, hits);
  if (tool === "sword") {
    const wob = hits % 2 ? sc : 0;
    ctx.fillStyle = "#6b4220";
    ctx.fillRect(Math.round(cx - sc / 2), groundY - 12 * sc, sc, 12 * sc);
    ctx.fillRect(Math.round(cx - 3 * sc + wob), groundY - 9 * sc, 6 * sc, sc);
    drawBlob(ctx, cx - 3 * sc + wob, groundY - 16 * sc, 6, 7, sc, "#d8b878", "#4a3315", "#b8955a");
    ctx.fillStyle = "#4a3315";
    ctx.fillRect(Math.round(cx - sc + wob), groundY - 14 * sc, sc, sc);
    ctx.fillRect(Math.round(cx + sc + wob), groundY - 13 * sc, sc, sc);
  }
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
