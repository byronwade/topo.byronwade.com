import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    manifest: "manifest.json",
  },
  server: {
    port: 4173,
  },
});
