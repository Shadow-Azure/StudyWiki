import path from "node:path";
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
  // Vendored cordis + cosmokit resolve from vendor/ in dev, test and build.
  resolve: {
    alias: {
      cordis: path.resolve(__dirname, "vendor/cordis/src/index.ts"),
      cosmokit: path.resolve(__dirname, "vendor/cosmokit/lib/index.mjs"),
    },
  },
});
