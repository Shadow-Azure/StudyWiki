import { defineConfig } from "vite";

// Tauri dev server conventions: fixed port (Tauri watches this URL) and no
// external network — the built client must stay offline-only.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  // Env headers would let dev inject environment differences into the client;
  // the shipped client must behave identically everywhere.
  envPrefix: ["STUDYWIKI_"],
});
