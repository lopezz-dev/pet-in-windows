import "./bubbles.css";
import "./settings.css";
import { GLYPH_Z, THEMES, drawAlert, drawGlyph, drawPet, drawTarget, drawThought, themeOf, themePalette, type Pose, type ThemeDef } from "./art";
import { DEFAULTS, PRESET_COLORS, loadSettings, onSettings, saveSettings, type Settings } from "./settings";

type PreviewState = "working" | "thinking" | "waiting" | "attention";

let S: Settings = await loadSettings();
let previewState: PreviewState = "working";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------------------
// Saving (debounced) + "Guardado" flash
// ---------------------------------------------------------------------------
let saveTimer = 0;
function update(patch: Partial<Settings>) {
  S = { ...S, ...patch };
  render();
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    await saveSettings(S);
    const el = $("saved");
    el.classList.add("on");
    setTimeout(() => el.classList.remove("on"), 1200);
  }, 150);
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
function segmented<K extends keyof Settings>(id: string, key: K) {
  const root = $(id);
  root.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button");
    if (b?.dataset.v) update({ [key]: b.dataset.v } as Partial<Settings>);
  });
  return () => root.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === String(S[key])));
}

function range<K extends keyof Settings>(id: string, key: K, fmt: (v: number) => string) {
  const input = $<HTMLInputElement>(id);
  const out = input.parentElement!.querySelector("output")!;
  input.addEventListener("input", () => update({ [key]: Number(input.value) } as Partial<Settings>));
  return () => {
    input.value = String(S[key]);
    out.textContent = fmt(Number(S[key]));
  };
}

function toggle<K extends keyof Settings>(id: string, key: K) {
  const input = $<HTMLInputElement>(id);
  input.addEventListener("change", () => update({ [key]: input.checked } as Partial<Settings>));
  return () => (input.checked = Boolean(S[key]));
}

function swatch(color: string, on: boolean, onClick: () => void) {
  const b = document.createElement("button");
  b.className = "swatch" + (on ? " on" : "");
  b.style.setProperty("--c", color);
  b.title = color;
  b.setAttribute("aria-pressed", String(on));
  b.addEventListener("click", onClick);
  return b;
}

function customColor(value: string, onPick: (c: string) => void) {
  const label = document.createElement("label");
  label.className = "swatch custom";
  label.title = "Color personalizado";
  const input = document.createElement("input");
  input.type = "color";
  input.value = value;
  input.addEventListener("input", () => onPick(input.value));
  label.append(input);
  return label;
}

/** Pet colours: in auto mode they're a multi-select rotation, in fixed mode a single pick. */
function renderSwatches() {
  const root = $("swatches");
  root.replaceChildren();
  const auto = S.colorMode === "auto";
  $("color-help").textContent = auto ? "Colores en rotación" : "Color de todas";
  const all = [...new Set([...PRESET_COLORS, ...S.autoColors, S.color])];
  for (const c of all) {
    const on = auto ? S.autoColors.includes(c) : S.color === c;
    root.append(
      swatch(c, on, () => {
        if (!auto) return update({ color: c });
        const next = on ? S.autoColors.filter((x) => x !== c) : [...S.autoColors, c];
        if (next.length) update({ autoColors: next });
      }),
    );
  }
  root.append(customColor(S.color, (c) => (auto ? update({ autoColors: [...new Set([...S.autoColors, c])] }) : update({ color: c }))));
}

function renderAccent() {
  const root = $("accent");
  root.replaceChildren();
  for (const c of PRESET_COLORS) root.append(swatch(c, S.bubbleAccent === c, () => update({ bubbleAccent: c })));
  root.append(customColor(S.bubbleAccent, (c) => update({ bubbleAccent: c })));
}

// Theme cards: each has its own tiny animated canvas.
const themeCards: { def: ThemeDef | null; canvas: HTMLCanvasElement; button: HTMLButtonElement }[] = [];
{
  const root = $("themes");
  for (const def of [...THEMES, null]) {
    const button = document.createElement("button");
    button.className = "theme";
    button.dataset.v = def?.id ?? "mix";
    button.setAttribute("role", "radio");
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 72;
    const name = document.createElement("strong");
    name.textContent = def?.name ?? "Mezcla";
    const desc = document.createElement("span");
    desc.textContent = def?.desc ?? "Un tema distinto por conversación";
    button.append(canvas, name, desc);
    button.addEventListener("click", () => update({ theme: button.dataset.v! }));
    root.append(button);
    themeCards.push({ def, canvas, button });
  }
}
const renderThemes = () =>
  themeCards.forEach(({ button }) => {
    const on = button.dataset.v === S.theme;
    button.classList.toggle("on", on);
    button.setAttribute("aria-checked", String(on));
  });

function drawThemeCards() {
  for (const [i, { def, canvas }] of themeCards.entries()) {
    const c = canvas.getContext("2d")!;
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, canvas.width, canvas.height);
    const th = def ?? THEMES[Math.floor(t / 1.5) % THEMES.length];
    const color = S.colorMode === "fixed" ? S.color : S.autoColors[i % S.autoColors.length] ?? S.color;
    drawPet(c, 48, 66, {
      theme: th,
      palette: themePalette(th, color),
      scale: 2,
      dir: 1,
      pose: "stand",
      eyes: Math.sin(t * 1.3 + i) > 0.97 ? "blink" : "open",
      mouth: "smile",
      walkPhase: 0,
      breathe: Math.sin(t * 2.2 + i) > 0.6,
      bulb: "#7be0a4",
      bulbOn: true,
      hat: false,
      swing: 0,
      lift: 0,
      frame: Math.floor(t * 60),
    });
  }
}

const renderers = [
  renderThemes,
  segmented("colorMode", "colorMode"),
  segmented("bubbleStyle", "bubbleStyle"),
  segmented("bubbleSize", "bubbleSize"),
  segmented("zone", "zone"),
  range("scale", "scale", (v) => `x${v}`),
  range("speed", "speed", (v) => `${v}×`),
  range("idleMinutes", "idleMinutes", (v) => `${v} min`),
  range("maxPets", "maxPets", (v) => String(v)),
  toggle("hat", "hat"),
  toggle("bubbleDetail", "bubbleDetail"),
  toggle("showAllOpen", "showAllOpen"),
  toggle("showSubagents", "showSubagents"),
  toggle("celebrate", "celebrate"),
];

function render() {
  renderers.forEach((r) => r());
  renderSwatches();
  renderAccent();
  renderBubble();
}

$("reset").addEventListener("click", () => update({ ...DEFAULTS, autoColors: [...DEFAULTS.autoColors] }));
$("preview-states").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button");
  if (!b?.dataset.state) return;
  previewState = b.dataset.state as PreviewState;
  document.querySelectorAll("#preview-states button").forEach((x) => x.classList.toggle("on", x === b));
  renderBubble();
});
onSettings((s) => {
  S = s;
  render();
});

// ---------------------------------------------------------------------------
// Live preview
// ---------------------------------------------------------------------------
const SAMPLE: Record<PreviewState, { status: string; detail: string }> = {
  working: { status: "Trabajando · Edit sessions.rs", detail: "Tarea: añade una ventana de ajustes con vista previa" },
  thinking: { status: "Pensando…", detail: "Tarea: añade una ventana de ajustes con vista previa" },
  waiting: { status: "Terminé, esperando tu respuesta", detail: "Listo: la ventana de ajustes guarda y aplica en vivo." },
  attention: { status: "¡Necesito tu permiso! Bash npm run build", detail: "Tarea: compila la app para probarla" },
};

function renderBubble() {
  const el = $("preview-bubble");
  el.className = `bubble show style-${S.bubbleStyle} size-${S.bubbleSize}`;
  el.style.setProperty("--accent", S.bubbleAccent);
  const s = SAMPLE[previewState];
  el.innerHTML =
    `<div class="title">Mascota en la barra de tareas</div><div class="sub">pet_in_windows · main</div>` +
    `<div class="status ${previewState}"><span class="dot"></span></div>` +
    (S.bubbleDetail ? `<div class="detail"></div>` : "");
  el.querySelector(".status")!.append(s.status);
  el.querySelector(".detail")?.append(s.detail);
}

const canvas = $<HTMLCanvasElement>("preview");
const ctx = canvas.getContext("2d")!;
let PW = 0;
let PH = 0;
new ResizeObserver(() => {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  PW = r.width;
  PH = r.height;
  canvas.width = Math.round(PW * dpr);
  canvas.height = Math.round(PH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
}).observe(canvas);

let t = 0;
let x = 0;
let dir: 1 | -1 = 1;
let lift = 0;
let vy = 0;
let zT = 0;
const zs: { x: number; y: number; life: number }[] = [];
let last = performance.now();

function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  t += dt;
  const sc = Math.min(5, S.scale + 1); // a bit bigger than on the taskbar, but fits the box
  const ground = PH - 28;
  ctx.clearRect(0, 0, PW, PH);

  // Ground: a strip of "taskbar".
  ctx.fillStyle = "#1c1a22";
  ctx.fillRect(0, ground, PW, PH - ground);
  ctx.fillStyle = "#2a2733";
  ctx.fillRect(0, ground, PW, 2);

  const st = previewState;
  // Simple motion: thinking paces, attention hops, others stay put.
  if (st === "thinking") {
    x += dir * 26 * S.speed * dt;
    if (Math.abs(x) > 50) dir = x > 0 ? -1 : 1;
  } else {
    x += (0 - x) * Math.min(1, dt * 4);
    if (st === "working") dir = 1;
  }
  if (st === "attention" && lift === 0 && Math.floor(t / 0.9) !== Math.floor((t - dt) / 0.9)) vy = 230;
  if (lift > 0 || vy > 0) {
    vy -= 900 * dt;
    lift = Math.max(0, lift + vy * dt);
    if (lift === 0) vy = 0;
  }

  const cx = PW / 2 - (st === "working" ? 9 * sc : 0) + x;
  const swing = Math.floor(t * 6) % 4;
  let pose: Pose = "stand";
  if (st === "waiting") pose = "sleep";
  else if (lift > 0) pose = "jump";
  else if (st === "working") pose = "mine";
  else if (st === "thinking") pose = "walk";

  const color = S.colorMode === "fixed" ? S.color : S.autoColors[Math.floor(t / 3) % S.autoColors.length] ?? S.color;
  const theme = S.theme === "mix" ? THEMES[Math.floor(t / 3) % THEMES.length] : themeOf(S.theme);
  if (pose === "mine") drawTarget(ctx, theme.tool, cx + 18 * sc, ground, sc, swing);
  const box = drawPet(ctx, cx, ground, {
    theme,
    frame: Math.floor(t * 60),
    palette: themePalette(theme, color),
    scale: sc,
    dir,
    pose,
    eyes: st === "waiting" ? "closed" : st === "attention" ? "wide" : Math.sin(t * 1.3) > 0.97 ? "blink" : "open",
    mouth: st === "attention" ? "open" : st === "waiting" ? "o" : st === "working" ? "flat" : "smile",
    walkPhase: Math.floor(t * 6) % 4,
    breathe: Math.sin(t * 2.2) > 0.6,
    bulb: { working: "#ffd84a", thinking: "#b892ff", waiting: "#7be0a4", attention: "#ff4d5e" }[st],
    bulbOn: st === "waiting" || Math.floor(t * 4) % 2 === 0,
    hat: S.hat && st === "working",
    swing,
    lift: Math.round(lift / sc) * sc,
  });
  if (st === "thinking") drawThought(ctx, cx, box.headY, dir, sc, t);
  if (st === "attention") drawAlert(ctx, cx, box.headY, sc, now);
  if (st === "waiting") {
    zT -= dt;
    if (zT <= 0) {
      zT = 1.2;
      zs.push({ x: cx + 6 * sc, y: box.headY, life: 2.4 });
    }
  } else zs.length = 0;
  for (let i = zs.length - 1; i >= 0; i--) {
    const z = zs[i];
    z.life -= dt;
    z.y -= 22 * dt;
    z.x += 10 * dt;
    if (z.life <= 0) {
      zs.splice(i, 1);
      continue;
    }
    ctx.globalAlpha = Math.min(1, z.life);
    drawGlyph(ctx, GLYPH_Z, z.x, z.y, Math.max(1, sc - 1));
    ctx.globalAlpha = 1;
  }
  drawThemeCards();
  requestAnimationFrame(frame);
}

render();
requestAnimationFrame(frame);
