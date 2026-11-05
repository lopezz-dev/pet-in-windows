// Pixel-art sprites, drawn in code. Each body sprite is defined as its LEFT
// half (8 px) and mirrored, so the critter is always symmetric and easy to edit.
//
// Palette keys:  . transparent   o body   d body shade   k ink   p cheek
//                s steel         b wood   y spark        r alert red   w white

export type Grid = string[];

const mirror = (half: Grid): Grid => half.map((r) => r + [...r].reverse().join(""));

const HEAD: Grid = [
  "........",
  "...d....", // antennae
  "...o....",
  "..oooooo",
  ".ooooooo",
];

const EYES_OPEN: Grid = [".oookooo", ".oookooo"];
const EYES_CLOSED: Grid = [".ooooooo", ".ooddooo"];
const EYES_WIDE: Grid = [".ookkooo", ".ookkooo"];

const LOWER: Grid = [".opooooo", ".ooooooo", "..oooooo"];
const LOWER_SHOUT: Grid = [".opooooo", ".oooooko", "..oooooo"];

const LEGS_A: Grid = ["..o..o..", "..o..o.."];
const LEGS_B: Grid = [".o..o...", ".o..o..."];

export const SPRITES = {
  standA: mirror([...HEAD, ...EYES_OPEN, ...LOWER, ...LEGS_A]),
  standB: mirror([...HEAD, ...EYES_OPEN, ...LOWER, ...LEGS_B]),
  blink: mirror([...HEAD, ...EYES_CLOSED, ...LOWER, ...LEGS_A]),
  shout: mirror([...HEAD, ...EYES_WIDE, ...LOWER_SHOUT, ...LEGS_B]),
  // Lying down: legs tucked, body squashed one row lower.
  sleep: mirror([
    "........",
    "........",
    "........",
    "..d.....",
    "..oooooo",
    ".ooooooo",
    ".ooooooo",
    ".ooddooo",
    ".opooooo",
    ".ooooooo",
    ".ooooooo",
    "........",
  ]),
};

export const GLYPHS = {
  // White with a dark outline so it reads on any window behind it.
  z: ["kkkkkk", "kwwwwk", "kkkwkk", "kkwkk.", "kwwwwk", "kkkkkk"],
  bang: ["rr", "rr", "rr", "..", "rr"],
  dot: ["k"],
  spark: [".y.", "yyy", ".y."],
};

/** Palettes for different agents (first one is the classic orange). */
export const BODY_COLORS: [string, string][] = [
  ["#d97757", "#9a4a30"],
  ["#e0a24a", "#9c6a22"],
  ["#7fb069", "#4d7a3c"],
  ["#6aa6d8", "#3f6f99"],
  ["#c084d6", "#83509a"],
  ["#e58aa6", "#a55470"],
];

const FIXED: Record<string, string> = {
  k: "#1a1a1a",
  p: "#f4a3a0",
  s: "#c9ced6",
  b: "#8b5a2b",
  y: "#ffd84a",
  r: "#e23b3b",
  w: "#ffffff",
};

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  grid: Grid,
  x: number,
  y: number,
  scale: number,
  colors: [string, string] = BODY_COLORS[0],
) {
  for (let row = 0; row < grid.length; row++) {
    const line = grid[row];
    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      if (ch === ".") continue;
      ctx.fillStyle = ch === "o" ? colors[0] : ch === "d" ? colors[1] : FIXED[ch] ?? "#f0f";
      ctx.fillRect(Math.round(x + col * scale), Math.round(y + row * scale), scale, scale);
    }
  }
}

/**
 * A pickaxe drawn as a pixel line rotated around the grip, so the swing
 * looks hand-made: the angle is quantized into a few chunky steps.
 */
export function drawPickaxe(
  ctx: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  angle: number,
  dir: 1 | -1,
  scale: number,
) {
  const px = (x: number, y: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(gx + x * scale * dir), Math.round(gy + y * scale), scale, scale);
  };
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Handle: 6 px long.
  for (let i = 0; i < 6; i++) px(Math.round(cos * i), Math.round(-sin * i), FIXED.b);
  // Head: perpendicular bar at the end.
  const hx = cos * 6;
  const hy = -sin * 6;
  for (let j = -2; j <= 2; j++) px(Math.round(hx + sin * j), Math.round(hy + cos * j), FIXED.s);
}
