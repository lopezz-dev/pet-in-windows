import { defineConfig } from "vite";

// Tauri expects a fixed port and doesn't want the terminal cleared.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2022" },
});
