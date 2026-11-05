import "./bubbles.css";
import { GLYPH_HEART, GLYPH_STAR, GLYPH_Z, THEMES, drawAlert, drawGlyph, drawPet, drawTarget, drawThought, themeOf, themePalette, type Eyes, type Mouth, type Pose } from "./art";
import { DEFAULTS, isTauri, loadSettings, onSettings, type Settings } from "./settings";

// ---------------------------------------------------------------------------
// Types shared with the Rust side (src-tauri/src/sessions.rs)
// ---------------------------------------------------------------------------
type AgentState = "working" | "thinking" | "waiting" | "attention" | "idle";

interface Agent {
  id: string;
  parentId: string | null;
  kind: "main" | "sub";
  project: string;
  cwd: string;
  branch: string;
  state: AgentState;
  activity: string;
  lastText: string;
  lastPrompt: string;
  agentType: string;
  description: string;
  name: string;
  status: string;
  idleMs: number;
}

let S: Settings = { ...DEFAULTS };

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------
const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const bubbleLayer = document.getElementById("bubbles")!;
let W = 0;
let H = 0;

const GROUND = () => H - 1; // feet touch the top of the taskbar
const rand = (a: number, b: number) => a + Math.random() * (b - a);

function hash(s: string) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Particles: sparks, rock chips, Zzz, confetti, sweat
// ---------------------------------------------------------------------------
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  life: number;
  max: number;
  size: number;
  color?: string;
  glyph?: string[];
}
const particles: Particle[] = [];

function emit(p: Partial<Particle> & { x: number; y: number }) {
  if (particles.length > 400) return;
  particles.push({ vx: 0, vy: 0, g: 0, life: 1, size: 2, ...p, max: p.life ?? 1 });
}

function updateParticles(dt: number) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0 || p.y > H + 10) {
      particles.splice(i, 1);
      continue;
    }
    p.vy += p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.g > 0 && p.y > GROUND() - p.size) {
      p.y = GROUND() - p.size;
      p.vy *= -0.35;
      p.vx *= 0.6;
    }
    ctx.globalAlpha = Math.min(1, (p.life / p.max) * 2);
    if (p.glyph) drawGlyph(ctx, p.glyph, p.x, p.y, p.size);
    else {
      ctx.fillStyle = p.color ?? "#fff";
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Pets
// ---------------------------------------------------------------------------
type Mode = "walk" | "pause" | "mine" | "sleep";
const BULB: Record<AgentState, string> = {
  working: "#ffd84a",
  thinking: "#b892ff",
  waiting: "#7be0a4",
  attention: "#ff4d5e",
  idle: "#7a7a88",
};

class Pet {
  agent: Agent;
  x: number;
  dir: 1 | -1 = 1;
  lift = 0;
  vy = 0;
  landT = 0;
  mode: Mode = "walk";
  modeT = 0;
  targetX: number;
  t = Math.random() * 10;
  blinkT = rand(2, 5);
  homeX = 0;
  range = 150;
  bubble: HTMLDivElement;
  pinned = false;
  noteUntil = 0;
  note = "";
  happyUntil = 0;
  hovered = false;
  leaving = false;
  alpha = 0;
  swing = 0;
  crack = 0;
  nextZ = 0;
  box = { x: 0, y: 0, w: 0, h: 0, headY: 0 };

  constructor(agent: Agent, x: number) {
    this.agent = agent;
    this.x = x;
    this.targetX = x;
    this.bubble = document.createElement("div");
    this.bubble.className = "bubble";
    bubbleLayer.appendChild(this.bubble);
  }

  get scale() {
    return this.agent.kind === "sub" ? Math.max(1, S.scale - 1) : S.scale;
  }
  get theme() {
    const key = this.agent.kind === "sub" ? (this.agent.parentId ?? this.agent.id) : this.agent.id;
    return S.theme === "mix" ? THEMES[(hash(key) >>> 3) % THEMES.length] : themeOf(S.theme);
  }
  get color() {
    if (S.colorMode === "fixed") return S.color;
    const key = this.agent.kind === "sub" ? (this.agent.parentId ?? this.agent.id) : this.agent.id;
    const list = S.autoColors.length ? S.autoColors : DEFAULTS.autoColors;
    return list[hash(key) % list.length];
  }
  get speed() {
    return S.speed;
  }

  setAgent(next: Agent) {
    const prev = this.agent.state;
    this.agent = next;
    if (prev === next.state) return;
    if (next.state === "waiting" && (prev === "working" || prev === "thinking") && S.celebrate) {
      this.say("¡Listo!", 6000);
      this.celebrate();
    }
    if (next.state === "attention") this.hop();
    this.mode = "walk";
    this.pickTarget();
  }

  say(text: string, ms: number) {
    this.note = text;
    this.noteUntil = performance.now() + ms;
  }

  celebrate() {
    this.hop(300);
    this.happyUntil = performance.now() + 2500;
    const top = GROUND() - 20 * this.scale;
    const colors = ["#ffd84a", "#ff5d73", "#7be0a4", "#6aa6ff", "#ffffff"];
    for (let i = 0; i < 26; i++) {
      emit({ x: this.x, y: top, vx: rand(-110, 110), vy: rand(-260, -120), g: 520, life: rand(1, 1.8), size: Math.max(2, this.scale - 1), color: colors[i % colors.length] });
    }
    for (let i = 0; i < 3; i++) {
      emit({ x: this.x + rand(-20, 20), y: top - 10, vx: rand(-20, 20), vy: rand(-60, -30), life: 1.4, size: Math.max(1, this.scale - 1), glyph: i % 2 ? GLYPH_STAR : GLYPH_HEART });
    }
  }

  hop(power = 260) {
    if (this.lift === 0) this.vy = power;
  }

  pickTarget(range = this.range) {
    const half = 12 * this.scale;
    this.targetX = Math.max(half, Math.min(W - half, this.homeX + rand(-range, range)));
  }

  update(dt: number, parent?: Pet) {
    this.t += dt;
    this.modeT -= dt;
    this.landT -= dt;
    this.alpha = Math.min(1, this.alpha + dt * 2);

    // Gravity for hops, with a squash on landing.
    if (this.lift > 0 || this.vy > 0) {
      this.vy -= 900 * dt;
      this.lift = Math.max(0, this.lift + this.vy * dt);
      if (this.lift === 0) {
        this.vy = 0;
        this.landT = 0.12;
      }
    }

    if (this.leaving) {
      this.alpha -= dt * 1.5;
      return;
    }

    this.blinkT -= dt;
    if (this.blinkT < -0.14) this.blinkT = rand(2, 5);

    // Hovering freezes the pet so you can read its bubble.
    if (this.hovered || this.pinned) return;

    const s = this.agent.state;
    if (this.agent.kind === "sub" && parent) {
      this.homeX = parent.x + (hash(this.agent.id) % 2 ? 1 : -1) * (36 + (hash(this.agent.id) % 40));
    }

    switch (s) {
      case "working": {
        if (this.mode === "walk" && this.arrive(dt, 75)) {
          this.mode = "mine";
          this.modeT = rand(2.5, 5);
          this.crack = 0;
        } else if (this.mode !== "walk" && this.modeT <= 0) {
          this.mode = "walk";
          this.pickTarget(this.agent.kind === "sub" ? 30 : this.range);
        }
        if (this.mode === "mine") this.mine();
        if (Math.random() < dt * 0.4) {
          emit({ x: this.x - this.dir * 8 * this.scale, y: this.box.headY + 2 * this.scale, vx: -this.dir * 30, vy: -40, g: 300, life: 0.8, size: this.scale, color: "#8fd3ff" });
        }
        break;
      }
      case "thinking": {
        if (this.mode === "walk" && this.arrive(dt, 30)) {
          this.mode = "pause";
          this.modeT = rand(1, 2.5);
        } else if (this.mode !== "walk" && this.modeT <= 0) {
          this.mode = "walk";
          this.pickTarget(this.range * 0.7);
        }
        break;
      }
      case "attention": {
        if (Math.abs(this.x - this.homeX) > 4 && this.mode === "walk") {
          this.targetX = this.homeX;
          if (this.arrive(dt, 90)) this.mode = "pause";
        } else {
          this.mode = "pause";
          if (this.lift === 0 && this.modeT <= 0) {
            this.hop(230);
            this.modeT = 0.9;
          }
        }
        break;
      }
      case "waiting":
      case "idle": {
        if (this.mode !== "sleep") {
          this.targetX = this.homeX;
          if (this.arrive(dt, 45)) this.mode = "sleep";
        } else if (performance.now() > this.nextZ) {
          this.nextZ = performance.now() + 1400;
          const sc = Math.max(1, this.scale - 1);
          emit({ x: this.x + this.dir * 6 * this.scale, y: this.box.headY - 2 * sc, vx: this.dir * 12, vy: -22, life: 2.6, size: sc, glyph: GLYPH_Z });
        }
        break;
      }
    }
  }

  private mine() {
    const phase = Math.floor(this.t * 6) % 4;
    if (phase === 3 && this.swing !== 3) {
      // Strike!
      const sc = this.scale;
      const rx = this.x + this.dir * 18 * sc;
      this.crack = (this.crack + 1) % 4;
      const tool = this.theme.tool;
      if (tool === "wand") {
        // Magic burst at the wand tip.
        const colors = ["#ffd84a", "#b892ff", "#7be0ff", "#ffffff"];
        const wx = this.x + this.dir * 16 * sc;
        const wy = GROUND() - 8 * sc;
        for (let i = 0; i < 7; i++) emit({ x: wx, y: wy, vx: rand(-70, 70), vy: rand(-90, 20), life: rand(0.5, 0.9), size: Math.max(1, sc - 1), color: colors[i % 4] });
        emit({ x: wx, y: wy - 4 * sc, vx: this.dir * 20, vy: -40, life: 1, size: Math.max(1, sc - 2), glyph: GLYPH_STAR });
        this.swing = phase;
        return;
      }
      if (tool === "sword") {
        for (let i = 0; i < 4; i++) emit({ x: rx, y: GROUND() - 13 * sc, vx: rand(-80, 80), vy: rand(-120, -40), g: 500, life: 0.5, size: Math.max(1, sc - 1), color: i % 2 ? "#ffffff" : "#e8d9a8" });
        this.swing = phase;
        return;
      }
      for (let i = 0; i < 5; i++) {
        emit({ x: rx, y: GROUND() - 5 * sc, vx: rand(-60, 60) - this.dir * 40, vy: rand(-180, -80), g: 600, life: 0.7, size: Math.max(1, sc - 1), color: i % 2 ? "#ffd84a" : "#fff3b0" });
      }
      for (let i = 0; i < 2; i++) {
        emit({ x: rx, y: GROUND() - 4 * sc, vx: rand(-40, 40), vy: rand(-140, -60), g: 700, life: 1.2, size: sc, color: "#8a8c99" });
      }
    }
    this.swing = phase;
  }

  /** Move toward targetX; returns true when there. */
  private arrive(dt: number, speed: number) {
    const d = this.targetX - this.x;
    if (Math.abs(d) < 2) return true;
    this.dir = d > 0 ? 1 : -1;
    this.x += Math.sign(d) * Math.min(Math.abs(d), speed * this.speed * dt);
    return false;
  }

  draw(now: number) {
    const s = this.agent.state;
    const sc = this.scale;
    const still = this.hovered || this.pinned;
    ctx.globalAlpha = Math.max(0, this.alpha) * (s === "idle" ? 0.65 : 1);

    // Soft pixel shadow that shrinks while airborne.
    const shadowW = Math.round((18 - Math.min(this.lift / sc, 10)) * 0.9);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(Math.round(this.x - (shadowW * sc) / 2), GROUND() - sc + 1, shadowW * sc, sc);
    ctx.fillRect(Math.round(this.x - ((shadowW - 4) * sc) / 2), GROUND() - sc * 2 + 1, (shadowW - 4) * sc, sc);

    let pose: Pose = "stand";
    if (this.mode === "sleep" && !still) pose = "sleep";
    else if (this.lift > 0) pose = "jump";
    else if (this.landT > 0) pose = "land";
    else if (this.mode === "mine" && s === "working" && !still) pose = "mine";
    else if (this.mode === "walk" && !still && Math.abs(this.targetX - this.x) > 2) pose = "walk";

    const happy = now < this.happyUntil || this.hovered;
    let eyes: Eyes = "open";
    if (pose === "sleep") eyes = "closed";
    else if (s === "attention") eyes = "wide";
    else if (happy) eyes = "happy";
    else if (this.blinkT < 0) eyes = "blink";

    let mouth: Mouth = "smile";
    if (s === "attention") mouth = "open";
    else if (pose === "sleep") mouth = Math.sin(this.t * 2.2) > 0.3 ? "o" : "flat";
    else if (pose === "mine") mouth = "flat";
    else if (s === "thinking") mouth = "flat";

    const blinkRate = s === "attention" ? 6 : s === "working" ? 2 : 1;
    const bulbOn = s === "waiting" ? true : s === "idle" ? false : s === "thinking" ? Math.sin(this.t * 4) > 0 : Math.floor(this.t * blinkRate * 2) % 2 === 0;

    const theme = this.theme;
    if (pose === "mine") drawTarget(ctx, theme.tool, this.x + this.dir * 18 * sc, GROUND(), sc, this.crack);

    this.box = drawPet(ctx, this.x, GROUND(), {
      theme,
      frame: Math.floor(this.t * 60),
      palette: themePalette(theme, this.color),
      scale: sc,
      dir: this.dir,
      pose,
      eyes,
      mouth,
      walkPhase: Math.floor(this.t * (s === "working" ? 10 : 6)) % 4,
      breathe: Math.sin(this.t * 2.2) > 0.6,
      bulb: BULB[s],
      bulbOn,
      hat: S.hat && s === "working",
      swing: this.swing,
      lift: Math.round(this.lift / sc) * sc,
    });

    // --- Overlays by state ---
    const headY = this.box.headY;
    if (s === "thinking" && !still) drawThought(ctx, this.x, headY, this.dir, sc, this.t);
    if (s === "attention") drawAlert(ctx, this.x, headY, sc, now);
    ctx.globalAlpha = 1;
  }

  renderBubble(now: number) {
    const a = this.agent;
    const showInfo = this.hovered || this.pinned;
    const showNote = !showInfo && (now < this.noteUntil || a.state === "attention");
    const el = this.bubble;
    el.className = `bubble style-${S.bubbleStyle} size-${S.bubbleSize}`;
    el.style.setProperty("--accent", S.bubbleAccent);
    if (!showInfo && !showNote) return;

    let html: string;
    if (showInfo) {
      const title = a.kind === "sub" ? a.agentType || "Subagente" : a.name || a.project;
      const sub = [a.project, a.branch].filter(Boolean).join(" · ");
      const detail = !S.bubbleDetail
        ? ""
        : a.kind === "sub"
          ? a.description
          : a.state === "waiting"
            ? a.lastText
            : a.lastPrompt
              ? "Tarea: " + a.lastPrompt
              : "";
      html =
        `<div class="title">${esc(title)}</div>` +
        (sub && sub !== title ? `<div class="sub">${esc(sub)}</div>` : "") +
        `<div class="status ${a.state}"><span class="dot"></span>${esc(statusText(a))}</div>` +
        (detail ? `<div class="detail">${esc(detail)}</div>` : "");
    } else {
      html = esc(a.state === "attention" ? "¡Te necesito!" : this.note);
      el.classList.add("mini");
    }
    if (el.innerHTML !== html) el.innerHTML = html;
    el.classList.add("show");
    const half = el.offsetWidth / 2;
    const left = Math.max(half + 4, Math.min(W - half - 8, this.x));
    el.style.left = `${left}px`;
    const above = a.state === "attention" && !showInfo ? 15 * this.scale : a.state === "thinking" ? 6 * this.scale : 0;
    el.style.top = `${Math.max(2, this.box.y - el.offsetHeight - 10 - above)}px`;
  }

  destroy() {
    this.bubble.remove();
  }
}

function statusText(a: Agent) {
  switch (a.state) {
    case "working":
      return `Trabajando · ${a.activity || "…"}`;
    case "thinking":
      return "Pensando…";
    case "waiting":
      return "Terminé, esperando tu respuesta";
    case "attention":
      return `¡Necesito tu permiso! ${a.activity}`;
    case "idle":
      return "Durmiendo (sin actividad)";
  }
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

// ---------------------------------------------------------------------------
// World: which agents get a pet, and where they live
// ---------------------------------------------------------------------------
const pets = new Map<string, Pet>();
let demo = !isTauri;
let lastAgents: Agent[] = [];
/** Last time each session was seen doing something. */
const lastActive = new Map<string, number>();

const ACTIVE: AgentState[] = ["working", "thinking", "attention"];
const PRIORITY: Record<AgentState, number> = { attention: 0, working: 1, thinking: 1, waiting: 2, idle: 3 };

function visible(list: Agent[]) {
  const now = Date.now();
  for (const a of list) if (ACTIVE.includes(a.state)) lastActive.set(a.id, now);
  const keepFor = S.idleMinutes * 60_000;
  const mains = list
    .filter((a) => a.kind === "main")
    .filter((a) => {
      if (ACTIVE.includes(a.state) || S.showAllOpen) return true;
      const seen = lastActive.get(a.id);
      if (seen !== undefined) return now - seen < keepFor;
      // Fallback mode (old Claude Code, no registry): use transcript age.
      return !a.status && a.idleMs < keepFor;
    })
    .sort((a, b) => PRIORITY[a.state] - PRIORITY[b.state] || a.idleMs - b.idleMs)
    .slice(0, Math.max(1, S.maxPets));
  const ids = new Set(mains.map((a) => a.id));
  const subs = S.showSubagents ? list.filter((a) => a.kind === "sub" && a.parentId && ids.has(a.parentId)) : [];
  return [...mains.sort((a, b) => a.id.localeCompare(b.id)), ...subs];
}

const ZONES = { all: [0.04, 0.96], left: [0.04, 0.42], center: [0.3, 0.7], right: [0.55, 0.97] } as const;

let lastLog = "";
function setAgents(input: Agent[]) {
  lastAgents = input;
  const list = visible(input);
  if (import.meta.env.DEV && isTauri) {
    const line = list.map((a) => `${a.kind}:${a.id.slice(0, 8)}:${a.state}:${a.name.slice(0, 20)}`).join(" | ");
    if (line !== lastLog) {
      lastLog = line;
      import("@tauri-apps/api/core").then(({ invoke }) => invoke("log_js", { msg: `pets: ${line}` }));
    }
  }
  const ids = new Set(list.map((a) => a.id));
  for (const [id, pet] of pets) if (!ids.has(id)) pet.leaving = true;

  const mains = list.filter((a) => a.kind === "main");
  const [z0, z1] = ZONES[S.zone] ?? ZONES.right;
  const slot = ((z1 - z0) * W) / (mains.length + 1);
  mains.forEach((a, i) => {
    const home = W * z0 + slot * (i + 1);
    let pet = pets.get(a.id);
    if (!pet || pet.leaving) {
      pet?.destroy();
      pet = new Pet(a, home + rand(-30, 30));
      pets.set(a.id, pet);
    } else {
      pet.setAgent(a);
    }
    pet.homeX = home;
    pet.range = Math.max(30, Math.min(170, slot * 0.6));
  });
  for (const a of list.filter((a) => a.kind === "sub")) {
    let pet = pets.get(a.id);
    const parent = a.parentId ? pets.get(a.parentId) : undefined;
    if (!pet || pet.leaving) {
      pet?.destroy();
      pet = new Pet(a, (parent?.x ?? W / 2) + rand(-20, 20));
      pet.hop(200);
      pets.set(a.id, pet);
    } else {
      pet.setAgent(a);
    }
  }
}

function resize() {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const firstLayout = W === 0;
  W = r.width;
  H = r.height;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  setAgents(lastAgents);
  if (firstLayout) for (const p of pets.values()) p.x = p.homeX + rand(-30, 30);
}
new ResizeObserver(resize).observe(canvas);

// ---------------------------------------------------------------------------
// Hover / click-through
// ---------------------------------------------------------------------------
let cursor = { x: -1, y: -1 };
let clickThrough = true;

async function setClickThrough(ignore: boolean) {
  if (ignore === clickThrough) return;
  clickThrough = ignore;
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_click_through", { ignore });
  }
}

type Rect = { x: number; y: number; w: number; h: number };
const inRect = (p: { x: number; y: number }, r: Rect, pad = 0) =>
  p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;

function updateHover() {
  let any = false;
  let taken = false;
  for (const pet of [...pets.values()].reverse()) {
    let over = false;
    if (!taken && !pet.leaving) {
      over = inRect(cursor, pet.box, 4);
      if (!over && (pet.hovered || pet.pinned) && pet.bubble.classList.contains("show")) {
        const r = pet.bubble.getBoundingClientRect();
        const c = canvas.getBoundingClientRect();
        over = inRect(cursor, { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height + 16 }, 4);
      }
    }
    if (over) taken = true;
    if (over && !pet.hovered) pet.dir = cursor.x > pet.x ? 1 : -1;
    pet.hovered = over;
    any ||= over || pet.pinned;
  }
  setClickThrough(!any);
}

function petAt(e: MouseEvent) {
  const r = canvas.getBoundingClientRect();
  const p = { x: e.clientX - r.left, y: e.clientY - r.top };
  return [...pets.values()].reverse().find((pet) => !pet.leaving && inRect(p, pet.box, 4));
}

canvas.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  const pet = petAt(e);
  if (pet) {
    pet.hop();
    pet.pinned = !pet.pinned;
  }
});
canvas.addEventListener("contextmenu", async (e) => {
  e.preventDefault();
  if (!petAt(e)) return;
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    invoke("open_settings");
  } else {
    window.open("/settings.html", "_blank");
  }
});

if (!isTauri) {
  window.addEventListener("mousemove", (e) => {
    const r = canvas.getBoundingClientRect();
    cursor = { x: e.clientX - r.left, y: e.clientY - r.top };
  });
}

// ---------------------------------------------------------------------------
// Demo mode (tray menu, or automatically in a normal browser)
// ---------------------------------------------------------------------------
function mk(id: string, name: string, project: string, state: AgentState, activity: string): Agent {
  return {
    id, parentId: null, kind: "main", project, cwd: "", branch: "main", state, activity, name, status: "busy",
    lastText: "He terminado la refactorización y los tests pasan. ¿Quieres que lo suba?",
    lastPrompt: "Refactoriza el lector de sesiones y añade tests", agentType: "", description: "", idleMs: 0,
  };
}
const DEMO: Agent[] = [
  mk("demo-1", "Mascota en la barra de tareas", "pet_in_windows", "working", "Edit sessions.rs"),
  mk("demo-2", "Revisión nota de planificación", "muninn", "thinking", ""),
  mk("demo-3", "Migraciones de seguridad", "muninn", "waiting", ""),
  mk("demo-4", "Deploy de la landing", "aboutme", "attention", "Bash npm run deploy"),
  { ...mk("demo-sub", "", "pet_in_windows", "working", "Grep cursor_position"), kind: "sub", parentId: "demo-1", agentType: "Explore", description: "Find how Tauri reports the cursor" },
];
let demoTick = 0;
setInterval(() => {
  if (!demo) return;
  demoTick++;
  const states: AgentState[] = ["working", "thinking", "working", "waiting", "attention"];
  DEMO.forEach((a, i) => {
    if (a.kind === "main" && demoTick % 3 === i % 3) a.state = states[(demoTick + i) % states.length];
  });
  setAgents(DEMO.map((a) => ({ ...a })));
}, 7000);

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
S = await loadSettings();
onSettings((s) => {
  S = s;
  setAgents(lastAgents);
});

if (isTauri) {
  const { invoke } = await import("@tauri-apps/api/core");
  const log = (msg: string) => invoke("log_js", { msg }).catch(() => {});
  window.addEventListener("error", (e) => log(`error: ${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) => log(`rejection: ${String(e.reason)}`));
  const { listen } = await import("@tauri-apps/api/event");
  await listen<Agent[]>("agents", (e) => {
    if (!demo) setAgents(e.payload);
  });
  await listen<{ x: number; y: number }>("cursor", (e) => {
    cursor = e.payload;
  });
  await listen("toggle-demo", () => {
    demo = !demo;
    if (demo) setAgents(DEMO.map((a) => ({ ...a })));
  });
} else {
  document.body.classList.add("browser");
}
if (demo) setAgents(DEMO.map((a) => ({ ...a })));

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  ctx.clearRect(0, 0, W, H);
  updateHover();
  for (const [id, pet] of pets) {
    const parent = pet.agent.parentId ? pets.get(pet.agent.parentId) : undefined;
    pet.update(dt, parent);
    if (pet.leaving && pet.alpha <= 0) {
      pet.destroy();
      pets.delete(id);
      continue;
    }
    pet.draw(now);
    pet.renderBubble(now);
  }
  updateParticles(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
