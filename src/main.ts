import { BODY_COLORS, GLYPHS, SPRITES, drawGrid, drawPickaxe, type Grid } from "./sprites";

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
  idleMs: number;
}

const isTauri = "__TAURI_INTERNALS__" in window;

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------
const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const bubbleLayer = document.getElementById("bubbles")!;
let W = 0;
let H = 0;

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
  // Re-spread homes for the new width.
  if (pets.size) setAgents([...pets.values()].filter((p) => !p.leaving).map((p) => p.agent));
  if (firstLayout) for (const p of pets.values()) p.x = p.homeX + rand(-40, 40);
}
new ResizeObserver(resize).observe(canvas);

const GROUND = () => H - 1; // feet touch the top of the taskbar
const rand = (a: number, b: number) => a + Math.random() * (b - a);

function hash(s: string) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Pets
// ---------------------------------------------------------------------------
type Mode = "walk" | "pause" | "mine" | "sleep";

class Pet {
  agent: Agent;
  x: number;
  dir: 1 | -1 = 1;
  jumpY = 0;
  vy = 0;
  mode: Mode = "walk";
  modeT = 0;
  targetX: number;
  t = Math.random() * 10;
  blinkT = rand(2, 5);
  scale: number;
  colors: [string, string];
  homeX = 0;
  bubble: HTMLDivElement;
  pinned = false;
  noteUntil = 0;
  note = "";
  hovered = false;
  leaving = false;
  alpha = 0;

  constructor(agent: Agent, x: number) {
    this.agent = agent;
    this.x = x;
    this.targetX = x;
    this.scale = agent.kind === "sub" ? 2 : 3;
    this.colors = BODY_COLORS[hash(agent.kind === "sub" ? agent.parentId ?? agent.id : agent.id) % BODY_COLORS.length];
    this.bubble = document.createElement("div");
    this.bubble.className = "bubble";
    bubbleLayer.appendChild(this.bubble);
  }

  get w() {
    return 16 * this.scale;
  }
  get h() {
    return 12 * this.scale;
  }

  setAgent(next: Agent) {
    const prev = this.agent.state;
    this.agent = next;
    if (prev !== next.state) {
      if (next.state === "waiting" && (prev === "working" || prev === "thinking")) {
        this.say("¡Listo!", 6000);
        this.hop();
      }
      if (next.state === "attention") this.hop();
      this.mode = "walk";
      this.pickTarget();
    }
  }

  say(text: string, ms: number) {
    this.note = text;
    this.noteUntil = performance.now() + ms;
  }

  hop(power = 260) {
    if (this.jumpY === 0) this.vy = power;
  }

  pickTarget(range = 160) {
    this.targetX = Math.max(this.w, Math.min(W - this.w, this.homeX + rand(-range, range)));
  }

  update(dt: number, parent?: Pet) {
    this.t += dt;
    this.modeT -= dt;
    this.alpha = Math.min(1, this.alpha + dt * 2);

    // Gravity for hops.
    if (this.jumpY > 0 || this.vy > 0) {
      this.vy -= 900 * dt;
      this.jumpY = Math.max(0, this.jumpY + this.vy * dt);
      if (this.jumpY === 0) this.vy = 0;
    }

    // Leaving pets walk off-screen, then get removed.
    if (this.leaving) {
      this.alpha -= dt * 1.5;
      return;
    }

    // Hovering freezes the pet so you can read its bubble.
    if (this.hovered || this.pinned) {
      this.blinkT -= dt;
      if (this.blinkT < -0.15) this.blinkT = rand(2, 5);
      return;
    }

    const s = this.agent.state;
    if (this.agent.kind === "sub" && parent) {
      this.homeX = parent.x + (hash(this.agent.id) % 2 ? 1 : -1) * (40 + (hash(this.agent.id) % 40));
    }

    switch (s) {
      case "working": {
        // Walk somewhere, mine for a bit, repeat.
        if (this.mode === "walk" && this.arrive(dt, 70)) {
          this.mode = "mine";
          this.modeT = rand(2, 4);
        } else if (this.mode !== "walk" && this.modeT <= 0) {
          this.mode = "walk";
          this.pickTarget(this.agent.kind === "sub" ? 30 : 200);
        }
        break;
      }
      case "thinking": {
        // Slow pacing with pauses.
        if (this.mode === "walk" && this.arrive(dt, 30)) {
          this.mode = "pause";
          this.modeT = rand(1, 2.5);
        } else if (this.mode !== "walk" && this.modeT <= 0) {
          this.mode = "walk";
          this.pickTarget(120);
        }
        break;
      }
      case "attention": {
        if (Math.abs(this.x - this.homeX) > 4 && this.mode === "walk") {
          this.targetX = this.homeX;
          if (this.arrive(dt, 90)) this.mode = "pause";
        } else {
          this.mode = "pause";
          if (this.jumpY === 0 && this.modeT <= 0) {
            this.hop(220);
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
        }
        break;
      }
    }

    this.blinkT -= dt;
    if (this.blinkT < -0.15) this.blinkT = rand(2, 5);
  }

  /** Move toward targetX; returns true when there. */
  private arrive(dt: number, speed: number) {
    const d = this.targetX - this.x;
    if (Math.abs(d) < 2) return true;
    this.dir = d > 0 ? 1 : -1;
    this.x += Math.sign(d) * Math.min(Math.abs(d), speed * dt);
    return false;
  }

  bounds() {
    const top = GROUND() - this.h - this.jumpY;
    return { x: this.x - this.w / 2, y: top, w: this.w, h: this.h };
  }

  draw(now: number) {
    const s = this.agent.state;
    const sc = this.scale;
    const b = this.bounds();
    ctx.globalAlpha = Math.max(0, this.alpha) * (s === "idle" ? 0.6 : 1);

    // Shadow
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    const shadowW = this.w * (0.8 - Math.min(this.jumpY, 40) / 120);
    ctx.fillRect(Math.round(this.x - shadowW / 2), GROUND() - sc / 2, shadowW, sc / 2 + 1);

    let grid: Grid;
    let bob = 0;
    if (this.mode === "sleep") {
      grid = SPRITES.sleep;
      bob = Math.sin(this.t * 2) > 0.6 ? -1 : 0;
    } else if (s === "attention") {
      grid = SPRITES.shout;
    } else if (this.mode === "walk" && !this.hovered && !this.pinned) {
      const fast = s === "working" ? 7 : 4;
      const step = Math.floor(this.t * fast) % 2;
      grid = step ? SPRITES.standB : SPRITES.standA;
      bob = step ? -1 : 0;
    } else {
      grid = this.blinkT < 0 ? SPRITES.blink : SPRITES.standA;
    }
    drawGrid(ctx, grid, b.x, b.y + bob * sc, sc, this.colors);

    // --- Overlays by state ---
    const headY = b.y;
    if (this.mode === "mine" && s === "working") {
      // 3 chunky swing steps, strike on the last one.
      const phase = Math.floor(this.t * 6) % 4;
      const angles = [1.9, 1.3, 0.6, 0.6];
      const gx = this.x + this.dir * (this.w / 2 - sc);
      const gy = b.y + 7 * sc;
      drawPickaxe(ctx, gx, gy, angles[phase], this.dir, sc);
      // Rock + sparks
      const rockX = this.x + this.dir * (this.w / 2 + 7 * sc);
      ctx.fillStyle = "#7d7d86";
      ctx.fillRect(Math.round(rockX - 2 * sc), GROUND() - 3 * sc, 4 * sc, 3 * sc);
      ctx.fillStyle = "#9a9aa3";
      ctx.fillRect(Math.round(rockX - 2 * sc), GROUND() - 3 * sc, 2 * sc, sc);
      if (phase >= 2) drawGrid(ctx, GLYPHS.spark, rockX - 1.5 * sc + rand(-sc, sc), GROUND() - 7 * sc, sc - 1 || 1);
      // Sweat drop now and then
      if (Math.floor(this.t * 1.5) % 3 === 0) {
        ctx.fillStyle = "#7cc4ff";
        ctx.fillRect(Math.round(this.x - this.dir * (this.w / 2 - 2 * sc)), headY + 2 * sc + ((this.t * 20) % (3 * sc)), sc, sc);
      }
    }
    if (s === "thinking") {
      // Thought dots: 3 dots blinking in sequence above the head.
      const n = Math.floor(this.t * 3) % 4;
      for (let i = 0; i < n; i++) {
        drawGrid(ctx, [".ww.", "wwww", "wwww", ".ww."], this.x - 6 * sc + i * 5 * sc, headY - 6 * sc, Math.max(1, sc - 1));
      }
    }
    if (this.mode === "sleep") {
      // Zzz drifting up.
      for (let i = 0; i < 3; i++) {
        const p = (this.t * 0.5 + i / 3) % 1;
        ctx.globalAlpha = Math.max(0, this.alpha) * (1 - p);
        drawGrid(ctx, GLYPHS.z, this.x + this.w / 3 + p * 6 * sc, headY + 2 * sc - p * 14 * sc, Math.max(1, sc - 1 - (i === 0 ? 0 : 1)));      }
      ctx.globalAlpha = Math.max(0, this.alpha);
    }
    if (s === "attention") {
      const blink = Math.floor(now / 300) % 2;
      if (blink) drawGrid(ctx, GLYPHS.bang, this.x - sc, headY - 7 * sc, sc);
    }
    ctx.globalAlpha = 1;
  }

  renderBubble(now: number) {
    const a = this.agent;
    const showInfo = this.hovered || this.pinned;
    const showNote = !showInfo && (now < this.noteUntil || a.state === "attention");
    const el = this.bubble;
    if (!showInfo && !showNote) {
      el.classList.remove("show");
      return;
    }
    let html: string;
    if (showInfo) {
      const title = a.kind === "sub" ? `${a.agentType || "subagente"} · ${a.project}` : `${a.project}${a.branch ? " · " + a.branch : ""}`;
      const detail =
        a.kind === "sub"
          ? a.description
          : a.state === "waiting"
            ? a.lastText
            : a.lastPrompt
              ? "Tarea: " + a.lastPrompt
              : "";
      html = `<div class="title">${esc(title)}</div><div class="status ${a.state}">${esc(statusText(a))}</div>${
        detail ? `<div class="detail">${esc(detail)}</div>` : ""
      }`;
      el.classList.remove("mini");
    } else {
      html = esc(a.state === "attention" ? "¡Te necesito!" : this.note);
      el.classList.add("mini");
    }
    if (el.innerHTML !== html) el.innerHTML = html;
    el.classList.add("show");
    const b = this.bounds();
    const half = el.offsetWidth / 2;
    const left = Math.max(half + 4, Math.min(W - half - 8, this.x));
    el.style.left = `${left}px`;
    el.style.top = `${b.y - el.offsetHeight - 14}px`;
    el.style.bottom = "auto";
  }

  destroy() {
    this.bubble.remove();
  }
}

function statusText(a: Agent) {
  switch (a.state) {
    case "working":
      return `Trabajando: ${a.activity || "…"}`;
    case "thinking":
      return "Pensando…";
    case "waiting":
      return "Terminé — esperando tu respuesta";
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
// World: reconcile agents -> pets
// ---------------------------------------------------------------------------
const pets = new Map<string, Pet>();
let demo = !isTauri;
let realAgents: Agent[] = [];

function setAgents(list: Agent[]) {
  const ids = new Set(list.map((a) => a.id));
  for (const [id, pet] of pets) if (!ids.has(id)) pet.leaving = true;

  const mains = list.filter((a) => a.kind === "main");
  mains.forEach((a, i) => {
    // Spread homes evenly across the right 2/3 of the screen.
    const home = W * (0.33 + (0.62 * (i + 1)) / (mains.length + 1));
    let pet = pets.get(a.id);
    if (!pet || pet.leaving) {
      pet?.destroy();
      pet = new Pet(a, home + rand(-40, 40));
      pets.set(a.id, pet);
    } else {
      pet.setAgent(a);
    }
    pet.homeX = home;
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

function inRect(p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }, pad = 0) {
  return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
}

function updateHover() {
  let any = false;
  // Topmost first so only one pet reacts.
  const ordered = [...pets.values()].reverse();
  let taken = false;
  for (const pet of ordered) {
    let over = false;
    if (!taken && !pet.leaving) {
      over = inRect(cursor, pet.bounds(), 6);
      if (!over && pet.bubble.classList.contains("show") && (pet.hovered || pet.pinned)) {
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

function petAt(p: { x: number; y: number }) {
  return [...pets.values()].reverse().find((pet) => !pet.leaving && inRect(p, pet.bounds(), 6));
}

canvas.addEventListener("mousedown", (e) => {
  const r = canvas.getBoundingClientRect();
  const pet = petAt({ x: e.clientX - r.left, y: e.clientY - r.top });
  if (pet) {
    pet.hop();
    pet.pinned = !pet.pinned;
  }
});

if (!isTauri) {
  // Browser preview: real mouse events instead of the Rust cursor feed.
  window.addEventListener("mousemove", (e) => {
    const r = canvas.getBoundingClientRect();
    cursor = { x: e.clientX - r.left, y: e.clientY - r.top };
  });
}

// ---------------------------------------------------------------------------
// Demo mode (tray menu, or automatically in a normal browser)
// ---------------------------------------------------------------------------
const DEMO: Agent[] = [
  mk("demo-1", "pet_in_windows", "working", "Edit sessions.rs"),
  mk("demo-2", "huginnDB", "thinking", ""),
  mk("demo-3", "aboutme", "waiting", ""),
  mk("demo-4", "bitacora", "attention", "Bash npm run deploy"),
  { ...mk("demo-sub", "pet_in_windows", "working", "Grep cursor_position"), kind: "sub", parentId: "demo-1", agentType: "Explore", description: "Find how Tauri reports the cursor" },
];
function mk(id: string, project: string, state: AgentState, activity: string): Agent {
  return {
    id, parentId: null, kind: "main", project, cwd: "", branch: "main", state, activity,
    lastText: "He terminado la refactorización y los tests pasan. ¿Quieres que lo suba?",
    lastPrompt: "Refactoriza el lector de sesiones y añade tests", agentType: "", description: "", idleMs: 0,
  };
}
let demoTick = 0;
function demoStep() {
  demoTick++;
  const states: AgentState[] = ["working", "thinking", "working", "waiting", "attention"];
  DEMO.forEach((a, i) => {
    if (a.kind === "main" && demoTick % 3 === i % 3) a.state = states[(demoTick + i) % states.length];
  });
}
setInterval(() => {
  if (!demo) return;
  demoStep();
  setAgents(DEMO.map((a) => ({ ...a })));
}, 7000);

// ---------------------------------------------------------------------------
// Tauri wiring
// ---------------------------------------------------------------------------
if (isTauri) {
  const { invoke } = await import("@tauri-apps/api/core");
  const log = (msg: string) => invoke("log_js", { msg }).catch(() => {});
  window.addEventListener("error", (e) => log(`error: ${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) => log(`rejection: ${String(e.reason)}`));
  document.addEventListener("visibilitychange", () => log(`visibility: ${document.visibilityState}`));
  if (import.meta.env.DEV) {
    setInterval(() => log(`alive: pets=${pets.size} W=${W} H=${H} vis=${document.visibilityState}`), 30000);
  }
  const { listen } = await import("@tauri-apps/api/event");
  await listen<Agent[]>("agents", (e) => {
    realAgents = e.payload;
    if (!demo) setAgents(realAgents);
  });
  await listen<{ x: number; y: number }>("cursor", (e) => {
    cursor = e.payload;
  });
  await listen("toggle-demo", () => {
    demo = !demo;
    setAgents(demo ? DEMO.map((a) => ({ ...a })) : realAgents);
  });
} else {
  document.body.classList.add("browser");
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
if (demo) setAgents(DEMO.map((a) => ({ ...a })));
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
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
