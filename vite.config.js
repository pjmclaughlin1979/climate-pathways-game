import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the same build works under a GitHub Pages sub-path or a root domain.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: Number(process.env.PORT) || 5181 },
  build: { chunkSizeWarningLimit: 4000 },
});
