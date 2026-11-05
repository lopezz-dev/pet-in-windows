// User settings: shape, defaults and persistence.
// In the app they live in <config dir>/settings.json (via Rust) and every
// window gets a "settings" event when they change. In a plain browser
// (preview) they fall back to localStorage.

export type BubbleStyle = "pixel" | "comic" | "dark" | "glass";
export type Zone = "all" | "left" | "center" | "right";

export interface Settings {
  // Pet
  colorMode: "auto" | "fixed";
  color: string; // used when colorMode = fixed
  autoColors: string[]; // rotation when colorMode = auto
  scale: number; // pixels per sprite pixel
  hat: boolean; // miner helmet while working
  speed: number; // walking speed multiplier
  // Bubble
  bubbleStyle: BubbleStyle;
  bubbleSize: "S" | "M" | "L";
  bubbleAccent: string;
  bubbleDetail: boolean;
  // Behaviour
  zone: Zone;
  idleMinutes: number; // how long a finished session stays on screen
  showAllOpen: boolean; // also show sessions that were already idle at start
  maxPets: number;
  showSubagents: boolean;
  celebrate: boolean; // "¡Listo!" + confetti when an agent finishes
}

export const PRESET_COLORS = [
  "#d97757", // terracotta
  "#e8a33d", // amber
  "#7fb069", // moss
  "#4fb3a9", // teal
  "#6a9fe0", // sky
  "#9b7fe0", // lavender
  "#e07fb0", // bubblegum
  "#8d8d99", // stone
];

export const DEFAULTS: Settings = {
  colorMode: "auto",
  color: "#d97757",
  autoColors: [...PRESET_COLORS],
  scale: 3,
  hat: true,
  speed: 1,
  bubbleStyle: "pixel",
  bubbleSize: "M",
  bubbleAccent: "#d97757",
  bubbleDetail: true,
  zone: "right",
  idleMinutes: 15,
  showAllOpen: false,
  maxPets: 6,
  showSubagents: true,
  celebrate: true,
};

export const isTauri = "__TAURI_INTERNALS__" in window;
const LS_KEY = "pet-settings";

function merge(raw: unknown): Settings {
  if (!raw || typeof raw !== "object") return { ...DEFAULTS };
  return { ...DEFAULTS, ...(raw as Partial<Settings>) };
}

export async function loadSettings(): Promise<Settings> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return merge(await invoke("load_settings"));
  }
  try {
    return merge(JSON.parse(localStorage.getItem(LS_KEY) ?? "null"));
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveSettings(s: Settings) {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_settings", { settings: s });
  } else {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(s));
    } catch {
      /* private mode etc. */
    }
    window.dispatchEvent(new CustomEvent("pet-settings", { detail: s }));
  }
}

export async function onSettings(cb: (s: Settings) => void) {
  if (isTauri) {
    const { listen } = await import("@tauri-apps/api/event");
    await listen<Settings>("settings", (e) => cb(merge(e.payload)));
  } else {
    window.addEventListener("pet-settings", (e) => cb(merge((e as CustomEvent).detail)));
    window.addEventListener("storage", (e) => {
      if (e.key === LS_KEY) cb(merge(JSON.parse(e.newValue ?? "null")));
    });
  }
}
